# Customer discovery

Open **MikroTik → Customer discovery**. This view shows equipment and subscriber connections reported by enrolled MikroTiks. It does not enroll those observations into GenieACS or prove that an unknown device is an ONT or customer router.

An equipment administrator can generate a private discovery script for an existing router, install it through WinBox System Scripts, and verify its first report. The script installs only `network-hub-discovery` and its two-minute scheduler. It does not update RouterOS, reboot equipment, change Internet service, or download commands. Its independent credential cannot authenticate router resource reports, other routers or user sessions. Replacement or revocation affects discovery only.

The collector reads IPv4 DHCP leases, ARP, active PPP sessions, active Hotspot sessions and advertised IP neighbors. It excludes PPP secrets, passwords and configuration exports. Every record starts **Unclassified**. Inspect its evidence and manually classify it; hostnames and platform advertisements are not independently verified hardware identities. Search by name/address/model, filter by MikroTik or classification, and use the paginated list.

- **PPP connected / Hotspot connected**: present in the latest fresh active-session report.
- **Lease bound**: the DHCP server reported a bound lease; this does not guarantee current device reachability or Internet access.
- **ARP reachable**: the ARP cache reported reachable; this is not an end-to-end Internet test.
- **Neighbor advertised**: discovered by neighbor advertisements; the device may be upstream or infrastructure.
- **Disconnected**: a previously observed session is absent from a newer, complete and successfully read session table.
- **Report stale**: no complete report for five minutes. Observations are retained for 30 days, up to 5,000 per MikroTik.

PPP traffic uses counters only from an exact matching active PPP interface and the same session identifier. Hotspot traffic uses the active session's own counters, with a session identifier and nondecreasing uptime. Rates require two samples 5–300 seconds apart, and reset counters never create negative traffic. Shared LAN interface counters are never assigned to an individual DHCP client. Upload means bytes received by the MikroTik from the subscriber; download means bytes sent to the subscriber.

Collection caps are 500 rows per DHCP, ARP, PPP and Hotspot table and 128 advertised neighbors. The view shows each source count, read failure and truncation. A failed or truncated table cannot establish that an absent session disconnected. Discovery is read-only and does not actively scan customers' ports or change their services.

RouterOS Fetch accepts at most 64 KB per request. The script base64-encodes its JSON and sends chunks of at most 40,000 ASCII characters over verified HTTPS. The server validates authenticated, bounded batches and publishes only a complete snapshot. Partial uploads expire after two minutes and cannot replace the previous report. Maximum decoded report size is 1 MiB. A dashboard restart discards unfinished batches; the next scheduled collection starts afresh.

Private generated scripts belong in `data/`, outside source packages. RouterOS needs its existing Internet path, correct time and trusted HTTPS certificates. There is no added management VPN or CPE login in this workflow.
