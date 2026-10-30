'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),jobs=require('../lib/jobs.cjs'),syslog=require('../lib/syslog.cjs'),presence=require('../lib/presence.cjs'),overview=require('../lib/overview.cjs'),radius=require('../lib/radius.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'il-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
test('system logs: a failed static connect shows as "Static Connected Failed" with the IP, and can be acknowledged',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'CCR2004',type:'router'}),now=Date.now(),u={name:'Owner',email:'o@x.test'};jobs.enroll(store,r.id);
  const s=store.put('subscribers',{name:'Ann',username:'ann',service:'static',status:'active'});
  const j=jobs.create(store,{routerId:r.id,type:'static-apply',params:{ip:'10.27.0.13',mac:'',iface:'bridge',name:'ann',rate:'5M/5M',enabled:'yes'},subscriberId:s.id,user:u},now);
  for(let i=0;i<j.maxAttempts;i++){const at=now+i*36e5,n=jobs.next(store,r.id,at);assert.ok(n,'attempt '+i);jobs.result(store,r.id,n.id,{ok:false,output:'no such item'},at+1000);}
  store.put('portalPayments',{phone:'254712345678',amount:50,status:'failed',reason:'Request cancelled by user',createdAt:now});
  const l=syslog.list(store,{},now+10*36e5),e=l.items.find(x=>x.category==='STATICS');
  assert.equal(e.title,'Static Connected Failed');assert.equal(e.level,'error');assert.match(e.message,/10\.27\.0\.13 on CCR2004: no such item/);assert.deepEqual([e.details.action,e.details.ip],['connected','10.27.0.13']);assert.equal(e.principal.name,'Ann');
  const pay=l.items.find(x=>x.category==='PAYMENTS');assert.equal(pay.level,'info','a customer cancelling is not an error');assert.doesNotMatch(pay.message,/712345/,'phone is masked');
  assert.equal(l.unacknowledged,1);assert.equal(syslog.list(store,{category:'PAYMENTS'},now).items.length,1);assert.equal(syslog.list(store,{q:'10.27.0.13'},now).items.length,1);
  syslog.acknowledge(store,[e.id],u,now);const after=syslog.list(store,{status:'open'},now);assert.equal(after.unacknowledged,0);assert.ok(!after.items.some(x=>x.id===e.id));
  assert.equal(syslog.list(store,{status:'acknowledged'},now).items[0].ack.by,'o@x.test');assert.throws(()=>syslog.acknowledge(store,['<script>'],u),/Nothing/);
 }finally{done();}
});
test('portal presence: counts visitors by service, page and router; drops them after 30 s; one entry per device',()=>{
 presence.reset();const t=1e12;presence.ping({mac:'aa:bb:cc:dd:ee:01',page:'Packages',nas:'HEX S (Ikutha)'},{},t);presence.ping({mac:'AA:BB:CC:DD:EE:01',page:'Purchase Package',nas:'HEX S (Ikutha)'},{},t+5000);
 presence.ping({page:'PPPoE Package',service:'pppoe',tab:'x'},{ip:'1.2.3.4',ua:'u'},t+6000);presence.ping({page:'<b>',nas:'<img>'},{ip:'1.2.3.5',ua:'u'},t+6000);
 let n=presence.now(t+7000);assert.deepEqual([n.total,n.hotspot,n.pppoe],[3,2,1]);assert.equal(n.pages['Purchase Package'],1);assert.equal(n.pages.Packages,1,'unknown page names fall back');assert.equal(n.devices['HEX S (Ikutha)'],1);assert.ok(!Object.keys(n.devices).some(k=>/[<>]/.test(k)));
 n=presence.now(t+6000+31000);assert.equal(n.total,0);
});
test('overview: hotspot and PPPoE status use RADIUS sessions too, with unpaid and a hotspot period',()=>{
 const {store,done}=fx();try{const now=Date.now(),D=864e5;const hp=store.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'})),pp=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
  const mk=(u,svc,exp,extra={})=>{const x=store.put('subscribers',{name:u,username:u,service:svc,planId:svc==='hotspot'?hp.id:pp.id,status:'active',expiresAt:exp,...extra});store.db.prepare("UPDATE records SET created=? WHERE kind='subscribers' AND id=?").run(now-40*D,x.id);};
  mk('h1','hotspot',now+36e5);mk('h2','hotspot',now+36e5);mk('h3','hotspot',now-1000,{paidEver:false});mk('hold','hotspot',now-20*D);
  mk('p1','pppoe',now+5*D);mk('p2','pppoe',now-D);mk('p3','pppoe',now+5*D,{status:'suspended'});
  const sess=(u,svc)=>store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(u,JSON.stringify({username:u,nas:'10.99.0.2',nasName:'CCR',service:svc,startedAt:now-6e4,updatedAt:now-6e4,stoppedAt:null}),now,now);
  sess('h1','hotspot');sess('p1','pppoe');sess('p2','pppoe');
  const o=overview.build(store,'24h',now);
  assert.deepEqual([o.hotspot.total,o.hotspot.online,o.hotspot.offline,o.hotspot.unpaid,o.hotspot.range],[3,1,1,1,'today'],'the old expired account is outside today');
  assert.equal(overview.build(store,'24h',now,{hotspotRange:'month'}).hotspot.total,4);
  assert.deepEqual([o.pppoe.online,o.pppoe.onlineExpired,o.pppoe.deactivated],[1,1,1]);assert.deepEqual(o.pppoe.byDevice,[{name:'CCR',count:2}]);assert.deepEqual(o.hotspot.byPackage,[{name:'Daily',count:1}]);
 }finally{done();}
});
test('reports: revenue split by service (hourly for one day) and payment times by weekday and time of day',()=>{
 const {store,done}=fx();try{const reports=require('../lib/reports.cjs'),D=864e5,now=Date.parse('2026-10-31T09:30:00+03:00');
  const h=store.put('subscribers',{name:'H',username:'h',service:'hotspot',status:'active'}),p=store.put('subscribers',{name:'P',username:'p',service:'pppoe',status:'active'});
  const pay=(s,amount,iso)=>store.put('subscriberPayments',{subscriberId:s.id,username:s.username,amount,method:'mpesa',time:Date.parse(iso)});
  pay(h,50,'2026-10-31T08:10:00+03:00');pay(p,2000,'2026-10-31T08:40:00+03:00');pay(h,20,'2026-10-30T22:15:00+03:00');pay(p,1500,'2026-10-29T01:00:00+03:00');
  const t=reports.build(store,{period:'today'},now);assert.equal(t.hourly,true);assert.equal(t.series.length,24);assert.deepEqual(t.series[8],{label:'08:00',hotspot:50,pppoe:2000});
  const m=reports.build(store,{period:'month'},now);assert.equal(m.hourly,false);assert.deepEqual(m.series.find(x=>x.label==='2026-10-30'),{label:'2026-10-30',hotspot:20,pppoe:0});
  const pt=m.paymentTimes.d7;assert.equal(pt.total,1520,'today is left out');assert.equal(pt.weekdays[0].day,'Friday','yesterday first');
  assert.equal(pt.weekdays[0].times.find(x=>x.name==='Night').amount,20);assert.equal(pt.all.find(x=>x.name==='Late Night').amount,1500);
 }finally{done();}
});
test('static IP list: connection state and a warning when one address is given to two customers',()=>{
 const {store,done}=fx();try{const statics=require('../lib/statics.cjs'),a=store.put('devices',{name:'CCR2004',type:'router'}),b=store.put('devices',{name:'HEX S',type:'router'}),now=Date.now();
  store.put('subscribers',{name:'Church',username:'church',service:'static',staticIp:'10.27.0.13',routerId:a.id,status:'active',expiresAt:now+864e5,provisioning:{status:'ok'}});
  store.put('subscribers',{name:'Kyandula HT',username:'kht',service:'static',staticIp:'10.27.0.13',routerId:b.id,status:'active',expiresAt:now-864e5,provisioning:{status:'failed',error:'already have such entry'}});
  store.put('subscribers',{name:'Shop',username:'shop',service:'static',staticIp:'10.27.0.20',routerId:a.id,status:'active',expiresAt:now-864e5,provisioning:{status:'ok'}});
  const o=statics.overview(store,radius.stateOf,now),c=n=>o.items.find(x=>x.name===n).connection;
  assert.deepEqual([c('Church'),c('Kyandula HT'),c('Shop')],['connected','failed','disconnected']);
  assert.equal(o.duplicates.length,1);assert.equal(o.duplicates[0].ip,'10.27.0.13');assert.deepEqual(o.duplicates[0].customers.map(x=>x.name).sort(),['Church','Kyandula HT']);
 }finally{done();}
});
test('static customer actions: Connect now re-sends, deactivate blocks, delete removes router entries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'il-app-')),{createApp}=require('../server.cjs'),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',radiusToken:'bridge-token-for-tests-0123456789',radiusPort:0});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 const api=async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null,response:r};};
 try{const owner=await api('setup','POST',{name:'Owner',workspace:'QA',email:'st@example.test',password:'fixture-owner-password-123'});cookie=owner.response.headers.get('set-cookie').split(';')[0];csrf=owner.body.csrf;
  const dev=(await api('records/devices','POST',{name:'CCR',type:'router',driver:'none'})).body;
  const plan=(await api('radius/plans','POST',{name:'B',service:'pppoe',downloadMbps:20,uploadMbps:20,price:3000,durationValue:30,durationUnit:'days',devices:1})).body;
  assert.equal((await api('statics/settings/'+dev.id,'PUT',{network:'10.27.0.0/16',gateway:'10.27.0.1',iface:'bridge',arpPinning:true})).status,200);
  const sub=(await api('radius/subscribers','POST',{name:'Church',username:'church',service:'static',planId:plan.id,routerId:dev.id,staticIp:'10.27.0.14'})).body;
  assert.equal((await api('radius/subscribers/'+sub.id+'/reapply','POST',{})).status,409,'no job runner yet');
  assert.equal((await api('router-jobs/enroll','POST',{deviceId:dev.id})).status,201);
  const re=await api('radius/subscribers/'+sub.id+'/reapply','POST',{});assert.equal(re.status,200);assert.equal(re.body.queued,true);
  const prof=(await api('customers/'+sub.id+'/profile')).body.staticInfo;assert.equal(prof.netmask,'255.255.0.0');assert.equal(prof.gateway,'10.27.0.1');assert.equal(prof.lastJob.type,'static-apply');
  assert.equal((await api('radius/subscribers/'+sub.id+'/deactivate','POST',{reason:''})).status,400,'needs a reason');
  const de=await api('radius/subscribers/'+sub.id+'/deactivate','POST',{reason:'Moved away'});assert.equal(de.body.subscriber.status,'suspended');
  const jobsNow=(await api('router-jobs')).body.jobs||[];assert.ok(jobsNow.some(j=>j.type==='static-apply'&&j.params.enabled==='no'),'blocked on the router');
  const del=await api('radius/subscribers/'+sub.id,'DELETE');assert.equal(del.status,200);assert.ok(del.body.routerJob);
  assert.ok(((await api('router-jobs')).body.jobs||[]).some(j=>j.type==='static-remove'&&j.params.ip==='10.27.0.14'));
 }finally{await new Promise(r=>app.server.close(r));app.close?.();fs.rmSync(dir,{recursive:true,force:true});}
});
test('alerts: acknowledge and resolve record who; points award; self-service link',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'il-al-')),{createApp}=require('../server.cjs'),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',radiusToken:'bridge-token-for-tests-0123456789',radiusPort:0});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 const api=async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});const t=await r.text();return {status:r.status,body:t?JSON.parse(t):null,response:r};};
 try{const owner=await api('setup','POST',{name:'Owner',workspace:'QA',email:'al@example.test',password:'fixture-owner-password-123'});cookie=owner.response.headers.get('set-cookie').split(';')[0];csrf=owner.body.csrf;
  const a=(await api('records/alerts','POST',{title:'CCR offline',severity:'critical',status:'Open'})).body;
  const ack=await api('alerts/'+a.id+'/acknowledge','POST',{});assert.equal(ack.body.status,'Acknowledged');assert.equal(ack.body.acknowledgedBy,'al@example.test');
  const res=await api('alerts/'+a.id+'/resolve','POST',{});assert.equal(res.body.status,'Resolved');assert.equal(res.body.resolvedBy,'al@example.test');assert.ok(res.body.resolvedAt);
  assert.equal((await api('nav-counts')).body.alerts,0);
  const plan=(await api('radius/plans','POST',{name:'D',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days',devices:1})).body;
  const sub=(await api('radius/subscribers','POST',{name:'Ann Mutua',username:'ann',service:'hotspot',planId:plan.id,password:'pw123456'})).body;
  assert.equal((await api('radius/subscribers/'+sub.id+'/award-points','POST',{points:5,reason:''})).status,400);
  const aw=await api('radius/subscribers/'+sub.id+'/award-points','POST',{points:5,reason:'Referral'});assert.equal(aw.body.subscriber.points,5);
  const ss=await api('radius/subscribers/'+sub.id+'/self-service','POST',{});assert.equal(ss.body.link,'https://network.example.test/portal/?account=ann');
  assert.equal((await api('radius/subscribers/'+sub.id+'/self-service','POST',{send:true})).status,400,'no phone');
 }finally{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
