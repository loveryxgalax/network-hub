# Windows and Cloudflare deployment

Target: **netops.kadenetworks.com**.

Status: live and verified on 2026-10-19. The owner account is initialized. The previous placeholder Worker’s domain attachment was removed with user approval; the Worker itself was preserved. The hostname now routes to the named tunnel. Local previous-DNS metadata is retained in deployment/previous-dns.local.json and excluded from distribution.

Windows runs Node, SQLite and equipment polling; a named Cloudflare Tunnel provides the HTTPS entry point. The PC needs LAN/VPN access to equipment and must stay running. Cloudflare does not itself install the ACS or create the management network.

## Local owner first

Run npm ci and npm start. Open http://127.0.0.1:4317 and create your owner account locally. The app rejects first-owner creation through the configured public hostname.

## Named tunnel

Use Cloudflare's [local tunnel guide](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/) and [ingress documentation](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/). Authorize the CLI interactively, create a named tunnel and use its returned UUID/credential path.

Commands, in order:

1. cloudflared tunnel login
2. cloudflared tunnel create kade-network-ops
3. .\scripts\configure-cloudflare.ps1 -Hostname netops.kadenetworks.com -TunnelId YOUR_TUNNEL_UUID -CredentialsFile C:\Users\hp\.cloudflared\YOUR_TUNNEL_UUID.json
4. Stop the previous Node instance; run .\scripts\start-dashboard.ps1 -EnvironmentFile .env.cloudflare
5. In another terminal, after reviewing the hostname: cloudflared tunnel route dns YOUR_TUNNEL_UUID netops.kadenetworks.com
6. .\scripts\start-cloudflare.ps1

The generator creates .env.cloudflare and deployment/cloudflare.local.yml, makes no account/DNS changes, validates credential identity and refuses accidental overwrites. Keep certificates/credentials outside source.

The tunnel launcher checks owner creation, the running app's public origin and ingress validity. Configuration forwards the public Host explicitly and uses a 404 catch-all. Cookies are Secure on the public HTTPS host; local HTTP remains usable. Review any existing DNS record instead of replacing it forcibly.

Sign in through the public HTTPS URL and verify persistence/refresh. Node and cloudflared must remain running. The base configuration publishes the app without RouterOS/SNMP/NBI ports. The installed ACS adds only the HTTPS `/cwmp/` route described below.

## Automatic startup and recovery

Installed and verified on 2026-10-20: the **Kade Network Hub** scheduled task runs at Windows sign-in with the current user's limited privileges. It starts `scripts/keep-online.ps1` without opening a window. The task retries a failed supervisor after one minute, and the supervisor restarts exited dashboard/tunnel processes with a short backoff. A file lock prevents duplicate supervisors. Existing processes using this exact project configuration are adopted rather than duplicated.

Install or resume with:

```powershell
.\scripts\install-online-startup.ps1 -CloudflaredPath C:\Users\hp\Documents\codex1\.tools\cloudflared\cloudflared.exe -StartNow
```

The installer uses a scheduled task when allowed, otherwise a user Startup shortcut. Its private receipt is in `data/runtime/startup.json`; `status.json` records the current supervisor and process IDs, app readiness and a timestamp. `supervisor.log` records launches/exits; restarted children write their output in that directory. Do not distribute this private directory. The supervisor checks the loopback binding, configured hostname and local owner initialization before starting a tunnel. It validates ingress and reuses the existing tunnel credentials without changing DNS or the Cloudflare plan.

The PC must remain powered on, awake, online and signed in. Locking the screen keeps the user session active; signing out, sleeping or shutting down interrupts this deployment. Startup before any user signs in requires an administrator-installed Windows service, which has not been installed. No automatic machine reboot has been tested. This does not move the app's hosting or database to Cloudflare.

For maintenance, stop this project's processes and pause recovery with:

```powershell
.\scripts\stop-online.ps1
```

This leaves a maintenance flag that prevents subsequent supervisor starts until the install/resume command clears it. The scheduled-task registration remains installed. To remove sign-in startup permanently, unregister **Kade Network Hub** in Task Scheduler; if the installer used its fallback, remove only the **Kade Network Hub** shortcut from the user's Startup folder.

## ACS deployment

Installed on 2026-10-20: a dedicated Ubuntu 24.04 WSL distribution, **NetworkHub-ACS**, runs GenieACS 1.2.16, Node 24.21.0 and MongoDB 8.0.34. The dashboard is connected to NBI at `http://127.0.0.1:7557`. The existing tunnel publishes `https://netops.kadenetworks.com/cwmp/` through a connection-isolation proxy at `127.0.0.1:7548`, before the app route; it forwards to GenieACS CWMP at `127.0.0.1:7547` using a fresh upstream connection for each request. This prevents tunnel connection pooling from mixing CPE sessions. NBI and MongoDB remain on loopback with no public tunnel route. MongoDB authentication is enabled. Unknown CPE serials are rejected; each enrolled device receives its own credentials.

The **Kade Network Hub ACS** scheduled task keeps this WSL distribution running at Windows sign-in. MongoDB, CWMP and NBI have systemd startup/recovery inside Linux. CWMP crash recovery, duplicate host protection and rejection of unauthenticated public Inform requests were tested. No Windows reboot/sign-out has been tested. The same powered-on, awake, online and signed-in requirement applies.

RBX's TR-069 client is enrolled with a one-minute periodic Inform. Its initial CA error was resolved by importing the verified GTS Root R4 certificate, scoped to TR-069. Authenticated physical bootstrap, periodic Inform and a read-only parameter refresh are verified. A competing Linux time service caused a one-hour clock jump during the first refresh. It was disabled, WSL was aligned with Windows and ACS sessions were restarted; the original task then completed with real model, uptime and Wi-Fi observations. The updated sign-in launcher checks the host clock before starting the keeper. The dashboard uses the NBI server's valid HTTP Date for device freshness, falls back to local time and discloses clock differences. See [ACS setup, enrollment and verification](TR069.md).

The public CWMP route uses normal HTTPS and device authentication. Do not put a browser-only Cloudflare Access login page in front of it. No Cloudflare plan upgrade, DNS change or equipment VPN was made for this setup.

The web tunnel does not create site-to-site WireGuard connectivity. Use the existing management network until equipment-specific provisioning is designed and tested.

## Backups

Run `scripts/stop-online.ps1` to pause recovery and stop this project's processes before an offline backup. Copy its entire private data directory, including master.key and any remaining WAL files. Resume using the install/resume command above. Preserve Cloudflare credentials separately. Never distribute these, env files, local tunnel configurations or private reference captures in a source archive.
