package com.kadenetworks.smsbridge

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.zxing.integration.android.IntentIntegrator
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/** One screen: pair with Kade Cloud, grant permissions, start or stop the gateway, see its state. */
class MainActivity : Activity() {
    private lateinit var store: Store
    private lateinit var status: TextView
    private lateinit var actions: LinearLayout
    private val ui = Handler(Looper.getMainLooper())
    private val blue = Color.parseColor("#1D4ED8")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(28), dp(20), dp(20)) }
        root.addView(TextView(this).apply { text = "Kade SMS Bridge"; textSize = 24f; setTypeface(typeface, Typeface.BOLD); setTextColor(blue) })
        root.addView(TextView(this).apply { text = "Sends SMS from this phone's SIM for Kade Cloud. Keep the phone plugged in and on Wi-Fi or mobile data."; textSize = 14f; setPadding(0, dp(6), 0, dp(14)); setTextColor(Color.DKGRAY) })
        status = TextView(this).apply { textSize = 15f; setPadding(dp(14), dp(14), dp(14), dp(14)); setBackgroundColor(Color.parseColor("#EFF6FF")); setTextColor(Color.parseColor("#0F172A")) }
        root.addView(status)
        actions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(14), 0, 0) }
        root.addView(actions)
        setContentView(ScrollView(this).apply { addView(root) })
        intent?.data?.let { handleLink(it) }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); intent.data?.let { handleLink(it) } }
    override fun onResume() { super.onResume(); render(); tick() }
    override fun onPause() { super.onPause(); ui.removeCallbacksAndMessages(null) }
    private fun tick() { ui.postDelayed({ renderStatus(); tick() }, 2000) }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun has(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    private fun button(label: String, primary: Boolean = false, onClick: () -> Unit) = actions.addView(Button(this).apply {
        text = label; isAllCaps = false; textSize = 15f
        if (primary) { setBackgroundColor(blue); setTextColor(Color.WHITE) }
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
    })

    private fun renderStatus() {
        val f = DateFormat.getTimeInstance(DateFormat.SHORT)
        val jobs = store.jobs(); val inFlight = jobs.keys().asSequence().count { jobs.getJSONObject(it).optString("state") in setOf("claimed", "handed") }
        status.text = if (!store.paired) "Not paired yet.\n\nIn Kade Cloud open SMS → Android gateway → Add phone, then scan the QR code here."
        else buildString {
            append("Phone: ${store.deviceName ?: "paired"}\nServer: ${store.server}\n")
            append("Gateway: ${if (store.running) "running" else "stopped"}${if (store.running && !store.enabled) " (switched off in Kade Cloud)" else ""}\n")
            append("Last contact: ${if (store.lastContact > 0) f.format(Date(store.lastContact)) else "—"}\n")
            append("Sent today: ${store.sentToday}   In progress: $inFlight   Reports waiting: ${store.reports().length()}\n")
            append("SMS permission: ${if (has(Manifest.permission.SEND_SMS)) "granted" else "MISSING"}")
            store.lastError?.let { append("\n\nLast problem: $it") }
        }
    }

    private fun render() {
        renderStatus(); actions.removeAllViews()
        if (!store.paired) {
            button("Scan pairing QR code", true) { IntentIntegrator(this).setPrompt("Scan the QR code shown in Kade Cloud").setOrientationLocked(false).setBeepEnabled(false).initiateScan() }
            button("Enter the code instead") { manualPair() }
            return
        }
        if (!has(Manifest.permission.SEND_SMS) || (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.POST_NOTIFICATIONS)))
            button("Allow sending SMS and notifications", true) { requestPermissions(listOfNotNull(Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS, if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else null).toTypedArray(), 1) }
        if (!getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName))
            button("Let the gateway run in the background") { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
        if (store.running) button("Stop the gateway") { GatewayService.stop(this); render() }
        else button("Start the gateway", true) { store.running = true; GatewayService.start(this); render() }
        button("Unpair this phone") {
            AlertDialog.Builder(this).setTitle("Unpair this phone?").setMessage("It stops sending. To use it again, make a new pairing code in Kade Cloud.")
                .setPositiveButton("Unpair") { _, _ -> GatewayService.stop(this); store.unpair(); render() }.setNegativeButton("Cancel", null).show()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) { super.onRequestPermissionsResult(requestCode, permissions, grantResults); render() }

    @Deprecated("Activity result for the QR scanner")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val r = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (r != null) { r.contents?.let { handleLink(Uri.parse(it)) }; return }
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
    }

    /** QR content: kadesms://pair?server=https://cloud.kadenetworks.com&code=ABCD2345 */
    private fun handleLink(u: Uri) {
        val server = u.getQueryParameter("server"); val code = u.getQueryParameter("code")
        if (u.scheme == "kadesms" && server != null && code != null) pair(server, code) else toast("That is not a Kade SMS Bridge pairing code.")
    }

    private fun manualPair() {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(8), dp(20), 0) }
        val srv = EditText(this).apply { setText("https://cloud.kadenetworks.com"); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        val code = EditText(this).apply { hint = "8-character code"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS }
        box.addView(srv); box.addView(code)
        AlertDialog.Builder(this).setTitle("Pair with Kade Cloud").setView(box).setPositiveButton("Pair") { _, _ -> pair(srv.text.toString().trim(), code.text.toString().trim()) }.setNegativeButton("Cancel", null).show()
    }

    private fun pair(server: String, code: String) {
        if (!server.startsWith("https://")) { toast("The server address must start with https://"); return }
        status.text = "Pairing…"
        Thread {
            try {
                val r = Api.post(server, "/api/smsgw/pair", JSONObject().put("code", code).put("info", DeviceInfo.collect(this, 0)))
                store.server = server.trimEnd('/'); store.deviceId = r.getString("deviceId"); store.deviceName = r.optString("name"); store.setToken(r.getString("token"))
                store.lastError = null; store.running = true
                runOnUiThread { toast("Paired as ${store.deviceName}"); if (has(Manifest.permission.SEND_SMS)) GatewayService.start(this); render() }
            } catch (e: Exception) { runOnUiThread { toast("Pairing failed: ${e.message}"); render() } }
        }.start()
    }

    private fun toast(m: String) = android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_LONG).show()
}
