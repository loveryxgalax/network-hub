#!/bin/sh
# External checks for the dedicated HTTPS ACS endpoint. Read-only, uses no credentials.
# Usage: sh deployment/acs/verify-https.sh acs.kadenetworks.com [IP-to-test]
# Run from a machine OUTSIDE the server (a laptop is fine). Needs openssl and curl.
set -u
HOST=${1:?usage: verify-https.sh HOSTNAME [IP]}
IP=${2:-}
RESOLVE=""; [ -n "$IP" ] && RESOLVE="--resolve $HOST:443:$IP"
TARGET=${IP:-$HOST}
pass=0; fail=0
ok(){ echo "PASS  $1"; pass=$((pass+1)); }
bad(){ echo "FAIL  $1"; fail=$((fail+1)); }

echo "== DNS"
if command -v dig >/dev/null 2>&1; then echo "   A: $(dig +short A "$HOST" | tr '\n' ' ')"; fi

echo "== 1. TLS 1.2 handshake WITHOUT SNI, chain and hostname verified against the system trust store"
if openssl s_client -connect "$TARGET:443" -noservername -tls1_2 -verify_hostname "$HOST" -verify_return_error </dev/null >/tmp/acs-sni.$$ 2>&1; then ok "non-SNI TLS 1.2 verified"; else bad "non-SNI TLS 1.2 (see below)"; grep -E "verify error|alert|error" /tmp/acs-sni.$$ | head -3; fi
grep -E "Protocol *:|Cipher is|Server public key" /tmp/acs-sni.$$ | sed 's/^/      /' | head -3; rm -f /tmp/acs-sni.$$

echo "== 2. Certificate chain presented (import the ROOT shown here on the CPE only if it does not already trust it)"
openssl s_client -connect "$TARGET:443" -noservername -tls1_2 -showcerts </dev/null 2>/dev/null | grep -E "^ *[0-9]+ s:|^ *i:" | sed 's/^/      /'
openssl s_client -connect "$TARGET:443" -noservername -tls1_2 </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null | sed 's/^/      /'

echo "== 3. TLS 1.0/1.1 refused"
for v in tls1 tls1_1; do if openssl s_client -connect "$TARGET:443" -noservername -$v -cipher 'DEFAULT@SECLEVEL=0' </dev/null >/dev/null 2>&1; then bad "$v accepted"; else ok "$v refused"; fi; done

echo "== 4. GET /cwmp/ answers 405 'CWMP requires POST' (TLS 1.2 only, verification on)"
out=$(curl -sS -i --tlsv1.2 --tls-max 1.2 $RESOLVE "https://$HOST/cwmp/" 2>&1)
echo "$out" | grep -qE "^HTTP/[0-9.]+ 405" && echo "$out" | grep -q "CWMP requires POST" && ok "GET /cwmp/ -> 405" || { bad "GET /cwmp/"; echo "$out" | head -3; }

echo "== 5. Everything else is 404"
for p in / /devices/ /api/ /nbi /config /cwmpx /admin; do c=$(curl -s -o /dev/null -w '%{http_code}' --path-as-is $RESOLVE "https://$HOST$p"); [ "$c" = 404 ] && ok "$p -> 404" || bad "$p -> $c"; done

echo "== 6. Unauthenticated CWMP Inform is refused by GenieACS"
INFORM='<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cwmp="urn:dslforum-org:cwmp-1-0"><soap:Header><cwmp:ID soap:mustUnderstand="1">1</cwmp:ID></soap:Header><soap:Body><cwmp:Inform><DeviceId><Manufacturer>Test</Manufacturer><OUI>000000</OUI><ProductClass>Test</ProductClass><SerialNumber>VERIFY-NOT-A-DEVICE</SerialNumber></DeviceId><Event soap:arrayType="cwmp:EventStruct[1]"><EventStruct><EventCode>2 PERIODIC</EventCode><CommandKey></CommandKey></EventStruct></Event><MaxEnvelopes>1</MaxEnvelopes><CurrentTime>2026-01-01T00:00:00Z</CurrentTime><RetryCount>0</RetryCount><ParameterList soap:arrayType="cwmp:ParameterValueStruct[0]"></ParameterList></cwmp:Inform></soap:Body></soap:Envelope>'
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/xml; charset="utf-8"' -H 'SOAPAction:' --data "$INFORM" $RESOLVE "https://$HOST/cwmp/")
[ "$c" = 401 ] && ok "unauthenticated Inform -> 401" || bad "unauthenticated Inform -> $c (must be 401)"

echo "== 7. Port 80 only redirects (needed for certificate renewal), never serves CWMP"
loc=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -X POST -H "Host: $HOST" "http://$TARGET/cwmp/")
case "$loc" in 30[18]\ https://*) ok "http -> $loc";; *) bad "http answered: $loc";; esac

echo; echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
