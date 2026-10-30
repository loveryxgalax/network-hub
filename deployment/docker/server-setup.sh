#!/usr/bin/env bash
# Run once as a sudo user on a fresh Ubuntu 24.04 server (ARM or x86): installs Docker, enables automatic
# security updates and the firewall (SSH only), and checks the clock. Changes no router or Cloudflare setting.
set -euo pipefail
[[ $(id -u) == 0 ]] && { echo "Run as your normal sudo user, not root." >&2; exit 1; }
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git ufw unattended-upgrades chrony fail2ban wireguard-tools jq age rclone
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker chrony
# Small servers (for example Google's free e2-micro, ~1 GB RAM) need swap for MongoDB, GenieACS and image builds.
if [ "$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)" -lt 3000 ] && [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-network-hub.conf >/dev/null && sudo sysctl -q --system
  echo "Added 2 GB swap for a small server."
fi
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw allow OpenSSH && sudo ufw allow 51820/udp comment 'netops WireGuard' && sudo ufw --force enable
# Block repeated SSH login attempts.
sudo systemctl enable --now fail2ban
echo "Architecture: $(uname -m)"; timedatectl | grep -E "synchronized|Time zone"
echo "Done. Log out and back in so the docker group applies, then run: docker run --rm hello-world"
