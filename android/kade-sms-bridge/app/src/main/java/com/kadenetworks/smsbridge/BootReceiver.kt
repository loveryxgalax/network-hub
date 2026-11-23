package com.kadenetworks.smsbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart or an app update the gateway starts again by itself (if it was running before). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val s = Store(ctx); if (s.paired && s.running) GatewayService.start(ctx)
    }
}
