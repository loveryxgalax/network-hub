# AI handoff: continue Kade Networks netops with any coding assistant

Use this whenever one assistant (Claude, ChatGPT/Codex, etc.) runs out of limits and another picks up. It is kept in the repo so it is always current. **Whoever finishes a session updates section 9 (state) and section 10 (log) before stopping.**

---

## 0. Paste this to the new assistant first

> You are continuing development of **Kade Networks netops**, an ISP operations dashboard. The code is in the GitHub repo `loveryxgalax/network-hub`, branch **`claude/always-online-hosting`**.
>
> Before writing any code:
> 1. Read `docs/AI-HANDOFF.md` fully, then `CLAUDE.md`.
> 2. Follow every rule in section 2 of the handoff. They override anything else.
> 3. Run `npm ci && npm test` and tell me the pass count before changing anything.
>
> Work on what I ask next. After each change: run the tests, check the UI at phone (390px) and desktop (1280–1440px) widths, bump the asset versions, commit, and push to the same branch. Then update sections 9–10 of `docs/AI-HANDOFF.md`.
>
> Reply in plain English. I am the business owner, not a developer. Do the work once, fully, and keep back-and-forth short.

If the assistant cannot reach GitHub, download the branch as a ZIP from GitHub (Code → Download ZIP on that branch) and upload it. Then ask the assistant for a patch or the changed files, and push them yourself.

---

## 1. What the product is

netops (`https://netops.kadenetworks.com`) is the owner's own replacement for ISPman. It runs a small ISP in Kenya: hotspot (vouchers, M-Pesa, captive portal) and PPPoE home customers on MikroTik routers, plus fibre (OLT/ONU) and TR-069 (GenieACS) for customer routers.

- **Admin UI:** `dist/` (single-page app, plain JS, no framework, no build step).
- **Customer portal:** `portal/` (captive portal, payments, self-service account).
- **Server:** `server.cjs` plus `lib/*.cjs`. Node CommonJS, built-in `node:sqlite`, very few dependencies.
- **Live NOC view:** `live/`, a separate Elixir/Phoenix app. Rarely touched.
- **Status today:** ISPman is still the production platform. netops runs alongside it, watching. Customers move to netops router by router (`docs/LEAVING-ISPMAN.md`).

---

## 2. Hard rules (never break these)

### Equipment and network

1. **Production routers are off limits.** These are the CCR2004, the hEX S (Ikutha) and the RB951 (KYANDULA).
   - Never run, queue, suggest or generate commands against them unless the owner explicitly asks for that specific step.
   - Even when asked, only read-only, observer-type steps are allowed (for example `docs/KYANDULA-OBSERVER-SETUP.md`, `docs/HEX-IKUTHA-OBSERVER-SETUP.md`).
   - Test routers are LAB-HEX (hEX E50UG) and the lab Cambium (serial WFWM0BKTD6CV). Nothing else may be touched.
2. **Never upgrade RouterOS. Never reboot a MikroTik.**
3. **Never disconnect customers or change their service** without a new, explicit instruction.
4. **Keep certificate checks on.**
   - Never `check-certificate=no`, never `NODE_TLS_REJECT_UNAUTHORIZED=0`.
   - Never serve the ACS over public plain HTTP.

### Secrets and the server

5. **Secrets never go into source, docs, logs, chat or commits.** That includes:
   - passwords, API keys, M-Pesa or Daraja keys
   - router link scripts (they contain bearer tokens)
   - anything printed on device labels (Wi-Fi keys, admin passwords)

   Router scripts are pasted only into the router itself.
6. **On the server:**
   - Never run `docker compose down -v` (it deletes the database).
   - Never reset or reinstall the VPS, and never change its credentials.
7. **M-Pesa:** the paybill confirmation URL stays on ispman.tech until the owner switches. Never register a new C2B URL.
8. **Hotspot and PPPoE are strictly separate.** PPPoE customers must never see hotspot things on their side, and the reverse.

### How the owner works

9. **Every customer SMS or WhatsApp link is auto-shortened** (`lib/shortlink.cjs`).
10. **Every UI change must work on small phones (390px) and large screens.** The owner sends screenshots with circled areas and expects those exact spots fixed and made to look good.
11. **Follow the ISPman reference screenshots** where sensible. Don't copy ISPman's name, branding or code.
12. **Push = live.**
    - The server's cron (`scripts/autodeploy.sh`) pulls `claude/always-online-hosting` every 2 minutes and rebuilds.
    - Never push untested code.
    - Never force-push.
    - Another account also pushes to this branch, so always `git pull origin claude/always-online-hosting` before committing.
