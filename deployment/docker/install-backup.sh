#!/usr/bin/env bash
# Install the nightly encrypted off-site backup as a systemd timer (02:30 Nairobi time = 23:30 UTC).
# Before running: configure rclone (remote "offsite") and deployment/docker/backup.env — see docs/MIGRATE-HOSTKEY.md.
set -euo pipefail
dir=$(cd "$(dirname "$0")/../.." && pwd)
[[ -f "$dir/deployment/docker/backup.env" ]] || { echo "Create deployment/docker/backup.env first" >&2; exit 1; }
rc=$(rclone config file 2>/dev/null | tail -1)
[[ -f "$rc" ]] || { echo "Run 'rclone config' first and create a remote named offsite" >&2; exit 1; }
printf '[Unit]\nDescription=netops nightly encrypted backup\nAfter=docker.service\n[Service]\nType=oneshot\nUser=root\nEnvironment=RCLONE_CONFIG=%s\nExecStart=/bin/bash %s/deployment/docker/backup.sh\n' "$rc" "$dir" | sudo tee /etc/systemd/system/netops-backup.service >/dev/null
printf '[Unit]\nDescription=netops nightly backup\n[Timer]\nOnCalendar=*-*-* 23:30:00 UTC\nPersistent=true\nRandomizedDelaySec=300\n[Install]\nWantedBy=timers.target\n' | sudo tee /etc/systemd/system/netops-backup.timer >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now netops-backup.timer
echo "Installed. Run one backup now to check it:  sudo systemctl start netops-backup && journalctl -u netops-backup -n 20"
