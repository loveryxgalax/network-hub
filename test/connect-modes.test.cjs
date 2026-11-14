'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),billing=require('../lib/billing.cjs');
test('manual connect modes, special price and grace baseline',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cm-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'cm@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store;
  const post=(b)=>fetch(o+'/api/radius/manual-connect',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
  const plan=st.put('plans',{name:'Basic',service:'pppoe',price:1500,durationValue:30,durationUnit:'days'});
  const a=st.put('subscribers',{name:'A',username:'a1',service:'pppoe',planId:plan.id,status:'active',specialPrice:1000});
  // Special price: KSh 1,000 pays one period, not the package's 1,500.
  billing.pay(st,a.id,{amount:1000,reference:'TESTREF1',method:'cash'});assert.ok(st.get('subscribers',a.id).expiresAt>Date.now()+29*864e5);assert.equal(st.list('subscriberPayments')[0].planPrice,1000);
  // Trial: only for never-paid customers.
  const b=st.put('subscribers',{name:'B',username:'b1',service:'pppoe',planId:plan.id,status:'suspended'});
  let r=await post({subscriberId:a.id,mode:'trial',reason:'try it',until:Date.now()+864e5});assert.equal(r.status,409);
  r=await post({subscriberId:b.id,mode:'trial',reason:'try it',until:Date.now()+8*864e5});assert.match(r.body.error,/at most 7 days/);
  r=await post({subscriberId:b.id,mode:'trial',reason:'try it',until:Date.now()+2*864e5});assert.equal(r.status,201);assert.equal(st.get('subscribers',b.id).grant,'trial');
  r=await post({subscriberId:b.id,mode:'trial',reason:'again',until:Date.now()+3*864e5});assert.equal(r.status,409,'one trial only');
  // Grace: no money; a later payment counts from the grace start.
  const c=st.put('subscribers',{name:'C',username:'c1',service:'pppoe',planId:plan.id,status:'suspended',expiresAt:Date.now()-864e5});
  const t0=Date.now();r=await post({subscriberId:c.id,mode:'grace',reason:'pays Friday',until:t0+3*864e5});assert.equal(r.status,201);
  assert.equal(st.list('subscriberPayments').filter(p=>p.subscriberId===c.id).length,0,'grace records no payment');
  r=await post({subscriberId:c.id,mode:'grace',reason:'again',until:Date.now()+864e5});assert.equal(r.status,409,'once per 30 days');
  billing.pay(st,c.id,{amount:1500,reference:'TESTREF2',method:'mpesa'});const ce=st.get('subscribers',c.id);
  assert.ok(Math.abs(ce.expiresAt-(t0+30*864e5))<5*6e4,'paid period starts at the grace start');assert.equal(ce.grant,null);
  // Cash: goes through the payment path at the customer's price.
  const d=st.put('subscribers',{name:'D',username:'d1',service:'pppoe',planId:plan.id,status:'suspended'});
  r=await post({subscriberId:d.id,payment:'cash',reason:'paid at office'});assert.equal(r.status,201);const pd=st.list('subscriberPayments').find(p=>p.subscriberId===d.id);assert.equal(pd.amount,1500);assert.equal(pd.method,'cash');
  r=await post({subscriberId:d.id,payment:'cheque',reason:'cheque'});assert.match(r.body.error,/cheque number/);
 }finally{app.server.close();app.store.close?.();fs.rmSync(dir,{recursive:true,force:true});}
});
test('MAC prefix policy and split bandwidth in RADIUS',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-')),{Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),st=new Store(dir);try{
  const plan=st.put('plans',{name:'P',service:'pppoe',price:100,durationValue:30,durationUnit:'days',downloadMbps:20,uploadMbps:10});
  const s=radius.saveSubscriber?null:null;void s;
  const sub=st.put('subscribers',{name:'X',username:'x1',service:'pppoe',planId:plan.id,status:'active',expiresAt:Date.now()+864e5,boundMac:'AA:BB:CC:00:00:01',macPolicy:{mode:'prefix',prefix:'AA:BB:CC'},maxDevices:2,splitBandwidth:true});
  radius.setPassword(st,sub.id,'pw123456');
  const auth=m=>radius.authorize(st,{'User-Name':'x1','Framed-Protocol':'PPP','Service-Type':'Framed-User','Calling-Station-Id':m});
  let r=await auth('AA:BB:CC:00:00:09');assert.equal(r.status,200,r.reason);assert.equal(r.attributes['reply:Mikrotik-Rate-Limit'],'5M/10M','speed split in two');
  r=await auth('11:22:33:44:55:66');assert.equal(r.status,401,'other router refused');
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('evict free users: only free-mode sessions, only when free mode is off, once each',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fe-')),{Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),jobs=require('../lib/jobs.cjs'),fe=require('../lib/freeevict.cjs'),st=new Store(dir);try{
  const r=st.put('devices',{name:'TEST-1',type:'router',driver:'none',ip:'10.99.0.2'});st.secret('jobs:'+r.id,{token:'x'});const now=Date.now();
  const sess=(u,id)=>st.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(id,JSON.stringify({username:u,nas:'10.99.0.2',nasName:'TEST-1',sessionId:id,startedAt:now-6e4,updatedAt:now,stoppedAt:null}),now,now);
  sess('free-0123456789ab','s1');sess('paidcustomer','s2');
  assert.equal(fe.freeSessions(st,now).length,1);
  const a=fe.evict(st,jobs,radius,null,now);assert.equal(a.queued,1);assert.equal(st.list('routerJobs')[0].params.username,'free-0123456789ab');
  assert.equal(fe.evict(st,jobs,radius,null,now).queued,0,'not twice');
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('IP conflict scan finds duplicates and out-of-pool addresses',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ic-')),{Store}=require('../lib/store.cjs'),pool=require('../lib/pppoepool.cjs'),st=new Store(dir);try{
  pool.save(st,{network:'10.50.0.0/16',enabled:true});
  st.put('subscribers',{name:'A',username:'a',service:'pppoe',pppoeIp:'10.50.0.5'});st.put('subscribers',{name:'B',username:'b',service:'pppoe',pppoeIp:'10.50.0.5'});st.put('subscribers',{name:'C',username:'c',service:'pppoe',pppoeIp:'192.168.9.9'});
  const r=pool.conflicts(st);assert.ok(r.items.some(x=>x.type==='Same address twice'&&x.ip==='10.50.0.5'));assert.ok(r.items.some(x=>x.type==='Outside the pool'&&x.ip==='192.168.9.9'));
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('public IP pool: public only, one customer each, release',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pip-')),{Store}=require('../lib/store.cjs'),pool=require('../lib/pppoepool.cjs'),st=new Store(dir);try{
  assert.throws(()=>pool.addPublic(st,{ip:'192.168.1.5'}),/private/);pool.addPublic(st,{ip:'41.90.10.5'});assert.throws(()=>pool.addPublic(st,{ip:'41.90.10.5'}),/already/);
  const a=st.put('subscribers',{name:'A',username:'a',service:'pppoe'}),b=st.put('subscribers',{name:'B',username:'b',service:'pppoe'});
  pool.assignPublic(st,'41.90.10.5',a.id);assert.equal(st.get('subscribers',a.id).staticIp,'41.90.10.5');assert.throws(()=>pool.assignPublic(st,'41.90.10.5',b.id),/already used/);
  assert.throws(()=>pool.removePublic(st,'41.90.10.5'),/Release/);pool.releasePublic(st,'41.90.10.5');assert.equal(st.get('subscribers',a.id).staticIp,'');
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
