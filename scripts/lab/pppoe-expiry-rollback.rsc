# Restore the original proxy settings observed on LAB-HEX during this test only.
:if ([/system identity get name] != "LAB-HEX") do={ :error "STOPPED: LAB-HEX only" }
/ip proxy set enabled=no port=8080 cache-on-disk=no max-cache-size=unlimited max-client-connections=600 max-server-connections=600
/ip firewall nat remove [find where comment~"^netops-expiry:"]
/ip firewall filter remove [find where comment~"^netops-expiry:"]
/ip proxy access remove [find where comment~"^netops-expiry:"]
/ip firewall address-list remove [find where comment="netops-expiry: portal"]
