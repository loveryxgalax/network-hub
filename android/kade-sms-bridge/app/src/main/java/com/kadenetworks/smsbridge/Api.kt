package com.kadenetworks.smsbridge

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val code: Int, message: String, val revoked: Boolean = false) : Exception(message)

/** HTTPS only (cleartext is disabled in the manifest). Certificates are checked by Android as usual. */
object Api {
    fun post(server: String, path: String, body: JSONObject, token: String? = null, timeoutMs: Int = 15000): JSONObject {
        val c = URL(server.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = timeoutMs; c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("User-Agent", "KadeSmsBridge/" + BuildConfigInfo.VERSION)
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (code !in 200..299) throw ApiException(code, json.optString("error", "HTTP $code"), json.optBoolean("revoked", false))
            return json
        } finally { c.disconnect() }
    }
}

object BuildConfigInfo { const val VERSION = "1.0.0" }
