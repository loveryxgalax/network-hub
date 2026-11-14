#!/bin/bash
# One-time: turn the netops server into the WireGuard hub (10.99.0.1) that MikroTiks connect to for RADIUS.
# Run on the VM: sudo bash deployment/wireguard/setup-server.sh
# Afterwards make sure UDP 51820 can reach this server from the internet (the server's own firewall, plus your
# provider's firewall or your router's port forward if the server sits behind one).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
apt-get install -y wireguard-tools >/dev/null
umask 077
if [ ! -f /etc/wireguard/wg0.conf ]; then
  key=$(wg genkey)
  printf '[Interface]\nAddress = 10.99.0.1/24\nListenPort = 51820\nPrivateKey = %s\n' "$key" > /etc/wireguard/wg0.conf
fi
systemctl enable --now wg-quick@wg0
# RADIUS is published on 10.99.0.1, so Docker must start after wg0 exists.
mkdir -p /etc/systemd/system/docker.service.d
printf '[Unit]\nAfter=wg-quick@wg0.service\nWants=wg-quick@wg0.service\n' > /etc/systemd/system/docker.service.d/after-wireguard.conf
systemctl daemon-reload
echo "WireGuard is up. Server public key: $(wg show wg0 public-key)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 51820/udp >/dev/null && echo "ufw: allowed UDP 51820"; fi
echo "Next: make sure UDP 51820 reaches this server from the internet (provider firewall or router port forward), then run: sudo bash deployment/wireguard/sync-peers.sh --install"
echo "netops fills in the WireGuard server details by itself once the sync timer runs."
