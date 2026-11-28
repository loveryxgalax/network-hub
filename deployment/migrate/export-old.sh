#!/usr/bin/env bash
# Run on the OLD server to package everything netops needs into one file for the new server.
#   Rehearsal (netops keeps running; data may change afterwards):  bash deployment/migrate/export-old.sh
#   Final cut-over (stops netops so nothing changes after the copy): bash deployment/migrate/export-old.sh --final
# Output: ~/netops-migration.tar (contains secrets: the database, master.key, .env and the WireGuard keys).
set -euo pipefail
cd "$(dirname "$0")/../.."
final=false;[[ "${1:-}" == "--final" ]] && final=true
out="$HOME/netops-migration.tar";work=$(mktemp -d);trap 'rm -rf "$work"' EXIT;umask 077
# This Compose project's volume (never another project's on the same machine).
project=$(docker compose config 2>&1 | sed -n 's/^name: //p' | head -1 || true)
[[ -n "$project" ]] || { echo "Cannot read the Compose project name. docker compose says:" >&2; docker compose config >/dev/null; exit 1; }
vol(){ docker volume ls -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.volume=$1" | head -1; }
set -a; . ./.env; set +a
mkdir "$work/m"
echo "Dumping the GenieACS database…"
docker compose exec -T mongo mongodump --quiet --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --db genieacs --archive --gzip > "$work/m/genieacs.archive.gz"
if $final; then echo "Stopping netops (hub, RADIUS, tunnel) so nothing changes after the copy…"; docker compose --profile radius stop tunnel radius hub; fi
echo "Copying the netops data volume…"
if $final; then docker run --rm -v "$(vol hub-data)":/d:ro -v "$work/m":/o alpine tar -C /d -czf /o/hub-data.tgz .
else docker compose exec -T hub node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/network.sqlite').exec(\"VACUUM INTO '/tmp/migrate.sqlite'\")"
  docker run --rm -v "$(vol hub-data)":/d:ro -v "$work/m":/o alpine tar -C /d --exclude=network.sqlite --exclude='network.sqlite-*' -czf /o/hub-data.tgz .
  docker compose cp hub:/tmp/migrate.sqlite "$work/m/network.sqlite"; docker compose exec -T hub rm -f /tmp/migrate.sqlite; fi
docker run --rm -v "$(vol acs-private)":/d:ro -v "$work/m":/o alpine tar -C /d -czf /o/acs-private.tgz .
cp .env "$work/m/env"
[[ -f deployment/docker/backup.env ]] && cp deployment/docker/backup.env "$work/m/backup.env"
if sudo test -f /etc/wireguard/wg0.conf; then sudo cat /etc/wireguard/wg0.conf > "$work/m/wg0.conf"; else echo "Note: no /etc/wireguard/wg0.conf on this server."; fi
date -u +%FT%TZ > "$work/m/exported-at"; $final && echo final > "$work/m/mode" || echo rehearsal > "$work/m/mode"
tar -C "$work" -cf "$out" m; chmod 600 "$out"
echo "Done: $out ($(du -h "$out" | cut -f1)). Copy it to the new server, e.g.:"
echo "  scp $out ubuntu@NEW_SERVER_IP:~/"
$final && echo "netops is now STOPPED here. To undo the cut-over: docker compose --profile radius start hub radius tunnel"
