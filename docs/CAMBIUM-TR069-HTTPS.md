# Cambium R195W: dedicated HTTPS ACS endpoint for clients without SNI

Status (2026-11-10): implementation complete and rehearsed locally; **not yet deployed**. DNS, the VPS listener and the
Cambium have not been changed. Every live step below is still to be done and is marked as such in §7.

## 1. Why

The Cambium cnPilot R195W (hardware V4.3, serial WFWM0BKTD6CV) never completes a TR-069 Inform through
`https://netops.kadenetworks.com/cwmp/`:

* A capture on firmware 4.7.2 showed a TLS 1.2 ClientHello **without SNI** to both Cloudflare addresses, answered at once
  with a fatal `handshake_failure`, before any certificate or ACS authentication. Cloudflare needs SNI to pick a certificate.
* On firmware 4.8.1-R4 the device logs `SSL socket connection failed[336130315] : wrong version number`. That OpenSSL
  error means the bytes received were not a TLS record (for example an HTTP or alert reply where a ServerHello was
  expected). The upgraded firmware's ClientHello has **not** been captured, so its SNI behaviour is unverified.
* `/etc/tr069/client.crt … Check private key and cert file failed` means the device has no **client** certificate of
  its own. GenieACS does not ask for one (it uses the serial/password), so this message is not the cause by itself.
* A laptop `curl --tlsv1.2 https://netops.kadenetworks.com/cwmp/` gets `405 CWMP requires POST`: the route and the
  laptop's TLS work. That says nothing about the Cambium's own handshake.

The fix: a second, **DNS-only** hostname served directly by the VPS through Caddy, which always presents its own
certificate even when the client sends no SNI (`default_sni`). The Cloudflare route stays exactly as it is.

## 2. What is in the repository

| File | Purpose |
|---|---|
| `deployment/acs/Caddyfile` | Caddy: `admin off`; `default_sni` = the ACS host; TLS 1.2/1.3; RSA-2048 certificate from Let's Encrypt, renewed automatically; forwards **only** `/cwmp` and `/cwmp/*` to `acs:7548`; everything else 404 |
| `deployment/acs/compose.https.yml` | Overlay adding service `acs-https` (profile `acs-https`, image `caddy:2-alpine`, 128 MB), publishing 80/443, named volumes `acs-tls-data`/`acs-tls-config` for certificate state |
| `deployment/acs/verify-https.sh` | Read-only external checks (no credentials): non-SNI TLS 1.2 with hostname verification, chain, TLS 1.0/1.1 refused, GET 405, other paths 404, unauthenticated Inform 401, port 80 redirect only |
| `lib/cpelink.cjs` `pinAcsUrl` + `POST /api/cpe/acs-url` + form on **Router auto-enrol (TR-069)** | Per-device ACS address pin (see §6) |
| `lib/acs.cjs` `askPppLogin` (used by automatic registration) | A new CPE that cannot be matched yet is asked, read-only, for its PPPoE username and WAN address at its next check-in (once an hour at most, only on the data model it uses), so it links to its customer without manual steps. TR-181 PPP WAN address now also counts for matching |
| `test/acs-https.test.cjs` | CI checks on the Caddyfile, the overlay and the pin |

Data path, unchanged after Caddy:

```
Cambium ──TLS 1.2 (no SNI ok)──▶ VPS:443 Caddy (acs-https) ──HTTP──▶ acs:7548 isolation proxy ──▶ GenieACS CWMP 127.0.0.1:7547
                                                                          (fresh socket per request)     serial + password auth
```

Not exposed by this change: GenieACS NBI (7557), MongoDB, the hub/dashboard (4317), Caddy's admin API (disabled).
The routine `scripts/autodeploy.sh` uses only `docker-compose.yml`, so it never starts, stops or removes `acs-https`.

## 3. Rehearsal already done (local, not production)

Run with Caddy v2.8.4 (official release, SHA-512 checked) using this exact Caddyfile, local test certificates, the real
`deployment/acs/cwmp-proxy.cjs`, and a stand-in for GenieACS that answers 401 without credentials:

| Check | Result |
|---|---|
| `caddy validate` and `docker compose … --profile acs-https config` | valid |
| TLS 1.2 with **no SNI**, `-verify_hostname acs.kadenetworks.com -verify_return_error` | verified; ECDHE-RSA-AES128-GCM-SHA256, RSA 2048 |
| Same without the issuing CA / with a wrong hostname | refused (verification really enforced) |
| TLS 1.0 / 1.1 | refused |
| `GET /cwmp/`, `GET /cwmp` | 405 `CWMP requires POST` |
| `/`, `/devices/`, `/api/`, `/nbi`, `/config`, `/cwmpx`, `/cwmp/../devices/` | 404 |
| Unauthenticated POST Inform | 401 from the ACS side |
| Authenticated POST to `/cwmp/sub/path?x=1` | path, query, `Authorization`, `Cookie` and body arrive unchanged |
| `http://…/cwmp/` POST | 308 redirect only |
| Admin API on 2019 | not listening |
| `verify-https.sh` against the rehearsal | 13 passed, 0 failed |

TLS 1.2 cipher suites offered by the endpoint: ECDHE-RSA with AES-128/256-GCM and ChaCha20-Poly1305 (no CBC, no static
RSA). If the Cambium still fails with `handshake_failure` / `no shared cipher` **after** SNI is solved, see §8.

## 4. Deploy on the VPS (owner or an operator with existing access)

Do not reset the server, change its credentials, or restart the hub, MongoDB, RADIUS or the ACS for this.

### 4.1 Confirm what is actually running

```sh
cd <the netops checkout used by autodeploy>          # the directory containing docker-compose.yml and .env
git rev-parse --abbrev-ref HEAD; git log -1 --oneline # expect claude/always-online-hosting at or after this commit
docker compose ps                                     # hub, acs, mongo, tunnel (and radius/live if enabled) Up
sudo ss -ltnp '( sport = :80 or sport = :443 )'       # MUST print nothing. If anything listens, stop here.
```

### 4.2 Firewall

* Provider (HOSTKEY) firewall: allow inbound TCP **80** (certificate issue/renewal) and **443** to 82.47.143.14.
* Docker publishes ports through its own iptables rules, which **bypass UFW**. That is fine here (we want 80/443 public),
  but it means a UFW rule does not restrict them. If you keep rules in `DOCKER-USER`, review them:
  `sudo iptables -S DOCKER-USER`. Do not add rules that touch the WireGuard (51820/udp) or RADIUS paths.
* Back up before changing: `sudo iptables-save > ~/iptables.before-acs-https.$(date +%F)`; if UFW is used:
  `sudo cp -a /etc/ufw ~/ufw.before-acs-https.$(date +%F)`.

### 4.3 DNS (Cloudflare dashboard)

* Add **A** record `acs` → `82.47.143.14`, Proxy status **DNS only (grey cloud)**. Do not route it through the tunnel.
* Add **AAAA** only if the VPS has working public IPv6.
* Check from outside: `dig +short acs.kadenetworks.com` returns 82.47.143.14 only (no Cloudflare 104.21.x / 172.67.x).

### 4.4 Configure and validate

```sh
cp -a .env .env.before-acs-https.$(date +%F)
printf '\nACS_TLS_HOST=acs.kadenetworks.com\nACS_TLS_EMAIL=<an address you read>\n' >> .env
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https config --quiet
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https run --rm --no-deps \
  acs-https caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

### 4.5 Start only the new service

```sh
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https up -d --no-deps acs-https
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml logs --tail=50 acs-https
# expect: "certificate obtained successfully" for acs.kadenetworks.com (issuer Let's Encrypt)
docker compose ps        # every existing service still Up, same uptime as before
```

## 5. Verify the endpoint before touching the Cambium

From a laptop **outside** the VPS:

```sh
sh deployment/acs/verify-https.sh acs.kadenetworks.com
```

All checks must pass. Note the chain printed under "2.": the leaf is issued by a Let's Encrypt intermediate that
chains to **ISRG Root X1**.

**Does the Cambium need a CA import?** First try without one (it may already trust ISRG Root X1). Only if the device then
logs a certificate/issuer error: download ISRG Root X1 from Let's Encrypt (https://letsencrypt.org/certificates/,
`isrgrootx1.pem`), check its SHA-256 fingerprint on that page (`openssl x509 -in isrgrootx1.pem -noout -fingerprint -sha256`),
and import it in the Cambium's TR-069 CA certificate field. Never disable certificate checking and never use plain HTTP.

## 6. Switch only the lab Cambium

1. In netops → **Router auto-enrol (TR-069)** → *ACS address for one device*: serial `WFWM0BKTD6CV`, address
   `https://acs.kadenetworks.com/cwmp/` → Save. (The serial must already be on the allow-list; it is after the earlier
   enrolment attempt. If netops says it is not, register it first from the user1 profile.) This pin keeps the dedicated
   address on record for this serial; later automatic re-registration no longer resets it to the global address.
   netops never writes an ACS URL into a device: neither the automatic registration nor the private-credential
   migration (`ManagementServer.Username/Password/ConnectionRequest*` only) changes `ManagementServer.URL`.