13. **Don't create pull requests or new branches** unless asked. PR loveryxgalax/network-hub#1 already tracks the branch, and CI (`.github/workflows/live.yml`) runs `npm test` on every push.
14. **No model or assistant names in code, comments or commit messages.** A neutral `Co-Authored-By` line is fine if your tool adds one.

---

## 3. Running and testing

```bash
npm ci
npm test            # node --test test/*.test.cjs — must stay 100% green (254 tests as of 2026-11-11)
npm start           # http://127.0.0.1:4317, first visit creates the owner account
node --check dist/ispmenu.js   # quick syntax check after editing any big front-end file
```

### Visual check (do this for every UI change)

Start the app in-process and screenshot it with Playwright at 390px and at 1280–1440px:

- Create an app with `createApp({dataDir: <temp dir>, collector:false})` from `server.cjs`.
- POST `/api/setup` to make an owner. Seed plans, subscribers, sessions and alerts with `app.store.put(...)`.
- Log in with the session cookie and take full-page screenshots.

Look for:
- overlapping text
- horizontal scrolling on phones
- cut-off dialogs
- console errors (listen to `pageerror` and console `error`)

Two traps:
- Full-page screenshots show the fixed sidebar only one viewport tall. That is not a bug.
- Changing only the `#hash` does not reload the page.

---

## 4. Code map

| Area | Where |
|---|---|
| HTTP routes | `server.cjs`, one long `if(route===...)` chain inside `handle()`. Roles: `role(user,[...])`, `permissions.equipment(user.role)`. |
| Storage | `lib/store.cjs`. One `records(kind,id,body JSON,version,created,updated)` table. Helpers: `store.put(kind,body,existing)` (optimistic version), `store.get`, `store.list(kind)`, `store.setting(key[,value])`, `store.secret(key[,value])` (encrypted), `store.audit(user,text,ref)`. |
| Record validation | `lib/domain.cjs` (`devices`, `jobs`, `tickets`, `stock`, `invoices` …) |
| RADIUS, customers, plans, settings | `lib/radius.cjs` (`settings()` / `updateSettings()` whitelist every key; add new settings in both places) |
| Reports, revenue, overview | `lib/reports.cjs`, `lib/overview.cjs`, `lib/revenue.cjs` |
| MikroTik link and provisioning | `lib/provision.cjs`, `lib/router-agent.cjs` (monitoring), `lib/customers.cjs` (discovery), `lib/jobs.cjs` (opt-in job runner, whitelist only) |
| TR-069 / ACS | `lib/acs.cjs` (GenieACS), `lib/cpelink.cjs` (register, auto-enrol, fibre PPPoE hand-over), `lib/gpon.cjs` (GPON serial forms) |
| OLTs | `lib/snmp.cjs` (read-only SNMP), `lib/oltpresets.cjs` (Huawei/ZTE mappings + ONU-table finder), `lib/oltdetect.cjs` |
| Search | `lib/search.cjs` (`/api/search`); the client side is at the end of `dist/ispmenu.js` |
| Automations | `lib/autopilot.cjs`, `lib/upsell.cjs`, `lib/insights.cjs`, `lib/summary.cjs`. All are off when `NETWORK_PASSIVE=1`. |
| Short links, SMS, WhatsApp, email | `lib/shortlink.cjs`, `lib/campaigns.cjs`, `lib/whatsapp.cjs`, `lib/email.cjs` |
| Admin UI shell | `dist/index.html` (all script/style tags with `?v=` versions), `dist/workspace.js` (core: `api()`, `rows()`, `load()`, `openEditor`, nav array, generic record editor) |
| Most admin pages | `dist/ispmenu.js` (see the patterns in section 5) |
| Dashboard | `dist/dashboard.js` + `dist/charts.js` (`kc.donut`, `kc.spark`, …) |
| Styles | `dist/kade-blue.css` is the live theme and wins over older `styles.css`, `workspace.css`, `mobile.css`. **Add new CSS at the end of `kade-blue.css`.** |
| Customer portal | `portal/` (`portal.js`, `account.js`, CSS) |
| Deployment | `docker-compose.yml`, `deployment/`, `scripts/autodeploy.sh`, `docs/DEPLOYMENT.md`, `docs/AUTO-DEPLOY.md` |

