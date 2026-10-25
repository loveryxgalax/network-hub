# Leaving ISPman, one router at a time

Nothing here happens automatically. Each step is something you run and can undo. Customers on routers you have
not switched keep using ISPman the whole time.

## Stage 0: deploy netops RADIUS (no customer impact)

1. On the VM: `cd ~/network-hub && git pull && docker compose up -d --build hub`
2. Follow `docs/RADIUS.md` step 1: WireGuard, Azure UDP 51820, the two `.env` secrets,
   `docker compose --profile radius up -d --build`.
3. In netops → Subscribers & plans:
   * **Plans**: recreate your ISPman packages with the *same names* (needed for import).
   * **M-Pesa & portal**: Daraja keys. Start in **Sandbox**, switch to **Live** after a test payment.
   * **SMS**: Africa's Talking username, API key and sender ID; send a test.

## Stage 1: test on the hEX with `@kade` logins (no customer impact)

1. `sudo bash deployment/wireguard/add-router.sh hEX 2` on the VM; paste the output on the hEX. Its RADIUS entry
   has `realm=kade`, so only logins like `test@kade` reach netops.
2. Create a subscriber `test`, record a payment, and log in as `test@kade`:
   * PPPoE: a spare router or a laptop PPPoE client.
   * Hotspot: the normal hotspot login page with `test@kade`.
3. Check **Online now**, **Login log** and the speed (the plan's rate limit).
4. Hotspot portal test: upload netops' `login.html` to a *second* hotspot server profile (not the live one),
   add the walled-garden lines from the M-Pesa & portal tab, buy a package with a sandbox number.

## Stage 2: import customers (no customer impact)

Export customers from ISPman (CSV with username, password, phone, package, expiry). In netops → **Import CSV**:
preview, fix any red rows, import. Nothing is saved if any row has a problem. Importing again updates by username,
so re-run it just before switching to pick up last-minute renewals.

## Stage 3: switch the hEX

Do this at a quiet hour. Look first, change second:
```
/radius print
/ip proxy access print
/ip firewall nat print where comment~"ISPMAN"
```
1. Send all logins to netops and pause ISPman's RADIUS entry (N = its number from `/radius print`):
   ```
   /radius set [find comment~"netops"] realm=""
   /radius disable N
   ```
2. Expired PPPoE customers (address list `no-internet`) must reach the netops portal to pay:
   ```
   /ip firewall address-list add list=netops-portal address=netops.kadenetworks.com comment="netops portal"
   /ip firewall filter add chain=forward src-address-list=no-internet dst-address-list=netops-portal action=accept comment="netops portal" place-before=[find comment~"block all non-captive"]
   ```
   Point ISPman's expired redirect at `https://netops.kadenetworks.com/portal/?tab=account` (it is the web proxy
   rule or NAT rule found above; send me its output and I will give the exact edit).
3. Hotspot: replace `hotspot/login.html` with netops' file (keep the old one as `login-ispman.html`) and add the
   walled-garden lines from the M-Pesa & portal tab.
4. Existing sessions keep working; customers move to netops at their next login. To move everyone now, disconnect
   PPPoE sessions in batches (`/ppp active remove [find]`) only when you are ready for a few seconds of downtime.

Watch **Login log** for rejections for the first hour. A rejected customer usually means a missing or different
password: fix it in netops (Edit → New password) and they can log in straight away.

**Rollback (one minute):**
```
/radius enable N
/radius set [find comment~"netops"] realm=kade
```
and put back `login-ispman.html` as `login.html`.

## Stage 4: CCR2004, then the RB

Same as Stage 1 → 3 with `add-router.sh CCR2004 3` and `add-router.sh RB 4`.

## Stage 5: remove ISPman (after a week without problems)

Remove ISPman's RADIUS entry, its WireGuard interface (`wg-ispman-v4`), its API users (`ispman`, `ispman-ro`) and
its scheduler/scripts. Keep its firewall rules until netops' equivalents are confirmed; send me
`/ip firewall export` first and I will list exactly what is safe to delete.
