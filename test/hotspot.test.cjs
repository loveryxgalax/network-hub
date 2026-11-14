'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs'),hotspot=require('../lib/hotspot.cjs'),health=require('../lib/health.cjs');
const {createApp}=require('../server.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hs-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const hreq=(user,mac,nas='north',extra={})=>({'User-Name':user,'User-Password':'pass1','Service-Type':'Login-User','NAS-Identifier':nas,'Calling-Station-Id':mac,...extra});
test('auth and accounting logs: kept 7 days, filtered by customer, username, MAC, reply and date',()=>{
 const {store,done}=fx();try{const north=store.put('devices',{name:'north',type:'router',driver:'none'});
  const p=store.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}));
  const s=store.put('subscribers',radius.subscriber(store,{name:'Mary Wanjiku',username:'mary',phone:'0712000111',service:'hotspot',planId:p.id,expiresAt:Date.now()+864e5,routerId:north.id}));radius.setPassword(store,s.id,'pass1');
  const now=Date.now();
  radius.authorize(store,hreq('mary','AA:BB:CC:00:00:01'),now-1000);
  radius.authorize(store,hreq('ghost','AA:BB:CC:00:00:02'),now-500);
  hotspot.add(store,'auth',{time:now-8*864e5,username:'old',service:'hotspot',result:'accept',reason:'OK'});
  const all=hotspot.query(store,'auth',new URLSearchParams({service:'hotspot'}),now);
  assert.equal(all.total,2,'entries older than 7 days are not shown');
  assert.equal(hotspot.query(store,'auth',new URLSearchParams({customer:'wanjiku'}),now).items[0].customer.name,'Mary Wanjiku');
  assert.equal(hotspot.query(store,'auth',new URLSearchParams({reply:'reject'}),now).items[0].username,'ghost');
  assert.equal(hotspot.query(store,'auth',new URLSearchParams({mac:'aa:bb:cc:00:00:02'}),now).total,1);
  assert.equal(hotspot.query(store,'auth',new URLSearchParams({username:'mar'}),now).total,1);
  // Accounting: events log and per-session view.
  const acct=(kind,t,extra={})=>radius.accounting(store,{'Acct-Status-Type':kind,'Acct-Session-Id':'s1','User-Name':'mary','NAS-Identifier':'north','NAS-IP-Address':'10.0.0.1','Framed-IP-Address':'10.5.0.9','Calling-Station-Id':'AA:BB:CC:00:00:01','Service-Type':'Login-User',...extra},t);
  acct('Start',now-600000);acct('Interim-Update',now-300000,{'Acct-Output-Octets':'5000','Acct-Input-Octets':'700'});
  assert.equal(hotspot.query(store,'acct',new URLSearchParams({ip:'10.5.0'}),now).total,2);
  let ses=hotspot.acctSessions(store,new URLSearchParams({customer:'mary'}),now);assert.equal(ses.total,1);assert.equal(ses.items[0].open,true);assert.equal(ses.items[0].downloadBytes,5000);
  const live=hotspot.sessions(store,new URLSearchParams({service:'hotspot'}),now);assert.equal(live.total,1);assert.equal(live.items[0].source,'radius');assert.equal(live.items[0].customer.name,'Mary Wanjiku');
  acct('Stop',now-1000,{'Acct-Terminate-Cause':'User-Request','Acct-Output-Octets':'9000'});
  ses=hotspot.acctSessions(store,new URLSearchParams(),now);assert.equal(ses.items[0].cause,'User-Request');assert.ok(ses.items[0].stoppedAt);
  assert.equal(hotspot.sessions(store,new URLSearchParams(),now).total,0,'stopped sessions are not active');
 }finally{done();}
});
test('the first run copies recent entries from the old auth log',()=>{
 const {store,done}=fx();try{store.setting('radiusAuthLog',{items:[{time:Date.now()-1000,username:'amy@kade',service:'pppoe',result:'accept',reason:'OK'},{time:Date.now()-9*864e5,username:'old',service:'pppoe',result:'accept'}]});
  const r=hotspot.query(store,'auth',new URLSearchParams({service:'pppoe'}));assert.equal(r.total,1);assert.equal(r.items[0].username,'amy');
 }finally{done();}
});
test('active sessions include what the routers report; servers come from health or sessions',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'HEX S',type:'router',driver:'none',tunnelIp:'10.121.15.247'}),now=Date.now();
  store.setting('customerDiscovery:'+r.id,{lastReport:now-60000,observations:[{key:'mac:AA:00:00:00:00:01',evidence:{hotspot:{source:'hotspot',name:'kne-c2zy2w',mac:'AA:00:00:00:00:01',ip:'10.10.0.5',service:'hs-kade',uptime:'00:10:00',rx:100,tx:2000,observedAt:now-60000}}}]});
  const live=hotspot.sessions(store,new URLSearchParams(),now);assert.equal(live.total,1);assert.equal(live.items[0].source,'router');assert.equal(live.items[0].router,'HEX S');assert.ok(Math.abs(live.items[0].startedAt-(now-60000-600000))<5);
  let sv=hotspot.servers(store,now);assert.equal(sv.items.length,1);assert.equal(sv.items[0].name,'hs-kade');assert.equal(sv.items[0].source,'sessions');assert.equal(sv.items[0].connected,1);assert.equal(sv.items[0].routerIp,'10.121.15.247');
  const h=health.normalize({hotspots:[{name:'hs-kade',interface:'bridge-hs',profile:'hsprof1',addressPool:'hs-pool',disabled:'false'},{name:'old',interface:'ether5',disabled:'true'}],ssids:[{interface:'wlan1',ssid:'Kade Networks',disabled:'false'}]});
  store.setting('routerHealth:'+r.id,{time:now,...h});
  sv=hotspot.servers(store,now);assert.equal(sv.items.length,2);const k=sv.items.find(x=>x.name==='hs-kade');assert.equal(k.enabled,true);assert.deepEqual(k.ssids,['Kade Networks']);assert.equal(sv.items.find(x=>x.name==='old').enabled,false);
  assert.match(health.SCRIPT,/\/ip hotspot print as-value/);assert.ok(!/\/ip hotspot (set|add|remove|enable|disable)/.test(health.SCRIPT),'read-only');
 }finally{done();}
});
test('max concurrent sessions per package, and auto billing from the wallet',()=>{
 const {store,done}=fx();try{const now=Date.now(),p=store.put('plans',radius.plan({name:'Hour',service:'hotspot',downloadMbps:5,uploadMbps:2,price:10,durationValue:1,durationUnit:'hours',maxSessions:1}));assert.equal(p.maxSessions,1);
  const mk=u=>{const s=store.put('subscribers',radius.subscriber(store,{name:u,username:u,service:'hotspot',planId:p.id,expiresAt:now+36e5}));radius.setPassword(store,s.id,'pass1');return s;};mk('aa');mk('bb');
  radius.accounting(store,{'Acct-Status-Type':'Start','Acct-Session-Id':'a1','User-Name':'aa','NAS-IP-Address':'10.0.0.1','Service-Type':'Login-User'},now);
  const r=radius.authorize(store,hreq('bb','AA:00:00:00:00:09','x'),now+1000);assert.equal(r.status,401);assert.match(r.reason,/full/);
  // Auto billing: off by default; on, an expired account with enough wallet renews once and the change is logged.
  const c=store.put('subscribers',{...radius.subscriber(store,{name:'Cee',username:'cee',service:'hotspot',planId:p.id,expiresAt:now-1000}),balance:25,paidEver:true});
  assert.deepEqual(billing.autoBill(store,now),[]);
  store.put('subscribers',{...store.get('subscribers',c.id),autoBilling:true},store.get('subscribers',c.id));
  assert.deepEqual(billing.autoBill(store,now),[c.id]);const after=store.get('subscribers',c.id);assert.equal(after.balance,15);assert.ok(after.expiresAt>now);
  assert.deepEqual(billing.autoBill(store,now),[],'not again while active');assert.equal(store.list('expiryChanges')[0].how,'Auto billing (wallet)');
 }finally{done();}
});
test('HTTP: connect requests, hotspot endpoints, expiry-change audit, MAC remove/block, migration ref',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hsa-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 try{await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'own@example.test',password:'fixture-owner-password-123'})});
  const lr=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'own@example.test',password:'fixture-owner-password-123'})}),cookie=lr.headers.get('set-cookie').split(';')[0],csrf=(await lr.json()).csrf;
  const api=async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json()};};
  const store=app.store,router=store.put('devices',{name:'CCR2004',type:'router',driver:'none'});
  const ua='Mozilla/5.0 (Linux; Android 14; SM-A055F Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
  for(let i=0;i<2;i++)await fetch(origin+'/portal/api/config?mac=AA%3ABB%3ACC%3A11%3A22%3A33&ip=10.10.1.7&nas=CCR2004',{headers:{'User-Agent':ua}});
  const rq=(await api('hotspot/logs/request')).body;assert.equal(rq.total,1,'one request per MAC per minute');assert.equal(rq.items[0].router,'CCR2004');assert.equal(rq.items[0].ip,'10.10.1.7');assert.match(rq.items[0].device,/SM-A055F/);
  assert.equal((await api('hotspot/logs/nope')).status,404);
  for(const r of ['hotspot/sessions','hotspot/acct-sessions','hotspot/servers','hotspot/manual','hotspot/logs/auth?service=hotspot'])assert.equal((await api(r)).status,200,r);
  const plan=(await api('radius/plans','POST',{name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'})).body;
  const sub=(await api('radius/subscribers','POST',{name:'Kim',username:'kim',service:'hotspot',planId:plan.id,phone:'0712000222'})).body;
  assert.equal((await api('radius/subscribers/'+sub.id+'/renew','POST',{periods:1})).status,200);
  const until=Date.now()+5*864e5;assert.equal((await api('radius/subscribers/'+sub.id,'PATCH',{expiresAt:until})).status,200);
  await api('radius/subscribers/'+sub.id,'PATCH',{notes:'no expiry change'});
  const m=(await api('hotspot/manual?customer=kim')).body;assert.equal(m.changes.length,2);assert.deepEqual(m.changes.map(x=>x.how).sort(),['Edited','Renewed']);assert.equal(m.changes.find(x=>x.how==='Edited').after,until);assert.equal(m.changes[0].by,'own@example.test');
  assert.equal((await api('hotspot/manual?by=nobody')).body.changes.length,0);
  // Devices on the profile: remove and block.
  {const cur=store.get('subscribers',sub.id);store.put('subscribers',{...cur,lastMac:'AA:BB:CC:11:22:33'},cur);}
  let pf=(await api('customers/'+sub.id+'/profile')).body;assert.equal(pf.devices[0].mac,'AA:BB:CC:11:22:33');assert.equal(pf.devices[0].device,'SM-A055F');assert.equal(pf.devices[0].engine,'Blink');assert.ok(pf.connectivity.length>=0);
  assert.equal((await api('radius/subscribers/'+sub.id+'/block-mac','POST',{mac:'aa-bb-cc-11-22-33'})).body.blocked,true);
  assert.ok(app.store.setting('radiusSettings').blockedMacs.some(b=>b.mac==='AA:BB:CC:11:22:33'));
  pf=(await api('customers/'+sub.id+'/profile')).body;assert.equal(pf.devices[0].blocked,true);
  assert.equal((await api('radius/subscribers/'+sub.id+'/block-mac','POST',{mac:'AA:BB:CC:11:22:33',unblock:true})).body.blocked,false);
  assert.equal((await api('radius/subscribers/'+sub.id+'/forget-mac','POST',{mac:'AA:BB:CC:11:22:33'})).status,200);
  pf=(await api('customers/'+sub.id+'/profile')).body;assert.equal(pf.devices.length,0);assert.equal(store.get('subscribers',sub.id).lastMac,'');
  assert.equal((await api('radius/subscribers/'+sub.id+'/forget-mac','POST',{mac:'bad'})).status,400);
  // Migration reference and auto billing switch.
  assert.equal((await api('radius/subscribers/'+sub.id+'/payment-ref','POST',{reference:'sfg3h1k2lm'})).body.paymentRef,'SFG3H1K2LM');
  assert.equal((await api('radius/subscribers/'+sub.id+'/payment-ref','POST',{reference:'bad ref!'})).status,400);
  assert.equal((await api('radius/subscribers/'+sub.id+'/auto-billing','POST',{enabled:true})).body.autoBilling,true);
  pf=(await api('customers/'+sub.id+'/profile')).body;assert.equal(pf.autoBilling,true);assert.equal(pf.paymentRef,'SFG3H1K2LM');
  assert.ok(pf.connectivity.length===0||pf.connectivity.every(c=>'mode' in c));
  void router;
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
