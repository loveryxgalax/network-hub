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
