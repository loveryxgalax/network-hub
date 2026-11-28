# Android SMS gateway (Kade SMS Bridge)

Kade Cloud → Comms → SMS → **Android gateway**. An Android phone with the Safaricom SIM sends SMS for Kade Cloud.
Everything is managed from Kade Cloud; the phone only needs power and internet.

## Install on the phone (one time, in Kenya)
1. Android 7 or newer, Safaricom SIM inserted, SMS bundle bought on that SIM.
2. Kade Cloud → SMS → Android gateway → **Add phone**. Open the "download the app" link on the phone
   (`https://cloud.kadenetworks.com/downloads/kade-sms-bridge.apk`) and allow "install unknown apps".
3. Open **Kade SMS Bridge** → **Scan pairing QR code** (or **Enter the code instead**). Codes work once, for 10 minutes.
4. Tap **Allow sending SMS and notifications** and **Let the gateway run in the background**. The gateway starts.
5. Keep the phone plugged in, on Wi-Fi or mobile data. It restarts by itself after a reboot or app update.
6. Optional, higher volumes: Android asks the person holding the phone to confirm after 30 SMS in 30 minutes.
   To raise that (once, with the phone on a computer, USB debugging on):
   `adb shell settings put global sms_outgoing_check_max_count 500` and
   `adb shell settings put global sms_outgoing_check_interval_ms 1800000`.

## Turning it on
- **Off** (default): nothing changes; the commercial provider sends everything.
- **Test**: only the test numbers in Settings get messages through the phone. Send a test from the Send tab.
- **On**: the ticked types (customer notices, promotions) go through the phone when one is online.
  PINs/codes, sign-in, staff alerts and test messages always use the commercial provider.
- **Emergency off** stops all phones at once.

## How sending is kept safe
- A message is handed to one phone once. If the phone goes silent after taking it, it becomes **Unknown** and is
  never re-sent automatically (staff can "Send again" after confirming).
- Messages no phone took within the fail-over time (default 15 min) go to the commercial provider instead.
- Same number + same text within 10 minutes is skipped as a duplicate; each Send has an idempotency key.
- Per-phone limits per minute / day / month. Promotions skip numbers that replied STOP and add an opt-out line.
- The phone forwards only STOP/START replies (number + keyword), never other messages. Its token is stored
  encrypted with the Android Keystore; Kade Cloud stores only a hash. Tokens rotate every 30 days; Revoke kills one.

## Bundles
Record each bundle bought (quantity, price, dates). The balance shown is an **estimate** from SMS units sent by the
phones; Kade Cloud cannot read the SIM's real balance.

## Rollback
1. Fastest: Settings → **Off** (or **Emergency off**). Everything goes back to the commercial provider at once.
2. Code: revert the commit that added `lib/smsgw.cjs` and push to the deploy branch. Stored records
   (`smsDevices`, `smsJobs`, `smsBundles`, settings `smsGateway`, `smsOptOut`) are left in place and harmless.

## Building the app
`android/kade-sms-bridge` (Kotlin). Release signing reads `keystore.properties` (not in git). The signing key must
be kept: an update signed with another key will not install over the existing app.
