# Netops RADIUS: leaving ISPman

Netops now has its own RADIUS: plans, subscribers, the login decision, speed limits, expiry and session
accounting (**Subscribers & plans** in the sidebar). The MikroTiks keep doing the work (PPPoE, hotspot, queues,
firewall); only the RADIUS server they ask changes.

```
MikroTik ──WireGuard (UDP 51820)──▶ the server's wg0 10.99.0.1 ──▶ FreeRADIUS (1812/1813) ──▶ hub :4318 (private)
```

* FreeRADIUS checks PAP, CHAP and MS-CHAP passwords. The hub decides who may log in, returns
  `Mikrotik-Rate-Limit`, `Session-Timeout` (time left on the plan), an optional static IP, and records accounting.
* Expired PPPoE customers are accepted at 512k into the `no-internet` address list (the router's existing redirect
  shows the payment page). Expired hotspot logins are rejected.
* New subscribers start expired until **Renew** (paid). Passwords are stored encrypted (CHAP/MS-CHAP need them).
* The hub's RADIUS port 4318 is only on the private Docker network and requires `NETWORK_RADIUS_TOKEN`; the
  Cloudflare Tunnel never routes it. RADIUS itself only listens on the WireGuard address.

## 1. Server (once)

```
cd ~/network-hub && git pull
sudo bash deployment/wireguard/setup-server.sh
```
Make sure UDP 51820 reaches the server from the internet: allow it in the server's firewall (the setup script does this for ufw) and, if your provider or your own router sits in front of the server, add the allow rule or port forward there.

Add to `~/network-hub/.env` (two new random values):
```
echo "RADIUS_SECRET=$(openssl rand -base64 24 | tr -d '/+=')" >> .env
echo "NETWORK_RADIUS_TOKEN=$(openssl rand -base64 24 | tr -d '/+=')" >> .env
docker compose --profile radius up -d --build
```

## 2. One test router

```
sudo bash deployment/wireguard/add-router.sh hEX 2
```
Paste the printed commands on that MikroTik. They add a WireGuard tunnel and a RADIUS entry with `realm=kade`:
only logins written `username@kade` go to netops; every other customer keeps using ISPman.

Create a plan and a test subscriber in netops, renew it, then log in as `test@kade` (PPPoE on a spare router, or
the hotspot page). Check **Online now** and **Login log**.

## 3. Switching a router over

When tests pass: move that router's customers into netops (same usernames and passwords, renew their expiry),
then on the router remove `realm=kade` from the netops RADIUS entry and disable ISPman's entry. Look first with
`/radius print` and note ISPman's entry number (shown as N below):
```
/radius set [find comment~"netops"] realm=""
/radius disable N
```
Rollback: `/radius enable N` and `/radius set [find comment~"netops"] realm=kade`.
