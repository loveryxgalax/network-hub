'use strict';
// RADIUS accounting keeps the truth when packets arrive late, twice, without counters, or out of order.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs');
const G=4294967296,T0=Date.UTC(2026,10,16,8,0,0);
function setup(margin=0){const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'acm-')));if(margin)st.setting('radiusSettings',{...radius.settings(st),usageMarginPct:margin});
 const p=st.put('plans',radius.plan({name:'P',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'A',username:'kne-aaa111',service:'hotspot',planId:p.id,expiresAt:T0+864e5}));return {st,s};}
const pkt=(type,o={})=>{const r={'Acct-Status-Type':type,'Acct-Session-Id':o.id||'s1','NAS-Identifier':o.nas||'LAB-HEX','NAS-IP-Address':o.nasIp||'10.0.0.1','User-Name':o.user||'kne-aaa111','Calling-Station-Id':o.mac||'5E:CB:3A:BF:9A:3D','Framed-IP-Address':o.ip||'10.5.3.248'};
 if(o.secs!=null)r['Acct-Session-Time']=String(o.secs);if(o.down!=null)r['Acct-Output-Octets']=String(o.down);if(o.up!=null)r['Acct-Input-Octets']=String(o.up);
 if(o.downG!=null)r['Acct-Output-Gigawords']=String(o.downG);if(o.cause)r['Acct-Terminate-Cause']=o.cause;return r;};
const acct=(st,type,o,at)=>radius.accounting(st,pkt(type,o),at);
const one=(st,id='s1')=>st.list('radiusSessions').find(x=>x.sessionId===id);

