# FreeRADIUS for netops: speaks RADIUS to the MikroTiks (over WireGuard) and asks the hub who may log in (rlm_rest).
FROM freeradius/freeradius-server:3.2.6-alpine
RUN rm -f /etc/raddb/sites-enabled/* /etc/raddb/mods-enabled/eap /etc/raddb/mods-enabled/files /etc/raddb/mods-enabled/detail* /etc/raddb/mods-enabled/radutmp /etc/raddb/mods-enabled/sradutmp /etc/raddb/mods-enabled/linelog /etc/raddb/mods-enabled/unix /etc/raddb/mods-enabled/passwd /etc/raddb/mods-enabled/ntlm_auth
COPY clients.conf /etc/raddb/clients.conf
COPY rest /etc/raddb/mods-enabled/rest
COPY netops /etc/raddb/sites-enabled/netops
