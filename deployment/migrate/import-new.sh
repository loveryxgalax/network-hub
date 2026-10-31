#!/usr/bin/env bash
# Run on the NEW server, from the cloned repo, after server-setup.sh and copying ~/netops-migration.tar here.
#   Rehearsal (does NOT start the Cloudflare tunnel, so the live site stays on the old server):
#     bash deployment/migrate/import-new.sh
#   Final (also starts the tunnel; stop the old server first with export-old.sh --final):
#     bash deployment/migrate/import-new.sh --final
set -euo pipefail
cd "$(dirname "$0")/../.."
final=false;[[ "${1:-}" == "--final" ]] && final=true
in="$HOME/netops-migration.tar";[[ -f "$in" ]] || { echo "Copy netops-migration.tar to $HOME first" >&2; exit 1; }
work=$(mktemp -d);trap 'rm -rf "$work"' EXIT;umask 077;tar -C "$work" -xf "$in";m="$work/m"
echo "Package exported $(cat "$m/exported-at") ($(cat "$m/mode"))."
$final && [[ "$(cat "$m/mode")" != final ]] && { echo "This is a rehearsal package; for the cut-over use one made with export-old.sh --final" >&2; exit 1; }
cp "$m/env" .env && chmod 600 .env
[[ -f "$m/backup.env" ]] && cp "$m/backup.env" deployment/docker/backup.env && chmod 600 deployment/docker/backup.env
# Memory limits for an 8 GB server (the defaults suit a 1 GB server). Only added if .env does not set them already.
for kv in HUB_MEMORY=768m MONGO_MEMORY=1g ACS_MEMORY=768m RADIUS_MEMORY=128m TUNNEL_MEMORY=128m MONGO_CACHE_GB=0.5; do grep -q "^${kv%%=*}=" .env || echo "$kv" >> .env; done
if [[ -f "$m/wg0.conf" ]]; then
  echo "Installing the WireGuard hub with the SAME keys, so routers only need the new endpoint IP…"
  sudo apt-get install -y -qq wireguard-tools >/dev/null; sudo install -m 600 "$m/wg0.conf" /etc/wireguard/wg0.conf
  sudo systemctl enable --now wg-quick@wg0
  sudo mkdir -p /etc/systemd/system/docker.service.d
  printf '[Unit]\nAfter=wg-quick@wg0.service\nWants=wg-quick@wg0.service\n' | sudo tee /etc/systemd/system/docker.service.d/after-wireguard.conf >/dev/null
  sudo systemctl daemon-reload; sudo ufw allow 51820/udp >/dev/null
fi
echo "Creating containers and volumes…"
docker compose --profile radius build hub acs radius >/dev/null
docker compose --profile radius create >/dev/null
# This Compose project's volume (never another project's on the same machine).
project=$(docker compose config 2>&1 | sed -n 's/^name: //p' | head -1 || true)
[[ -n "$project" ]] || { echo "Cannot read the Compose project name. docker compose says:" >&2; docker compose config >/dev/null; exit 1; }
vol(){ docker volume ls -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.volume=$1" | head -1; }
# A rehearsal copy may already be running here: stop it, or it keeps its old database open while the files are replaced.
docker compose --profile radius stop tunnel radius hub acs >/dev/null 2>&1 || true
for v in hub-data acs-private; do [[ -n "$(vol $v)" ]] || { echo "Volume $v was not created" >&2; exit 1; }; done
docker run --rm -v "$(vol hub-data)":/d alpine sh -c 'find /d -mindepth 1 -delete'
docker run --rm -v "$(vol hub-data)":/d -v "$m":/i:ro alpine sh -c 'tar -C /d -xzf /i/hub-data.tgz && if [ -f /i/network.sqlite ]; then cp /i/network.sqlite /d/network.sqlite; rm -f /d/network.sqlite-wal /d/network.sqlite-shm; fi; chown -R "$(stat -c %u:%g /d/master.key)" /d'
docker run --rm -v "$(vol acs-private)":/d -v "$m":/i:ro alpine sh -c 'find /d -mindepth 1 -delete; tar -C /d -xzf /i/acs-private.tgz'
docker run --rm -v "$(vol hub-data)":/d alpine test -f /d/master.key || { echo "master.key missing from the package" >&2; exit 1; }
set -a; . ./.env; set +a
docker compose up -d mongo; for i in $(seq 1 30); do docker compose exec -T mongo mongosh --quiet --eval 'db.runCommand({ping:1}).ok' -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin >/dev/null 2>&1 && break; sleep 2; done
docker compose exec -T mongo mongorestore --quiet --drop --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip < "$m/genieacs.archive.gz"
docker compose up -d acs hub
if [[ -n "${NETWORK_RADIUS_TOKEN:-}" && -f /etc/wireguard/wg0.conf ]]; then docker compose --profile radius up -d radius; fi
if $final; then docker compose up -d tunnel; echo "Tunnel started: netops.kadenetworks.com now serves from this server."; else echo "Rehearsal: tunnel NOT started; the live site is still the old server."; fi
sleep 5; docker compose --profile radius ps
docker compose exec -T hub node -e "fetch('http://127.0.0.1:4317/api/session').then(r=>r.json()).then(j=>console.log('netops answering; setup needed:',!!j.setup)).catch(e=>{console.error('netops not answering:',e.message);process.exit(1)})"
echo "Imported. Delete the package when you are happy: shred -u $in"
