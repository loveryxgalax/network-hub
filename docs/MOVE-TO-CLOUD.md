# Moving the admin site from cloud.kadenetworks.com to cloud.kadenetworks.com

The admin site (staff) moves to `https://cloud.kadenetworks.com`. **`cloud.kadenetworks.com` keeps working the whole
time** for everything that calls it: routers, M-Pesa and Paystack callbacks, short links, the expired-PPPoE redirect.
Nothing about `my.kadenetworks.com`, `wifi.kadenetworks.com` or ISPman changes. The database is not touched.

## What already uses which address (checked in the code)

| Thing | Address it uses | Needs a change? |
|---|---|---|
| Staff sign-in, dashboard, admin API | `NETWORK_PUBLIC_ORIGIN` | Yes: becomes `cloud` (stage 3). Staff sign in once on the new address (cookies are per address). |
| Customer portal, account pages, SMS/short links | `NETWORK_PORTAL_ORIGIN` (`my.`) | No |
| Router WiFi pages, status/logout pages | `my.` / `wifi.` | No |
| Router monitoring, job runner, provisioning scripts already on routers | the address they were made with (`Kade Cloud`) | No: `Kade Cloud` keeps answering. New scripts made after stage 3 use `cloud`. **No router is changed.** |
| RADIUS (PPPoE and hotspot logins) | WireGuard / IP, not a hostname | No |
| TR-069 / ACS | `NETWORK_ACS_PUBLIC_URL` | No |
| M-Pesa STK callbacks, B2C results, payer-name lookups | sent with each request from `NETWORK_PUBLIC_ORIGIN` | Automatic after stage 3; callbacks already in flight still reach `Kade Cloud` |
| M-Pesa paybill (C2B) confirmation URL | registered once with Safaricom (`Kade Cloud`) | Later, optional: re-register only when you choose; `Kade Cloud` keeps receiving them meanwhile |
| Paystack webhook | set in the Paystack dashboard (`Kade Cloud`) | Later, optional: change it in Paystack; `Kade Cloud` keeps receiving it meanwhile |
| Expired-PPPoE redirect on routers (`/portal/?expired=1`) | `Kade Cloud` | No: portal paths on `Kade Cloud` are never redirected |
| Phoenix live view | `LIVE_PUBLIC_HOST` / `LIVE_EXTRA_HOSTS` | Yes, with stage 3 (only if you run it) |

## Stage 0: backups

1. Admin → **Health → Server and backups → Make a copy and test-restore now**. It must say *passed*.
2. On the server: `cp ~/network-hub/.env ~/env-before-cloud-$(date +%F)` (keeps the current settings for rollback).

## Stage 1: Cloudflare (needs your Cloudflare login, no downtime)

The site is published through the Cloudflare Tunnel (no Nginx/Caddy on the server). Cloudflare creates the DNS record
and the HTTPS certificate itself.

1. Cloudflare Zero Trust → Networks → Tunnels → the Kade Cloud tunnel → **Public hostnames** → **Add a public hostname**.
2. Subdomain `cloud`, domain `kadenetworks.com`, type `HTTP`, URL `hub:4317` (exactly as the `Kade Cloud` entry).
3. Leave the `Kade Cloud`, `my` and `wifi` entries as they are.

Right after this, `https://cloud.kadenetworks.com` answers **403 "Unrecognized dashboard hostname"**. That is expected
until stage 2, and proves DNS and HTTPS work.

## Stage 2: let the hub answer on cloud too (Kade Cloud stays the main address)

In the server's `.env` add:
```
NETWORK_ALIAS_ORIGINS=https://cloud.kadenetworks.com
LIVE_EXTRA_HOSTS=cloud.kadenetworks.com
```
then `docker compose up -d hub` (a few seconds; routers retry, RADIUS keeps answering from the same container start).

Test on `https://cloud.kadenetworks.com`: sign in, dashboard, customers, a customer profile, Captive experience
preview, Health. Everything else still runs on `Kade Cloud`.

## Stage 3: make cloud the main address

`.env`:
```
NETWORK_PUBLIC_ORIGIN=https://cloud.kadenetworks.com
NETWORK_ALIAS_ORIGINS=https://cloud.kadenetworks.com
NETWORK_ALIAS_REDIRECT=1
LIVE_PUBLIC_HOST=cloud.kadenetworks.com
LIVE_EXTRA_HOSTS=cloud.kadenetworks.com
```
`docker compose up -d hub` (and `live` if used).

Now a person opening `cloud.kadenetworks.com` in a browser is sent to `cloud`. API calls, router scripts, callbacks,
webhooks, portal pages and short links on `Kade Cloud` are **not** redirected and keep working.

Test (all on cloud): sign in · dashboard numbers · open a customer · extend a test account · Captive experience
preview · Routers page shows LAB-HEX online (its monitoring still reports to `Kade Cloud`) · Health shows the backup ·
a KSh 1 test payment on LAB-HEX only when you choose to run one.

## Stage 4 (later, optional)

* Paybill URLs: M-Pesa & portal → Register paybill URLs with Safaricom (production shortcodes sometimes need
  Safaricom to change them; until then `Kade Cloud` keeps receiving paybill confirmations).
* Paystack: change the webhook URL in the Paystack dashboard to `https://cloud.kadenetworks.com/portal/api/paystack/webhook`.
* Routers: new scripts you generate already use `cloud`. Old scripts keep working against `Kade Cloud`; re-run them only
  when you decide to.
* Keep the `Kade Cloud` public hostname in Cloudflare until all of the above are moved.

## Rollback (any stage)

* Stage 3 → back: put the old lines back (`cp ~/env-before-cloud-<date> .env`) and `docker compose up -d hub`.
  `Kade Cloud` is the main address again; `cloud` simply stops answering (or keep it in `NETWORK_ALIAS_ORIGINS`).
* Stage 1 → back: delete the `cloud` public hostname in Cloudflare.
* No data is changed by any stage, so there is nothing to restore in the database.
