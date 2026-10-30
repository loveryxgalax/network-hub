# Moving netops to the HOSTKEY server

New server: **82.47.143.14** (HOSTKEY Frankfurt, vm.v2-mini: 4 vCPU, 8 GB RAM, 120 GB NVMe, Ubuntu 24.04). Log in as `ubuntu` with the `kade-netops` SSH key; root login is off.

The site name stays **netops.kadenetworks.com** (Cloudflare Tunnel), so staff, customers, router check-in scripts and TR-069 CPEs need no change. The WireGuard hub moves with its **same keys**, so each router only needs its WireGuard endpoint changed to the new IP. RADIUS reaches netops over that tunnel.

HOSTKEY has no backup option on this plan, so the nightly encrypted off-site backup (step 3) is the only backup. Set it up before moving live data.

The migration scripts were rehearsed end to end with Docker (export → import → late change on the old server → final export → import): data, `master.key` (encrypted secrets still decrypt), ledger integrity and writes all checked. The rehearsal found and fixed two bugs before you run them.

## 1. Check the network from Kenya (5 minutes)

On one of your MikroTiks (WinBox → New Terminal):

```
/ping 82.47.143.14 count=20
```

Expect a steady 150–200 ms with no loss. Large jumps or loss mean the route is poor; tell Claude before continuing.

## 2. Prepare the new server (15 minutes)

```bash
ssh ubuntu@82.47.143.14
git clone -b claude/always-online-hosting https://github.com/loveryxgalax/network-hub ~/network-hub
cd ~/network-hub
bash deployment/docker/server-setup.sh     # Docker, firewall (SSH + WireGuard UDP 51820 only), automatic updates, fail2ban, backup tools
exit                                       # log out and back in so Docker works without sudo
ssh ubuntu@82.47.143.14 'docker run --rm hello-world'
```

If `git clone` asks for a password, the repository is private: in GitHub open the repository → Settings → Deploy keys → Add deploy key (read-only), with a key made on the server by `ssh-keygen -t ed25519 -f ~/.ssh/github`, then clone with `git@github.com:loveryxgalax/network-hub.git`.

## 3. Off-site backup (20 minutes, do this before live data)

**a. Make the backup key on your own computer, not on the server.** Install `age` (Windows: `winget install FiloSottile.age`; Mac: `brew install age`), then:

```
age-keygen -o kade-netops-backup-key.txt
```

It prints a **public key** (`age1…`). Keep `kade-netops-backup-key.txt` (the private key) in a password manager and a printed copy. Without it the backups cannot be opened; it must never go on the server.

**b. Choose where backups go** (outside HOSTKEY). Backblaze B2 is cheap and simple; Google Drive also works. On the server run `rclone config`, create a remote named exactly **`offsite`**, and follow rclone's prompts for your choice.

**c. Tell the backup what to use**, on the server:

```bash
cd ~/network-hub
cp deployment/docker/backup.env.example deployment/docker/backup.env
nano deployment/docker/backup.env   # AGE_RECIPIENT=the age1… public key; OFFSITE_PATH=offsite:YOUR-BUCKET/netops
```

The timer is installed after the import (step 4), because the backup needs netops running.

## 4. Rehearsal: copy a test copy across (live site untouched)

On the **old server**:

```bash
cd ~/network-hub && git pull            # gets the migration scripts; does not restart anything
bash deployment/migrate/export-old.sh   # netops keeps running
scp ~/netops-migration.tar ubuntu@82.47.143.14:~/
```

(If the old server cannot reach the new one by SSH, download the file to your computer with `scp`, then upload it to the new server the same way.)

On the **new server**:

```bash
cd ~/network-hub
bash deployment/migrate/import-new.sh   # builds, restores, starts everything EXCEPT the Cloudflare tunnel
```

It ends with `netops answering; setup needed: false`. Now install and test the backup:

```bash
bash deployment/docker/install-backup.sh
sudo systemctl start netops-backup && journalctl -u netops-backup -n 20   # expect: backup … uploaded
```

**Test a restore once** (on your computer): download the newest `network-hub-*.tar.age` from your backup storage, then

```
age -d -i kade-netops-backup-key.txt network-hub-XXXX.tar.age > restore.tar
tar -tf restore.tar     # must list b/network.sqlite b/master.key b/env b/cpes.json b/genieacs.archive.gz (and b/wg0.conf)
```

## 5. Cut-over (about 15 minutes; choose a quiet hour, e.g. 02:00)

Netops is unavailable from the first command until the tunnel starts on the new server.

Old server:

```bash
cd ~/network-hub && bash deployment/migrate/export-old.sh --final   # stops netops, RADIUS and the tunnel here
scp ~/netops-migration.tar ubuntu@82.47.143.14:~/
```

New server:

```bash
cd ~/network-hub && bash deployment/migrate/import-new.sh --final   # replaces the rehearsal copy and starts the tunnel
```

Open https://netops.kadenetworks.com, sign in, and check a few customers, payments and the dashboard.

**Routers (one command each, when you choose).** Until this is done, routers keep sending RADIUS to the old address. Check-in scripts and TR-069 use the site name, so they are unaffected. On each router:

```
/interface wireguard peers set [find comment="netops server"] endpoint-address=82.47.143.14
:delay 5s; /ping 10.99.0.1 count=3
```

`/interface wireguard peers print detail` should then show a recent `last-handshake`.

## 6. If something is wrong: roll back

New server: `cd ~/network-hub && docker compose stop tunnel`
Old server: `cd ~/network-hub && docker compose --profile radius start hub radius tunnel`
Routers already changed: run the command above with the old server's IP.

Anything recorded on the new server after the cut-over (payments, changes) is not on the old one; note it down before rolling back.

## 7. Afterwards

- Delete the migration file on both servers: `shred -u ~/netops-migration.tar`.
- Keep the old server switched off but not deleted for a week, then cancel it once a few nightly backups have arrived.
- Updates from now on, on the new server: `cd ~/network-hub && git pull && docker compose --profile radius up -d --build`.
