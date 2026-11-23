package com.kadenetworks.smsbridge

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * The gateway loop, as a foreground service (Android keeps it running; a notification shows it is on).
 * Each round: finish local work → send outcome reports → ask Kade Cloud for jobs (long poll, up to 25 s) → send them.
 * Network errors back off from 5 s to 60 s and recover by themselves. Revocation in Kade Cloud stops the phone.
 */
class GatewayService : Service() {
    companion object {
        @Volatile private var thread: Thread? = null
        private val lock = Object()
        fun start(ctx: Context) {
            val i = Intent(ctx, GatewayService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
        fun stop(ctx: Context) { Store(ctx).running = false; ctx.stopService(Intent(ctx, GatewayService::class.java)) }
        /** Wake the loop early (a result or an opt-out is waiting). */
        fun poke(ctx: Context) { synchronized(lock) { lock.notifyAll() } }
    }
    private var wake: PowerManager.WakeLock? = null
    @Volatile private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel("gw", "Gateway", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "gw") else @Suppress("DEPRECATION") Notification.Builder(this))
            .setSmallIcon(android.R.drawable.stat_notify_chat).setContentTitle("Kade SMS Bridge is on")
            .setContentText("Sending SMS for Kade Cloud").setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING) else startForeground(1, n)
        val store = Store(this)
        if (!store.paired) { stopSelf(); return START_NOT_STICKY }
        store.running = true
        if (wake == null) wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kade:gateway").apply { setReferenceCounted(false); acquire() }
        if (thread?.isAlive != true) { stopping = false; thread = Thread { loop(store) }.apply { name = "kade-gateway"; start() } }
        return START_STICKY
    }

    override fun onDestroy() { stopping = true; synchronized(lock) { lock.notifyAll() }; thread?.interrupt(); wake?.release(); wake = null; super.onDestroy() }

    private fun loop(store: Store) {
        var backoff = 5000L
        while (!stopping && store.running) {
            try {
                val server = store.server ?: break; val token = store.token() ?: break
                finishLocal(store)
                flush(store, server, token)
                if (store.rotateAfter in 1 until System.currentTimeMillis()) {
                    val r = Api.post(server, "/api/smsgw/device/rotate", JSONObject(), token); store.setToken(r.getString("token")); store.rotateAfter = 0
                }
                val canSend = checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
                val pending = store.jobs().let { j -> j.keys().asSequence().count { j.getJSONObject(it).optString("state") in setOf("claimed", "handed") } }
                val info = DeviceInfo.collect(this, pending)
                val hb = Api.post(server, "/api/smsgw/device/heartbeat", JSONObject().put("info", info), store.token())
                store.enabled = hb.optBoolean("enabled"); store.deviceName = hb.optString("name", store.deviceName ?: ""); if (hb.has("rotateAfter")) store.rotateAfter = hb.getLong("rotateAfter")
                store.lastContact = System.currentTimeMillis(); store.lastError = null; backoff = 5000L
                if (!store.enabled || !canSend || pending > 0) { waitMs(if (pending > 0) 3000 else 20000); continue }
                val r = Api.post(server, "/api/smsgw/device/claim", JSONObject().put("max", 5).put("wait", 25).put("info", info), store.token(), timeoutMs = 40000)
                val jobs = r.optJSONArray("jobs") ?: JSONArray()
                if (jobs.length() > 0) {
                    val all = store.jobs()
                    for (i in 0 until jobs.length()) { val j = jobs.getJSONObject(i); all.put(j.getString("id"), JSONObject().put("to", j.getString("to")).put("message", j.getString("message")).put("state", "claimed").put("claimedAt", System.currentTimeMillis())) }
                    store.saveJobs(all)
                    for (i in 0 until jobs.length()) { Sender.send(this, store, jobs.getJSONObject(i).getString("id")); Thread.sleep(1500) }
                }
            } catch (e: ApiException) {
                store.lastError = e.message
                if (e.code == 401) { if (e.revoked) { store.unpair() }; store.running = false; break }
                waitMs(backoff); backoff = minOf(60000L, backoff * 2)
            } catch (e: InterruptedException) { break
            } catch (e: Exception) {
                store.lastError = "No connection to Kade Cloud (" + (e.message ?: e.javaClass.simpleName) + ")"
                waitMs(backoff); backoff = minOf(60000L, backoff * 2)
            }
        }
        stopSelf()
    }

    /** Claimed but not yet handed (app was stopped in between): safe to send now. Handed long ago with no result: unknown. */
    private fun finishLocal(store: Store) {
        val now = System.currentTimeMillis(); val all = store.jobs(); val old = ArrayList<String>()
        for (id in all.keys().asSequence().toList()) {
            val j = all.getJSONObject(id)
            when (j.optString("state")) {
                "claimed" -> if (checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) Sender.send(this, store, id)
                "handed" -> if (now - j.optLong("handedAt") > 5 * 60_000) {
                    store.updateJob(id) { it.put("state", "unknown") }
                    store.addReport(JSONObject().put("id", id).put("status", "unknown").put("error", "Handed to the SIM but no result came back (phone restarted or no network)"))
                }
                else -> if (now - j.optLong("doneAt", j.optLong("handedAt", now)) > 2 * 86_400_000L) old.add(id)
            }
        }
        if (old.isNotEmpty()) store.prune(old)
    }

    private fun flush(store: Store, server: String, token: String) {
        val reps = store.reports()
        if (reps.length() > 0) { val n = minOf(100, reps.length()); val batch = JSONArray(); for (i in 0 until n) batch.put(reps.get(i)); Api.post(server, "/api/smsgw/device/report", JSONObject().put("results", batch), token); store.dropReports(n) }
        val inb = store.takeInbound()
        for (i in 0 until inb.length()) try { Api.post(server, "/api/smsgw/device/inbound", inb.getJSONObject(i), token) } catch (e: Exception) { store.addInbound(inb.getJSONObject(i)); throw e }
    }

    private fun waitMs(ms: Long) { synchronized(lock) { try { lock.wait(ms) } catch (_: InterruptedException) {} } }
}