2. On the Cambium (LAN 192.168.11.1): TR-069 → ACS URL `https://acs.kadenetworks.com/cwmp/`. Keep TLS 1.2, the
   username (= serial) and the current ACS password exactly as they are; do not touch the connection-request fields.
   Note the previous URL first (`https://netops.kadenetworks.com:443/cwmp/`) for rollback. Save, then trigger an Inform
   (or wait one periodic interval).
3. Do not reset the Cambium, change PPPoE, or touch LAB-HEX for this. Production CCR, HEX and RBX are out of scope.

## 7. Acceptance (report each separately; anything not observed stays "unverified")

| Step | How to see it | Status |
|---|---|---|
| Transport | `verify-https.sh` all pass; Cambium log has no SSL error | unverified |
| Authentication | GenieACS accepts the Inform (no 401 for the serial) | unverified |
| Inform | **TR-069 → Devices**: serial WFWM0BKTD6CV, Cambium, model R195W, *Last inform* within the interval | unverified |
| Customer link | Device registered to **user1** (matched by its PPPoE username; not the MikroTik B8570C8D2333) | unverified |
| Private credentials | Auto-enrol audit: "Registered WFWM0BKTD6CV automatically…" then "now uses its own ACS login" | unverified |
| Periodic check-in | *Last inform* advances again after one interval, using the private login | unverified |
| Parameter refresh | TR-069 → the device → **Refresh**: the task shows *Executed*, values update (not just queued) | unverified |
| Service | user1 still online in PPPoE → Sessions, internet works on the Cambium | unverified |

When all pass and no other installer is enrolling a device: **Router auto-enrol → Turn off shared login**.

## 8. If it still fails

* `wrong version number` persists: capture the upgraded firmware's handshake on LAB-HEX
  (`/tool sniffer` on the PPPoE interface, filter host 82.47.143.14 port 443) and read the ClientHello (SNI present?
  version? cipher list?). Compare with the endpoint's ciphers in §3.
* `handshake_failure` with no SNI problem: the cipher lists do not overlap. Only then, add to the `tls` block in
  `deployment/acs/Caddyfile` the specific suite(s) the device offers, for example
  `ciphers TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA`, validate, and restart only
  `acs-https`.
* Certificate errors: check the device clock (NTP) before anything else, then the CA import in §5.
* 401 for the serial: check the allow-list entry is enabled and the password on the device matches the shared or
  private login netops expects. Do not weaken GenieACS authentication.

## 9. Rollback

1. Cambium: set the ACS URL back to `https://netops.kadenetworks.com:443/cwmp/`.
2. netops: Router auto-enrol → *ACS address for one device* → serial `WFWM0BKTD6CV`, empty address → Save (clears the pin).
3. Stop and remove only the new service; keep its certificate volumes:
   ```sh
   docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https stop acs-https
   docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https rm -f acs-https
   ```
   Never `down -v`. Optional: remove `ACS_TLS_HOST`/`ACS_TLS_EMAIL` from `.env` (or restore `.env.before-acs-https.*`).
4. Remove the `acs` DNS record (only if no CPE uses it) and the 80/443 provider-firewall rule added in §4.2; restore the
   iptables/UFW backups only if you changed them.

The Cloudflare `https://netops.kadenetworks.com/cwmp/` route, GenieACS, MongoDB, the hub and RADIUS are untouched
throughout.
