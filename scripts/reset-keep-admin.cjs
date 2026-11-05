#!/usr/bin/env node
'use strict';
// Wipes the Network Hub database back to "just the admin": every router, customer, package, payment, ticket, session,
// log and setting is removed. The admin account(s) (role "admin") and the database key (master.key) are kept.
//
//   node scripts/reset-keep-admin.cjs                 dry run: shows what would be removed, changes nothing
//   node scripts/reset-keep-admin.cjs --yes           backs up first, then wipes
//   node scripts/reset-keep-admin.cjs --yes --keep-settings
//        also keeps the system settings you configured by hand: workspace name, portal design, M-Pesa / SMS / email /
//        WhatsApp / Paystack credentials, RADIUS and WireGuard server settings, roles. Customers, routers and
//        everything tied to them are still removed.
//
// Stop the hub first (docker compose stop hub live) so nothing writes while this runs. A full copy of the database and its
// key is saved under <data>/backups/ before anything is deleted. To undo: stop the hub, copy that file back over
// network.sqlite (and delete network.sqlite-wal / -shm), start the hub.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');

const args=process.argv.slice(2),flag=n=>args.includes(n),opt=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:null;};
const dir=path.resolve(opt('--data')||process.env.NETWORK_DATA_DIR||(fs.existsSync('/data/network.sqlite')?'/data':path.join(__dirname,'..','data')));
const dbFile=path.join(dir,'network.sqlite');
if(!fs.existsSync(dbFile)){console.error('No database at '+dbFile+'. Use --data <folder> if it lives elsewhere.');process.exit(2);}
const yes=flag('--yes'),keepSettings=flag('--keep-settings');

// What --keep-settings preserves (configuration you entered by hand, not customer or router data).
const KEEP_SETTINGS=['workspace','landingConfig','portalSettings','statusConfig','radiusSettings','wgServer','roleCaps','smsReminders','smsLibrary','emailTemplates','billingSettings','loyalty','alertEscalation','whatsappRouting','pppoePool','c2bRegistration','acs'];
const KEEP_SECRETS=['sms:config','whatsapp:config','mpesa:config','mpesa:b2c','paystack:config','email:config','assistant:config','integration:acs','brandApi','selfservice:key','engage:key'];

const db=new DatabaseSync(dbFile);db.exec('PRAGMA busy_timeout=5000');
const n=(sql,...p)=>db.prepare(sql).get(...p).n;
const admins=db.prepare("SELECT id,email,name FROM users WHERE role='admin' AND active=1").all();
if(!admins.length){console.error('There is no active admin account in this database. Refusing to continue: you would be locked out.');process.exit(3);}
const adminIds=admins.map(a=>a.id),inList=adminIds.map(()=>'?').join(',');
const kinds=db.prepare('SELECT kind,count(*) c FROM records GROUP BY kind ORDER BY c DESC').all();
const plan={
 records:n('SELECT count(*) n FROM records'),
 measurements:n('SELECT count(*) n FROM measurements'),audit:n('SELECT count(*) n FROM audit'),ledger:n('SELECT count(*) n FROM ledger'),
 secrets:n('SELECT count(*) n FROM secrets')-(keepSettings?n(`SELECT count(*) n FROM secrets WHERE device_id IN (${KEEP_SECRETS.map(()=>'?').join(',')})`,...KEEP_SECRETS):0),
 settings:n('SELECT count(*) n FROM settings')-(keepSettings?n(`SELECT count(*) n FROM settings WHERE key IN (${KEEP_SETTINGS.map(()=>'?').join(',')})`,...KEEP_SETTINGS):0),
 otherUsers:n(`SELECT count(*) n FROM users WHERE id NOT IN (${inList})`,...adminIds)};
console.log('Database: '+dbFile);
console.log('Kept: admin '+admins.map(a=>a.email).join(', ')+' and master.key'+(keepSettings?' and your system settings':''));
console.log('Would remove: '+Object.entries(plan).map(([k,v])=>`${v} ${k}`).join(', '));
console.log('Records by kind: '+(kinds.map(k=>`${k.kind} ${k.c}`).join(', ')||'none'));
if(!yes){console.log('\nDry run only. Nothing was changed. Run again with --yes to wipe (a backup is made first).');process.exit(0);}

// 1) full backup first (consistent copy of the database plus its key)
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),bdir=path.join(dir,'backups');fs.mkdirSync(bdir,{recursive:true,mode:0o700});
const backup=path.join(bdir,'pre-reset-'+stamp+'.sqlite');db.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
const key=path.join(dir,'master.key');if(fs.existsSync(key))fs.copyFileSync(key,path.join(bdir,'master.key.'+stamp));
console.log('Backup saved: '+backup);

// 2) wipe
db.exec('BEGIN IMMEDIATE');
try{
 db.exec('DELETE FROM records;DELETE FROM measurements;DELETE FROM audit;DELETE FROM ledger;');
 db.prepare(`DELETE FROM sessions WHERE user_id NOT IN (${inList})`).run(...adminIds);
 db.prepare(`DELETE FROM users WHERE id NOT IN (${inList})`).run(...adminIds);
 if(keepSettings){
  db.prepare(`DELETE FROM secrets WHERE device_id NOT IN (${KEEP_SECRETS.map(()=>'?').join(',')})`).run(...KEEP_SECRETS);
  db.prepare(`DELETE FROM settings WHERE key NOT IN (${KEEP_SETTINGS.map(()=>'?').join(',')})`).run(...KEEP_SETTINGS);
 }else{db.exec('DELETE FROM secrets;DELETE FROM settings;');}
 db.exec('COMMIT');
}catch(e){db.exec('ROLLBACK');console.error('Wipe failed and was rolled back: '+e.message);process.exit(1);}
db.exec('PRAGMA wal_checkpoint(TRUNCATE);VACUUM');
console.log('Done. Left: '+n('SELECT count(*) n FROM users')+' user(s), '+n('SELECT count(*) n FROM records')+' records.');
console.log('Start the hub again (docker compose up -d hub live). Sign in as '+admins.map(a=>a.email).join(' / ')+'.');
