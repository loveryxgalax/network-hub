# Transfer to Claude Code

The prepared ZIP is a source-only handoff. Extract it to a new folder, open that folder in Claude Code, and tell Claude Code to read `CLAUDE.md` before changing anything.

## Safe source transfer

```powershell
npm ci
npm run check
npm test
npm start
```

This starts a clean local installation. Create the owner account locally at `http://127.0.0.1:4317` if the data directory is new.

## Continue the existing live installation on this PC

Claude Code can open the original folder directly:

`C:\Users\hp\Documents\codex1\network-dashboard`

That keeps the current database, encrypted credentials, tunnel configuration, and Windows startup tasks in place. Do not upload the private data directory or environment files into a Claude conversation or source repository.

## Move the live installation to another machine

Moving the source ZIP alone does not carry the live owner account, router enrollment credentials, Cloudflare Tunnel identity, or GenieACS state.

1. On the old machine, pause this project's recovery and stop its processes with `scripts\stop-online.ps1`.
2. Back up `data\network.sqlite`, any `data\network.sqlite-wal` and `data\network.sqlite-shm` files, and `data\master.key` together.
3. Preserve `.env.cloudflare` and the matching Cloudflare tunnel credential separately from the source archive.
4. Preserve the `NetworkHub-ACS` WSL deployment separately if its GenieACS and MongoDB state must move.
5. Restore private files only into a trusted local environment, install dependencies with `npm ci`, then verify locally before changing DNS or starting the public tunnel.

Do not copy the SQLite database while the app is writing unless the WAL files are included. The safer workflow is to stop the project first.

## First Claude Code task

Ask Claude Code to:

1. Read `CLAUDE.md`, `README.md`, `docs/DEPLOYMENT.md`, `docs/CUSTOMER-DISCOVERY.md`, and `docs/TR069.md`.
2. Run `npm ci`, `npm run check`, and `npm test` without changing RouterOS or network equipment.
3. Inspect the current live status before editing deployment scripts.
4. Keep the stated no-upgrade and no-reboot router rules.

