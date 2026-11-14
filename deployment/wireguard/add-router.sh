#!/bin/bash
# Add one MikroTik to the netops WireGuard network and print the RouterOS commands to paste on it.
# Usage: sudo bash deployment/wireguard/add-router.sh <name> <number 2-254> [public IP of this server]
# Example: sudo bash deployment/wireguard/add-router.sh hEX 2
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
name=${1:?router name}; n=${2:?address number 2-254}; endpoint=${3:-$(curl -fsS https://api.ipify.org)}
[[ "$name" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || { echo "Name: letters, numbers, dot, dash, underscore"; exit 1; }
[[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 2 ] && [ "$n" -le 254 ] || { echo "Number must be 2-254"; exit 1; }
ip="10.99.0.$n"
grep -q "AllowedIPs = $ip/32" /etc/wireguard/wg0.conf && { echo "$ip is already used in /etc/wireguard/wg0.conf"; exit 1; }
secret=$(grep -E '^RADIUS_SECRET=' "$(dirname "$0")/../../.env" | cut -d= -f2-)
[ -n "$secret" ] || { echo "Set RADIUS_SECRET in .env first"; exit 1; }
umask 077
priv=$(wg genkey); pub=$(printf '%s' "$priv" | wg pubkey); server=$(wg show wg0 public-key)
printf '\n[Peer]\n# %s\nPublicKey = %s\nAllowedIPs = %s/32\n' "$name" "$pub" "$ip" >> /etc/wireguard/wg0.conf
wg syncconf wg0 <(wg-quick strip wg0)
cat <<ROS

=== Paste on $name (WinBox -> New Terminal). Private: contains its WireGuard key and the RADIUS secret. ===
/interface wireguard add name=wg-netops listen-port=13299 private-key="$priv" comment="netops"
/interface wireguard peers add interface=wg-netops public-key="$server" endpoint-address=$endpoint endpoint-port=51820 allowed-address=10.99.0.1/32 persistent-keepalive=25s comment="netops server"
/ip address add address=$ip/24 interface=wg-netops comment="netops"
/radius add address=10.99.0.1 secret="$secret" service=ppp,hotspot src-address=$ip realm=kade timeout=3s comment="netops RADIUS (test: only user@kade)"
:delay 5s; /ping 10.99.0.1 count=3
ROS
echo
echo "realm=kade means only logins like jane@kade go to netops; everyone else stays on ISPman."
