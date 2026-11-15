'use strict';
// Two devices on one hotspot username: every row keeps its own router, session, MAC, IP and usage together.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),cu=require('../lib/customers.cjs'),radius=require('../lib/radius.cjs'),hs=require('../lib/hotspot.cjs');
const I={mac:'FA:53:A7:4A:FD:AF',ip:'10.5.3.243'},A={mac:'5E:CB:3A:BF:9A:3D',ip:'10.5.3.248'},MIN=60000;
function setup(){const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'hid-'))),r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});
 const rep=(rows,now)=>cu.ingest(st,r,cu.normalize({schema:2,tables:{dhcp:{ok:true,truncated:false,rows:[]},arp:{ok:true,truncated:false,rows:[]},ppp:{ok:true,truncated:false,rows:[]},neighbor:{ok:true,truncated:false,rows:[]},
  hotspot:{ok:true,truncated:false,rows:rows.map((x,i)=>({ip:x.ip,mac:x.mac,name:'g55g4hva',status:'connected',service:'netops-hotspot',uptime:'00:05:00',sessionId:'*'+i,rx:x.rx||0,tx:x.tx||0}))}}}),now);
 const acct=(kind,id,x,t,extra={})=>radius.accounting(st,{'Acct-Status-Type':kind,'Acct-Session-Id':id,'NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX','User-Name':'g55g4hva','Calling-Station-Id':x.mac,'Framed-IP-Address':x.ip,'Service-Type':'Login-User','Acct-Output-Octets':String(x.down||0),...extra},t);
 const rows=now=>hs.sessions(st,new URLSearchParams('service=hotspot'),now).items.map(x=>({src:x.source,ip:x.ip,mac:x.mac,id:x.sessionId,down:x.downloadBytes}));
 return {st,rep,acct,rows};}
const pairs=list=>list.map(x=>x.ip+'='+x.mac).sort();
const OK=[I.ip+'='+I.mac,A.ip+'='+A.mac].sort();
test('shared username, both orders, duplicates: correct pairs and per-device usage',()=>{
 const {rep,acct,rows}=setup(),now=Date.now();
 acct('Start','s-and',{...A,down:900},now-3*MIN);acct('Start','s-iph',{...I,down:100},now-2*MIN);   // RADIUS order: Android first
 rep([I,A],now-MIN);                                                                                   // router order: iPhone first
 const r=rows(now);assert.deepEqual(pairs(r),OK);assert.ok(r.every(x=>x.src==='both'),'RADIUS and router merged once per device');
 assert.equal(r.find(x=>x.mac===I.mac).id,'s-iph');assert.equal(r.find(x=>x.mac===A.mac).down,900,'usage stays with its own device');
});
test('IP reuse and reconnects: an old session with the other device\'s IP is not shown once the router list is newer',()=>{
 const {rep,acct,rows,st}=setup(),now=Date.now();
 // Earlier the IPs were the other way round; those sessions never got a Stop and were last updated 5 minutes ago.
 acct('Start','old-i',{mac:I.mac,ip:A.ip},now-20*MIN);acct('Interim-Update','old-i',{mac:I.mac,ip:A.ip},now-5*MIN);
 acct('Start','old-a',{mac:A.mac,ip:I.ip},now-20*MIN);acct('Interim-Update','old-a',{mac:A.mac,ip:I.ip},now-5*MIN);
 // Router (complete, fresh) now reports the current pairs; no RADIUS Start for them yet.
 rep([I,A],now-MIN);
 const r=rows(now);assert.deepEqual(pairs(r),OK,'never a MAC against the other device\'s IP');assert.equal(r.length,2);
 assert.equal(st.sessionsOf('g55g4hva',0).filter(x=>x.stoppedAt).length,0,'no Stop invented');
 // New RADIUS sessions arrive: they pair with their own router rows.
 acct('Start','new-i',I,now);acct('Start','new-a',A,now);assert.deepEqual(pairs(rows(now)).sort(),OK);assert.deepEqual(rows(now).map(x=>x.id).sort(),['new-a','new-i']);
});
test('stale router report: RADIUS rows only, each coherent; no MAC borrowed',()=>{
 const {rep,acct,rows}=setup(),now=Date.now();
 rep([I,A],now-60*MIN);acct('Start','x1',I,now-MIN);acct('Start','x2',{mac:'',ip:A.ip},now-MIN);
 const r=rows(now);assert.deepEqual(r.map(x=>x.src),['radius','radius']);
 assert.equal(r.find(x=>x.ip===I.ip).mac,I.mac);assert.equal(r.find(x=>x.ip===A.ip).mac,'','a session without a MAC shows none, not another device\'s');
});
