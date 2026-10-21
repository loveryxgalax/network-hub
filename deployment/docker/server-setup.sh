#!/usr/bin/env bash
# Run once as a sudo user on a fresh Ubuntu 24.04 server (ARM or x86): installs Docker, enables automatic
# security updates and the firewall (SSH only), and checks the clock. Changes no router or Cloudflare setting.
set -euo pipefail
[[ $(id -u) == 0 ]] && { echo "Run as your normal sudo user, not root." >&2; exit 1; }
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl git ufw unattended-upgrades chrony
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker chrony
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw allow OpenSSH && sudo ufw --force enable
echo "Architecture: $(uname -m)"; timedatectl | grep -E "synchronized|Time zone"
echo "Done. Log out and back in so the docker group applies, then run: docker run --rm hello-world"
