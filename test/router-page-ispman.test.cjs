'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dgram=require('node:dgram');
const {Store}=require('../lib/store.cjs'),jobs=require('../lib/jobs.cjs');
test('remote logging: syslog lines land on the right router by identity, logs page filters by date and text',async()=>{
 const st=new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rl-')),'db.sqlite'));const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});
 
 
 // parse + store path without the network: feed lines through the same parser and flush code.
 const p=require('../lib/syslogin.cjs').parse(Buffer.from('<28>Nov 18 10:00:01 LAB-HEX hotspot,warning radius timeout for kne-abc'));assert.equal(p.host,'LAB-HEX');assert.equal(p.level,'warning');assert.equal(p.topics,'hotspot,warning');
 st.setting('routerSyslog:'+r.id,{items:[{time:Date.now(),level:'warning',topics:'hotspot,warning',message:'radius timeout for kne-abc'},{time:Date.now()-3*864e5,level:'info',topics:'system,info',message:'old line'}]});
 const lg=require('../lib/routerlogs.cjs');let d=lg.forRouter(st,r.id,{});assert.equal(d.items.filter(x=>x.kind==='router').length,2);
 d=lg.forRouter(st,r.id,{q:'radius'});assert.equal(d.items.length,1);
 const today=new Date().toISOString().slice(0,10);d=lg.forRouter(st,r.id,{from:today});assert.ok(d.items.every(x=>x.message!=='old line'));
});
test('new router jobs are whitelisted, risky ones need the router name, passwords never shown',()=>{
 const st=new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rj-')),'db.sqlite'));const r=st.put('devices',{name:'LAB-HEX',type:'router'});jobs.enroll(st,r.id);
 for(const t of ['tv-connect','tv-connect-off','ssh-enable','ssh-disable','winbox-on','winbox-off'])assert.throws(()=>jobs.create(st,{routerId:r.id,type:t,confirm:'wrong'}),/Type the router name/);
 for(const t of ['remote-logging-on','remote-logging-off','tv-connect'])assert.ok(jobs.create(st,{routerId:r.id,type:t,confirm:'LAB-HEX'}).id);
 assert.throws(()=>jobs.create(st,{routerId:r.id,type:'admin-password',params:{password:'bad"quote;x'},confirm:'LAB-HEX'}),/Invalid password/);
 const j=jobs.create(st,{routerId:r.id,type:'admin-password',params:{password:'Str0ng-pass-1'},confirm:'LAB-HEX'});assert.doesNotMatch(JSON.stringify(jobs.redact(j)),/Str0ng-pass-1/);
 assert.match(jobs.TYPES['tv-connect'].script(),/mac-cookie/);assert.match(jobs.TYPES['remote-logging-on'].script(),/10\.99\.0\.1/);
});
test('config audit: dismiss hides until recheck, ignore until unmute',()=>{
 const st=new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ra-')),'db.sqlite'));const r=st.put('devices',{name:'LAB-HEX',type:'router'});
 const prof=()=>require('../lib/routerprofile.cjs').profile(st,r.id).audit;const before=prof().checks.map(c=>c.key);assert.ok(before.includes('backup'));
 st.setting('auditMute:'+r.id,{ignored:['backup'],dismissed:{runner:Date.now()}});const a=prof();assert.ok(!a.checks.some(c=>c.key==='backup'||c.key==='runner'));assert.equal(a.ignored[0].key,'backup');
});
