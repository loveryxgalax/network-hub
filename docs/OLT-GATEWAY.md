# OLT gateway integration contract

This is an integration boundary, not a claim of support for any OLT brand. Implement the gateway against the actual vendor/model/firmware using its supported management protocol. The dashboard server must be able to reach it through HTTPS with a valid certificate. A loopback HTTP origin is allowed for local tests.

Configure an OLT with driver `olt-gateway`, the gateway HTTPS origin, its external device ID, and a bearer token using Monitor → Configure connection. Tokens are encrypted in the database. No generic shell command endpoint is exposed.

`GET /v1/devices/{externalId}/snapshot` must return independently observed device and subscriber state:

```json
{
  "online": true,
  "onus": [{"serial":"VENDOR_SERIAL","pon":"1/1","name":"Subscriber","online":true,"power":-20.1,"oltPower":-21.3}],
  "unconfigured": [{"serial":"NEW_SERIAL","pon":"1/2"}]
}
```

Readings are dBm numbers or omitted. `online` on each ONU must be a boolean. Respond with an error when collection fails; never return a successful snapshot for stale cache without identifying the loss of observation.

`POST /v1/devices/{externalId}/authorize` receives:

```json
{
  "serial":"NEW_SERIAL",
  "pon":"1/2",
  "profileId":"workspace-profile-id",
  "profile":{"name":"100M","vendor":"actual model","vlan":100,"download":100,"upload":100,"tr069Url":""},
  "idempotencyKey":"server-generated-operation-id"
}
```

The gateway must durably deduplicate `idempotencyKey`, apply the intended vendor operation and verify the resulting serial/port/service state. Only then return `{"authorized":true,"serial":"NEW_SERIAL"}`. Timeout, malformed response, wrong serial, or lack of positive verification produces an unresolved provisioning alert and blocks a second attempt for that serial. An operator must check equipment and reconcile that alert before retrying.

`POST /v1/devices/{externalId}/onus/{serial}/{action}` with `action` one of `reboot`, `disable`, `enable`, `deauthorize` receives `{"pon":"1/2","idempotencyKey":"server-generated-operation-id"}`. The gateway must deduplicate the key, apply the vendor operation, verify it, and only then return `{"done":true,"serial":"…","action":"…"}`. Anything else leaves an unresolved `onu-operation` alert that blocks another operation on that ONU until an operator reconciles it. Removing (`deauthorize`) needs the ONU serial typed by an admin, manager or technician.

The built-in integration tests use a local HTTP protocol fixture to verify this boundary. They do not verify a physical OLT or any vendor command implementation.
