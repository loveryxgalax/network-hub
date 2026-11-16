#!/usr/bin/env bash
# Prove an off-site backup can really be restored. Run it on a laptop or spare machine (NOT the live server) that has
# `age`, `rclone` (with the same "offsite" remote) and Node 22+. It downloads the newest backup, decrypts it with your
# private age key, and checks that the database opens, passes SQLite's integrity check and that its encrypted secrets
# can be read with the master key in the same backup. It changes nothing on the server and prints PASS or FAIL.
#   usage: OFFSITE_PATH=offsite:bucket/network-hub AGE_KEY=~/netops-backup.key scripts/restore-test.sh
set -euo pipefail
: "${OFFSITE_PATH:?set OFFSITE_PATH, e.g. offsite:bucket/network-hub}" "${AGE_KEY:?set AGE_KEY to your private age key file}"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
latest=$(rclone lsf "$OFFSITE_PATH" --include 'network-hub-*.tar.gz.age' | sort | tail -1)
[ -n "$latest" ] || { echo "FAIL: no backup found in $OFFSITE_PATH"; exit 1; }
echo "Newest backup: $latest"
rclone copyto "$OFFSITE_PATH/$latest" "$work/b.age"
age -d -i "$AGE_KEY" "$work/b.age" | tar -C "$work" -xzf -
for f in network.sqlite master.key env; do [ -s "$work/b/$f" ] || { echo "FAIL: $f is missing from the backup"; exit 1; }; done
node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),crypto=require('node:crypto'),d=process.argv[1];
const db=new DatabaseSync(d+'/network.sqlite',{readOnly:true}),key=fs.readFileSync(d+'/master.key');
const ok=db.prepare('PRAGMA integrity_check').get().integrity_check==='ok';
const n=k=>db.prepare('SELECT count(*) n FROM records WHERE kind=?').get(k).n;
let secrets=0;for(const r of db.prepare('SELECT encrypted FROM secrets LIMIT 5').all()){const b=Buffer.from(r.encrypted,'base64'),dc=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));dc.setAuthTag(b.subarray(12,28));Buffer.concat([dc.update(b.subarray(28)),dc.final()]);secrets++;}
console.log('customers',n('subscribers'),'| payments',n('subscriberPayments'),'| ledger entries',n('ledger'),'| secrets decrypted',secrets);
if(!ok||key.length!==32){console.log('FAIL: database or key is damaged');process.exit(1);}
console.log('PASS: this backup restores.');" "$work/b"