---

## 5. Front-end patterns and traps

### Cache-busting

After changing any `dist/*.js` or `*.css`, bump its `?v=` in `dist/index.html`. Otherwise browsers keep the old file. Portal files have their own versions in `portal/*.html`.

### Pages in `dist/ispmenu.js`

- Almost everything lives inside one big `(()=>{ ... })();` that opens at line 4 and closes right after `const ROUTES={...}` and the router code.
- **New pages must go inside that IIFE.** `pages`, `ROUTES`, `shell()` and `group()` don't exist outside it, so the browser reports e.g. "ROUTES is not defined".
- To add a page:
  1. Add `pages.myPage=async function(id){shell('Title','Description','<actions html>'); ... $('#im-body').innerHTML=...}`.
  2. Add `ROUTES['my-page']='myPage'`.
  3. Add a nav entry, e.g. `nav.splice(index,0,['my-page','Label','icon'])`, or use `group(...)` in the `items` list near the top.
- Guard async renders with `if(state.page!==id)return;` after each `await`.

### Shared helpers (globals from `workspace.js`)

- `api(path,method,body)` returns JSON and throws `Error(message)`.
- `toast(msg)`, `H()` / `E()` / `h()` for HTML-escaping.
- `rows(kind)` gives loaded records; `load()` reloads them.

### Saving records

PATCH with the record version:

```js
api('records/devices/'+id,'PATCH',{version:d.version, field:value})
```

### Overriding a global function

Top-level `function x(){}` in classic scripts can be replaced with `window.x=function(){}`. This is how search and `openEditor` are extended.

### Sidebar and modals

- **Sidebar:** `organise()` in `ispmenu.js` handles groups and search. Nothing in the sidebar is sticky; the whole sidebar scrolls as one.
- **Dialogs:** `dialog.modal` with `.modal-heading`. Search is a separate `dialog.sx-dialog`.

### Mobile rules

- Inputs must be 16px on phones (iOS zooms otherwise).
- No horizontal scroll.
- Long text wraps (`overflow-wrap:anywhere`).
- Button rows become grids on small screens.
- Desktop is 100% scale: there is deliberately **no** CSS zoom.

---

## 6. Backend patterns

### Routes

Add a route next to related ones in `server.cjs`. Use `json(res,status,obj)`, `await body(req)` and `throw error(status,message)`.

### Settings, secrets, audit

- Settings with a fixed shape go in `lib/radius.cjs` `settings()` (defaults) and `updateSettings()` (whitelist).
- Secrets: `store.secret('name', value)`. Never return them to the browser unless that is the feature's whole point.
- Every change a user makes should call `store.audit(user, 'Did X', ref)`.

### Background loops

The background loops sit at the bottom of `server.cjs`, inside `server.on('listening', ...)`:
- the collector (router polls)
- the 2-minute ACS loop: `verify`, `autoRegister`, `fibre`, hosts

Every automatic action must:
- respect `process.env.NETWORK_PASSIVE==='1'`
- have an on/off setting, off by default when it changes customers or devices.

### Tests

- New features get a `test/<name>.test.cjs` using `node:test` and a temp `Store`; copy the setup from any existing test.
- Test real behaviour, including that money is hidden from roles without access and that secrets cannot be searched.

---

## 7. Commit and push routine

```bash
git pull origin claude/always-online-hosting
npm test                         # must pass
git add -A dist lib server.cjs portal docs test
git commit -m "Short summary

- bullet per change"
git push origin HEAD:claude/always-online-hosting
```

CI on the PR re-runs the tests. If it goes red, fix it immediately: the branch deploys to production.

---

## 8. Docs worth knowing

| Doc | What it covers |
|---|---|
| `docs/LEAVING-ISPMAN.md` | moving routers from ISPman to netops in stages |
| `docs/KYANDULA-OBSERVER-SETUP.md` | browser-assistant steps to connect the RB951 read-only |
| `docs/FIBRE-ONT-TR069.md` | Huawei HG8546M / GPON ONT onboarding |
| `docs/CAMBIUM-TR069-HTTPS.md` | the dedicated HTTPS ACS endpoint for the Cambium |
| `docs/LINK-MIKROTIK.md` | the Link a MikroTik wizard |
| `docs/MIKROTIK-SCRIPT.md` | the read-only monitoring script |
| `docs/CUSTOMER-DISCOVERY.md` | session/lease/ARP reporting |
| `docs/RADIUS.md` | netops RADIUS |
| `docs/LAB-SETUP.md` | lab design (LAB-HEX, Cambium, laptops) |
| `docs/DEPLOYMENT.md`, `docs/AUTO-DEPLOY.md` | server and auto-deploy |

