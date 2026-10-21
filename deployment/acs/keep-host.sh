#!/usr/bin/env bash
set -euo pipefail
systemctl start mongod network-hub-acs-cwmp network-hub-acs-nbi network-hub-acs-proxy
trap 'exit 0' TERM INT
while sleep 30; do
  for service in mongod network-hub-acs-cwmp network-hub-acs-nbi network-hub-acs-proxy; do
    if ! systemctl is-active --quiet "$service"; then systemctl start "$service"; fi
  done
done
