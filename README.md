# Network Hub

Claude Code handoff: read [CLAUDE.md](CLAUDE.md) first. Safe source and private-state transfer steps are in [docs/TRANSFER-TO-CLAUDE-CODE.md](docs/TRANSFER-TO-CLAUDE-CODE.md).

An independent network operations app based on observed Texin Hub workflows. SQLite stores workspace records; RouterOS, SNMP and an independently hosted GenieACS provide equipment connections. No Texin API, credentials, licences or private account records are used.

Live at **https://netops.kadenetworks.com** through Cloudflare Tunnel. The owner account is initialized, public HTTPS serves the current app, and unauthenticated dashboard access is blocked. The old placeholder Worker remains preserved without this hostname. See [feature status](docs/FEATURE-PARITY.md), [reference workflows](docs/REFERENCE-WORKFLOWS.md), [equipment capabilities](docs/EQUIPMENT.md) and [deployment](docs/DEPLOYMENT.md).

## Run

Requires Node.js 24.15 or later. Run `npm ci`, then `npm start` from this project. Open http://127.0.0.1:4317 and create the owner account. There are no default credentials or seeded devices. Opening dist/index.html directly does not run the backend.

For this deployed installation, the **Kade Network Hub** Windows scheduled task starts the background supervisor at Windows sign-in. It watches the dashboard and tunnel and restarts exited processes. To install or resume it, run `scripts/install-online-startup.ps1 -CloudflaredPath C:\Users\hp\Documents\codex1\.tools\cloudflared\cloudflared.exe -StartNow`. Status and logs are in `data/runtime/`. The PC must stay powered on, awake, connected to the Internet and signed in; running before sign-in requires a separate administrator-installed service. See [deployment and maintenance](docs/DEPLOYMENT.md).

## Working features

MikroTik script connection: open **Routers → Connect with script**, then copy the generated per-router script into RouterOS 7.16+. See [installation and migration details](docs/MIKROTIK-SCRIPT.md). This adds outbound monitoring through Cloudflare; VPN/RADIUS/customer-service provisioning remains separate.

- Password sessions, CSRF protection, encrypted credentials and team access: owner, manager, technician, support, field installer and viewer. Legacy roles retain their prior boundaries.
- RouterOS REST resources, interfaces, counters/derived traffic, routes and available WireGuard observations; failure/recovery alerts.
- Direct SNMP v2c/v3 identity/uptime, with configurable vendor columns for ONU inventory/status/power.
- Independent GenieACS CPE inventory/check-ins, refresh, reboot and observed TR-098/TR-181 Wi-Fi changes; executed/queued/uncertain task tracking.
- Zones, numbered ODB ports, capacity checks, speed plans, default ONU location/name presets, customers and service profiles.
- Assigned work orders with due dates and fresh linked-device checks before completion.
- Cables, closures/trays, core/splice conflict checks, categorized stock and immutable stock movements.
- Health, coverage-aware uptime, optical observations, search, CSV, topology, authenticated GeoJSON/KML and responsive light/dark UI.
- Internal tickets and manual invoice/payment accounting. Recording payments does not initiate or verify transfers.

Use Monitor → Configure connection for equipment credentials and TR-069 → Connect ACS for your own NBI. Keep secrets in the local UI, outside source/chat. Verified HTTPS remains enabled; NETWORK_CA_FILE can supply a private trust root.

This Windows installation has a private GenieACS/MongoDB service in the **NetworkHub-ACS** Ubuntu WSL distribution, with sign-in startup and an HTTPS CWMP endpoint through the existing tunnel. RBX has completed authenticated physical TR-069 check-ins and a read-only parameter refresh after importing the verified endpoint root CA for TR-069 only. The dashboard uses the ACS clock for device freshness and can disclose clock differences; the ACS launcher aligns WSL with Windows before starting its keeper. See [TR-069 setup and current status](docs/TR069.md).

The PC must remain running. Direct equipment polling needs LAN/VPN access; script routers report outbound over HTTPS. Cloudflare Tunnel provides HTTPS access to this app. It does not install an ACS or create an equipment VPN. OLT authorization needs a real vendor gateway; its contract alone is not a driver. Script monitoring was physically verified on hEX S / RouterOS 7.22.1, CCR2004-16G-2S+ / RouterOS 7.23.3 and RB951Ui-2HnD / RouterOS 7.24 on 2026-10-20; other equipment integrations remain unverified on hardware.

## Data and configuration

See [.env.example](.env.example). Start an env-file configuration using `node --env-file=.env server.cjs` or scripts/start-dashboard.ps1.

Private data is in data/network.sqlite; saved credentials depend on data/master.key. Back up both together while stopped, including any remaining SQLite WAL files. Measurements retain 30 days; business/audit records persist. Only theme uses localStorage.

NETWORK_PUBLIC_ORIGIN enables Secure cookies for the configured HTTPS host while preserving local HTTP, rejects other API hosts and blocks public first-run owner creation. Generated tunnel files, env files and data are excluded from source distribution.

The retained Sites registration is unpublished; a Node/SQLite app cannot run as a static frontend deployment.

## Verification

Run `npm run check` and `npm test`. Tests cover persistence/auth/roles, RouterOS HTTP fixtures, real UDP SNMP fixtures, GenieACS NBI fixtures, uncertain operations, accounting/stock/fibre invariants, GIS exports and Cloudflare origin behavior. Fixtures do not prove physical interoperability.

Browser QA and private reference evidence live outside this project in ../texin-research/. QA uses isolated temporary databases. Never deploy reference captures or credential files.

Customer equipment discovery and subscriber session monitoring: see [Customer discovery](docs/CUSTOMER-DISCOVERY.md). This is separate from TR-069 enrollment and needs no RouterOS update or router reboot.
