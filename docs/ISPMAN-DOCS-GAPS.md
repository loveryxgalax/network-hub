# netops vs ISPman help pages (all 114 pages + 3 guides)

Checked section by section against netops (code, not memory). Written in our own words; no ISPman text is copied.

## Same as ISPman (already in netops)
- **Account**: alerts, assistant, billing, network settings, overview, profile, reports & trends, settings, team & roles, branches.
- **Communication**: SMS (send, log, templates, sender IDs, settings, custom SMS API), email, customer support/tickets.
- **Customers**: customer pages, finding (global search), importing, overview.
- **Devices**: add MikroTik, config backups, logs & alerts, MikroTik device page (pill bar, More menu, audit + Apply fix,
  Change View, logs page, remote logging, TV Connect, SSH, Winbox, remote access), network topology, OLTs (SNMP brands,
  Tenda auto-detect), remote access / jumpbox / WireGuard, Ruijie, TR-069 (tabs, provisioning, firmware).
- **Getting started**: dashboard tour (Show me around), onboarding board (stages, leads, filters), first-week checklist.
- **Hotspot**: bulk actions and outage compensation, captive portal (both designs), customers + manual connects log,
  free mode, packages (burst, FUP, customize, notifications, sharing code, time & day windows, hide from landing page),
  sessions and logs (auth, accounting, roaming, servers), MikroTik setup, vouchers (bulk, print, CSV import).
- **Inventory**: items, requests, settings, reorder levels.
- **Payments**: overview, reports, payment settings (M-Pesa, Paystack), received payments + assign, wallets, withdrawals.
- **PPPoE**: billing and expiry (grace, special prices, installation fees, SMS), bulk actions, customers, invoices,
  packages, router setup, PPPoE network (fixed IPs), authentication policies, sessions and logs.
- **Promotions**: advertising (library, schedule), loyalty points, promo campaigns, quizzes, selling ad space.
- **Statics**: customers, expiry and payments, logs and bulk actions, network setup (incl. save only).
- **Scenarios / troubleshooting**: covered by the features above (paid-but-not-connected tools, compensation, router
  offline alerts, SMS log, withdrawal statuses, PPPoE auth log reasons).

## Built in this round (were missing)
| ISPman page | What netops now has |
|---|---|
| Payments → Checkout links | Payments → **Checkout links**: fixed or variable amount, custom 3-letter code, public pay page (`/portal/pay.html?c=CODE`), Copy URL, **Download QR**, signed callback to your own system, API secret, totals and payments per link, turn off. Money is confirmed with Safaricom and kept separate from customer balances. |
| PPPoE → Invoices → templates | Invoice **design** picker on each invoice: Classic, Modern, Minimal (used for the PDF and Print). |
| Troubleshooting → FastTrack | Router audit **FastTrack check** (read from the latest config backup) with Apply fix → job "Turn off FastTrack" (type the router name to confirm). |

## Works differently (on purpose)
- Checkout links collect **KES only** (our M-Pesa account); ISPman lists TZS/UGX/USD.
- Router actions run through the opt-in job runner and risky ones need the router name typed.

## Not built (not useful for a single ISP, or needs hardware we do not have)
- **Marketplace** (buying/selling equipment, capacity, technicians, buyer wallet, pay later): ISPman's own platform business.
- **Platform ads** (ISPman's ad network paying you): needs an ad network.
- **Teltonika** routers: no device to test with.
- Vendor field guides (V-SOL VLAN, torrent blocking, L2 loops, onboarding checklist): reference reading, not features.

## Needs testing on LAB-HEX before any real router
FastTrack off, remote logging, TV Connect, SSH/Winbox on/off, admin password reset. A KSh 1 checkout test only when you choose.
