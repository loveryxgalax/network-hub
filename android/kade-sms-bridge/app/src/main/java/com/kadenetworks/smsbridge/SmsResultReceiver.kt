package com.kadenetworks.smsbridge

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsMessage
import org.json.JSONObject

/** Results from the radio: "sent" per part, then carrier delivery reports when the network provides them. */
class SmsResultReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val store = Store(ctx); val id = intent.getStringExtra("id") ?: return
        val job = store.jobs().optJSONObject(id) ?: return
        when (intent.action) {
            Sender.ACTION_SENT -> {
                if (job.optString("state") != "handed") return
                val ok = resultCode == Activity.RESULT_OK
                store.updateJob(id) { j ->
                    if (ok) j.put("ok", j.optInt("ok") + 1) else { j.put("fail", j.optInt("fail") + 1); j.put("error", Sender.sendError(resultCode)) }
                    val done = j.optInt("ok") + j.optInt("fail") >= j.optInt("partsTotal", 1)
                    if (done) {
                        if (j.optInt("fail") == 0) { j.put("state", "sent"); store.addReport(JSONObject().put("id", id).put("status", "sent")); store.countSent() }
                        else { j.put("state", "failed"); store.addReport(JSONObject().put("id", id).put("status", "failed").put("error", j.optString("error"))) }
                        j.put("doneAt", System.currentTimeMillis())
                    }
                }
                GatewayService.poke(ctx)
            }
            Sender.ACTION_DELIVERED -> {
                val pdu = intent.getByteArrayExtra("pdu") ?: return
                val fmt = intent.getStringExtra("format")
                val status = try { SmsMessage.createFromPdu(pdu, fmt).status } catch (e: Exception) { return }
                // GSM TP-Status: 0x00–0x1F delivered, 0x20–0x3F still trying, 0x40+ failed.
                if (status in 0x20..0x3F) return
                store.updateJob(id) { j ->
                    if (status < 0x20) j.put("dOk", j.optInt("dOk") + 1) else j.put("dFail", j.optInt("dFail") + 1)
                    if (j.optBoolean("dReported")) return@updateJob
                    if (j.optInt("dFail") > 0) { j.put("dReported", true); store.addReport(JSONObject().put("id", id).put("status", "undelivered").put("error", "Carrier delivery report: not delivered")) }
                    else if (j.optInt("dOk") >= j.optInt("partsTotal", 1)) { j.put("dReported", true); store.addReport(JSONObject().put("id", id).put("status", "delivered")) }
                }
                GatewayService.poke(ctx)
            }
        }
    }
}
