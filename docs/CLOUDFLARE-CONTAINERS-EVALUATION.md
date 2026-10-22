# Cloudflare Containers evaluation (2026-10-22)

Question: can Network Hub run on Cloudflare Containers instead of a VPS, so everything lives in one Cloudflare account?

Sources: Cloudflare documentation read on 2026-10-22 (Containers FAQ, architecture, pricing, limits changelog). Nothing was deployed or tested; the cost figures are arithmetic from the published rates, not a quote.

## Verdict

**Not a good fit today.** Containers is built for stateless or short-lived work. Network Hub keeps its state in SQLite (dashboard) and MongoDB (GenieACS), and both need a real, durable disk.

## Findings

| Topic | What the docs say | Effect on Network Hub |
| --- | --- | --- |
| Disk | "All disk is ephemeral by default." A restarted or slept instance starts from a fresh image disk. | SQLite, `master.key`, MongoDB data and `cpes.json` would be lost on any restart unless stored elsewhere. |
| Persistence options | Snapshots (immutable; need the Durable Object scheduling policy) or an R2 FUSE mount, which "does not provide local-disk performance or full POSIX filesystem semantics" (renames, locks and permissions differ). | SQLite (WAL, locking) and MongoDB should not run on a FUSE-mounted bucket. Snapshots are point-in-time, so writes since the last snapshot can be lost. |
| Lifetime | No fixed maximum runtime, but "Cloudflare does not guarantee that any container instance will run for a set period." Host restarts happen on an irregular cadence (SIGTERM, up to 15 minutes, then SIGKILL). Default `sleepAfter` is 10 minutes. | Always-on is possible only by overriding the sleep behaviour, and instances can still move or restart. Everything must tolerate restarts. |
| Entry | Traffic reaches a container through a Worker and Durable Object. | The Cloudflare Tunnel is not needed, but the app needs a Worker front end. |
| Storage services | Durable data belongs in D1, R2, KV or Durable Object storage. | Honest migration path: SQLite to D1 and GenieACS's MongoDB to an external managed database. That means rewriting `lib/store.cjs` and changing the ACS storage layer. |
| Cost | Requires Workers Paid ($5/month). Memory is billed on provisioned size at $0.0000025 per GiB-second beyond 25 GiB-hours, disk on provisioned size, CPU on active use. | Estimated, always on: dashboard on `basic` (1/4 vCPU, 1 GiB) about $13/month; with an ACS and a database container roughly $30-50/month. A VPS with the same stack is about $5-12/month. |
| Network | Outbound internet from containers is available. | Same limit as any cloud host: no private LAN access without a management VPN. UDP/SNMP egress was not verified. |

## What it would take

1. Replace SQLite storage with D1 or an external database (a rewrite and re-test of the data layer and its 30 tests).
2. Host MongoDB or replace it with an external managed service (GenieACS requires MongoDB).
3. Add a Worker and Durable Object front end, always-on settings and restart handling.
4. Re-test router agents, TR-069 check-ins and backups.

This is a multi-week rewrite of a working system to save a few dollars of server management.

## Recommendation

Run the existing Docker Compose stack on an ordinary server (a paid VPS for production; Oracle Always Free is fine for rehearsal), keep the Cloudflare Tunnel, keep tested encrypted off-server backups. Re-evaluate Containers only if persistent volumes become a documented feature or the app is deliberately redesigned for Workers and D1.
