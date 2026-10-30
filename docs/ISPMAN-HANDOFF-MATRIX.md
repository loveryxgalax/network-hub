# ISPman handoff — implemented / partial / missing

Reference: `NetOps-Claude-Code-Handoff.md` (read-only audit of ispman.tech, 28 Oct 2026, 147 captured views).
That document describes **observed** reference behaviour; this file tracks what Network Hub actually does.
Statuses: **Done** = backend workflow + validation + UI + tests. **Partial** = usable but missing parts listed.
**Missing** = not built. **Skip** = deliberately not planned (reason given).

Update this file with every increment.

## Increment log

| Date | Increment | Tests |
|---|---|---|
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
| Metric definitions, "last updated", data completeness | Partial | freshness shown on routers; not on every chart |

### Customers and subscriptions (§4)
| Item | Status | Notes |
|---|---|---|
| One customer table with filters, saved filters, CSV | Done | Customers page |
| PPPoE create/edit (name, username, password, phone, email, package, static IP, notes) | Done | router, installation fee and device limit on the form; location field missing |
| Customer profile: details, payments, sessions, usage, SMS, auth log, tickets | Done | profile dialog |
| Actions: renew, payment, edit, SMS, password reveal, points | Done | |
| Actions: STK request from profile | Done | uses the same confirmed-payment path as the portal |
| Actions: connect/disconnect, reset, flight speed, max connections | Done | through the opt-in router job runner; flight speed also works without it at next login |
| Actions: PIN | Done | set/reset from the profile (optional SMS), bulk dispatch with count confirmation; unlocks balance/usage on the portal |
| Hotspot profile extras: device/browser/OS, recent MACs, child/family accounts | Done | family accounts share package/expiry and count toward the device limit |
| Roaming events | Done | Hotspot → Roaming, from RADIUS accounting |
| Connect requests | Done | Payment requests page (portal STK attempts) |
| Manual connects with actor/before/after | Partial | creates voucher-backed entitlement and audit entry; no before/after expiry record |
| Static IP service (customers, per-router pools, ARP pinning, expiring) | Done | router changes go through the job runner; without it the state shows "Not applied". Needs one firewall rule per router (shown on the settings page) |
| Bulk actions with explicit scope | Done | add days, change package, deactivate, activate, delete (admin, typed) |
| Outage compensation (preview + idempotent grant) | Done | |
| MAC binding (PPPoE) | Done | per-ISP switch; roaming scopes/strict router assignment missing |
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
| OLT list and detection from neighbours | Partial | no vendor operations |
| TR-069 (GenieACS) | Partial | inventory/refresh/reboot/Wi-Fi exist; customer CPE enrolment pending |
| WireGuard management UI | Missing | tunnels made with `deployment/wireguard/*.sh` |
| Free mode | Done | Speed rules & free mode page |
| Winbox jumpbox | Missing | |

### Inventory and onboarding (§8)
| Item | Status | Notes |
|---|---|---|
| Stock items, movements, requests/approvals, FIFO | Done | Operations → Stock requests; issues are costed oldest receipt first |
| Onboarding board (Leads → Completed) | Done | Operations → Onboarding |

### Growth (§9)
| Item | Status | Notes |
|---|---|---|
| Vouchers: batches, CSV, redeem at first login | Done | no single-customer assignment, no voucher expiry |
| Campaigns with discount codes | Done | promo codes (percent/amount/bonus days, limits) |
| Loyalty points (earn on payment, redeem to wallet) | Done | no referral/visit points |
| Advertising, quizzes | Done | Hotspot → Adverts & quizzes; images must be https |

### Communications and alerts (§10)
| Item | Status | Notes |
|---|---|---|
| SMS provider (custom/BlessedTexts, Africa's Talking), templates, reminders, campaigns, log | Done | |
| Email sending | Done | Comms → Email & alert escalation; needs an API key and a verified sender domain |
| Customer support tickets | Done | linked by customer account (older tickets still match by name) |
| Alerts (router health, outages, RADIUS, config change) | Done | escalation after delays, up to three levels |
| Assistant | Partial | existing network assistant page |

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
