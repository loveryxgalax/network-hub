package com.kadenetworks.smsbridge

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Everything the bridge keeps on the phone, in app-private storage.
 * - The device token is encrypted with a key held in the Android Keystore (it never leaves the secure hardware).
 * - Jobs: only what is needed to finish them. The message text is dropped as soon as it is handed to the radio.
 * - Reports: outcomes waiting to reach Kade Cloud. Reporting is idempotent on the server, so resending is safe.
 */
class Store(ctx: Context) {
    companion object { private val LOCK = Any() }
    private val p = ctx.getSharedPreferences("bridge", Context.MODE_PRIVATE)

    var server: String? get() = p.getString("server", null); set(v) { p.edit().putString("server", v).apply() }
    var deviceId: String? get() = p.getString("deviceId", null); set(v) { p.edit().putString("deviceId", v).apply() }
    var deviceName: String? get() = p.getString("deviceName", null); set(v) { p.edit().putString("deviceName", v).apply() }
    var running: Boolean get() = p.getBoolean("running", false); set(v) { p.edit().putBoolean("running", v).apply() }
    var lastContact: Long get() = p.getLong("lastContact", 0); set(v) { p.edit().putLong("lastContact", v).apply() }
    var lastError: String? get() = p.getString("lastError", null); set(v) { p.edit().putString("lastError", v).apply() }
    var enabled: Boolean get() = p.getBoolean("enabled", false); set(v) { p.edit().putBoolean("enabled", v).apply() }
    var rotateAfter: Long get() = p.getLong("rotateAfter", 0); set(v) { p.edit().putLong("rotateAfter", v).apply() }
    var sentToday: Int get() = p.getInt("sentToday", 0); set(v) { p.edit().putInt("sentToday", v).apply() }
    var sentDay: Long get() = p.getLong("sentDay", 0); set(v) { p.edit().putLong("sentDay", v).apply() }

    val paired get() = server != null && deviceId != null && token() != null

    // ---- token (Keystore AES-GCM) ----
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry("kade_token", null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder("kade_token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return g.generateKey()
    }
    fun setToken(t: String?) {
        if (t == null) { p.edit().remove("token").apply(); return }
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(t.toByteArray())
        p.edit().putString("token", Base64.encodeToString(out, Base64.NO_WRAP)).apply()
    }
    fun token(): String? = try {
        p.getString("token", null)?.let {
            val b = Base64.decode(it, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, b.copyOfRange(0, 12)))
            String(c.doFinal(b.copyOfRange(12, b.size)))
        }
    } catch (e: Exception) { null }

    fun unpair() { setToken(null); p.edit().remove("deviceId").remove("deviceName").putBoolean("running", false).putString("jobs", "{}").putString("reports", "[]").apply() }

    // ---- jobs ----
    fun jobs(): JSONObject = synchronized(LOCK) { JSONObject(p.getString("jobs", "{}")!!) }
    fun saveJobs(j: JSONObject) = synchronized(LOCK) { p.edit().putString("jobs", j.toString()).commit() }
    fun updateJob(id: String, f: (JSONObject) -> Unit) { synchronized(LOCK) { val all = jobs(); val j = all.optJSONObject(id) ?: return; f(j); all.put(id, j); saveJobs(all) } }

    fun prune(ids: List<String>) = synchronized(LOCK) { val a = jobs(); ids.forEach { a.remove(it) }; saveJobs(a) }

    // ---- outcome reports waiting for the server ----
    fun addReport(r: JSONObject) = synchronized(LOCK) { val a = JSONArray(p.getString("reports", "[]")); a.put(r); p.edit().putString("reports", a.toString()).commit() }
    fun reports(): JSONArray = synchronized(LOCK) { JSONArray(p.getString("reports", "[]")) }
    fun dropReports(n: Int) = synchronized(LOCK) { val a = JSONArray(p.getString("reports", "[]")); val b = JSONArray(); for (i in n until a.length()) b.put(a.get(i)); p.edit().putString("reports", b.toString()).commit() }
    fun addInbound(r: JSONObject) = synchronized(LOCK) { val a = JSONArray(p.getString("inbound", "[]")); a.put(r); p.edit().putString("inbound", a.toString()).commit() }
    fun takeInbound(): JSONArray = synchronized(LOCK) { val a = JSONArray(p.getString("inbound", "[]")); p.edit().putString("inbound", "[]").commit(); a }

    fun countSent() {
        val day = System.currentTimeMillis() / 86_400_000L
        if (sentDay != day) { sentDay = day; sentToday = 0 }
        sentToday += 1
    }
}
