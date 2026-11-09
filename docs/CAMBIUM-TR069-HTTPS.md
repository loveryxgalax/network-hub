# Cambium R195W: HTTPS ACS for clients without SNI

Status: deployment configuration prepared; not yet deployed or verified against the Cambium.

The earlier R195W capture showed a TLS 1.2 ClientHello without SNI and rejection at the Cloudflare edge. The laptop reaching `/cwmp/` and receiving HTTP 405 proved that its TLS path worked, not that the router's handshake worked. The device's `wrong version number` error preceded ACS authentication. Missing client-certificate messages were also logged; a live retest must determine whether any separate firmware/trust-store issue remains.

This optional Caddy endpoint selects a default certificate for non-SNI clients. It keeps TLS 1.2/1.3 and certificate verification, presents an RSA leaf certificate, and forwards only `/cwmp/` to the existing connection-isolation proxy. GenieACS shared/private credential authentication stays in place. NBI, MongoDB and the dashboard are not exposed. Existing Cloudflare traffic is unchanged.

## Prerequisites

- Access to the existing Docker Compose VPS checkout and its existing `.env` (never paste credentials into chat or GitHub).
- A dedicated hostname, for example `acs.kadenetworks.com`, with a **DNS-only** A record pointing at this VPS. Do not orange-cloud this hostname. Add AAAA only if that server's IPv6 is configured and reachable.
- TCP 80 and 443 available on this server and allowed by its firewall/provider firewall. Check listeners first; do not stop another service or replace its configuration to free the ports.
- Existing `acs` container healthy. Do not reset/re-enrol any MikroTik or alter production routers.

A normal repository autodeploy does not activate this endpoint. No DNS, firewall, public binding or CPE URL change is performed by adding these files.

## Deploy from the repository root

Add these non-secret values to the server's existing `.env` (use your actual hostname/contact):

```dotenv
ACS_TLS_HOST=acs.kadenetworks.com
ACS_TLS_EMAIL=support@kadenetworks.com
```

Validate the overlay and Caddy configuration before starting the listener:

```sh
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https config --quiet
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https run --rm --no-deps acs-https caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Then start only the new endpoint (do not rebuild/restart the running hub, ACS or database):

```sh
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https up -d --no-deps acs-https
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml logs --tail=50 acs-https
```

Caddy obtains and renews the certificate. Keep its data volume; deleting it loses certificate state. Review logs privately before sharing; do not publish router credentials or full CWMP payloads.

## Verify transport, authentication and the actual router

1. Verify the endpoint certificate normally:

   ```sh
   curl --tlsv1.2 --tls-max 1.2 -i https://acs.kadenetworks.com/cwmp/
   ```

   Expect HTTP 405 with `Allow: POST`. Do not use `-k` or disable device certificate validation.

2. Test a **non-SNI** handshake, replacing `VPS_IP` with the confirmed server IP:

   ```sh
   openssl s_client -connect VPS_IP:443 -noservername -tls1_2 -verify_hostname acs.kadenetworks.com -verify_return_error </dev/null
   ```

   Require successful certificate-chain and hostname verification. A normal browser/curl request alone does not test this failure mode.

3. Verify unrelated paths return 404, including `/devices/` and `/api/`. Verify an unauthenticated real CWMP Inform is refused by GenieACS; a 405 GET is not an authentication test. Use the existing lab diagnostics without logging passwords.
4. On **Cambium WFWM0BKTD6CV only**, change ACS URL to `https://acs.kadenetworks.com/cwmp/`; keep its current ACS username/password and TLS 1.2. Save and trigger an Inform. Do not reset the router or change connection-request credentials as part of this repair.
5. Confirm the Cambium serial appears online, a successful Inform is recorded, and it links to the intended lab PPPoE customer. Recheck the periodic Inform after five minutes. If TLS still fails, inspect the actual handshake/certificate-chain error before changing credentials or trust settings.
6. Turn shared enrolment off after all intended lab CPEs have private credentials. Do not turn it off while another authorised installer is enrolling a device.

## Rollback

Restore the Cambium's previous ACS URL if changed. Stop only the optional listener:

```sh
docker compose -f docker-compose.yml -f deployment/acs/compose.https.yml --profile acs-https stop acs-https
```

Retain certificate and database volumes. Do not run `down -v`. Remove the dedicated DNS record only if no CPEs depend on it. The old Cloudflare `/cwmp/` route remains available throughout.
