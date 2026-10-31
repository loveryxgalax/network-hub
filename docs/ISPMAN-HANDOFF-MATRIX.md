# ISPman handoff — implemented / partial / missing

Reference: `NetOps-Claude-Code-Handoff.md` (read-only audit of ispman.tech, 28 Oct 2026, 147 captured views), updated 31 Oct 2026 (§19, 180 views).
That document describes **observed** reference behaviour; this file tracks what Network Hub actually does.
Statuses: **Done** = backend workflow + validation + UI + tests. **Partial** = usable but missing parts listed.
**Missing** = not built. **Skip** = deliberately not planned (reason given).

Update this file with every increment.

## Increment log

| Date | Increment | Tests |
|---|---|---|
| 2026-11-01 | Second screenshot set (100–193): dashboard static status card, total-customers bars and received payments; hotspot fair-usage trend and by-package; settings (blocked devices, static installation fee, packets margin, customer package changes, router follows customer); branding API; customer data usage by range/grouping, full session history, fair-usage progress, router jobs per customer; per-router WiFi page (isolate, support contact); SMS template library, per-service wording, welcome SMS | `test/topology.test.cjs`, `test/extras.test.cjs`, `test/comms.test.cjs` |
| 2026-11-01 | §19: support ticket conversation, internal notes, assignment, Pending/Closed and history; promo campaigns (prefixed code batches, activations, edit/off); voucher import with a check step, vouchers for phone lists (+ optional SMS), printable cards; bulk customer email (audiences, fields, templates, per-recipient results); advert sales (plans, "Advertise here" on the WiFi page, paid/review/approve board, schedule by weekday and hours) | `test/tickets.test.cjs` |
| 2026-11-01 | Also from the screenshots: My account (own password, sign-in alerts), wallets and loyalty pages, static IP connection logs, topology tiles, ISP details, invoices linked to customers, resolved-alert messages, speed-rule priority, portal feature switches, ticket board, assistant on OpenRouter | `test/me.test.cjs`, `test/topology.test.cjs`, `test/comms.test.cjs`, `test/speed.test.cjs`, `test/assistant.test.cjs` |
| 2026-10-30 | Network assistant on Claude (owner's Anthropic API key; read-only snapshot with no customer contact data; refusals retried on a fallback model) | `test/assistant.test.cjs` |
| 2026-10-30 | TR-069 customer CPE enrolment (CPE PPPoE login read from the ACS, link to a customer, write the customer's PPPoE login with setParameterValues; linked CPE on the profile); ONU reboot/disable/enable/remove through the OLT gateway contract with verification and reconciliation | `test/acs-enroll.test.cjs`, `test/workspace.test.cjs` |
| 2026-10-30 | Customer address and map coordinates; roaming lock (ISP-wide or per customer: only through the router on the account); manual connect for existing customers with reason, actor and expiry before/after; vouchers with a last day to use, single named vouchers with SMS, apply a voucher to an account; referral and daily-visit loyalty points; data completeness and metric definitions on the dashboard and Reports | `test/extras.test.cjs`, `test/services-http.test.cjs` |
| 2026-10-30 | WireGuard page: routers and time-limited staff laptops on 10.99.0.0/24, keys generated and shown once, host sync script applies peers to wg0 every minute, limits staff to routers' management ports (Winbox jump box) and reports handshakes back. Fixed a dashboard script error from the previous increment | `test/wireguard.test.cjs` |
| 2026-10-30 | Daily rollups (hourly average/peak traffic, CPU, customers online per router) kept 400 days; dashboard 30-day and 3-month ranges; weekday × hour heatmaps of traffic and customers online in Reports. Per-person permissions (allow / do not allow on top of the role) and router scope enforced on customers, profiles, changes, bulk, statics and router jobs; router choice on every customer | `test/rollup.test.cjs`, `test/access.test.cjs` |
| 2026-10-30 | WiFi page: loading screen designs (spinner, dots, name, progress, none) applied before the page script runs; terms of service; French alongside Swahili and English; expired-PPPoE renewal page with the router rules; adverts (views, clicks, schedule, weight, free minutes after the full viewing time with a signed ticket) and daily quizzes (answer never sent to the page, one attempt per device per day) | `test/engage.test.cjs` |
| 2026-10-30 | Onboarding board (Leads → Site survey → Installation scheduled → Installed → Completed / Lost; scheduling creates the installation work order; customer account made from the lead); stock requests with approve/issue and FIFO costing, stock receipts with unit cost; tickets linked to the customer account; email provider (Resend, Brevo, SendGrid) with customer copies and log; alert escalation in up to three levels by SMS/email | `test/ops.test.cjs`, `test/comms.test.cjs` |
| 2026-10-30 | Money: append-only ledger in whole cents with a hash chain and CSV export; payment reversal (typed reference, undoes days/wallet/installation fee/points exactly once); wallet loaded vs pending and staff adjustments with reasons; refunds and withdrawals with request → approve (second admin when there is one) → paid by hand or M-Pesa B2C with result callback and hold release on failure; Paystack card/mobile-money checkout with server-side verification and signed webhooks; revenue figures exclude reversed payments | `test/money.test.cjs`, `test/services-http.test.cjs` |
| 2026-10-30 | Static IP service (per-router networks, automatic addresses, ARP pinning, speed queue, expired → blocked address list, Save only / Save & apply, PPPoE↔static conversion); family accounts; customer PINs and PIN dispatch; device/OS/browser per MAC and portal visits by hour/OS/device; roaming log; bulk actions with preview, count+version check and typed delete; free trial per device; buy several units with bulk discounts | `test/services.test.cjs`, `test/services-http.test.cjs` |
| 2026-10-30 | Opt-in router job runner (whitelisted jobs, scoped token, retries with backoff, timeouts, typed confirmation for reboot/upgrade); customer Connect/Disconnect/Reset device/Flight speed; push portal pages to routers; provisioning-failed state | `test/jobs.test.cjs` |
| 2026-10-30 | Speed rules (raise/cut/exact; ISP, router, package, customer; schedules; end time = flight speed) with explanation; free mode (routers, package, end time, portal button); daily FUP and adaptive steps; fair-usage SMS 50/80/100%; packages limited to routers; package version history and payment version | `test/speed.test.cjs`, `test/packages.test.cjs` |
| 2026-10-30 | Outage compensation (preview, fixed cut-off, idempotent grants with before/after), never-paid state, PPPoE deactivation grace, installation fee default/override/waive settled before the package, per-customer device limit | `test/accounts.test.cjs` |
| 2026-10-30 | Staff M-Pesa payment request (STK) from the customer profile, rate-limited and audited; renews on Safaricom confirmation | `test/ispman-menu.test.cjs` |
| 2026-10-30 | Package policy: tabbed editor (Details, Burst, Fair usage, Notifications, Time & day of purchase, Other), RADIUS burst/FUP/idle/interim enforcement, purchase windows on the portal, per-package expiry SMS, package ordering, hidden/off-sale | `test/packages.test.cjs` |

## Matrix

### Overview and reporting (handoff §3)
| Item | Status | Notes |
|---|---|---|
| Dashboard counters, router health, revenue, expiring | Done | `dist/dashboard.js`, `lib/overview.cjs` |
| Distinct states: paid online/offline, online-expired, expired, unpaid, deactivated, provisioning failed | Done | provisioning shown separately from the account state |
| Reports: revenue by package/location/method, vouchers, usage, visits by time, heavy users, CSV | Done | `lib/reports.cjs`; Excel export is CSV |
| Portal visits by device/OS | Done | captured when the WiFi page loads; Reports shows by hour, system and device |
| Trends: 24h/7d/30d/3 months, heatmaps, fair-usage view | Done | 3 months from daily rollups; heatmaps in Reports; fair-usage state on each profile |
| Metric definitions, "last updated", data completeness | Done | dashboard footer (routers reporting, customer lists, accounting) and definitions on dashboard and Reports |

### Customers and subscriptions (§4)
| Item | Status | Notes |
|---|---|---|
| One customer table with filters, saved filters, CSV | Done | Customers page |
| PPPoE create/edit (name, username, password, phone, email, package, static IP, notes) | Done | router, address, map coordinates, roaming, referral, installation fee and device limit on the form |
| Customer profile: details, payments, sessions, usage, SMS, auth log, tickets | Done | profile dialog |
| Actions: renew, payment, edit, SMS, password reveal, points | Done | |
| Actions: STK request from profile | Done | uses the same confirmed-payment path as the portal |
| Actions: connect/disconnect, reset, flight speed, max connections | Done | through the opt-in router job runner; flight speed also works without it at next login |
| Actions: PIN | Done | set/reset from the profile (optional SMS), bulk dispatch with count confirmation; unlocks balance/usage on the portal |
| Hotspot profile extras: device/browser/OS, recent MACs, child/family accounts | Done | family accounts share package/expiry and count toward the device limit |
| Roaming events | Done | Hotspot → Roaming, from RADIUS accounting |
| Connect requests | Done | Payment requests page (portal STK attempts) |
| Manual connects with actor/before/after | Done | new codes or one period for an existing customer, with reason |
| Static IP service (customers, per-router pools, ARP pinning, expiring) | Done | router changes go through the job runner; without it the state shows "Not applied". Needs one firewall rule per router (shown on the settings page) |
| Bulk actions with explicit scope | Done | add days, change package, deactivate, activate, delete (admin, typed) |
| Outage compensation (preview + idempotent grant) | Done | |
| MAC binding (PPPoE), roaming scope | Done | MAC binding switch; roaming lock ISP-wide or per customer |
| Installation fee default/override | Done | settled from the first payment |
| PPPoE deactivation grace policy | Done | 7–365 days, hourly check, payment reactivates |

### Packages and rate policy (§5)
| Item | Status | Notes |
|---|---|---|
| Base fields: name, price, up/down speed, validity, devices | Done | |
| Idle timeout, accounting interval | Done | sent as `Idle-Timeout`, `Acct-Interim-Interval` |
| Features list, popular badge, order/reorder | Done | portal shows features and badge |
| Burst (limit, threshold, averaging time) with validation | Done | `Mikrotik-Rate-Limit` burst form |
| FUP: upload/download caps, online-time cap, reduced speed | Done | evaluated per paid period at login; takes effect on reconnect (no CoA) |
| Adaptive FUP, daily FUP reset | Done | up to 2 extra steps; daily resets at Nairobi midnight |
| Notifications: on expiry and minutes/hours/days before | Done | per-package; deduplicated; runs every minute |
| Usage-threshold notifications | Done | 50/80/100% of the download cap |
| Time & day of purchase (overnight windows) | Done | blocks new sales only; active packages keep working |
| Off sale / hide from landing page | Done | |
| Free trial | Done | one per device per N days |
| Earned-by-ad/quiz packages | Done | Hotspot → Adverts & quizzes |
| Customize (quantity pricing, bulk discount) | Done | up to 3 discount steps; validity multiplies |
| Speed override (raise slower / cut faster / exact), schedules | Done | Speed rules page; profile shows the effective speed and why |
| Router-scoped packages | Done | RADIUS refuses the package on other routers |
| Policy versioning / snapshot on purchase | Done | version history per package; payments store version, name and price |

### Payments, wallets, invoices (§6)
| Item | Status | Notes |
|---|---|---|
| M-Pesa STK (Daraja) with stkQuery confirmation, late callbacks, recheck | Done | |
| M-Pesa C2B paybill with unmatched assignment | Done | URLs still registered to ISPman until the user moves them |
| Payments list, receipts, invoices (print/PDF) | Done | |
| Wallet balance, credit carry-over | Done | loaded and pending (unconfirmed portal payments); staff adjustments go through the ledger |
| Immutable ledger, integer minor units, reversals | Done | Payments → Ledger; hash-chained; existing payment records still hold KSh numbers, the ledger is in cents |
| Refunds and withdrawals | Done | Payments → Refunds & withdrawals; M-Pesa B2C needs an initiator and security credential from the M-Pesa org portal, otherwise pay by hand and record the reference |
| Other providers (Paystack) | Done | Payments → Card payments; off until a secret key is saved |

### Devices (§7)
| Item | Status | Notes |
|---|---|---|
| MikroTik inventory, health, ports/SFP, pools, firewall, queues, WAN quality | Done | read-only discovery script v8 |
| Config backups with diffs | Done | nightly export over existing channel; not encrypted separately from DB |
| Device jobs (reboot, upgrade, backup, push pages, static apply) | Done | opt-in runner; reboot/upgrade typed confirmation, admin only |
| Topology/neighbour map | Done | |
| OLT list, detection, ONU operations | Done | ONU reboot/disable/enable/remove via the vendor gateway (docs/OLT-GATEWAY.md); the gateway itself is per vendor and must be built for your OLT |
| TR-069 (GenieACS) | Done | inventory, refresh, reboot, Wi-Fi, customer CPE enrolment with PPPoE login push |
| WireGuard management UI | Done | Operations → WireGuard & Winbox access; needs `sudo bash deployment/wireguard/sync-peers.sh --install` once on the server |
| Free mode | Done | Speed rules & free mode page |
| Winbox jumpbox | Done | staff WireGuard access (1–168 h) to routers' 8291/22/80/443/8728/8729 only |

### Inventory and onboarding (§8)
| Item | Status | Notes |
|---|---|---|
| Stock items, movements, requests/approvals, FIFO | Done | Operations → Stock requests; issues are costed oldest receipt first |
| Onboarding board (Leads → Completed) | Done | Operations → Onboarding |

### Growth (§9)
| Item | Status | Notes |
|---|---|---|
| Vouchers: batches, CSV, redeem at first login | Done | last day to use, single named vouchers, apply to an account |
| Campaigns with discount codes | Done | promo codes (percent/amount/bonus days, limits) |
| Loyalty points (earn on payment, redeem to wallet) | Done | plus referral and daily visit points |
| Advertising, quizzes | Done | Hotspot → Adverts & quizzes; images must be https |

### Communications and alerts (§10)
| Item | Status | Notes |
|---|---|---|
| SMS provider (custom/BlessedTexts, Africa's Talking), templates, reminders, campaigns, log | Done | |
| Email sending | Done | Comms → Email & alert escalation; needs an API key and a verified sender domain |
| Customer support tickets | Done | linked by customer account (older tickets still match by name) |
| Alerts (router health, outages, RADIUS, config change) | Done | escalation after delays, up to three levels |
| Assistant | Done | Workspace → Network assistant; needs an Anthropic API key, usage billed to that account |

### Branding and portal (§11)
| Item | Status | Notes |
|---|---|---|
| Landing page: 9 designs, list/grid/swipe, contacts, show/hide sections | Done | Captive experience page |
| Status page designs + status.html download | Done | |
| Loading screen, expired-PPPoE page, terms & languages beyond EN/SW | Done | Captive experience (loading, terms, French); PPPoE → Expired page has the router rules |
| Push design to routers with per-router results | Done | Captive experience → Push to routers; results in Router jobs |

### Team and audit (§12)
| Item | Status | Notes |
|---|---|---|
| Roles (owner/admin, manager, operator, technician, support, installer, viewer) | Done | server-enforced |
| Capability-level permissions, branch/router scope | Done | Team → Permissions |
| Activity log (who changed what) | Done | admin only |

## Next increments (in order)
1. Customer actions: deactivate/reactivate with a reason, package change with proration rules (STK request done; package/password/suspend exist through Edit).
2. Outage compensation: preview + idempotent grant per outage/customer.
3. Distinct "unpaid" and "provisioning failed" states in filters and reports.
4. Speed override (raise slower / cut faster / exact) at ISP and customer level with an explanation of the effective rate.
5. Static IP service.
6. Onboarding board.

### Handoff §19 (31 Oct 2026 deeper inspection)
| Item | Status | Notes |
|---|---|---|
| 19.1 OLT creation (brand, parent router, ports, SNMP v2c/v3) | Done | SNMPv3 has its own user/auth/privacy fields; community stored encrypted. |
| 19.2 WireGuard management | Done | Own WireGuard hub (routers + expiring staff access), not ISPman's paid /28 service. |
| 19.3 Inventory requests (priority, stock check, FIFO) | Done | Approval rechecks stock and issues oldest-first. |
| 19.4 Advertising plans and placed-ads board | Partial | Plans, "Advertise here" requests, paid → review → approve/turn down, weekday/hour schedule, auto-finish. Payment is confirmed by staff (no online payment for adverts yet); image is a https link, no upload. |
| 19.5 Picture quizzes | Done | Image choices with text fallback, scored or "no wrong answer". |
| 19.6 Support: board, conversation, internal notes, assignment | Done | Replies can also be texted; notes staff-only; every change in history; viewers read-only. |
| 19.7 Vouchers: bulk, phone list + SMS, import, print | Done | Check step with row errors before saving; print = HTML page → Save as PDF (grid 2–12, compact 18–100, A4/Letter). |
| 19.8 PPPoE import | Done | CSV with a dry run (`/api/radius/import`). XLSX not accepted: save as CSV. |
| 19.9 Campaigns: codes, activations, edit | Done | 100% off charges KSh 1 (smallest M-Pesa payment); a truly free code is not built. |
| 19.10 Platform invoice | Skip | That is ISPman billing the ISP; netops has no platform bill. |
| 19.11 Email audiences and templates | Done | Plain text with fields; union of audiences; one per address; per-recipient result. No rich-text editor. |

## 20. HOTSPOT section deep dive (Oct 31, 2026)

| Module | Status | Notes |
|---|---|---|
| 20.1 Customers: filters, columns, Excel | Done | Added Device type, Router device and Balance min–max filters, an Active connect column ("OFA MOTO: in 29 minutes") and Export to Excel (.xls that Excel, LibreOffice and Sheets open). |
| 20.2 Customer detail | Done | New: View portal, Access logs (opens the filtered auth log), Create voucher, Speed override (customer speed rule), Payment ref (migration), Auto billing toggle (off by default; renews from the prepaid wallet only, skipped in passive mode), Customer profile (model, type, OS, browser, rendering engine, last IP, captive seen, user agent), Recent MAC addresses with Remove/Block, Recent connectivity, usage Download SVG/PNG/CSV. |
| 20.3 Packages | Done | # order, ↓/↑ speed, Sessions (max concurrent + devices per user), Device (routers), Restrictions, Popular. New per-package "max concurrent sessions", enforced by RADIUS. |
| 20.4 Roamings | Done | Filters: Customer, MAC, From device, To device, Detected at; ID and Time ago columns; paging; Excel. |
| 20.5 Requests (connect requests) | Done | New page. Every captive-portal open (MAC, IP, router identity, device) is logged, at most once per MAC per minute, and kept 7 days. The M-Pesa page is still under Payment requests. |
| 20.6 Sessions | Done | Active = not stopped and updated in the last 30 min. Filters: Customer, Username, IP, MAC. Sync every 10 s. Includes router-reported sessions that our RADIUS does not handle, marked "Router". |
| 20.7 Auth logs | Done | 7 days in an indexed table. Filters: Customer, Username, MAC, Reply, date. Shows Access-Accept/Access-Reject and the reason. |
| 20.8 Acct logs | Done | Per session: Started, Stopped, Last update, Up, Down, Terminate cause; a second tab has the raw Start/Interim/Stop records. Kept 7 days. |
| 20.9 Servers | Done | New page: server, SSID, router, router IP, interface/profile, connected, enabled. Read-only. Full details need customer discovery v9 on each router (Replace discovery script, a read-only print of `/ip hotspot` and the wireless SSIDs). Until then servers are listed from the sessions the routers report. Checkboxes select rows for export. Enable/disable from netops is intentionally not offered. |
| 20.10 Manual connects | Done | Two tables with filters (Customer, Package, Team member, date): "Manual connects by team members" and "Manual connect logs" (every staff change to paid-until: manual connect, renew, edit, auto billing, with before and after). |
