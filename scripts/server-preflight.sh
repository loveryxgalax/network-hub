#!/usr/bin/env bash
# Run on the server from the project folder BEFORE the WireGuard setup and the rebuild. It checks the things the
# MikroTik setup needs and fixes only what is safe to fix. It never prints a secret and never overwrites a value
# that is already set. Usage: bash scripts/server-preflight.sh
set -u
cd "$(dirname "$0")/.." || exit 1
ok(){ echo "  OK     $*"; }; fix(){ echo "  FIXED  $*"; }; bad(){ echo "  CHECK  $*"; ISSUES=$((ISSUES+1)); }
ISSUES=0; echo "netops server preflight"
[ -f .env ] || { touch .env; chmod 600 .env; fix ".env did not exist, created it"; }
val(){ grep -s "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"'; }
rnd(){ head -c 32 /dev/urandom | base64 | tr -d '/+=' | cut -c1-40; }
# Secrets that RADIUS and the live view share with the hub: add only when missing.
for k in RADIUS_SECRET NETWORK_RADIUS_TOKEN NETWORK_LIVE_TOKEN; do
  if [ -n "$(val $k)" ]; then ok "$k is set"; else printf '%s=%s\n' "$k" "$(rnd)" >> .env; fix "$k was missing, generated one (value not shown)"; fi
done
if [ -n "$(val LIVE_SECRET_KEY_BASE)" ]; then ok "LIVE_SECRET_KEY_BASE is set"; else printf 'LIVE_SECRET_KEY_BASE=%s%s\n' "$(rnd)" "$(rnd)" >> .env; fix "LIVE_SECRET_KEY_BASE was missing, generated one"; fi
for k in TUNNEL_TOKEN MONGO_ROOT_USER MONGO_ROOT_PASSWORD MONGO_APP_PASSWORD; do
  [ -n "$(val $k)" ] && ok "$k is set" || bad "$k is empty in .env (the site cannot start without it). Set it by hand."
done
grep -q "NETWORK_PUBLIC_ORIGIN: https://" docker-compose.yml && ok "public address: $(grep -m1 'NETWORK_PUBLIC_ORIGIN:' docker-compose.yml | awk '{print $2}')" || bad "NETWORK_PUBLIC_ORIGIN is not set in docker-compose.yml"
# WireGuard and the firewall on this server.
command -v wg >/dev/null && ok "wireguard tools installed" || echo "  TODO   wireguard tools not installed yet (the setup script installs them)"
if ip link show wg0 >/dev/null 2>&1; then ok "wg0 is up"; else echo "  TODO   wg0 does not exist yet (the setup script creates it)"; fi
if ss -lun 2>/dev/null | grep -q ':51820 '; then ok "UDP 51820 is listening on this server"; else echo "  TODO   nothing listens on UDP 51820 yet (the setup script starts it)"; fi
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  if ufw status | grep -q "51820/udp"; then ok "ufw allows UDP 51820"; else echo "  TODO   ufw is active; the setup script will allow UDP 51820"; fi
else ok "ufw is not active on this server"; fi
echo "  NOTE   a firewall in your hosting provider's panel (outside this server) can only be checked there: UDP 51820 inbound must be allowed."
[ "$ISSUES" -eq 0 ] && echo "preflight: nothing to fix by hand" || echo "preflight: $ISSUES item(s) need you (marked CHECK)"
exit 0
