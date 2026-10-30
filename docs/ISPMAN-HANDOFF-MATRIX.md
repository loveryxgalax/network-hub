# ISPman handoff — implemented / partial / missing

Reference: `NetOps-Claude-Code-Handoff.md` (read-only audit of ispman.tech, 28 Oct 2026, 147 captured views).
That document describes **observed** reference behaviour; this file tracks what Network Hub actually does.
Statuses: **Done** = backend workflow + validation + UI + tests. **Partial** = usable but missing parts listed.
**Missing** = not built. **Skip** = deliberately not planned (reason given).

Update this file with every increment.

## Increment log

| Date | Increment | Tests |
|---|---|---|
| 2026-10-30 | Outage compensation (preview, fixed cut-off, idempotent grants with before/after), never-paid state, PPPoE deactivation grace, installation fee default/override/waive settled before the package, per-customer device limit | `test/accounts.test.cjs` |
| 2026-10-30 | Staff M-Pesa payment request (STK) from the customer profile, rate-limited and audited; renews on Safaricom confirmation | `test/ispman-menu.test.cjs` |
| 2026-10-30 | Package policy: tabbed editor (Details, Burst, Fair usage, Notifications, Time & day of purchase, Other), RADIUS burst/FUP/idle/interim enforcement, purchase windows on the portal, per-package expiry SMS, package ordering, hidden/off-sale | `test/packages.test.cjs` |

## Matrix

### Overview and reporting (handoff §3)
| Item | Status | Notes |
|---|---|---|
| Dashboard counters, router health, revenue, expiring | Done | `dist/dashboard.js`, `lib/overview.cjs` |
| Distinct states: paid online/offline, online-expired, expired, unpaid, deactivated, provisioning failed | Partial | all except provisioning failed (needs router jobs) |
| Reports: revenue by package/location/method, vouchers, usage, visits by time, heavy users, CSV | Done | `lib/reports.cjs`; Excel export is CSV |
| Portal visits by device/OS | Missing | needs user-agent capture on the portal |
| Trends: 24h/7d/30d, heatmaps, fair-usage view | Partial | 1h/24h/7d only; no heatmaps |
| Metric definitions, "last updated", data completeness | Partial | freshness shown on routers; not on every chart |

### Customers and subscriptions (§4)
| Item | Status | Notes |
|---|---|---|
| One customer table with filters, saved filters, CSV | Done | Customers page |
| PPPoE create/edit (name, username, password, phone, email, package, static IP, notes) | Done | router/installation fee/location fields missing |
| Customer profile: details, payments, sessions, usage, SMS, auth log, tickets | Done | profile dialog |
| Actions: renew, payment, edit, SMS, password reveal, points | Done | |
| Actions: STK request from profile | Done | uses the same confirmed-payment path as the portal |
| Actions: connect/disconnect, reset, flight speed, speed override, max connections, PIN | Missing | disconnect needs RADIUS CoA (not set up) |
| Hotspot profile extras: device/browser/OS, recent MACs, child/family accounts | Missing | |
| Roaming events | Missing | |
| Connect requests | Done | Payment requests page (portal STK attempts) |
| Manual connects with actor/before/after | Partial | creates voucher-backed entitlement and audit entry; no before/after expiry record |
| Static IP service (customers, per-router pools, ARP pinning, expiring) | Missing | static IP is only a field on PPPoE customers |
| Bulk actions with explicit scope | Missing | campaigns only |
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
| Adaptive FUP, daily FUP reset | Missing | |
| Notifications: on expiry and minutes/hours/days before | Done | per-package; deduplicated; runs every minute |
| Usage-threshold notifications | Missing | |
| Time & day of purchase (overnight windows) | Done | blocks new sales only; active packages keep working |
| Off sale / hide from landing page | Done | |
| Free trial, earned-by-ad/quiz packages | Missing | |
| Customize (quantity pricing, bulk discount) | Missing | |
| Speed override (raise slower / cut faster / exact), schedules | Missing | |
| Router-scoped packages / hotspot configurations | Missing | packages are global |
| Policy versioning / snapshot on purchase | Missing | edits apply at next login; payments record amount paid |