---

## 9. Current state (update this every session)

As of **2026-11-13**:

- **Tests:** 289 passing locally (adds `test/profile-insight.test.cjs`).

### Recently finished

- **Customer portal extras** (`portal/account.js` `afterPaint`, both hotspot and PPPoE): status header with Online/Offline, PPPoE/Hotspot and account-state badges, package, expiry and a big **Top up** button (scrolls to the pay box); Receipt link on each recent payment plus **All payments** sheet (`GET /portal/api/me/payments`); receipts at `GET /portal/api/me/receipt?t=&id=` (own, non-reversed payments only); inline email **Update** (`POST /portal/api/me/contact`, refused when banned); phone changes go to support as a message.
- **Admin customer profile** (`dist/ispmenu.js` `layoutCustomer` + `customerInsight`, data from `GET /api/radius/subscribers/:id/insight` in `lib/insight.cjs`, SQL lookups only): header quick actions SMS / Set expiry / Edit (they press the existing `data-pf` buttons); tabs Overview / Sessions / Payments / Package history / Tickets / Notes (last tab remembered in sessionStorage); Lifetime value with 30-day trend and loyalty points; lifecycle timeline; 12-month activity heatmap (Nairobi days); package history from payments' `planName`; tickets; editable staff notes plus the account's audit log.

- **Self-service account page — recent payments & weekly usage:** `portal/account.html` (hotspot and PPPoE both) now shows a "This week" 7-day usage bar chart and a masked "Recent payments" list (reusing the existing M-Pesa reference masking pattern from `lib/hotspotme.cjs`). Backed by two new fields on `lib/selfservice.cjs`'s `view()` — `recentPayments` and `weeklyUsageMB` — and by exporting the previously-private `dailyUse()` helper from `lib/insights.cjs`. New test in `test/selfservice.test.cjs`. No pricing/business settings changed; loyalty points remain disabled pending an owner decision on point economics (unchanged from before this session).
- **netops.kadenetworks.com domain split (infra, not code):** customer-facing traffic now goes through `my.kadenetworks.com` (Cloudflare Tunnel route to the `hub` service) and the LAB-HEX hotspot captive portal now points at `wifi.kadenetworks.com` (public A record to its hotspot-address, `dns-name` updated on the `netops-hs` hotspot profile). Server `.env` on the production host got `NETWORK_PORTAL_ORIGIN=https://my.kadenetworks.com`, container restarted. Verified end-to-end with real authenticated hotspot and PPPoE customer sessions on LAB-HEX only; no other production router was touched. Cloudflare Access in front of the admin `netops` host, and rolling the domain change out to the other production routers, are both still deferred to the owner's own timing (see section 2 — those routers are off limits without explicit new instruction). This ships alongside another session's own `my.kadenetworks.com` server-side domain split (`NETWORK_PORTAL_ORIGIN` host separation in `server.cjs`/`lib/portal.cjs`, see below) — the two are complementary (Cloudflare/DNS/router side here, server routing side there).

- **Latest display preference:** site-wide `text-transform: none` preserves original casing (supersedes lowercase/capitalize). Profile table text and controls are 11px on phone and desktop. Desktop dashboard has a three-card row for revenue by service/package and voucher revenue by location, followed by a two-card row for top sites/live traffic.

- **Lowercase and compact profiles:** owner changed the site-wide display rule from capitalize to lowercase (admin, portal, guide and rating page). Profile table cells use 10px on desktop / 9px on phones and wrap MAC/IP/date/message values inside fixed-width tables. Contact labels are separated and email always has a row. Last seen falls back to observed sessions. Unknown PPPoE browser/model fields are explained, not inferred. 284 tests and responsive browser overflow checks pass.

- **Deployment recovery:** owner logs identified an unrelated ACS dependency-audit build failure and a pipeline that falsely reported success after Git advanced. App auto-deployment now builds hub separately, includes live only when relevant files change, waits for health, records the successful commit in Git private state and retries failures. ACS/MongoDB/RADIUS/tunnel are left running. Three deployment failure/retry tests added.

