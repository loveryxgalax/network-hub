package com.kadenetworks.smsbridge

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.telephony.TelephonyManager
import org.json.JSONObject

/** Phone, SIM and connection state for the Kade Cloud dashboard. Nothing personal: no contacts, no messages. */
object DeviceInfo {
    fun collect(ctx: Context, pending: Int): JSONObject {
        val o = JSONObject()
        o.put("model", Build.MODEL).put("manufacturer", Build.MANUFACTURER).put("android", Build.VERSION.RELEASE).put("appVersion", BuildConfigInfo.VERSION).put("pending", pending)
        try {
            val b = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (b != null) {
                val lvl = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1); val sc = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
                if (lvl >= 0) o.put("battery", lvl * 100 / sc)
                val st = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                o.put("charging", st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL)
            }
        } catch (_: Exception) {}
        try {
            val cm = ctx.getSystemService(ConnectivityManager::class.java)
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            o.put("network", when {
                caps == null -> "offline"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Mobile data"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
                else -> "Other"
            })
        } catch (_: Exception) {}
        try {
            val tm = ctx.getSystemService(TelephonyManager::class.java)
            o.put("operator", tm.simOperatorName ?: "")
            o.put("simState", when (tm.simState) {
                TelephonyManager.SIM_STATE_READY -> "Ready"; TelephonyManager.SIM_STATE_ABSENT -> "No SIM"
                TelephonyManager.SIM_STATE_PIN_REQUIRED -> "PIN required"; TelephonyManager.SIM_STATE_PUK_REQUIRED -> "PUK required"
                TelephonyManager.SIM_STATE_NETWORK_LOCKED -> "Network locked"; else -> "Not ready"
            })
            if (Build.VERSION.SDK_INT >= 28) tm.signalStrength?.let { o.put("signal", "${it.level}/4") }
        } catch (_: Exception) {}
        o.put("smsPermission", if (ctx.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) "granted" else "missing")
        return o
    }
}
