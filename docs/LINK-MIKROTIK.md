# Link a MikroTik

MikroTik → **Link a MikroTik** (admins). Four steps:

1. **Router identity**: the name (also set on the router so netops RADIUS recognises it), and what to install:
   WireGuard tunnel, netops RADIUS (none / test logins `user@realm` / all logins), job runner.
2. **Link script**: one line to paste in Winbox → New Terminal. The router downloads its private bundle from netops
   over HTTPS (certificate checked; the link works for 2 hours) and installs monitoring, customer discovery and the
   parts you chose. The page ticks each check as the router reports in. If RouterOS says "not allowed by
   device-mode", follow the steps shown (netops never changes device-mode itself).
3. **Services** (new or reset routers only): PPPoE and/or Hotspot, the uplink port (never bridged) and the customer
   ports. Ports already in a bridge, with an address or carrying the uplink cannot be chosen. Preview shows exactly
   what will be set up and the script.
4. **Apply**: type the router name. The job runner runs the script within a minute.

What the setup creates: bridge `netops-bridge` with the chosen ports; hotspot (address, pool, DHCP, profile using
RADIUS, login page downloaded from netops, walled garden for the netops address); PPPoE server `netops` with a pool
and profile, PPP AAA using RADIUS with accounting; NAT masquerade out of the uplink if missing.

Factory-default routers: a router that still has its default configuration has its LAN ports in the bridge named `bridge`.
The services step can take the ports you choose out of that bridge (a tick box, on by default there). Only ports
in `bridge` with the factory `defconf` marker are touched, and at least one port (or the Wi-Fi) must stay, so the router
stays reachable at its default address. Ports in any other bridge are never changed.

Safety: the script checks the router first and returns "STOPPED: nothing was changed" if it finds a PPPoE server, a
hotspot, the netops bridge, a chosen port that is in a bridge, has an address or a DHCP client, an address range
already in use, or no netops RADIUS entry. netops also refuses the step for routers that report PPPoE/hotspot
sessions. It never reboots, never upgrades or resets RouterOS, and never touches router users.

Needs on the server: `NETWORK_PUBLIC_ORIGIN`; for WireGuard, the server details on Operations → WireGuard & Winbox
access; for netops RADIUS, `RADIUS_SECRET` in `.env` (passed to the hub as `NETWORK_RADIUS_SECRET`).
