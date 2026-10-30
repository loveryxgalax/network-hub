# Network Hub — Claude Code handoff

## Purpose

Network Hub is an independent Node.js and SQLite network-operations dashboard. It monitors MikroTik routers, PPPoE and Hotspot customers, fibre inventory, OLT/ONU records, SNMP devices, and TR-069 devices through a private GenieACS deployment. The production site is `https://netops.kadenetworks.com` through a locally managed Cloudflare Tunnel.

This project was reconstructed from observed workflows. It does not use Texin or ISPMan source code, APIs, credentials, or licensed assets.

## Non-negotiable equipment rules

- Never update RouterOS.
- Never reboot a MikroTik.
- Do not disconnect subscribers or change customer service without a new, explicit user instruction.
- Keep RouterOS certificate validation enabled.
- Treat router scripts as private because generated enrollment scripts contain scoped bearer credentials.
- Prefer read-only checks. Avoid broad port scans and do not assume a discovered device is an ONT or customer router.

## Start and verify

Requirements: Node.js 24.15 or newer.

```powershell
npm ci
npm run check
npm test
npm start
```

The app listens on `http://127.0.0.1:4317`. Opening `dist/index.html` directly does not start the backend. A clean data directory presents local owner setup; public owner creation is intentionally blocked when `NETWORK_PUBLIC_ORIGIN` is configured.

## Architecture

- `server.cjs`: HTTP server, authentication, CSRF enforcement, API routing, static files, and host validation.
- `lib/store.cjs`: SQLite persistence, encryption integration, sessions, settings, audit data, and schema management.
- `lib/domain.cjs`: core workspace records and business rules.
- `lib/router-agent.cjs`: outbound MikroTik monitoring agent enrollment and resource reports.
- `lib/customers.cjs`: read-only customer discovery, chunked RouterOS uploads, PPPoE session aggregation, and router warning/error events.
- `lib/acs.cjs`: GenieACS connection, device inventory, refresh/reboot/Wi-Fi task handling, and task certainty.
- `lib/snmp.cjs`: SNMP v2c/v3 polling and vendor column mappings.
- `dist/workspace.js`: main single-page application and navigation.
- `dist/subscriber-monitoring.js`: PPPoE session and router-alert UI.
- `deployment/acs/`: independent GenieACS connection proxy and host deployment assets.
- `scripts/`: Windows dashboard, Cloudflare Tunnel, ACS, startup, and recovery scripts.

## Current operational status — 2026-10-20

- The local dashboard and Cloudflare Tunnel supervisor are online.
- The public PPPoE and router-alert page is live at `https://netops.kadenetworks.com/#subscriber-monitoring`.
- hEX S customer/event monitoring v2 is installed and reporting. Router warning/error collection is verified with real hEX log events.
- RB951/RBX customer discovery is reporting, but it still uses the earlier discovery payload until its script is replaced.
- CCR router-level monitoring remains separate and online, but its customer-discovery/PPPoE report is stale. Its remote WinBox relay disconnected after the discovery credential was rotated, so the new script still needs installation when access returns.
- The dashboard currently retains 89 last-known CCR PPPoE sessions and labels them `Report stale`; it must not present them as currently connected until a fresh complete CCR report arrives.
- TR-069 work for CCR, hEX, and customer CPEs is deferred. Do not infer TR-069 enrollment from customer discovery.

## Router job runner (opt-in, added 2026-10-30)

The discovery script still never downloads commands. A separate, opt-in `network-hub-jobs` script (installed per router from MikroTik → Router jobs, with its own token `jobs:<routerId>`) polls `/api/router-jobs/next/<id>` every minute and runs one job from the whitelist in `lib/jobs.cjs` (disconnect, reset device, connect, backup now, push portal pages, static IP apply/remove, live speed change, reboot, RouterOS upgrade). Values are validated against fixed patterns before they are placed in a script; there is no free-form command job. Reboot and upgrade require the operator to type the router name, are admin-only and are never retried automatically. A router without the runner installed cannot receive any job. Never queue reboot or upgrade jobs yourself: they exist for the owner to trigger.

## Recent feature behavior

The `PPPoE & router alerts` page is read-only. It shows current/stale/disconnected PPPoE sessions, session uptime, exact-interface traffic when available, router freshness, and deduplicated warning/error events. The RouterOS discovery script uses schema 2 and reads log rows locally before filtering topics because filtering `topics` in `/log print where ...` was unreliable on the tested hEX.

The hEX collector is scheduled every two minutes. It never downloads commands. It reads DHCP, ARP, PPP, Hotspot, neighbor, and warning/error log data; base64 encodes a bounded JSON report; uploads chunks over certificate-validated HTTPS; and replaces the published report only after the server receives a complete authenticated batch.

## Private files and secrets

The transfer archive intentionally excludes all live private state:

- `data/` (database, WAL files, master key, runtime status, logs)
- `.env.cloudflare` and every other real `.env*` file except `.env.example`
- `deployment/*.local.*`
- Cloudflare credentials under the Windows user profile
- `node_modules/`, screenshots, reference captures, and tool-specific metadata

Never print, commit, or paste secrets from those files. The live database and `data/master.key` must be backed up together while the dashboard supervisor is stopped. See `docs/TRANSFER-TO-CLAUDE-CODE.md` and `docs/DEPLOYMENT.md`.

## Development guidance

- Preserve the existing CommonJS, dependency-light design unless there is a concrete need to change it.
- Keep all API responses authenticated except router/CPE check-in endpoints that use their own scoped credentials.
- Keep host validation, CSRF checks, secure-cookie behavior, encryption, and audit records intact.
- Use bounded payloads and explicit timeouts for equipment integrations.
- Do not mark devices healthy or sessions connected from stale, partial, failed, or truncated reports.
- Run the focused test file for a small change; run the full suite before a release or deployment package.