- **Customer portal and admin controls:** View Portal uses one authenticated same-site redirect for both services, without generating a short link or requiring a known hotspot MAC. Banned accounts show a permanent-ban banner and disabled controls; server checks reject payment, TV, reset, redemption and connection attempts. Deactivated PPPoE customers retain payment/package controls. Admin profiles now include ban/TV/MAC-policy data; the ban button reads Banned after banning. MAC binding prefills the most recent passively reported router MAC.
- **Wallet checkout:** verified account purchases spend wallet credit first, activate one package period without STK when fully covered, or reserve credit and request only the shortfall. Failed requests, cancellations and ten-minute timeouts release the reservation. Request keys prevent duplicate wallet activation. Wallet spending does not inflate external payment revenue. No live payment or router action was used to test this.
- **UI:** removed the requested sign-in/Operations centre wording; added admin hotspot TV create/edit/remove; profile tables start at five rows with 5/10/15/25/50/100 controls; paired session history/jobs and payments/MACs; moved dashboard charts and created a three-card bottom row; arranged the team header. Browser checks at 390px and 1366px pass with synthetic data.

- Site-wide CSS `text-transform: capitalize` across admin and customer portal pages; removed forced uppercase payment formatting. Five-character payment identifiers and full original hover titles remain.

- Dashboard Received payments: customer, router and reference display at most five characters, with full values in hover titles; stored values and customer links preserved. Verified at 390px and 1366px; 269 tests pass.

- **ISPman export formats:** supports actual November 2026 customer headings, separate currency/available/current balance fields, wallet-only Hotspot identities, blank unpurchased packages, source last-device/last-seen/active-connect/status. Preview validation found 120 PPPoE and 3,652 identifiable Hotspot rows; two Hotspot rows lack identifiers and are retained locally as exceptions. Exports omit expiry. Live import is in progress.

- **ISPman overview:** owner-only, separate customer snapshot and CSV preview/import; duplicate and conflicting identity checks, source balance/expiry text, informational account matches, source timestamps. No operational subscribers, credentials, wallets, payments or routers are changed. See `docs/ISPMAN-OVERVIEW.md`. Validated at 390px and 1366px with synthetic records. No live ISPman data imported during implementation.
- **Ikutha observer check:** existing `HEX` entry online and discovery Reporting; no scripts installed. 0 PPP / 19 Hotspot agreed between netops and WinBox. Existing `network-hub-event-test` and New York timezone left unchanged with owner approval. Secure fetch finished with HTTP 200. Configuration export was not run; no pre-check RADIUS baseline.

- Sidebar scrolls as one piece, with no sticky parts; the sidebar menu search is fast. Trends axis labels fixed; tidy discovery cards; one-line mobile top bar.
- **Search everything:** `/api/search` plus a new dialog, covering customers, live sessions, devices/ONUs, payments, vouchers, packages, tickets, jobs, alerts, onboarding, stock, sites and menu pages.
- **Dashboard:**
  - "On the captive portal now" live card with a sync interval.
  - Revenue donuts: by service and by package under Received payments; by location and two voucher charts in the bottom row.
- **OLT brand set-up page:** built-in Huawei/ZTE SNMP mappings, plus an ONU-table finder for V-SOL, C-Data, FiberHome and BDCOM.
- **Fibre ONT zero-touch:** GPON serial matching across label, OLT and ACS; an ONT is tied to the customer set on its ONU; optional automatic PPPoE hand-over (switch on the Router auto-enrol page).
- Desktop back to 100% scale.

### Waiting on the owner (not code)

- Run `docs/KYANDULA-OBSERVER-SETUP.md` (RB951). Ikutha reporting was checked successfully; see Recently finished for the exceptions.
- Live HTTPS ACS steps in `docs/CAMBIUM-TR069-HTTPS.md` (VPS / DNS / Cambium).
- Set each OLT's brand once real OLTs are added.
- Decide when to set `NETWORK_PASSIVE=1` on the server while ISPman stays primary.

### Known limits

- Huawei/ZTE OLT mappings and fibre PPPoE hand-over have only been tested with simulated devices.
- ZTE optical power is not read.
- ISPman overview accepts customer CSV saved from Excel; XLSX is not parsed directly. Payment history is not imported into the overview, and no supported live ISPman feed has been verified. The older service-account CSV importer remains separate.

---

