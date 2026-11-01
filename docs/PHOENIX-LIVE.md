# Phoenix live view (Phases 1–2)

A live NOC screen at **https://netops.kadenetworks.com/live**: customers online (by router and service, top users),
routers up/down, open alerts, people on the WiFi page now and, for admins, today's payments. It updates by itself
over a websocket; nothing to refresh.

## How it fits

- The Node app stays exactly as it is. Phoenix is an extra, optional container (`live`, Compose profile `live`).
- Phoenix has **no database** and changes nothing. One process inside it asks the hub for a snapshot every 3 seconds
  (internal port 4319, private network only, shared token) and pushes changes to everyone watching.
- Browsers never reach Phoenix directly. The hub checks the netops sign-in on `/live` (page and websocket), then
  passes the request on with the user and the shared token; Phoenix refuses anything without them. No Cloudflare
  change is needed. Field installers cannot open it; money is shown to admins only.
- If Phoenix is not running, `/live` says so and the rest of netops is unaffected.

## Turn it on (on the server)

```bash
cd ~/network-hub && git pull
echo "NETWORK_LIVE_TOKEN=$(openssl rand -hex 24)" >> .env
echo "LIVE_SECRET_KEY_BASE=$(openssl rand -hex 48)" >> .env
echo "NETWORK_LIVE_URL=http://live:4000" >> .env
docker compose --profile live --profile radius up -d --build hub live
```

Then open netops → **Live view** (bottom of the menu). Memory: about 150–250 MB (`LIVE_MEMORY`, default 384m).

To turn it off: `docker compose stop live` and remove `NETWORK_LIVE_URL` from `.env` (then `docker compose up -d hub`).

## Phase 2 (Nov 2026)

- **Event stream.** Node keeps an outbox of what just happened (alert opened/resolved, router up/down, payment
  received/reversed, ticket opened, customer added, customer connected/disconnected through netops RADIUS), kept 48 h.
  Phoenix follows it with a cursor about once a second (`/internal/v1/events?after=N`), so the **Activity** panel
  updates within a second or two. After a Phoenix restart it starts from the latest 50 events; if the database was
  restored (cursor ahead), it starts again. The delay is shown under the screen ("events 0.4 s behind").
- **Internal API v1** (port 4319, private network, bearer token): `/internal/v1/snapshot` (with the event cursor),
  `/internal/v1/events`, `/internal/v1/session`. The old `/internal/live` still answers.
- **Sign-out ends the live view.** The hub passes a session id (an HMAC, not the cookie); each screen re-checks it
  every 30 s and closes when you sign out of netops or your account is turned off.
- **Who may watch.** `NETWORK_LIVE_ROLES=admin` (or `admin,manager`) in `.env` limits `/live` to those roles; empty
  means everyone except field installers. Phoenix applies the same list. Money stays admin-only.
- **Origin check.** The hub refuses a live websocket whose Origin is not netops itself (and Phoenix checks too).
- **Health.** `GET /healthz` inside the container (feed and event status, lag); Docker uses it as the health check.
  Check by hand: `docker compose exec live curl -s localhost:4000/healthz`.
- **CI.** `.github/workflows/live.yml` runs the Node tests and `mix test`, then builds the Phoenix image and pushes it
  to `ghcr.io/<owner>/netops-live`. On the server you can then skip compiling Elixir:
  `echo "LIVE_IMAGE=ghcr.io/loveryxgalax/netops-live:latest" >> .env && docker compose pull live && docker compose --profile live up -d live`
  (the package must be readable by the server: make it public in GitHub → Packages, or `docker login ghcr.io`).

## Status

- Node side (feed, sign-in check, page and websocket pass-through): built and tested.
- Phoenix app (`live/`): its tests run with `mix test` in `live/` and in CI (this coding environment cannot reach the
  Hex registry, so they are run by GitHub Actions or on the server).
