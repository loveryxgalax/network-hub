'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {summary}=require('../lib/topology.cjs');
test('topology summary: equipment, users online from router reports, device kinds from the last 24 h',()=>{
 const now=Date.now(),settings={'onlineSeries:r1':{points:[[now-60000,7,30]]},'onlineSeries:r2':{points:[[now-36e5,9,9]]},
  deviceInfo:{byMac:{a:{os:'Android',device:'TECNO KI5',last:now},b:{os:'iOS',device:'iPad',last:now},c:{os:'Windows',device:'Computer',last:now},d:{os:'Android',device:'X',last:now-2*864e5}}}};
 const store={setting:k=>settings[k],list:()=>[{service:'static',status:'active'},{service:'pppoe'}]};
 const map={nodes:[{id:'r1',kind:'router'},{id:'r2',kind:'router'},{id:'n1',kind:'MikroTik'},{id:'n2',kind:'Ubiquiti radio'},{id:'n3',kind:'OLT'}]};
 assert.deepEqual(summary(store,map,now),{routers:2,mikrotiks:3,neighbours:3,accessPoints:1,olts:1,statics:1,hotspot:30,pppoe:7,phones:1,tablets:1,computers:1,other:0});
});
test('hotspot fair usage: capped bundles by share of allowance used; uncapped bundles counted apart',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),fu=require('../lib/fairuse.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fu-')),store=new Store(dir);
 try{const now=Date.now(),MB=1048576;
  const capped=store.put('plans',{...radius.plan({name:'Day 1GB',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}),fup:{enabled:true,period:'package',downCapMB:1000,upCapMB:0,timeCapMinutes:0,afterDownMbps:1,afterUpMbps:1,tiers:[]}});
  const open=store.put('plans',radius.plan({name:'Hour',service:'hotspot',downloadMbps:5,uploadMbps:2,price:10,durationValue:1,durationUnit:'hours'}));
  const used=[100,400,600,900,1200];used.forEach((mb,i)=>{const s=store.put('subscribers',radius.subscriber(store,{name:'U'+i,username:'u'+i,service:'hotspot',planId:capped.id,expiresAt:now+12*36e5}));
   store.put('radiusSessions',{username:s.username,service:'hotspot',startedAt:now-36e5,updatedAt:now-60000,downloadBytes:mb*MB,uploadBytes:0});});
  store.put('subscribers',radius.subscriber(store,{name:'Open',username:'open',service:'hotspot',planId:open.id,expiresAt:now+1800000}));
  store.put('subscribers',radius.subscriber(store,{name:'Gone',username:'gone',service:'hotspot',planId:capped.id,expiresAt:now-1000}));
  const r=fu.summary(store,now);
  assert.equal(r.inUse,6);assert.equal(r.capped,5);assert.equal(r.uncapped,1);
  assert.deepEqual(r.counts,{under30:1,b30:1,b50:1,b80:1,limit:1});assert.equal(r.reachedCustomers,1);
  assert.deepEqual(r.byPlan,[{name:'Day 1GB',capMB:1000,b30:1,b50:1,b80:1,limit:1}]);assert.equal(r.history.length,1);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('branding API: key needed, shown once and stored hashed; packages and ISP details; CORS for other sites',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ba-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const s=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'Kade Networks',email:'own@example.test',password:'fixture-owner-password-123'})});const cookie=s.headers.get('set-cookie').split(';')[0],csrf=(await s.json()).csrf;
  app.store.put('plans',radius.plan({name:'1 Hour',service:'hotspot',downloadMbps:5,uploadMbps:2,price:20,durationValue:1,durationUnit:'hours'}));app.store.put('plans',{...radius.plan({name:'Secret',service:'hotspot',downloadMbps:5,uploadMbps:2,price:1,durationValue:1,durationUnit:'hours'}),hidden:true});
  let r=await fetch(o+'/portal/api/brand/hotspot-packages');assert.equal(r.status,401);assert.equal(r.headers.get('access-control-allow-origin'),'*');
  const k=await (await fetch(o+'/api/brand-api',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:'{}'})).json();assert.match(k.key,/^kn_/);
  assert.ok(!JSON.stringify(app.store.secret('brandApi')).includes(k.key),'only a hash is stored');
  r=await fetch(o+'/portal/api/brand/hotspot-packages',{headers:{Authorization:'Bearer '+k.key}});assert.equal(r.status,200);assert.deepEqual((await r.json()).packages.map(p=>p.name),['1 Hour']);
  const isp=await (await fetch(o+'/portal/api/brand/isp',{headers:{Authorization:'Bearer '+k.key}})).json();assert.equal(isp.name,'Kade Networks');
  assert.equal((await fetch(o+'/portal/api/brand/isp',{method:'OPTIONS'})).status,204);
  assert.equal((await fetch(o+'/portal/api/brand/isp',{headers:{Authorization:'Bearer kn_wrongwrongwrong'}})).status,401);
  {const dr=await fetch(o+'/api/brand-api',{method:'DELETE',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf}});assert.equal(dr.status,200,await dr.text());}assert.equal((await fetch(o+'/portal/api/brand/isp',{headers:{Authorization:'Bearer '+k.key}})).status,401,'revoked');
 }finally{await app.close();}
});
test('customer usage: range and grouping; larger of RADIUS or router figures per day, never both; paged sessions',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),u=require('../lib/usage.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'us-')),store=new Store(dir);
 try{const now=Date.UTC(2026,10,10,9,0,0),GB=1e9,r=store.put('devices',{name:'CCR',type:'router'});
  const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
  const s=store.put('subscribers',radius.subscriber(store,{name:'Masavi',username:'masavi',service:'pppoe',planId:p.id}));
  // Router reports for two days; RADIUS has a bigger figure for one of them.
  store.setting('customerDiscovery:'+r.id,{observations:[{evidence:{ppp:{name:'Masavi'}},usageDays:{'2026-11-08':{down:5*GB,up:1*GB},'2026-11-09':{down:2*GB,up:0}}}]});
  store.put('radiusSessions',{username:'masavi',service:'pppoe',startedAt:Date.UTC(2026,10,9,6,0,0),updatedAt:Date.UTC(2026,10,9,8,0,0),stoppedAt:Date.UTC(2026,10,9,8,0,0),downloadBytes:3*GB,uploadBytes:GB});
  const d=u.usage(store,s,{from:'2026-11-01',to:'2026-11-10',group:'day'},now);
  assert.equal(d.series.length,10);assert.equal(d.totals.down,8*GB,'5 GB from the router on the 8th, 3 GB from RADIUS on the 9th');assert.equal(d.totals.up,2*GB);assert.equal(d.totals.sessions,1);assert.deepEqual(d.sources,{radius:true,router:true});
  assert.equal(u.usage(store,s,{from:'2026-11-01',to:'2026-11-10',group:'month'},now).series.length,1);
  assert.deepEqual(u.usage(store,s,{from:'2026-11-01',to:'2026-11-10',group:'week'},now).series.map(x=>x.label),['2026-10-26','2026-11-02','2026-11-09']);
  assert.throws(()=>u.usage(store,s,{from:'2026-11-10',to:'2026-11-01'},now),/valid date range/);
  for(let i=0;i<30;i++)store.put('radiusSessions',{username:'masavi',service:'pppoe',startedAt:now-i*36e5,updatedAt:now-i*36e5+60000,downloadBytes:1,uploadBytes:1});
  const pg=u.sessionsPage(store,s,1);assert.equal(pg.total,31);assert.equal(pg.items.length,6);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('WiFi page per router: packages of other routers hidden, isolate, own support contact',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),portal=require('../lib/portal.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rp-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port,st=app.store;
 try{const a=st.put('devices',{name:'CCR2004',type:'router'}),b=st.put('devices',{name:'HEX S',type:'router'});
  const mk=(name,routerIds)=>st.put('plans',{...radius.plan({name,service:'hotspot',downloadMbps:5,uploadMbps:2,price:10,durationValue:1,durationUnit:'hours'}),routerIds});
  mk('Everywhere',[]);mk('Only CCR',[a.id]);mk('Only HEX',[b.id]);
  const names=async q=>(await (await fetch(o+'/portal/api/config'+q)).json()).plans.map(p=>p.name).sort();
  assert.deepEqual(await names(''),['Everywhere','Only CCR','Only HEX'],'no router known: all');
  assert.deepEqual(await names('?nas=ccr2004'),['Everywhere','Only CCR']);
  portal.saveRouterPortal(st,a.id,{isolate:true,supportPhone:'0711000222'});assert.deepEqual(await names('?nas=CCR2004'),['Only CCR']);
  const cfg=(await (await fetch(o+'/portal/api/config?nas=CCR2004')).json()).config;assert.equal(cfg.phone,'0711000222');
  assert.throws(()=>portal.saveRouterPortal(st,a.id,{supportPhone:'12'}),/phone/);
 }finally{await app.close();}
});