test('ordered, delayed and duplicate Interim packets never lower usage or overwrite newer details',()=>{
 const {st}=setup();acct(st,'Start',{secs:0,down:0,up:0},T0);acct(st,'Interim-Update',{secs:300,down:50e6,up:5e6,ip:'10.5.3.248'},T0+300e3);
 acct(st,'Interim-Update',{secs:120,down:10e6,up:1e6,ip:'10.5.3.99'},T0+310e3);let x=one(st);
 assert.equal(x.downloadBytes,50e6,'a delayed Interim does not reduce usage');assert.equal(x.uploadBytes,5e6);assert.equal(x.ip,'10.5.3.248','older packet does not overwrite newer details');assert.equal(x.updatedAt,T0+300e3);
 acct(st,'Interim-Update',{secs:300,down:50e6,up:5e6},T0+320e3);assert.equal(one(st).downloadBytes,50e6,'duplicate is harmless');
 acct(st,'Interim-Update',{secs:600,down:80e6,up:6e6},T0+600e3);x=one(st);assert.equal(x.downloadBytes,80e6);assert.equal(x.updatedAt,T0+600e3);assert.equal(x.stoppedAt,null);
});
test('Stop without counters keeps the last values; one direction omitted keeps that direction only',()=>{
 const {st}=setup();acct(st,'Start',{secs:0},T0);acct(st,'Interim-Update',{secs:300,down:50e6,up:5e6},T0+300e3);
 acct(st,'Stop',{secs:400,cause:'User-Request'},T0+400e3);let x=one(st);assert.equal(x.downloadBytes,50e6);assert.equal(x.uploadBytes,5e6);assert.equal(x.stoppedAt,T0+400e3);
 const b=setup().st;acct(b,'Start',{secs:0},T0);acct(b,'Interim-Update',{secs:300,down:50e6,up:5e6},T0+300e3);acct(b,'Stop',{secs:400,down:60e6},T0+400e3);
 x=one(b);assert.equal(x.downloadBytes,60e6,'the counter it sent is taken');assert.equal(x.uploadBytes,5e6,'the omitted one is kept');
});
test('explicit zero counters and 32-bit Gigawords rollover',()=>{
 const {st}=setup();acct(st,'Start',{secs:0,down:0,up:0},T0);assert.equal(one(st).downloadBytes,0,'explicit zero is a real zero');
 acct(st,'Interim-Update',{secs:300,down:4294967000,up:0},T0+300e3);acct(st,'Interim-Update',{secs:600,down:500,downG:1,up:0},T0+600e3);
 assert.equal(one(st).downloadBytes,G+500,'Gigawords carry the high 32 bits');
 acct(st,'Interim-Update',{secs:900,down:0,up:0},T0+900e3);assert.equal(one(st).downloadBytes,G+500,'a later zero cannot wipe what was counted');
});
test('duplicate Stop: equal, lower and higher counters keep the first stop time and cause; never reopens',()=>{
 const {st}=setup();acct(st,'Start',{secs:0},T0);acct(st,'Stop',{secs:400,down:50e6,up:5e6,cause:'Idle-Timeout'},T0+400e3);
 acct(st,'Stop',{secs:400,down:50e6,up:5e6,cause:'Lost-Carrier'},T0+500e3);let x=one(st);assert.equal(x.stoppedAt,T0+400e3);assert.equal(x.cause,'Idle-Timeout');
 acct(st,'Stop',{secs:400,down:10e6,up:1e6},T0+600e3);x=one(st);assert.equal(x.downloadBytes,50e6);assert.equal(x.stoppedAt,T0+400e3);
 acct(st,'Stop',{secs:410,down:55e6,up:6e6},T0+700e3);x=one(st);assert.equal(x.downloadBytes,55e6,'higher final counters improve usage');assert.equal(x.stoppedAt,T0+400e3,'stop time does not move');assert.equal(x.cause,'Idle-Timeout');
 // Every packet is still in the accounting log (evidence kept).
 assert.ok(st.setting('radiusAcctLog').items.filter(e=>e.status==='stop').length>=4);
});
test('Interim after Stop is ignored; Stop before Start stays stopped',()=>{
 const {st}=setup();acct(st,'Start',{secs:0},T0);acct(st,'Stop',{secs:400,down:50e6,up:5e6},T0+400e3);
 assert.equal(acct(st,'Interim-Update',{secs:450,down:70e6,up:7e6},T0+450e3).ignored,true);let x=one(st);assert.equal(x.stoppedAt,T0+400e3);assert.equal(x.downloadBytes,50e6);
 const b=setup().st;acct(b,'Stop',{id:'s9',secs:300,down:20e6,up:2e6,cause:'User-Request'},T0+300e3);assert.equal(acct(b,'Start',{id:'s9',secs:0},T0+301e3).ignored,true);
 x=one(b,'s9');assert.equal(x.stoppedAt,T0+300e3);assert.equal(x.startedAt,T0,'start comes from the session time');assert.equal(x.downloadBytes,20e6);
});
test('same session ID on two routers and reconnects with new IDs are separate sessions',()=>{
 const {st}=setup();acct(st,'Start',{id:'abc',nas:'LAB-HEX',nasIp:'10.0.0.1',secs:0},T0);acct(st,'Start',{id:'abc',nas:'HAP-NEW',nasIp:'10.0.0.2',secs:0},T0);
 acct(st,'Interim-Update',{id:'abc',nas:'LAB-HEX',nasIp:'10.0.0.1',secs:60,down:5e6,up:1e6},T0+60e3);
 const two=st.list('radiusSessions').filter(x=>x.sessionId==='abc');assert.equal(two.length,2);assert.deepEqual(two.map(x=>x.downloadBytes).sort((a,b)=>a-b),[0,5e6]);
 acct(st,'Stop',{id:'abc',nas:'LAB-HEX',nasIp:'10.0.0.1',secs:90,down:6e6,up:1e6},T0+90e3);acct(st,'Start',{id:'abd',nas:'LAB-HEX',nasIp:'10.0.0.1',secs:0},T0+95e3);
 assert.equal(one(st,'abd').downloadBytes,0,'a reconnect starts its own counters');assert.equal(st.list('radiusSessions').filter(x=>x.sessionId==='abc'&&x.nas==='10.0.0.1')[0].downloadBytes,6e6);
});
test('TV session counts once for its owner, through late and repeated packets',()=>{
 const {st,s}=setup(),tv='2C:FE:E2:F6:01:E2';st.put('subscribers',{...st.get('subscribers',s.id),tvs:[{mac:tv,name:'TV',addedAt:T0-1}]},st.get('subscribers',s.id));
 acct(st,'Start',{secs:0},T0);acct(st,'Interim-Update',{secs:300,down:40e6,up:4e6},T0+300e3);
 acct(st,'Start',{id:'tv1',user:tv.toLowerCase(),mac:tv,secs:0},T0);acct(st,'Interim-Update',{id:'tv1',user:tv.toLowerCase(),mac:tv,secs:300,down:30e6,up:1e6},T0+300e3);
 acct(st,'Interim-Update',{id:'tv1',user:tv.toLowerCase(),mac:tv,secs:100,down:5e6,up:1e5},T0+310e3);acct(st,'Stop',{id:'tv1',user:tv.toLowerCase(),mac:tv,secs:320},T0+320e3);acct(st,'Stop',{id:'tv1',user:tv.toLowerCase(),mac:tv,secs:320},T0+330e3);
 const all=st.sessionsOf('kne-aaa111');assert.equal(all.length,2,'owner sees own session and the TV session');assert.equal(all.find(x=>x.sessionId==='tv1').account,'kne-aaa111');
 assert.equal(all.reduce((a,x)=>a+x.downloadBytes,0),70e6,'customer usage = own 40 MB + TV 30 MB, counted once');
});
test('usage margin is applied exactly once, also across repeated and partial packets',()=>{
 const {st}=setup(10);acct(st,'Start',{secs:0,down:0,up:0},T0);acct(st,'Interim-Update',{secs:300,down:50e6,up:5e6},T0+300e3);
 let x=one(st);assert.equal(x.rawDownloadBytes,50e6);assert.equal(x.downloadBytes,55e6);
 acct(st,'Interim-Update',{secs:300,down:50e6,up:5e6},T0+310e3);acct(st,'Stop',{secs:400},T0+400e3);acct(st,'Stop',{secs:400},T0+410e3);
 x=one(st);assert.equal(x.rawDownloadBytes,50e6);assert.equal(x.downloadBytes,55e6,'not 60.5 MB: margin not applied twice');assert.equal(x.uploadBytes,5.5e6);
});
test('audit (read-only) finds a session the old code lowered, from the packet log, and changes nothing',()=>{
 const {st}=setup(),{audit}=require('../scripts/accounting-audit.cjs');acct(st,'Start',{secs:0},T0);acct(st,'Interim-Update',{secs:300,down:50e6,up:5e6},T0+300e3);
 const x=one(st),bad={...x,downloadBytes:0,uploadBytes:0};st.db.prepare("UPDATE records SET body=? WHERE kind='radiusSessions' AND id=?").run(JSON.stringify(bad),x.id);
 const before=JSON.stringify(st.list('radiusSessions')),r=audit(st);assert.equal(r.affected.length,1);assert.equal(r.affected[0].download.packetsShow,50e6);assert.equal(JSON.stringify(st.list('radiusSessions')),before);
});
test('a used voucher shows in the customer\'s payments and connects',()=>{
 const {st}=setup(),V=require('../lib/vouchers.cjs'),hm=require('../lib/hotspotme.cjs'),p=st.list('plans')[0];V.generate(st,{planId:p.id,count:1},{name:'Staff'});
 const code=st.list('vouchers')[0].code,acc=V.redeem(st,code.toLowerCase(),T0);assert.ok(acc);
 acct(st,'Start',{user:code.toLowerCase(),secs:0},T0+1000);const tok=hm.trust(st,code.toLowerCase(),'5E:CB:3A:BF:9A:3D'),u=hm.usage(st,'5E:CB:3A:BF:9A:3D',T0+2000,tok);
 assert.equal(u.found,true);assert.equal(u.payments.length,1);assert.match(u.payments[0].ref,/^Voucher /);assert.equal(u.payments[0].amount,1);assert.equal(u.connects.length,1);assert.equal(u.connects[0].plan,'P');
});
