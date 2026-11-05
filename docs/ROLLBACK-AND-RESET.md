# Rolling back a design, and wiping test data

## 1. Roll back code and design (safe, one command)

Restore points are git tags named `rollback/...`:

| Tag | What it restores |
|---|---|
| `rollback/before-tonight` | Everything exactly as it was before the night's testing and changes. |
| `rollback/before-portal-redesign` | The admin as it was before the new portal designs (language dropdown, header, account page, chat, situation views, phone check). |

On the server (or on any checkout of the branch):

```bash
cd ~/network-hub && git pull -q
scripts/rollback.sh rollback/before-tonight            # preview: lists the files that would change
scripts/rollback.sh rollback/before-tonight --apply    # restore, commit and push
```

It makes ONE new commit that puts the files back exactly as they were at the tag. History is kept (nothing is rewritten), so
auto-deploy picks it up within about 2 minutes like any other change, and you can roll forward again with the same command
and a newer tag or commit.

Only code and design change. Data in the database is untouched. The newer code only adds optional fields
(`tvs` on customers, `accountPrefix` in portal settings), which older code simply ignores.

Smaller step: undo just one change with `git revert <commit>` and push.

To mark another restore point before more testing: `git tag rollback/<name> && git push origin rollback/<name>`.

## 2. Wipe everything except the admin

Use this before linking a new MikroTik so no old routers, customers, payments, logs or test data remain.

```bash
cd ~/network-hub && git pull -q
docker compose stop hub live
# 1. Look first (changes nothing):
docker compose run --rm --no-deps hub node scripts/reset-keep-admin.cjs
# 2. Wipe. A full backup is saved under the data folder's backups/ first:
docker compose run --rm --no-deps hub node scripts/reset-keep-admin.cjs --yes --keep-settings
docker compose --profile live --profile radius up -d hub live
```

* `--keep-settings` also keeps what you configured by hand: workspace name, portal design, M-Pesa / SMS / email / WhatsApp /
  Paystack credentials, RADIUS and WireGuard server settings and roles. Leave it off to wipe those too (you would then enter
  them again).
* Always kept: the admin account(s) and the database key (`master.key`).
* Removed: all routers and their job runners and discovery data, customers, packages, payments, tickets, sessions, logs, vouchers,
  campaigns, branches, other staff accounts.
* Undo: stop the hub, copy the file from `backups/pre-reset-<time>.sqlite` over `network.sqlite`, delete
  `network.sqlite-wal` and `network.sqlite-shm`, start the hub.

Not touched by this script: WireGuard peers already added on the server host (the host's sync script removes them when it
next syncs an empty list), FreeRADIUS and the optional GenieACS/Mongo data, and the routers themselves. Routers keep their own
configuration; reset or remove the old ones on the router side if you reuse them.
