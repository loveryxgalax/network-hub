# Task for Claude in the browser: add cloud.kadenetworks.com (Cloudflare only)

Copy everything below the line into Claude in the browser, while you are signed in to the Cloudflare dashboard.

---

You are helping the owner of Kade Networks move their staff dashboard from `cloud.kadenetworks.com` to a new
address, `cloud.kadenetworks.com`. Your only job is the **Cloudflare part (stage 1)**. Work slowly and stop to ask
if anything on screen does not match these instructions.

## Rules (do not break these)

1. **Only add.** Do not edit, rename, move or delete any existing public hostname, DNS record, tunnel, route,
   application, policy or certificate.
2. **Do not touch** `cloud.kadenetworks.com`, `my.kadenetworks.com`, `wifi.kadenetworks.com` or anything
   related to ISPman. They must keep working exactly as now.
3. Do not change SSL/TLS settings, "Always Use HTTPS", WAF, caching or any zone-wide setting.
4. Do not create or reveal API tokens, tunnel tokens or passwords, and do not paste any secret into the chat.
5. If a step asks to confirm something not listed here (for example "delete", "replace", "migrate tunnel"),
   **stop and ask the owner**.

## Steps

1. Open **Cloudflare Zero Trust** (one.dash.cloudflare.com) → **Networks** → **Tunnels**.
2. Find the tunnel that serves `cloud.kadenetworks.com` (its **Public Hostname** tab lists `Kade Cloud`).
   Open it → **Public Hostname** tab.
3. **Write down** the existing `Kade Cloud` entry exactly as shown: Service type and URL (expected: type `HTTP`,
   URL `hub:4317`), and any "Additional application settings" that are not default. Do not change it.
4. Click **Add a public hostname** and fill in:
   - Subdomain: `cloud`
   - Domain: `kadenetworks.com`
   - Path: leave empty
   - Service Type: the same as the Kade Cloud entry (expected `HTTP`)
   - URL: the same as the Kade Cloud entry (expected `hub:4317`)
   - Additional application settings: copy only what you wrote down in step 3; otherwise leave the defaults.
5. Save. Cloudflare creates the DNS record and certificate for `cloud.kadenetworks.com` by itself.
   If it reports that a DNS record named `cloud` already exists, **stop and tell the owner** (do not overwrite it).
6. Check the list now shows **Kade Cloud**, **my**, **wifi** (if they were there before) **and cloud**, and nothing else changed.

## How to check it worked

Wait 1–2 minutes, then open `https://cloud.kadenetworks.com` in a new tab.

- **Expected now:** a page or message saying **"Unrecognized dashboard hostname"** (HTTP 403). That is correct:
  it proves the address and HTTPS work. The dashboard itself switches on in stage 2, which the owner does on
  the server.
- Also open `https://cloud.kadenetworks.com` and confirm it still loads the dashboard sign-in as before.
- If you see a Cloudflare error (1033, 502, 530) instead, report the exact error text to the owner. Do not try
  to fix it by changing other settings.

## Report back to the owner

Tell them: the hostname was added (subdomain, service type and URL used), what `https://cloud.kadenetworks.com`
shows, and that `Kade Cloud` still works. Then tell them the next step is stage 2 on the server (below).

---

## Stage 2 (owner, on the server, not in the browser)

In `~/network-hub/.env` add these two lines, then run `docker compose up -d hub`:

```
NETWORK_ALIAS_ORIGINS=https://cloud.kadenetworks.com
LIVE_EXTRA_HOSTS=cloud.kadenetworks.com
```

Back up `.env` first: `cp ~/network-hub/.env ~/env-before-cloud-$(date +%F)`. After this, sign in on
`https://cloud.kadenetworks.com` and test: dashboard, customers, a customer profile, Health. `Kade Cloud` keeps
working. Stages 3 and 4 (making cloud the main address) and the rollback are in `docs/MOVE-TO-CLOUD.md`.