### Payments, wallets, invoices (§6)
| Item | Status | Notes |
|---|---|---|
| M-Pesa STK (Daraja) with stkQuery confirmation, late callbacks, recheck | Done | |
| M-Pesa C2B paybill with unmatched assignment | Done | URLs still registered to ISPman until the user moves them |
| Payments list, receipts, invoices (print/PDF) | Done | |
| Wallet balance, credit carry-over | Done | single balance; no loaded/pending categories |
| Immutable ledger, integer minor units, reversals | Missing | amounts stored as KSh numbers with 2-dp rounding; no reversal flow |
| Withdrawals | Skip | Kade receives money directly into its own paybill |
| Other providers (Paystack, etc.) | Skip | not used in Kenya setup |

### Devices (§7)
| Item | Status | Notes |
|---|---|---|
| MikroTik inventory, health, ports/SFP, pools, firewall, queues, WAN quality | Done | read-only discovery script v8 |
| Config backups with diffs | Done | nightly export over existing channel; not encrypted separately from DB |
| Device jobs (reboot, re-onboard, push config) | Skip | user rule: never reboot/update routers from netops |
| Topology/neighbour map | Done | |
| OLT list and detection from neighbours | Partial | no vendor operations |
| TR-069 (GenieACS) | Partial | inventory/refresh/reboot/Wi-Fi exist; customer CPE enrolment pending |
| WireGuard management UI | Missing | tunnels made with `deployment/wireguard/*.sh` |
| Winbox jumpbox, free mode | Missing | |

### Inventory and onboarding (§8)
| Item | Status | Notes |
|---|---|---|
| Stock items, movements | Partial | existing fibre/stock module; no requests/approvals/FIFO |
| Onboarding board (Leads → Completed) | Missing | |

### Growth (§9)
| Item | Status | Notes |
|---|---|---|
| Vouchers: batches, CSV, redeem at first login | Done | no single-customer assignment, no voucher expiry |
| Campaigns with discount codes | Done | promo codes (percent/amount/bonus days, limits) |
| Loyalty points (earn on payment, redeem to wallet) | Done | no referral/visit points |
| Advertising, quizzes | Skip | not requested |

### Communications and alerts (§10)
| Item | Status | Notes |
|---|---|---|
| SMS provider (custom/BlessedTexts, Africa's Talking), templates, reminders, campaigns, log | Done | |
| Email sending | Missing | needs mail provider |
| Customer support tickets | Partial | linked by customer name |
| Alerts (router health, outages, RADIUS, config change) | Done | escalation/notification delays missing |
| Assistant | Partial | existing network assistant page |

### Branding and portal (§11)
| Item | Status | Notes |
|---|---|---|
| Landing page: 9 designs, list/grid/swipe, contacts, show/hide sections | Done | Captive experience page |
| Status page designs + status.html download | Done | |
| Loading screen, expired-PPPoE page, terms & languages beyond EN/SW | Missing | |
| Push design to routers with per-router results | Missing | manual file upload |

### Team and audit (§12)
| Item | Status | Notes |
|---|---|---|
| Roles (owner/admin, manager, operator, technician, support, installer, viewer) | Done | server-enforced |
| Capability-level permissions, branch/router scope | Missing | |
| Activity log (who changed what) | Done | admin only |

## Next increments (in order)
1. Customer actions: deactivate/reactivate with a reason, package change with proration rules (STK request done; package/password/suspend exist through Edit).
2. Outage compensation: preview + idempotent grant per outage/customer.
3. Distinct "unpaid" and "provisioning failed" states in filters and reports.
4. Speed override (raise slower / cut faster / exact) at ISP and customer level with an explanation of the effective rate.
5. Static IP service.
6. Onboarding board.
