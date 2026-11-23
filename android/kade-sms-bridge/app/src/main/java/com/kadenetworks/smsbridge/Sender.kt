package com.kadenetworks.smsbridge

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import org.json.JSONObject

/**
 * Hands one job to the SIM. States on the phone:
 *  claimed → handed (given to the radio; the text is then deleted here) → sent / failed (all parts reported).
 * A job is handed at most once. If the app dies after handing it and no result comes back, the job is reported as
 * "unknown" and never sent again automatically.
 */
object Sender {
    const val ACTION_SENT = "com.kadenetworks.smsbridge.SENT"
    const val ACTION_DELIVERED = "com.kadenetworks.smsbridge.DELIVERED"

    fun smsManager(ctx: Context): SmsManager =
        if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()

    fun send(ctx: Context, store: Store, id: String) {
        val job = store.jobs().optJSONObject(id) ?: return
        if (job.optString("state") != "claimed") return
        val to = job.getString("to").let { if (it.startsWith("+")) it else "+$it" }; val text = job.optString("message")
        val sms = smsManager(ctx)
        val parts = sms.divideMessage(text)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        val sent = ArrayList<PendingIntent>(); val delivered = ArrayList<PendingIntent>()
        for (i in parts.indices) {
            fun pi(action: String) = PendingIntent.getBroadcast(ctx, (id + action + i).hashCode(),
                Intent(ctx, SmsResultReceiver::class.java).setAction(action).putExtra("id", id).putExtra("part", i), flags)
            sent.add(pi(ACTION_SENT)); delivered.add(pi(ACTION_DELIVERED))
        }
        // Mark handed BEFORE the radio call: if the app dies in between, the job is "unknown", never sent twice.
        store.updateJob(id) { it.put("state", "handed").put("handedAt", System.currentTimeMillis()).put("partsTotal", parts.size).remove("message") }
        try {
            if (parts.size == 1) sms.sendTextMessage(to, null, parts[0], sent[0], delivered[0])
            else sms.sendMultipartTextMessage(to, null, parts, sent, delivered)
        } catch (e: Exception) {
            store.updateJob(id) { it.put("state", "failed") }
            store.addReport(JSONObject().put("id", id).put("status", "failed").put("error", "Phone refused to send: " + (e.message ?: e.javaClass.simpleName)))
        }
    }

    fun sendError(code: Int): String = when (code) {
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "Generic failure (often no airtime / SMS bundle, or the network rejected it)"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "Radio off (airplane mode)"
        SmsManager.RESULT_ERROR_NULL_PDU -> "Message could not be encoded"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "No mobile network service"
        SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "Android's SMS sending limit reached"
        SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED, SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> "Short code not allowed"
        Activity.RESULT_CANCELED -> "Cancelled by the phone"
        else -> "Send error $code"
    }
}
