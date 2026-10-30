#!/usr/bin/env bash
# Nightly encrypted backup of Network Hub: SQLite + master.key + CPE logins + GenieACS database.
# Only an encrypted file ever leaves the server; the private decryption key is NOT stored on it.
# One-time setup: see docs/ALWAYS-ON.md ("Backups"). Needs: age, rclone (remote named "offsite"), and a backup.env beside this script.
set -euo pipefail
cd "$(dirname "$0")/../.."
. deployment/docker/backup.env            # AGE_RECIPIENT=age1... (public key), OFFSITE_PATH=offsite:bucket/network-hub, KEEP_DAYS=30
[[ -n "${AGE_RECIPIENT:-}" && -n "${OFFSITE_PATH:-}" ]] || { echo "backup.env incomplete" >&2; exit 1; }
set -a; . ./.env; set +a
stamp=$(date -u +%Y%m%dT%H%M%SZ); work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir "$work/b"
# Consistent SQLite copy while the hub keeps running (includes WAL content).
docker compose exec -T hub node -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/network.sqlite');d.exec(\"VACUUM INTO '/tmp/backup.sqlite'\");" 
docker compose cp hub:/tmp/backup.sqlite "$work/b/network.sqlite"
docker compose exec -T hub rm -f /tmp/backup.sqlite
docker compose cp hub:/data/master.key "$work/b/master.key"
docker compose cp acs:/private/cpes.json "$work/b/cpes.json"
# Everything else needed to rebuild the server: settings/passwords and the WireGuard hub keys (routers trust them).
cp .env "$work/b/env"
if [ -r /etc/wireguard/wg0.conf ]; then cp /etc/wireguard/wg0.conf "$work/b/wg0.conf"; elif sudo -n test -f /etc/wireguard/wg0.conf 2>/dev/null; then sudo -n cat /etc/wireguard/wg0.conf > "$work/b/wg0.conf"; fi
docker compose exec -T mongo mongodump --quiet --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --db genieacs --archive --gzip > "$work/b/genieacs.archive.gz"
tar -C "$work" -cf - b | age -r "$AGE_RECIPIENT" > "$work/network-hub-$stamp.tar.age"
rclone copyto "$work/network-hub-$stamp.tar.age" "$OFFSITE_PATH/network-hub-$stamp.tar.age"
rclone delete --min-age "${KEEP_DAYS:-30}d" "$OFFSITE_PATH"
echo "backup $stamp uploaded ($(du -h "$work/network-hub-$stamp.tar.age" | cut -f1))"
