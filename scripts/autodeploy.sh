#!/usr/bin/env bash
# Deploy the tracked app branch. A successful marker is separate from the checkout,
# so failed builds and unhealthy starts are retried even after Git has advanced.
set -euo pipefail
cd "$(dirname "$0")/.."
exec 9>"${NETOPS_DEPLOY_LOCK:-/tmp/netops-autodeploy.lock}"
flock -n 9 || exit 0
log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }
if ! git fetch -q origin; then log 'fetch failed'; exit 1; fi
before=$(git rev-parse HEAD)
target=$(git rev-parse '@{u}')
marker=$(git rev-parse --git-path netops-deployed)
last=''
if [ -f "$marker" ]; then last=$(cat "$marker"); fi
# Remote logging: keep the small log relay running (it is separate from RADIUS and is never restarted here).
# Started only when the server's WireGuard address is up, because the relay listens on it.
bind=$(grep -E '^RADIUS_BIND=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true); bind=${bind:-10.99.0.1}
if ip -4 addr 2>/dev/null | grep -q "inet ${bind}/" && [ -z "$(docker compose --profile radius ps -q syslog-relay 2>/dev/null || true)" ]; then
  if docker compose --profile radius up -d --no-deps syslog-relay >/dev/null 2>&1; then log 'started the remote logging relay'; else log 'remote logging relay did not start'; fi
fi
if [ "$last" = "$target" ]; then exit 0; fi
if [ "$before" != "$target" ]; then
  if ! git merge -q --ff-only '@{u}'; then log 'cannot fast-forward (local changes?)'; exit 1; fi
fi
# ACS, MongoDB, RADIUS and the tunnel are independent services. An ordinary app
# deployment must not rebuild or restart them. Include live only when its files change.
services=(hub)
baseline=${last:-$before}
if ! git cat-file -e "$baseline^{commit}" 2>/dev/null; then baseline=$before; fi
if [ -n "$(git diff --name-only "$baseline" "$target" -- live docker-compose.yml)" ]; then services+=(live); fi
log "deploying $(git rev-parse --short HEAD): ${services[*]}"
# Build first: an unsuccessful build leaves the running service untouched.
if ! docker compose --profile live --profile radius build "${services[@]}" 2>&1 | tail -20; then
  log 'build failed; current containers preserved; will retry'; exit 1
fi
# Before switching the app, take a consistent copy of the database inside the data volume and check it opens and
# passes SQLite's integrity check with the same record count. No verified copy, no deploy (retried next run).
if [ -n "$(docker compose ps -q hub 2>/dev/null)" ]; then
  snap="predeploy-$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short "$target").sqlite"
  if ! docker compose exec -T hub node -e "
const fs=require('node:fs'),{DatabaseSync}=require('node:sqlite'),dir='/data/predeploy',out=dir+'/'+process.argv[1];
fs.mkdirSync(dir,{recursive:true});const d=new DatabaseSync('/data/network.sqlite');d.exec(\"VACUUM INTO '\"+out+\"'\");
const src=d.prepare('SELECT count(*) n FROM records').get().n,c=new DatabaseSync(out,{readOnly:true});
if(c.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||c.prepare('SELECT count(*) n FROM records').get().n!==src){fs.rmSync(out,{force:true});console.error('copy failed verification');process.exit(1);}
for(const f of fs.readdirSync(dir).filter(x=>x.startsWith('predeploy-')).sort().slice(0,-3))fs.rmSync(dir+'/'+f,{force:true});
console.log('verified '+out+' ('+src+' records)');" "$snap" 2>&1 | tail -3; then
    log 'pre-deploy database copy failed; current containers preserved; will retry'; exit 1
  fi
fi
if ! docker compose --profile live --profile radius up -d --no-deps --wait --wait-timeout 120 "${services[@]}" 2>&1 | tail -20; then
  log 'start or health check failed; will retry'; exit 1
fi
printf '%s\n' "$target" > "$marker"
log "deployed $(git rev-parse --short HEAD) (healthy)"
