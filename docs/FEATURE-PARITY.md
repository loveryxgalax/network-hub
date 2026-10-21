# Workflow parity and independent-system status

The user chose an independent equipment system. Observing the website does not provide its private collectors, vendor commands or commercial backend. Implemented means application behavior verified locally or with protocol fixtures, unless physical verification is explicitly recorded. Outbound script monitoring was physically verified on hEX S / RouterOS 7.22.1, CCR2004-16G-2S+ / RouterOS 7.23.3 and RB951Ui-2HnD / RouterOS 7.24 on 2026-10-20.

| Workflow | Implemented | Remaining |
| --- | --- | --- |
| Dashboard | Persistent summaries, devices, alerts, audit, clock and live refresh | Real equipment observations |
| Team | Owner, manager, technician, support, installer, viewer; revocation and assigned-job isolation | Optional phone field, invitations |
| Routers | RouterOS REST resources/interfaces/counters/traffic/routes/WireGuard observations; RouterOS 7.16+ outbound HTTPS script enrollment, reports, token rotation/revocation and missing-check-in alerts; physical script monitoring verified on hEX S / RouterOS 7.22.1, CCR2004-16G-2S+ / RouterOS 7.23.3 and RB951Ui-2HnD / RouterOS 7.24 | Other physical models/firmware need verification; RouterOS 6 adapter and remote configuration are not implemented |
| VPN bootstrap | Existing LAN/VPN accepted | Server, IP/key allocation, reviewed provisioning and rollback |
| OLT monitoring | Direct SNMP v2c/v3 identity/uptime and configurable ONU columns | Vendor MIB validation; no automatic all-model detection |
| ONU authorization | HTTP gateway discovery/confirmation, profiles and uncertain-outcome retry guard | Real vendor gateway implementations and hardware tests |
| OLT management setup | Saved IP, credentials and service profiles | Interface conflict preflight, VLAN/DHCP/firewall provisioning and vendor console |
| Speeds/presets | Rate records, fixed-upstream distinction, default location/local-name presets, batch application | Verified hardware profile application and physical rename |
| TR-069 | Own GenieACS NBI, CPE status, refresh/reboot/Wi-Fi and operation journal; private GenieACS/MongoDB installed in WSL with startup/recovery, authenticated public CWMP route and serial-scoped enrollment; RBX authenticated bootstrap, periodic Inform and read-only parameter refresh physically verified, including two Wi-Fi SSIDs; status handles and discloses ACS clock differences | Physical reboot/Wi-Fi changes remain untested; separate ONT/CPE, other models, management VLAN and bulk/VLAN operations |
| ONU migration | Inventory references | Target pre-registration, rediscovery/service restoration and rollback |
| Jobs | Assignment, contacts, type/priority/due/status, current device check before completion | Physical job validation |
| Health/uptime | Observations, coverage-aware availability and failure/recovery alerts | Additional vendor conditions and notifications |
| Zones/ODBs | Coordinates, numbered ports, unique assignment and capacity enforcement | Hardware-specific actions |
| Fibre/stock | Cable types/PON/endpoints, closures/trays, cores/splices, cost/categories/opening stock/movements | Vendor optical feeds and route geometry drawing |
| Map | SVG topology/projection, authenticated GeoJSON/KML excluding contacts | Street basemap, persistent coordinate dragging, tokenized live feeds |
| WAN/failover | Route/gateway/interface observations | Policy generation, reviewed apply/rollback and physical failover tests |
| Billing | Manual invoices, partial payments, duplicate/overpayment checks | Payment provider/reconciliation; Texin licence charges are not copied |
| Tickets | Internal categorized cases, assignment/resolution | External support conversation and SMS |
| SMS/AI | Explicit unconfigured state | Provider setup, delivery/model integration/accounting |
| Security/API | Password sessions, CSRF, roles | Password recovery/change UI, OTP, trusted browsers, API keys |
| Cloudflare | Authorized named tunnel and DNS route, public HTTPS verified, current frontend and authentication boundary checked; sign-in scheduled task and background process recovery installed and tested; old placeholder Worker preserved | PC must stay powered on, awake, online and signed in; service startup before sign-in and cloud hosting migration remain outstanding |

## Evidence

Earlier REA 6.7.0 evidence covers authenticated dashboard/router/work-order views and refresh behavior:

- Dashboard: ev_cd7cb846ca2f9192f71393de651e8b5f04ec124a752017656e1e4db606b94a1a
- Refresh: ev_381180728367414d6bc4a530ca735aac9250bff27e4e1c43ba3c4d67135c6321
- Router/work order: ev_0c4f5da3acec5dca1ef8ec20ab68ec4fa0154ba6bdb2f12d142e72ca08ebfa43

Additional authenticated Brave UI/DOM inspection covered OLT/ONU, zones/ODBs, speeds/presets, fibre/stock, TR-069, team, billing/tickets, AI/settings, map and API documentation. These were browser-extension observations, not evidence from REA's separate CDP session. That separate target was a login page.

No changes were submitted to Texin. Private reference records/credentials do not seed this project. Captures remain outside the distributable project.
