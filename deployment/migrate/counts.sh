#!/usr/bin/env bash
# Prints record counts and the newest payment, read-only, so the old and new servers can be compared after a copy.
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose exec -T hub node -e '
const {DatabaseSync}=require("node:sqlite"),d=new DatabaseSync("/data/network.sqlite",{readOnly:true});
for(const r of d.prepare("SELECT kind,COUNT(*) n FROM records WHERE kind IN (\x27subscribers\x27,\x27subscriberPayments\x27,\x27plans\x27,\x27devices\x27,\x27alerts\x27,\x27ledger\x27) GROUP BY kind ORDER BY kind").all())console.log(r.kind.padEnd(20),r.n);
console.log("users".padEnd(20),d.prepare("SELECT COUNT(*) n FROM users").get().n);
const p=d.prepare("SELECT body FROM records WHERE kind=\x27subscriberPayments\x27 ORDER BY created DESC LIMIT 1").get();
if(p){const x=JSON.parse(p.body);console.log("newest payment".padEnd(20),new Date(x.time||0).toISOString(),x.reference||"")}'
