# Deploy without typing the command

`scripts/autodeploy.sh` checks GitHub every 2 minutes. When the branch the server tracks has a new commit it pulls
it and rebuilds `hub` and `live` (the same thing as your manual deploy). No new commit means it does nothing.

One-time install (run on your PC, it logs in once and sets up the schedule):

```
ssh ubuntu@82.47.143.14 "chmod +x ~/network-hub/scripts/autodeploy.sh && (crontab -l 2>/dev/null | grep -v autodeploy.sh; echo '*/2 * * * * ~/network-hub/scripts/autodeploy.sh >> ~/autodeploy.log 2>&1') | crontab - && crontab -l"
```

- Watch it: `ssh ubuntu@82.47.143.14 "tail -20 ~/autodeploy.log"`
- Turn it off: `ssh ubuntu@82.47.143.14 "crontab -l | grep -v autodeploy.sh | crontab -"`
- A failed build leaves the running containers as they are; the log shows why.
- Anything pushed to the tracked branch goes live within about 2 minutes, so only trusted people should be able to
  push to it. Pushing to another branch changes nothing on the server.

## Failure handling and independent services

The app deploy builds `hub` first, then starts it with `--no-deps --wait` and waits for its health check. It includes `live` only when `live/` or the Compose file changes. It does not rebuild or restart ACS, MongoDB, RADIUS or the tunnel. Changes to those independent services need their own tested deployment.

Build pipelines use `pipefail`: a failed Docker build cannot be reported as deployed. The successful commit is stored in Git's private `netops-deployed` marker, not inferred from the checkout. A failed build/start is retried on the next run even if Git already pulled the commit. The first run without a marker verifies and deploys the app once.

An operator already connected to the VPS can run the normal app deployment immediately:

```bash
sudo -u ubuntu -H bash /home/ubuntu/network-hub/scripts/autodeploy.sh
```

Do not run commands against production routers to troubleshoot an app deployment.
