# Fibre ONTs on TR-069 (Huawei HG8546M and other GPON/XPON ONTs)

How a fibre customer's ONT goes from "box on the bench" to "online with the right PPPoE login" with as little typing as possible, and what netops does at each step.

netops never writes to an OLT. It reads the OLT over SNMP (ONU list, state, optical power) and talks to ONTs only through your own ACS (GenieACS).

## 1. Reading the label

A Huawei EchoLife HG8546M label carries several numbers. Only one of them identifies the ONT on the fibre:

| On the label | Example form | What it is | Used by netops |
|---|---|---|---|
| GPON SN (big barcode) | `48575443` + 8 hex digits | The ONT's GPON serial in hex. `48575443` is ASCII for `HWTC` (Huawei). | **Yes**: the key that ties OLT, ACS and customer together |
| Same serial, text form | `HWTC` + 8 hex digits | The same GPON serial, as the OLT CLI shows it | Yes, same thing |
| (S)SN `2150…` | 20 characters | Huawei equipment/board serial | No (stock records only) |
| MAC | 12 hex digits | LAN/WAN MAC | Optional, also filled from the first PPPoE login |
| Default password, SSID, WLAN key | — | Factory login and Wi-Fi key | **Never enter these into netops.** Change them at installation. |

netops treats `HWTC1A2B3C4D`, `48575443 1A2B3C4D` and `48:57:54:43:1a:2b:3c:4d` as the same ONT, so installers can type whichever form is easiest.

## 2. One-time set-up in netops

1. **OLT brand set-up** (OLTs & ONUs → OLT brand set-up): pick each OLT's brand. Huawei MA56xx/MA58xx and ZTE C300/C320/C600 have built-in read-only mappings. For V-SOL, C-Data, FiberHome and BDCOM, use **Find the ONU table**: netops walks the OLT's vendor MIB and finds the column of GPON serials (or EPON MACs) and the state column next to it. Confirm which state value means online, then save. The OLT needs the SNMP driver and its SNMP credentials (OLTs → Connection) first.
2. **ACS address** (Operations → Router auto-enrol): enter your HTTPS ACS address.
3. On the same page, turn on:
   - **Shared login**: lets a brand-new ONT reach the ACS before it has its own login.
   - **Automatic registration**: matches the ONT to a customer and moves it to a private login.
   - **Fibre ONT set-up**: writes the customer's PPPoE username and password to the ONT.

   Turn the shared login off again once your ONTs are in.

## 3. Per installation

1. **Authorise the ONT on the OLT** as you normally do: auto-find, then `ont add` / confirm, with the service-port and VLAN for internet. netops does not do this step.
2. **Tie the ONT to the customer.** Do either of these:
   - On the ONU's record in netops, set **Customer account** (the ONU appears automatically after the OLT's next poll once its brand is set up).
   - Or, on the customer's profile, use **Register router** and type or scan the GPON serial from the label.
3. **Point the ONT at the ACS.** Choose one:
   - **From the OLT (no visit to the ONT's web page).** Huawei OLTs can hand the ONT its ACS address over OMCI with a TR-069 server profile. Bind that profile to the ONT, and give the ONT a management WAN (DHCP on your management VLAN, or the internet WAN with the TR069 service). The exact keywords differ between OLT firmware, so check `ont tr069-server-profile ?` and `ont tr069-server-config ?` on your OLT. The profile holds:
     - the ACS URL (from netops),
     - the username (the ONT's serial),
     - the shared or the ONT's own password, as shown by netops.
   - **From the ONT's web page.** Log in with the operator (admin) account and open the TR-069 page (System Tools → TR-069 on the HG8245/HG8546 family). Then:
     - Turn on periodic inform, every 60 seconds.
     - Enter the ACS URL.
     - Enter the username and password netops shows for this serial.
     - Make sure one WAN connection lists **TR069** in its service list (for example `TR069_INTERNET`).
4. **netops takes over** on the next ACS check (every 2 minutes):
   - The ONT checks in with its GPON serial. netops matches it to the customer through the ONU on the OLT, or through the serial registered on the profile.
   - netops registers it as the customer's **Fibre ONT** and moves it from the shared login to its own private login.
   - With fibre set-up on, netops writes the customer's PPPoE username and password to the PPPoE WAN the ONT reports.
   - If the ONT has **no PPPoE WAN yet**, it is marked "Needs a PPPoE WAN". Create the internet WAN (PPPoE, the internet VLAN of your service-port) on the ONT, or with the OLT's internet/WAN config for the ONT. netops then fills in the login on the next check.
5. The customer's first PPPoE login also records the ONT's MAC on their profile.

## 4. What netops can then do on the ONT

The ONT uses the TR-098 data model (`InternetGatewayDevice`). From the TR-069 page and the customer's profile you can:

- Read model, firmware, uptime and the number of devices connected.
- Change the Wi-Fi name and password: `LANDevice.1.WLANConfiguration.n`.
- Change the PPPoE login: `WANDevice.1.WANConnectionDevice.n.WANPPPConnection.1`.
- Reboot it.
- Upgrade firmware from an image stored on the ACS.

MikroTik routers are never changed through TR-069.

## 5. Troubleshooting

- **The ONT never appears on the ACS.**
  - Check that the ONT has a WAN that carries TR069 and that the WAN has an IP address.
  - Check that the ACS address is reachable from that VLAN.
  - Check the ONT's clock (TLS fails with a wrong date).
- **Older firmware fails HTTPS.** Some ONT firmware sends no SNI or offers only old ciphers. Pin that serial to the dedicated endpoint (Router auto-enrol → ACS address for one device), as for the Cambium. Never switch to plain HTTP.
- **"Not matched".**
  - The ONU on the OLT has no customer set, or two ONUs claim the same serial.
  - Set **Customer account** on the ONU, or register the serial on the customer's profile, then press **Check now**.
- **Optical power is empty for a ZTE OLT.** The ZTE power table is indexed differently from the ONU table and is not read by the built-in mapping. ONU state and serials still work.
