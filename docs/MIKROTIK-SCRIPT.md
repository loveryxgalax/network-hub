# Connect a MikroTik using a script

Open **Routers → Connect with script** (also available in Settings), enter the router's name and generate its connection script. Copy or download the entire block and paste it into the intended router's terminal as an administrator. Requires **RouterOS 7.16 or later** with JSON serialization.

The script installs only `network-hub-agent` in System → Scripts and System → Scheduler, runs immediately, then checks in every 30 seconds. Re-running replaces those two entries by name. It leaves bridge ports, DHCP, NAT, DNS, firewall, VPN, users, RADIUS and customer access rules in place.

Each enrollment has a unique token scoped to reporting for that device. The script is shown at generation time and must be kept private. The server stores only an encrypted hash. Generate a replacement to invalidate the previous token, or use Configure connection → Revoke this connection. Viewing device records never reveals the token.

## What is reported

- Router identity, model, architecture, RouterOS version and uptime.
- CPU and memory observations.
- Up to 64 interface names, types, link states and receive/transmit counters. A truncation flag identifies larger inventories.
- Up to 32 IPv4 default routes and their gateway/state/distance observations.

The app uses the server's receipt time, derives traffic from successive compatible interface counter reports, and records history. Online means an authenticated check-in arrived within 90 seconds. Missing check-ins create an alert; a valid report resolves it. Completing a job linked to a script router requires an authenticated report within 45 seconds and records that receipt time.

This is an outbound HTTPS monitoring connection. It works through NAT when the router can reach the public hostname; it does not establish a management VPN or provide a remote command console. The runtime script uses `read,test,ftp` policies for observations and Fetch, with certificate verification enabled and redirects disabled. It validates the JSON acknowledgement and never imports remote executable files.

## Adapting the supplied ISPMan bootstrap

The supplied script combines LAN/WAN setup, a privileged API user, WireGuard, RADIUS/PPP/captive access rules and scheduled remote task import. Its addresses, tunnel keys, RADIUS configuration and task endpoint belong to that existing provider integration. Changing only its web hostname would not reproduce those services.

Network Hub adapts the scheduled check-in portion with fresh per-router credentials. It does not reuse the pasted provider secrets or send requests to that provider. The original private values are not retained in source or documentation. Rotate the exposed provider/router credentials, coordinating VPN and RADIUS changes with the corresponding server.

If the old bootstrap is already installed, its scheduler remains active until you deliberately migrate it. The new monitoring script does not remove that scheduler, its users, firewall rules or customer services. Moving RADIUS/customer authorization or bidirectional equipment management requires separately configured services and a reviewed migration.

## If the router stays pending

Check RouterOS version, Internet/DNS reachability, router time, its trusted certificate store and System → Log warnings for Network Hub. Keep HTTPS validation enabled. If the generated token was replaced or revoked, install the current script. Cloudflare protections must allow the authenticated non-browser check-in request; a browser challenge is not a valid JSON acknowledgement.

The implementation uses MikroTik's documented [Fetch tool](https://help.mikrotik.com/docs/spaces/ROS/pages/8978514/Fetch) and [JSON scripting commands](https://manual.mikrotik.com/docs/developer-guides/scripting/). Automated HTTP and browser tests verify enrollment, authorization, telemetry, rotation and revocation. On 2026-10-20, a physical hEX S running RouterOS 7.22.1 (stable), enrolled as HEX, successfully sent repeated authenticated reports to the public hostname approximately 30 seconds apart. CPU, memory, uptime and nine interfaces were observed. A CCR2004-16G-2S+ running RouterOS 7.23.3 (stable), enrolled as CCR, also sent authenticated reports; its first two scheduled reports arrived 30.2 seconds apart. CCR's interface inventory reached the 64-entry limit and correctly reported truncation. An RB951Ui-2HnD running RouterOS 7.24 (stable), enrolled as RBX, also reported successfully on 2026-10-20. Two scheduled reports arrived 30.7 seconds apart, with CPU, memory, uptime and all ten interfaces observed. Its one-time setup script removed itself after creating the restricted monitoring script and 30-second schedule. This verifies monitoring on those devices and firmware; remote configuration, VPN management and other hardware remain unverified.
