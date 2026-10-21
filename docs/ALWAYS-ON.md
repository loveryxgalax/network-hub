# Always-on hosting (Linux server + Docker)

Goal: `https://netops.kadenetworks.com` keeps running with the owner's PC switched off. Same hostname, same tunnel, so routers and CPE need no change.

Status: **prepared, not yet tested on a real server** (written without a Docker daemon available). Treat the first run as a rehearsal on an empty database before moving live data.

## What runs

| Container | Replaces on the PC | Public? |
| --- | --- | --- |
| `hub` (Node 24, SQLite in volume `hub-data`) | `scripts/start-dashboard.ps1` | No |
| `mongo` 8.0 (auth on, volume `mongo-data`) | MongoDB in WSL | No |
| `acs` (GenieACS CWMP + NBI + connection-isolation proxy, serial-scoped CPE logins in volume `acs-private`) | NetworkHub-ACS WSL distribution | Only `/cwmp/` through the tunnel |
| `tunnel` (cloudflared) | `scripts/start-cloudflare.ps1` | Outbound only |

No ports are published on the server. Only an SSH port needs to be reachable (prefer key login, no password login). Docker restarts every container after a crash or reboot, and the server needs no signed-in user.

## Server

Run `deployment/docker/server-setup.sh` once on a fresh server to install Docker, automatic updates and an SSH-only firewall.

Ubuntu 24.04 LTS, 2 vCPU, 4 GB RAM, 40 GB disk, with automatic security updates and NTP on (the ACS depends on correct time). Any reputable VPS works. Pick the region closest to your routers. Install Docker Engine and the compose plugin from Docker's official apt repository.

## What a server cannot do

A cloud server cannot reach private LAN addresses. Everything that reports **outbound over HTTPS** keeps working: script-enrolled routers (hEX S, CCR, RBX) and TR-069 CPE. Direct RouterOS REST or SNMP polling of private addresses needs a management VPN between the server and your network. That is a separate, deliberate change to router configuration and is **not** part of this migration.

## Rehearsal

```bash
git clone https://github.com/loveryxgalax/network-hub && cd network-hub
cp .env.docker.example .env      # fill each password with: openssl rand -base64 32
docker compose up -d --build mongo acs hub
docker compose ps                # all healthy
```

Without the tunnel, check from the server only: `docker compose exec hub node -e "fetch('http://127.0.0.1:4317/').then(r=>console.log(r.status))"`.

## Move the live data (planned maintenance window)

1. On the PC run `scripts\stop-online.ps1` (stops dashboard and tunnel, pauses recovery). Router agents queue or skip reports until the server is back.
2. Back up together: `data\network.sqlite` plus any `-wal`/`-shm` files and `data\master.key`. From the WSL distribution: `mongodump` of the `genieacs` database, and copy `/etc/network-hub-acs/cpes.json`.
3. Copy them to the server over SSH (scp), never through chat or git.
4. Restore into the volumes (hub-data gets the three data files; `mongorestore` into `mongo`; `cpes.json` into `acs-private`) before starting `hub`/`acs`. Set the dashboard's ACS connection URL to `http://acs:7557` under TR-069 → Connect ACS (credentials stay in the UI).
5. Put the existing tunnel credentials JSON and a filled-in `config.yml` (from `config.example.yml`) in `deployment/docker/cloudflared/`, `chmod 600`, then `docker compose up -d tunnel`.
6. Verify: sign in at the public URL, router freshness updating, a TR-069 device check-in, one CPE refresh. Keep the PC's data folder untouched for at least a week as the rollback copy.
7. Disable the Windows tasks **Kade Network Hub** and **Kade Network Hub ACS** so two connectors never serve the same tunnel.

Rollback: stop the `tunnel` container, run `scripts\install-online-startup.ps1 -StartNow` on the PC.

## Backups (required for always-on)

Nightly: stop-free SQLite copy with `sqlite3 data/network.sqlite ".backup ..."` (or a brief `docker compose stop hub`), `mongodump`, `master.key` and `cpes.json`, encrypted, stored off the server. Test a restore before relying on it. `master.key` and the database must always be restored together.

## Not done yet

- A real-server test of these images.
- Off-server backup automation and uptime alerts.
- Management VPN for direct polling (needs explicit approval before touching any router).
