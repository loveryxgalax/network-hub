# Home ISP lab: hEX + 2 Cambium PPPoE clients + Archer AP, from zero

This is the complete, in-order runbook for testing netops (PPPoE, Hotspot, TR-069, billing and the automations) on a
home lab. It is written so a person **or a browser/computer-use agent** can follow it step by step. Every screen and
button name below is the real one in netops (https://netops.kadenetworks.com).

**Owner:** the person who owns the netops account. **Agent:** ChatGPT / Claude doing the clicks.

---

## 0. Rules for the agent (read first)

1. Do the phases **in order**. Do not skip a check; each phase depends on the one before.
2. **Stop and ask the owner** before: factory-resetting any device, typing a router name to confirm a risky job,
   entering or changing any password, and anything that sends SMS to a number that is not the owner's own.
3. Never paste a password, API key, RADIUS secret or one-line link script into a chat, ticket or document.
   The one-line link script contains a private token: paste it **only** into the MikroTik terminal.
4. If a check fails, use the troubleshooting table at the end (§11) before trying anything else. Do not invent
   RouterOS commands; netops generates the ones that are needed.
5. Write down every value you create (usernames, passwords, serial numbers) in a private note for the owner.

---

## 1. Shopping list and what each device does

| Device | Role in the lab |
|---|---|
| Xfinity gateway | Internet source. Leave it as it is (bridge mode is **not** needed). |
| **MikroTik hEX E50UG** (5× gigabit, 512 MB, no Wi-Fi) | The "ISP router": PPPoE server, Hotspot, DHCP, NAT, firewall. Linked to netops. |
| TP-Link TL-SG105 (unmanaged switch) | The "customer street": every customer device plugs in here. |
| Cambium cnPilot R195W #1 and #2 | Two **PPPoE home customers** (user1, user2). Managed by TR-069. |
| TP-Link Archer A54 in **Access Point** mode | A **hotspot** Wi-Fi: phones that join it get the netops login page. |
| Laptop #3 | Admin laptop: WinBox + netops in a browser. |
| Your own phone | Receives the test SMS and acts as a hotspot customer. |

The hEX replaces the hAP lite. Because it has 512 MB, use the **full** link (not the "Small router" mode).
The hEX has **no Wi-Fi**: Wi-Fi comes from the two Cambiums (PPPoE customers) and the Archer (hotspot).

---

## 2. Cabling (one change from the picture)

The picture puts the admin laptop on the switch. **Do not do that:** the switch is the customer side, and the
hotspot captures every device on it, so the admin laptop would land on the hotspot login page. Plug the admin
laptop straight into the hEX instead.

| Cable | From | To |
|---|---|---|
| 1 | Xfinity gateway LAN port | **hEX ether1** (internet / WAN) |
| 2 | **hEX ether2** | Switch port 1 (customer side) |
| 3 | **hEX ether3** | **Laptop #3** (admin; stays on the router's default network 192.168.88.0/24) |
| 4 | Switch port 2 | Cambium #1 **WAN/Internet** port |
| 5 | Switch port 3 | Cambium #2 **WAN/Internet** port |
| 6 | Switch port 4 | Archer A54 **LAN** port (not its WAN port; see §7) |
| – | Switch port 5 | Spare: a wired "hotspot customer" laptop if you want one |

```
Internet ─ Xfinity ─ ether1 [hEX] ether2 ─ switch ─┬─ Cambium #1 (PPPoE user1) ─ Wi-Fi/LAN devices
                              ether3                ├─ Cambium #2 (PPPoE user2) ─ Wi-Fi/LAN devices
                                │                   └─ Archer A54 (AP) ─ phones → hotspot login page
                           Admin laptop
```

Networks netops will create (they do not clash with Xfinity's 10.0.0.0/24):

| Network | Used for |
|---|---|
| 192.168.88.0/24 (router 192.168.88.1) | Admin laptop on ether3–5 (the hEX factory network, kept) |
| 10.5.0.0/22 (gateway 10.5.0.1) | Hotspot customers (phones behind the Archer) |
| 10.20.0.0/22 (gateway 10.20.0.1) | PPPoE customers (the Cambiums) |
| 10.99.0.x | WireGuard tunnel from the hEX to netops (RADIUS and remote access) |

---

## 3. Check netops is ready (owner or agent, in the browser)

Log in to https://netops.kadenetworks.com as an **administrator**.

| Check | Where | Expected |
|---|---|---|
| WireGuard server | Sidebar → **WireGuard & Winbox access** | Server shows a public key and endpoint. If not, set it up there first. |
| RADIUS secret | Sidebar → **Link a MikroTik** | The option "netops RADIUS for all logins (new router)" is **not greyed out**. If greyed out, RADIUS_SECRET or WireGuard is missing on the server: stop and tell the owner. |
| SMS | Sidebar → **SMS** → Settings | Provider set up. Send a test SMS to the owner's phone. |
| M-Pesa (optional) | Sidebar → **M-Pesa & portal** | Keys saved (sandbox is fine for a lab). Not required: vouchers work without it. |
| ACS (TR-069) | Sidebar → **Router auto-enrol (TR-069)** | The ACS address is filled in (it is `https://netops.kadenetworks.com/cwmp/`). |
| Old lab router | Sidebar → **Routers** | If the old hAP lite is listed and will not be used again, open it → **Forget router** (removes only netops data). |

---

## 4. Prepare the hEX (in WinBox on the admin laptop)

1. Plug in cables 1 and 3 only (ether1 to Xfinity, ether3 to the laptop) and power the hEX.
2. Open **WinBox** on the laptop → *Neighbors* tab → connect to the hEX (MAC or 192.168.88.1), user `admin`, password
   from the sticker (or empty on older units).
3. If WinBox asks about the **default configuration**, keep it (**do not** remove it). netops relies on it for the
   internet port (DHCP client on ether1), NAT and the admin network.
4. **System → Password**: set a strong admin password and give it to the owner.
5. **System → Packages → Check For Updates** → channel **stable** → **Download & Install** (the router reboots).
   Then **System → RouterBOARD → Upgrade** and reboot once more.
6. Check internet: **New Terminal** and run `ping 8.8.8.8 count=3`. Replies = good. No replies: check cable 1 and that
   **IP → DHCP Client** on ether1 shows *bound*.
7. Leave cable 2 (to the switch) **unplugged** until §6 is finished.

---

## 5. Link the hEX to netops

In netops: Sidebar → **Link a MikroTik**.

1. **Router identity:** `LAB-HEX` (letters, numbers, dot, dash; netops RADIUS recognises the router by this name).
2. Leave **"Small router (32 MB RAM…)" unticked** (the hEX has 512 MB).
3. **RADIUS:** choose **"netops RADIUS for all logins (new router)"**.
4. Tick: **Set this name on the router**, **WireGuard tunnel to netops**, **Job runner**.
5. Create the script. netops shows **one line**. Copy it.
6. In WinBox → **New Terminal** → paste the line → Enter.
   * If the router says **"not allowed by device-mode"**: follow the box on the same netops page (paste the shown
     command, then press the reset button briefly or power-cycle within 5 minutes; settings stay), then paste the
     line again.
7. Back in netops the page shows **"Waiting for the router"**, then the router as settled/online. This takes
   1–3 minutes. In **Routers**, `LAB-HEX` should be **Online**.

Checks:
* Sidebar → **Router jobs**: `LAB-HEX` shows the job runner as installed.
* Sidebar → **Routers** → `LAB-HEX` profile: device info filled in, "Connected to netops".

---

## 6. Let netops set up PPPoE and Hotspot on the hEX

Still on **Link a MikroTik** (continue with `LAB-HEX`), the next step is the services form:

| Field | Value |
|---|---|
| PPPoE | **ticked** |
| Hotspot | **ticked** |
| Uplink (internet) | **ether1** |
| Customer ports | **ether2** only |
| Take the chosen ports out of the factory default bridge | **ticked** (ether3–5 stay on 192.168.88.1 for the admin laptop) |
| Hotspot gateway / network | `10.5.0.1/22` (default) |
| Hotspot DNS name | `wifi.kade` (default) |
| PPPoE local address / network | `10.20.0.1/22` (default) |
| Internet for customers through the uplink (NAT) | **ticked** |

1. Press **Preview setup** and read **What will be set up**: the netops-bridge with ether2, a hotspot on 10.5.0.0/22
   with the netops login page, PPPoE on 10.20.0.0/22, RADIUS with accounting, NAT.
2. Type the router name `LAB-HEX` to confirm (agent: ask the owner first) and apply.
3. Wait about a minute. **Router jobs** shows *Set up PPPoE / Hotspot (new router)* → **succeeded**.
   If it says **STOPPED: …**, the router already had a PPPoE server/hotspot or the port was busy: read the message,
   fix that one thing, run again.
4. Now plug in **cable 2** (hEX ether2 → switch).

What netops also does by itself after this (nothing to click):
* turns on **LLDP neighbour discovery** on the router (about 30 minutes after the job runner was installed);
* puts the **netops Wi-Fi login and status pages** on the router and allows netops before login;
* starts reporting customers, traffic and health every 2 minutes.

---

## 7. Create packages and test customers in netops

Hotspot and PPPoE are completely separate in netops: use the **PPPOE** menu for PPPoE and the **HOTSPOT** menu for
Hotspot.

**PPPoE packages** (Sidebar → PPPOE → **Packages** → add):

| Name | Speed (down/up) | Price | Validity |
|---|---|---|---|
| Lab 5 Mbps | 5 / 5 Mbps | 10 | 1 day |
| Lab 20 Mbps | 20 / 10 Mbps | 20 | 1 day |

**Hotspot packages** (Sidebar → HOTSPOT → **Packages** → add):

| Name | Speed | Price | Validity | Devices |
|---|---|---|---|---|
| Lab 1 Hour | 3 / 3 Mbps | 5 | 1 hour | 1 |
| Lab Day | 5 / 5 Mbps | 10 | 1 day | 2 |

**PPPoE customers** (Sidebar → **PPPoE customers** → add):

| Name | Username | Password | Package | Phone |
|---|---|---|---|---|
| Lab User One | `user1` | (create; write it down) | Lab 5 Mbps | owner's phone |
| Lab User Two | `user2` | (create; write it down) | Lab 20 Mbps | owner's phone |

Then on each customer's profile press **Renew** (or **Record payment**) so the account is **active**.
Use the owner's own phone number so all test SMS go to the owner.

**Hotspot vouchers** (Sidebar → HOTSPOT → **Vouchers**): generate 5 vouchers for **Lab 1 Hour**. Write the codes down.

**Expired-customer page rules (once per router):** Sidebar → PPPOE → **Expired page** → copy **Router rules (run once
per router)** → paste into the hEX terminal (WinBox → New Terminal). This lets expired PPPoE customers reach only DNS and
netops, and sends their web browsing to the "Your internet has expired" page with M-Pesa renewal.

---

## 8. Cambium cnPilot R195W #1 and #2 (PPPoE customers)

Do this for each Cambium (user1 on #1, user2 on #2).

1. Factory reset (hold reset ~10 s; agent: ask the owner first). Connect a laptop to the Cambium's **LAN** port or
   its Wi-Fi (default SSID/password on the label) and open its web page (default `192.168.11.1`, admin login on the
   label or the Cambium quick-start sheet).
2. Set a new admin password and give it to the owner.
3. **WAN / Internet connection type: PPPoE**. Username `user1` (or `user2`), password from §7. Leave service name and
   MTU at their defaults. Save/apply.
4. Plug its **WAN** port into the switch (cables 4 and 5). Within a minute the Cambium shows **Connected** with an
   address in 10.20.x.x.

Checks in netops:
* **PPPOE → Sessions**: user1 and user2 online on LAB-HEX.
* **PPPOE → Auth logs**: "accept" for both.
* Customer profile: online, router `LAB-HEX`, and **Data usage** starts moving within ~5 minutes of traffic.
* Run a speed test on a phone on Cambium #1's Wi-Fi: about **5 Mbps**. On #2: about **20 Mbps**.

---

## 9. Archer A54 as the hotspot access point

1. Factory reset the Archer, connect to it, open `http://tplinkwifi.net`, set an admin password.
2. **Advanced → Operation Mode → Access Point** (the Archer stops being a router and just bridges Wi-Fi to the wire).
3. Wi-Fi name `KADE-LAB-HOTSPOT`, **no password** (open, like a real hotspot) or a simple one, your choice.
4. Plug an Archer **LAN** port into switch port 4 (cable 6).
5. On your phone, join `KADE-LAB-HOTSPOT`. The netops login page opens (if not, browse to any `http://` site or
   `http://wifi.kade`).

Checks:
* Phone gets an address in 10.5.x.x.
* Login page shows the **Hotspot** packages only (Lab 1 Hour, Lab Day), never the PPPoE ones.
* Enter a **voucher** from §7: the phone connects; HOTSPOT → **Sessions** shows it.
* Optional with M-Pesa: buy **Lab 1 Hour** with M-Pesa from the page; after paying, the phone connects by itself.

---

## 10. TR-069 for the two Cambiums

1. netops → Sidebar → **Router auto-enrol (TR-069)**:
   * check the ACS address is `https://netops.kadenetworks.com/cwmp/`;
   * **Turn on shared login** (lab only; it is turned off again at the end) and **Turn on automatic registration**.
   * The page shows: *Username = the router's serial · Password: …* and the ACS address.
2. On each Cambium's web page find the **TR-069 / ACS** settings (usually under *Administration* or *Management*):

   | Field | Value |
   |---|---|
   | Enable TR-069 | on |
   | ACS URL | `https://netops.kadenetworks.com/cwmp/` |
   | ACS username | the Cambium's **serial number** (from its label / status page) |
   | ACS password | the shared password shown on the netops page |
   | Periodic inform | on, every **300** seconds |
   | Connection request username/password | leave as they are (netops sets its own later) |

   If the Cambium is managed by cnMaestro, turn cnMaestro off on it for this test, or TR-069 may be ignored.
3. Wait 2–10 minutes. Then in netops:
   * **TR-069 → Devices**: both Cambiums appear, **Online**.
   * Because their PPPoE usernames are `user1`/`user2`, netops **registers them to those customers by itself** and then
     moves each one to its **own private ACS login** (Router auto-enrol page → audit shows "Registered … automatically",
     then "now uses its own ACS login").
   * Customer profile (PPPoE) shows the TR-069 CPE and, after ~30 minutes, **"N devices on their router now"**.
4. Try: TR-069 → open a Cambium → **Refresh**, change the Wi-Fi name, then change it back.
5. When both are registered: **Turn off shared login** on the auto-enrol page.

---

## 11. Feature test checklist

Tick each one. "Where" is the netops screen.

| # | Feature | How to test | Where to see the result |
|---|---|---|---|
| 1 | PPPoE login and speed | §8 speed tests | PPPOE → Sessions; speed test on the phone |
| 2 | Hotspot login | §9 voucher | HOTSPOT → Sessions |
| 3 | Usage | Watch a video for 10 min on Cambium #1 Wi-Fi | user1 profile → Data usage; customer's own account page |
| 4 | Self-service link | user1 profile → **Self-service link** → **Send by SMS** | SMS arrives as a short `/s/...` link; opens user1's account page (no router guide shown) |
| 5 | Disconnect / reset | user1 profile → **Disconnect** (or **Reset conn.**) | Cambium #1 reconnects within seconds; Router jobs shows it succeeded |
| 6 | Speed change | Change user1 to **Lab 20 Mbps** | After reconnect (or at once if Settings → Live changes is on) the speed test shows ~20 |
| 7 | Expiry | user2 profile → **Extend** → explicit date/time 2 minutes from now; wait; **Disconnect** user2 so Cambium #2 redials | An `http://` site shows the netops "expired" page (needs the Expired page router rules from §7); **Renew** restores it |
| 8 | Payment code login (hotspot) | Phone A connects with a voucher/M-Pesa code; on phone B use the same code: try **Sharing** then **Migration** (hotspot customer profile → **Payment Ref**) | Sharing: both online. Migration: phone A is signed out |
| 9 | TR-069 | §10 | TR-069 → Devices; customer profile |
| 10 | Neighbour discovery | Wait ~45 min after §5 | Router profile → neighbours / Network map shows the Cambiums and Archer if they speak LLDP/CDP/MNDP |
| 11 | Outage SMS | Unplug the **hEX power** for 20 minutes, then plug it back | Owner's phone gets "outage" then "your internet is back" (Automation → log). Skip this if you do not want SMS |
| 12 | Self-healing / jobs | Router jobs → run **Take a config backup now** | Job succeeded; Routers → LAB-HEX → backups |
| 13 | Insights | After a few days of use | **Insights & risks** (capacity: set LAB-HEX uplink speed there), **Upgrade suggestions** |
| 14 | Automation log | Any time | **Automation** page → "What autopilot did" |

---

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Link script does nothing / "not allowed by device-mode" | RouterOS device-mode | Follow the device-mode box on the Link a MikroTik page (§5.6) |
| LAB-HEX never shows Online | No internet on ether1, or the line was not pasted fully | `ping 8.8.8.8` in the terminal; make a new link script and paste again |
| "RADIUS server not responding" alert | WireGuard tunnel down | Routers → LAB-HEX → WireGuard; on the hEX: `/interface wireguard peers print` shows a recent handshake |
| Setup job says **STOPPED** | Router already had a PPPoE server/hotspot, or ether2 was busy | Read the message; remove only that item, run again |
| Cambium stays "Connecting" | Wrong PPPoE password, or account not active | PPPOE → Auth logs shows the reason (wrong password / expired); fix and retry |
| Phone on the Archer gets no 10.5.x address | Archer not in AP mode, or plugged into its WAN port | Operation Mode → Access Point; use a LAN port |
| Admin laptop sees the hotspot login | Laptop is on the switch | Plug it into hEX ether3 (§2) |
| Usage stays 0 B | No accounting yet | Wait 5 minutes of traffic; PPPOE → Acct logs should show "interim" lines |
| Cambium not in TR-069 | Wrong ACS URL/credentials, cnMaestro on, or periodic inform off | Re-enter §10 values exactly; username is the **serial** |
| No SMS | SMS provider or credit | SMS → Messages shows the error; Automation warns when credit is low |

When finished: Router auto-enrol → **Turn off shared login**. To start over: Routers → LAB-HEX → **Forget router**,
reset the hEX, and begin again at §4.
