# Phoenix live view (Phase 1)

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

## Status

- Node side (feed, sign-in check, page and websocket pass-through): built and tested.
- Phoenix app (`live/`): written; its tests run with `mix test` in `live/`. It is built inside Docker on the server,
  where the Hex package registry is reachable.