## 10. Session log (newest first; one line per session)

- 2026-11-13 (later): ideas from a reference billing demo: portal Top up header, badges, all payments with receipts, email Update; admin profile tabs, lifetime value, lifecycle timeline, activity heatmap, package history, tickets, notes, header quick actions.
- 2026-11-13: merged with another session's `my.kadenetworks.com`/ban/wallet-checkout work; split `netops.kadenetworks.com` into `my.kadenetworks.com` (customer traffic, Cloudflare Tunnel + server env var) and `wifi.kadenetworks.com` (LAB-HEX hotspot captive portal only), verified with real authenticated sessions, LAB-HEX only; added masked "Recent payments" and a 7-day "This week" usage chart to the customer self-service page (`lib/selfservice.cjs`, `portal/account.js/.css/.html`), exported `dailyUse()` from `lib/insights.cjs`, new test added. 288 tests pass after merge. No pricing/loyalty settings changed, no other production router touched.
- 2026-11-12: customer address split: `NETWORK_PORTAL_ORIGIN` (e.g. https://my.kadenetworks.com) serves only the portal (also at /), portal API, short links, img/fonts; admin/API/live 404 there; customer links, router pages, payment returns, upsell/insight messages use it; netops still serves the portal for old links; push-design jobs add the customer host to the walled garden; HSTS. Steps for the owner in `docs/CUSTOMER-DOMAINS.md` (Cloudflare tunnel hostname, .env, LAB-HEX first, router dns-name wifi.kadenetworks.com). Also: one-tap hotspot Connect, router logout page, CSP-safe Close buttons.
- 2026-11-12: restored original casing with text-transform none, set compact customer tables to 11px, and arranged dashboard rows as three revenue cards then two traffic cards; 284 tests and phone/desktop layout checks pass.

- 2026-11-12: applied lowercase display site-wide, compacted customer tables and prevented card overflow, clarified unreported device details and contact rows, and used session last-seen fallback; 284 tests pass; 390px/1366px checks show no table or page overflow.

- 2026-11-12: diagnosed auto-deploy from owner-provided logs; excluded unrelated ACS rebuilds from app updates, fixed false success reporting and retry/health tracking; 284 tests pass. Independent ACS dependency audit remains separate from app deployment.

- 2026-11-12: customer portal access, wallet-first package checkout and recovery, permanent-ban visibility/enforcement, admin TV CRUD, passive MAC detection, sign-in cleanup and responsive dashboard/profile/team layouts; 281 tests pass. View Portal has no local HTTP 5xx; production proxy errors require server logs if they recur. No live customer transactions or equipment changes performed.

- 2026-11-11: applied CSS word capitalization across admin and portal pages, removed forced uppercase payment formatting, and bumped changed asset versions; 269 tests and responsive browser checks pass.

- 2026-11-11: capitalized shortened dashboard payment identifiers and service badges; asset version bumped; 269 tests pass and 390px/1366px display verified.

- 2026-11-11: shortened dashboard payment customer/router/reference display to five characters; full hover titles, cache version bumped, phone/desktop checked with no browser errors; 269 tests pass.

- 2026-11-11: owner authorized source data imports and follow-through without routine reapproval; inspected actual ISPman export schemas and adapted the isolated overview, preserving two distinct balances and wallet-only identities. 268 tests pass. No service-control changes.

- 2026-11-11 (b): invoice PDFs (`lib/pdf.cjs`, `/api/invoices/:id/pdf`, PDF + Print buttons); Settings → System & connections in pairs, ISP details two-column; short links now `site/<code>` (old `/s/` still work); admin View portal opens directly; PPPoE "Pay and Extend" fixed and PPPoE package change by payment; hotspot account card shows Connect only when not connected; data usage Line/Bar choice; Bans & blocks page (`lib/restrictions.cjs`, ban = permanent, blocks devices); "Use my current location" on every lat/long form; "What needs action"; .sit-note style.
- 2026-11-11: verified Ikutha observer reporting without installing scripts; built isolated owner-only ISPman customer overview with preview/confirmed CSV import, duplicate prevention and source timestamps; eight added tests, 262 total passing; desktop/phone sample import verified; no live customer data imported.

- 2026-11-11: dashboard chart moves; 100% desktop scale; KYANDULA observer instructions; captive-now card; search, revenue donuts, OLT brands, fibre ONT TR-069; sidebar and trends fixes; this handoff file.
