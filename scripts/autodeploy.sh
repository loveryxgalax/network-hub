#!/usr/bin/env bash
# Pulls the branch this checkout tracks and rebuilds hub + live ONLY when there is a new commit.
# Run from cron every couple of minutes (see docs/AUTO-DEPLOY.md). Safe to run often: it does nothing when up to date,
# never runs two deploys at once, and leaves the running containers alone if the build fails.
set -u
cd "$(dirname "$0")/.." || exit 1
exec 9>/tmp/netops-autodeploy.lock; flock -n 9 || exit 0
git fetch -q origin || { echo "$(date -Is) fetch failed"; exit 0; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}')" ] && exit 0
echo "$(date -Is) new commit $(git rev-parse --short '@{u}'), deploying"
git merge -q --ff-only '@{u}' || { echo "$(date -Is) cannot fast-forward (local changes?)"; exit 1; }
if docker compose --profile live --profile radius up -d --build hub live 2>&1 | tail -3; then
  sleep 10; docker compose ps hub live --format '{{.Name}} {{.Status}}'
  echo "$(date -Is) deployed $(git rev-parse --short HEAD)"
fi
