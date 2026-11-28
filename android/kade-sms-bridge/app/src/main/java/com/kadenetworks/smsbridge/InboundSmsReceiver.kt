package com.kadenetworks.smsbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import org.json.JSONObject

/**
 * Opt-out handling. Only a reply that is exactly a keyword (STOP, START, …) is passed to Kade Cloud, as the sender
 * number and the keyword. Every other incoming message is ignored and never leaves the phone.
 */
class InboundSmsReceiver : BroadcastReceiver() {
    private val keywords = setOf("STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "START", "UNSTOP", "SUBSCRIBE")
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val store = Store(ctx); if (!store.paired) return
        val msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val from = msgs.firstOrNull()?.originatingAddress ?: return
        val body = msgs.joinToString("") { it.messageBody ?: "" }.trim().uppercase().replace(Regex("[^A-Z]"), "")
        if (body in keywords) { store.addInbound(JSONObject().put("from", from).put("keyword", body)); GatewayService.poke(ctx) }
    }
}
