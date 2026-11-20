# Customer addresses: my.kadenetworks.com and wifi.kadenetworks.com

| Address | Who | What |
|---|---|---|
| `netops.kadenetworks.com` | Staff | Admin and operations. Unchanged. |
| `my.kadenetworks.com` | Customers (hotspot and PPPoE) | Packages, M-Pesa, My account, self-service links, short links (`my.kadenetworks.com/Ab3dE7k`) |
| `wifi.kadenetworks.com` | Hotspot customers on the WiFi | The router's own login, timer and disconnect pages (replaces `wifi.kade`) |

## What netops does

**Once `NETWORK_PORTAL_ORIGIN` is set** to `https://my.kadenetworks.com`:

- **`my.kadenetworks.com/`** opens the customer portal. The admin site, its API and the live view are **not** served there (404).
- **New links use `my.kadenetworks.com`.** That covers:
  - SMS short links
  - self-service links
  - upgrade and insight messages
  - the router login, status and logout pages
  - payment return pages
- **Nothing old breaks.** The customer pages keep working on `netops.kadenetworks.com` as well, so links already sent and routers not yet switched keep working.
- **Pushing the WiFi pages to a router** also adds `my.kadenetworks.com` to that router's walled garden, so the pages and the address they use always arrive together.
- **Browsers are told to always use HTTPS** on both addresses (HSTS).

## Your steps, in order

### 1. Cloudflare: add `my.kadenetworks.com` to the tunnel

1. Go to Cloudflare Zero Trust → Networks → Tunnels → `netops-server` → **Public hostnames** → **Add a public hostname**.
2. Fill in:
   - Subdomain `my`
   - Domain `kadenetworks.com`
   - Type `HTTP`
   - URL `hub:4317`
3. Save, then check that `https://my.kadenetworks.com/` shows the customer portal.

### 2. Server: switch netops to the new address for customer links

In the server's `.env` (on the server only, never in chat or git), add:

```
NETWORK_PORTAL_ORIGIN=https://my.kadenetworks.com
```

Then recreate only the hub container:

```
cd ~/network-hub && docker compose up -d hub
```

Never use `down -v`; it deletes the database.

From now on, new customer links say `my.kadenetworks.com`.

### 3. Test on LAB-HEX first

1. In netops, go to MikroTik → Router jobs and queue **Push hotspot login and status pages** for LAB-HEX. This:
   - writes the new `login.html`, `status.html` and `logout.html`
   - adds `my.kadenetworks.com` to that router's walled garden
2. Change the hotspot's name on LAB-HEX in the terminal. First look:
   ```
   /ip hotspot profile print
   ```
   Then set it, using the profile name shown:
   ```
   /ip hotspot profile set [find name="<profile name>"] dns-name=wifi.kadenetworks.com
   ```
3. Test with a phone on LAB-HEX:
   - the login page opens
   - packages load from `my.kadenetworks.com`
   - payment works
   - after connecting, `wifi.kadenetworks.com/status` shows the timer
   - Disconnect shows the new page

### 4. Optional DNS record for `wifi.kadenetworks.com`

Phones that use their own private DNS (Android "Private DNS", iCloud Private Relay) may not open a name that only the router knows. To make it open everywhere:

1. In Cloudflare DNS, add an **A** record `wifi` → your hotspot gateway address (for example `10.5.50.1`).
2. Set it to **DNS only** (grey cloud, not proxied).

If your routers use different hotspot gateway addresses, either give them the same gateway address or use one name per site (for example `ikutha.wifi.kadenetworks.com`).

### 5. Production routers

Only when you decide, one router at a time, at a quiet hour: repeat step 3 for that router. Until then it keeps working exactly as before.

### 6. Later (optional): Cloudflare Access in front of netops

This adds an email sign-in in front of `netops.kadenetworks.com`. Routers, the ACS and payment callbacks also use that address, so it needs bypass rules for their paths. Ask for the exact bypass list before turning it on.

## Undo

1. Remove `NETWORK_PORTAL_ORIGIN` from `.env` and run `docker compose up -d hub`. Customer links go back to `netops.kadenetworks.com`.
2. On a router, set `dns-name` back to `wifi.kade`.
