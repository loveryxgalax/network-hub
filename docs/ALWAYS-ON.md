# Always-on hosting (Linux server + Docker)

Goal: `https://netops.kadenetworks.com` keeps running with the owner's PC switched off. Same hostname and paths (including `/cwmp/`), so routers and CPE need no change. The Cloudflare tunnel connector runs on the server, not on a PC.

Status: **prepared, not yet tested on a real server** (written without a Docker daemon available). Treat the first run as a rehearsal on an empty database before moving live data.

## What runs

| Container | Replaces on the PC | Public? |
| --- | --- | --- |
| `hub` (Node 24, SQLite in volume `hub-data`) | `scripts/start-dashboard.ps1` | No |
| `mongo` 8.0 (auth on, volume `mongo-data`) | MongoDB in WSL | No |
| `acs` (GenieACS CWMP + NBI + connection-isolation proxy, serial-scoped CPE logins in volume `acs-private`) | NetworkHub-ACS WSL distribution | Only `/cwmp/` through the tunnel |
| `tunnel` (cloudflared, dashboard-managed, token in `.env`) | `scripts/start-cloudflare.ps1` | Outbound only |

No ports are published on the server. Only an SSH port needs to be reachable (prefer key login, no password login). Docker restarts every container after a crash or reboot, and the server needs no signed-in user.

## Server

Run `deployment/docker/server-setup.sh` once on a fresh server to install Docker, automatic updates and an SSH-only firewall.

Recommended: Ubuntu 24.04 LTS, 2 vCPU, 4 GB RAM, 40 GB disk, with automatic security updates and NTP on (the ACS depends on correct time). Pick the region closest to your routers.

### Google Cloud free tier (e2-micro)

Works with limits: about 1 GB RAM, so `server-setup.sh` adds 2 GB swap and `docker-compose.yml` caps each container's memory (defaults in `.env.docker.example`). Expect occasional slowness under load; resize to e2-medium later without reinstalling. The free tier only covers `us-west1`, `us-central1` or `us-east1`, a standard persistent disk up to 30 GB, and a small monthly egress allowance; confirm Google's current terms and set a billing budget alert.

Create the VM: Compute Engine → Create instance → region one of the three above, machine type **e2-micro**, boot disk **Ubuntu 24.04 LTS, Standard persistent disk, 30 GB**, HTTP/HTTPS unticked. Connect with the console's SSH button.

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
5. Tunnel (Cloudflare dashboard, kadenetworks.com account): Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared, name `netops-server`. Copy only the token into `TUNNEL_TOKEN` in the server's `.env` (never into chat or git). Delete the old DNS record for `netops` (it points to the PC's tunnel), then add two **Public hostnames** to the new tunnel, in this order: `netops.kadenetworks.com` path `^/cwmp/` → `http://acs:7548`, then `netops.kadenetworks.com` (no path) → `http://hub:4317`. Run `docker compose up -d tunnel`.
6. Verify: sign in at the public URL, router freshness updating, a TR-069 device check-in, one CPE refresh. Keep the PC's data folder untouched for at least a week as the rollback copy.
7. Disable the Windows tasks **Kade Network Hub** and **Kade Network Hub ACS** so two connectors never serve the same tunnel.

Rollback: remove the public hostnames from `netops-server`, run `cloudflared tunnel route dns --overwrite-dns kade-network-ops netops.kadenetworks.com` on the PC, then `scripts\install-online-startup.ps1 -StartNow`.

## Backups (required for always-on)

`deployment/docker/backup.sh` makes one encrypted archive per run (consistent SQLite copy, `master.key`, `cpes.json`, GenieACS database) and uploads it off the server, keeping 30 days. Only the encrypted file leaves the server.

One-time setup on the server:

1. `sudo apt-get install -y age rclone`
2. On your **own computer** (not the server) run `age-keygen -o network-hub-backup.key`. Keep that file offline in two places (it is the only way to restore). Copy only the printed public key (`age1...`).
3. Create a free Cloudflare R2 bucket (10 GB free; check current terms) and an R2 API token limited to that bucket. Enter it with `rclone config` (type S3, provider Cloudflare) on the server, remote name `offsite`. Never paste the token anywhere else.
4. `cp deployment/docker/backup.env.example deployment/docker/backup.env`, fill in the public key and bucket path.
5. Test: `./deployment/docker/backup.sh`, then restore it on another machine with `age -d -i network-hub-backup.key file.tar.age | tar -x` before trusting it.
6. Schedule: `crontab -e` and add `17 2 * * * cd ~/network-hub && ./deployment/docker/backup.sh >> ~/backup.log 2>&1`.

`master.key` and the database must always be restored together.

## Not done yet

- A real-server test of these images.
- A tested restore of a real backup, and uptime alerts.
- Management VPN for direct polling (needs explicit approval before touching any router).
