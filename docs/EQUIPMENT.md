# Equipment capabilities

Support follows observed protocols and operations. A brand name does not guarantee that all its models/firmware share commands, MIBs or behavior. Huawei, V-SOL, Hioso, BDCOM, ZTE and other vendors need individual validation. Physical outbound script monitoring was verified on hEX S / RouterOS 7.22.1, CCR2004-16G-2S+ / RouterOS 7.23.3 and RB951Ui-2HnD / RouterOS 7.24 on 2026-10-20; this does not establish other operation or model compatibility.

| Driver | Implemented capability | Requirement |
| --- | --- | --- |
| routeros-rest | Resources, interfaces, counters, routes, available WireGuard peers | Reachable REST, trusted HTTPS, read-only credentials |
| routeros-script | Outbound HTTPS monitoring, scoped enrollment, history and missing-check-in alerts | RouterOS 7.16+, Internet access and the [connection script](MIKROTIK-SCRIPT.md); physical reporting verified on hEX S / RouterOS 7.22.1, CCR2004-16G-2S+ / RouterOS 7.23.3 and RB951Ui-2HnD / RouterOS 7.24 |
| snmp | sysDescr/sysUpTime; optional ONU inventory/status/power columns | v2c or v3 authPriv SHA/SHA256 with AES, matching vendor MIB |
| olt-gateway | Discovery/snapshots and positively confirmed authorization | Real vendor implementation following [the contract](OLT-GATEWAY.md) |
| GenieACS NBI | CPE/check-in inventory, refresh/reboot, observed Wi-Fi changes | Own ACS and enrolled compatible TR-098/TR-181 CPEs |

## SNMP

Choose snmp on an OLT record, set its IP and port (default 161), then open Monitor → Configure connection. Without a mapping, only identity and uptime are observed; no ONU count is fabricated.

Mapping JSON accepts serialOid, statusOid, optional ponOid, nameOid, rxPowerOid, txPowerOid, onlineValues, powerScale, powerOffset and serialEncoding (utf8 or hex). Columns must share row-index suffixes. Serial/status are required together. Obtain exact numeric OIDs, state values and scaling from the equipment firmware's MIB; no universal vendor mapping is shipped.

A cycle caps at 15 seconds and a table at 5,000 rows. Power is accepted only from -100 to +20 dBm. Missing observations remain unknown. SNMP is read-only; it does not authorize units or apply configuration.

## Independent TR-069

Connect your own NBI under TR-069 → Connect ACS. Unauthenticated access is accepted only on loopback. Remote NBI requires verified HTTPS and reverse-proxy authentication. NBI credentials differ from CPE connection-request credentials.

Wi-Fi changes target observed parameters. TR-181 uses SSIDReference to find the matching access point; AP/SSID indices are not assumed equal. Existing Wi-Fi passwords are never fetched/shown. Discovery currently covers indices 1–16 for TR-181 SSIDs/APs and TR-098 LANDevice.1 WLAN configurations.

The journal distinguishes execution receipts and queue acceptance. A timeout/invalid receipt after sending blocks duplicate actions until the operator checks and reconciles. In-flight tasks become uncertain after restart. Reconciliation does not cancel or retry remote tasks.

The integration follows [GenieACS's NBI task API](https://docs.genieacs.com/en/stable/api-reference.html). The deployed private ACS, MongoDB, public authenticated CWMP route and Windows sign-in startup were installed and checked on 2026-10-20. RBX completed authenticated bootstrap and periodic Inform sessions after its verified root CA was imported for TR-069 only. A read-only parameter refresh returned its model, uptime and two observed Wi-Fi SSIDs. Physical reboot/Wi-Fi changes and other CPE models remain untested. The dashboard uses the ACS response clock for device freshness, falls back to local time when no valid Date is available, and discloses clock differences; metadata-only parameters remain unobserved instead of becoming fabricated values. See [deployment and enrollment](TR069.md).
