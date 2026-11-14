'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {Store}=require('../lib/store.cjs');
const script=path.join(__dirname,'..','scripts','reset-keep-admin.cjs');
function seed(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reset-')),st=new Store(dir);
 st.db.prepare("INSERT INTO users(id,email,name,role,password,active,created) VALUES('a1','admin@x.test','Admin','admin','h',1,1),('o1','op@x.test','Op','operator','h',1,1)").run();
 st.db.prepare("INSERT INTO sessions(token,user_id,csrf,expires) VALUES('t1','a1','c',9999999999999),('t2','o1','c',9999999999999)").run();
 const r=st.put('devices',{name:'TEST-1',type:'router'});st.put('subscribers',{name:'C',username:'c1'});st.put('plans',{name:'P'});st.secret('jobs:'+r.id,{h:1});st.secret('mpesa:config',{shortcode:'1'});
 st.setting('workspace',{name:'Kade'});st.setting('smsLog',{items:[1]});st.setting('routerHealth:'+r.id,{x:1});st.db.close();return dir;}
const run=(dir,...a)=>spawnSync(process.execPath,[script,'--data',dir,...a],{encoding:'utf8'});
test('reset: dry run changes nothing; --yes keeps only the admin and makes a backup',()=>{
 const dir=seed();let r=run(dir);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Dry run only/);
 let st=new Store(dir);assert.equal(st.list('devices').length,1);st.db.close();
 r=run(dir,'--yes');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Backup saved/);
 st=new Store(dir);assert.deepEqual(st.db.prepare('SELECT email FROM users').all().map(x=>x.email),['admin@x.test']);
 assert.equal(st.db.prepare('SELECT count(*) n FROM sessions').get().n,1);assert.equal(st.db.prepare('SELECT count(*) n FROM records').get().n,0);
 assert.equal(st.db.prepare('SELECT count(*) n FROM secrets').get().n,0);assert.equal(st.db.prepare('SELECT count(*) n FROM settings').get().n,0);st.db.close();
 assert.equal(fs.readdirSync(path.join(dir,'backups')).filter(f=>f.endsWith('.sqlite')).length,1);
});
test('reset --keep-settings keeps hand-entered configuration but not customer, router or log data',()=>{
 const dir=seed(),r=run(dir,'--yes','--keep-settings');assert.equal(r.status,0,r.stderr);
 const st=new Store(dir);assert.equal(st.setting('workspace').name,'Kade');assert.equal(st.setting('smsLog'),null);assert.equal(st.db.prepare("SELECT count(*) n FROM settings WHERE key LIKE 'routerHealth:%'").get().n,0);
 assert.deepEqual(st.secret('mpesa:config'),{shortcode:'1'});assert.equal(st.db.prepare("SELECT count(*) n FROM secrets WHERE device_id LIKE 'jobs:%'").get().n,0);st.db.close();
});
test('reset refuses to run when there is no admin',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reset-')),st=new Store(dir);st.db.close();const r=run(dir,'--yes');assert.equal(r.status,3);assert.match(r.stderr,/no active admin/);
});
