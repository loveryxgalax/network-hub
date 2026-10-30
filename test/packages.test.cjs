'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),packages=require('../lib/packages.cjs'),portal=require('../lib/portal.cjs'),billing=require('../lib/billing.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pk-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const base={name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days',devices:1};
const rest=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,{type:'string',value:[x]}]));
test('package policy validates burst, FUP and purchase windows, and old packages keep working',()=>{
 const old=radius.plan(base);assert.equal(old.burst.enabled,false);assert.equal(old.fup.enabled,false);assert.equal(packages.rateLimit(old),'2M/5M');
 assert.throws(()=>radius.plan({...base,burst:{enabled:true,upMbps:2,downMbps:8,thresholdUpMbps:1,thresholdDownMbps:4,seconds:8}}),/burst limit must be higher/);
 assert.throws(()=>radius.plan({...base,burst:{enabled:true,upMbps:4,downMbps:8,thresholdUpMbps:3,thresholdDownMbps:4,seconds:8}}),/threshold must not be higher/);
 const b=radius.plan({...base,burst:{enabled:'on',upMbps:4,downMbps:10,thresholdUpMbps:1.5,thresholdDownMbps:4,seconds:16}});assert.equal(packages.rateLimit(b),'2M/5M 4M/10M 1.5M/4M 16/16');
 assert.throws(()=>radius.plan({...base,fup:{enabled:true,downCapMB:0,upCapMB:0,timeCapMinutes:0,afterDownMbps:1,afterUpMbps:0.5}}),/data cap or an online-time cap/);
 assert.throws(()=>radius.plan({...base,fup:{enabled:true,downCapMB:500,afterDownMbps:6,afterUpMbps:1}}),/must be lower/);
 assert.throws(()=>radius.plan({...base,window:{days:true,weekdays:[]}}),/at least one day/);
 assert.throws(()=>radius.plan({...base,features:Array(9).fill('x')}),/Up to 8 features/);
 const n=radius.plan({...base,notices:{expired:'on',before:'5,60,999'}});assert.deepEqual(n.notices,{expired:true,before:[5,60]});
});
test('purchase windows stop new sales only; overnight windows wrap; hidden packages leave the portal',async()=>{
 const {store,done}=fx();try{
  // 22:00–06:00 Nairobi
  const night=store.put('plans',radius.plan({...base,name:'Night',window:{hours:true,fromHour:22,toHour:6}}));
  const at=h=>Date.UTC(2026,9,26,h-3,30);
  assert.equal(packages.buyable(night,at(23)).ok,true);assert.equal(packages.buyable(night,at(3)).ok,true);assert.equal(packages.buyable(night,at(12)).ok,false);
  await assert.rejects(portal.start(store,{kind:'hotspot',planId:night.id,phone:'0712345678'},'https://x.example',async()=>{throw new Error('no network');},at(12)),/Available between 22:00 and 06:00/);
  store.put('plans',radius.plan({...base,name:'Secret',hidden:true}));
  const listed=portal.info(store).plans.map(p=>p.name);assert.ok(!listed.includes('Secret'));
  const weekend=radius.plan({...base,window:{days:true,weekdays:[0,6]}});assert.equal(packages.buyable(weekend,Date.UTC(2026,9,24,9)).ok,true,'Saturday');assert.equal(packages.buyable(weekend,Date.UTC(2026,9,26,9)).ok,false,'Monday');
 }finally{done();}
});
test('fair usage: past the cap the customer gets the reduced speed at the next login',()=>{
 const {store,done}=fx();try{const now=Date.now();
  const p=store.put('plans',radius.plan({...base,fup:{enabled:true,downCapMB:100,afterDownMbps:1,afterUpMbps:0.5},idleTimeoutMinutes:10,interimSeconds:120}));
  const s=store.put('subscribers',radius.subscriber(store,{name:'A',username:'a1',service:'hotspot',planId:p.id,expiresAt:now+12*36e5}));radius.setPassword(store,s.id,'123456');
  let r=radius.authorize(store,rest({'User-Name':'a1','Service-Type':'Login-User'}),now);assert.equal(r.attributes['reply:Mikrotik-Rate-Limit'],'2M/5M');assert.equal(r.attributes['reply:Idle-Timeout'],'600');assert.equal(r.attributes['reply:Acct-Interim-Interval'],'120');
  store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions','x1',?,?,?)").run(JSON.stringify({username:'a1',service:'hotspot',startedAt:now-36e5,updatedAt:now-6e5,stoppedAt:now-6e5,downloadBytes:150*1048576,uploadBytes:1}),now,now);
  r=radius.authorize(store,rest({'User-Name':'a1','Service-Type':'Login-User'}),now);assert.equal(r.attributes['reply:Mikrotik-Rate-Limit'],'500k/1M');assert.match(r.reason,/fair-usage/);
 }finally{done();}
});
test('package notices: minutes before expiry and on expiry, once each, at any hour',async()=>{
 const {store,done}=fx();try{const sent=[];
  billing.setSmsConfig(store,{provider:'custom',url:'https://sms.example/send',apiKey:'k',senderId:'KADE'});
  const fetchImpl=async(url,o)=>{sent.push(o.body);return {ok:true,status:200,text:async()=>JSON.stringify({status_code:1000})};};
  const p=store.put('plans',radius.plan({...base,notices:{expired:true,before:[10,60]}})),night=Date.UTC(2026,9,26,0,0);// 03:00 Nairobi, inside quiet hours
  store.put('subscribers',radius.subscriber(store,{name:'B',username:'b1',service:'hotspot',planId:p.id,phone:'0712345678',expiresAt:night+50*60000}));
  await billing.runReminders(store,night,fetchImpl);await billing.runReminders(store,night+60000,fetchImpl);assert.equal(sent.length,1,'60-minute notice once');
  await billing.runReminders(store,night+41*60000,fetchImpl);assert.equal(sent.length,2,'10-minute notice');
  await billing.runReminders(store,night+51*60000,fetchImpl);await billing.runReminders(store,night+52*60000,fetchImpl);assert.equal(sent.length,3,'expired notice once');
 }finally{done();}
});
