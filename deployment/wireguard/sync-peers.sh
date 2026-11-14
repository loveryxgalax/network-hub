#!/bin/bash
# Apply the WireGuard peers managed on netops (MikroTik → WireGuard page) to wg0 on this server, keep the
# staff → router management firewall rules, and report handshakes back to netops.
# Run once by hand:   sudo bash deployment/wireguard/sync-peers.sh
# Run every minute:   sudo bash deployment/wireguard/sync-peers.sh --install
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
dir=$(cd "$(dirname "$0")/../.." && pwd)
if [ "${1:-}" = "--install" ]; then
  printf '[Unit]\nDescription=netops WireGuard peer sync\n[Service]\nType=oneshot\nExecStart=/bin/bash %s/deployment/wireguard/sync-peers.sh\n' "$dir" > /etc/systemd/system/netops-wg-sync.service
  printf '[Unit]\nDescription=netops WireGuard peer sync every minute\n[Timer]\nOnBootSec=1min\nOnUnitActiveSec=1min\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/netops-wg-sync.timer
  systemctl daemon-reload && systemctl enable --now netops-wg-sync.timer && echo "Installed: syncs every minute (systemctl status netops-wg-sync.timer)"; exit 0
fi
command -v jq >/dev/null || apt-get install -y jq >/dev/null
cd "$dir"
# Tell netops this server's WireGuard public key, port and public address (used only while the page is still empty).
# Set WG_ENDPOINT in .env (a host name or IP) if the address detected below is not the one routers should use.
endpoint=$(grep -s '^WG_ENDPOINT=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)
[ -n "$endpoint" ] || endpoint=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
if [ -n "$endpoint" ]; then docker compose exec -T hub node lib/wg-cli.cjs server "$(wg show wg0 public-key)" "$(wg show wg0 listen-port)" "$endpoint" >/dev/null || true; fi
json=$(docker compose exec -T hub node lib/wg-cli.cjs peers)
umask 077
# Keep [Interface] from wg0.conf; replace every [Peer] with the list from netops.
iface=$(awk '/^\[Peer\]/{exit} {print}' /etc/wireguard/wg0.conf)
new=$(printf '%s\n\n%s' "$iface" "$(jq -r .conf <<<"$json")")
if [ "$new" != "$(cat /etc/wireguard/wg0.conf)" ]; then
  cp /etc/wireguard/wg0.conf "/etc/wireguard/wg0.conf.bak.$(date +%s)"; ls -t /etc/wireguard/wg0.conf.bak.* 2>/dev/null | tail -n +6 | xargs -r rm -f
  printf '%s\n' "$new" > /etc/wireguard/wg0.conf; wg syncconf wg0 <(wg-quick strip wg0); echo "wg0 peers updated"
fi
# Staff laptops may reach routers' management ports only; nothing else is forwarded between peers.
sysctl -q -w net.ipv4.ip_forward=1
iptables -N NETOPS-WG 2>/dev/null || true; iptables -F NETOPS-WG
iptables -C FORWARD -i wg0 -o wg0 -j NETOPS-WG 2>/dev/null || iptables -I FORWARD 1 -i wg0 -o wg0 -j NETOPS-WG
ports=$(jq -r '.ports|join(",")' <<<"$json")
iptables -A NETOPS-WG -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for s in $(jq -r '.staff[]' <<<"$json"); do for r in $(jq -r '.routers[]' <<<"$json"); do
  iptables -A NETOPS-WG -s "$s" -d "$r" -p tcp -m multiport --dports "$ports" -j ACCEPT; done; done
iptables -A NETOPS-WG -j DROP
# The first dump line is the interface (with its private key): never send it on.
wg show wg0 dump | tail -n +2 | docker compose exec -T hub node lib/wg-cli.cjs status >/dev/null
