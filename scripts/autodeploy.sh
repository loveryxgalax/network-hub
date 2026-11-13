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
if ! docker compose --profile live --profile radius up -d --no-deps --wait --wait-timeout 120 "${services[@]}" 2>&1 | tail -20; then
  log 'start or health check failed; will retry'; exit 1
fi
printf '%s\n' "$target" > "$marker"
log "deployed $(git rev-parse --short HEAD) (healthy)"
