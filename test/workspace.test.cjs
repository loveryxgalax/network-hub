'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createApp}=require('../server.cjs');
const {endpoint}=require('../lib/connectors.cjs');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
test('persistent workspace, authorization and operational workflows',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-hub-test-'));let app=createApp({dataDir:directory,collector:false}),origin=await listen(app.server),cookie='',csrf='';
 const owner={name:'QA Owner',workspace:'QA Network',email:'owner@example.test',password:'test-owner-password-123'};
 let router,zone,odb,cableA,cableB,closure,stock,invoice,viewer,olt,profile;
 let routerUp=true,gatewayUp=true,gatewayConfirmed=true,authorized=false,bytes=1000,authCalls=0;
 const fixture=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture');res.setHeader('Content-Type','application/json');
  if(url.pathname.startsWith('/rest/')){
   if(req.headers.authorization!=='Basic '+Buffer.from('monitor:router-secret-value').toString('base64')){res.writeHead(401).end('{}');return;}
   if(!routerUp){res.writeHead(503).end('{}');return;}
   if(url.pathname==='/rest/system/resource'){assert.match(url.searchParams.get('.proplist'),/cpu-load/);res.end(JSON.stringify({'cpu-load':'23','free-memory':'50','total-memory':'100',uptime:'3d2h',version:'7.fixture','board-name':'Fixture router'}));return;}
   if(url.pathname==='/rest/interface'){bytes+=500;res.end(JSON.stringify([{'.id':'*1',name:'ether1',type:'ether',running:'true',disabled:'false','rx-byte':String(bytes),'tx-byte':String(bytes/2)}]));return;}
   if(url.pathname==='/rest/ip/route'){res.end(JSON.stringify([{'.id':'*1','dst-address':'0.0.0.0/0',gateway:'192.0.2.1',distance:'1',active:'true','check-gateway':'ping'}]));return;}
   if(url.pathname==='/rest/interface/wireguard/peers'){res.end(JSON.stringify([{interface:'wg-monitor','last-handshake':'20s',rx:'12',tx:'8'}]));return;}
  }
  if(url.pathname.startsWith('/v1/devices/')){
   if(req.headers.authorization!=='Bearer gateway-secret-value'){res.writeHead(401).end('{}');return;}
   if(url.pathname.endsWith('/snapshot')){if(!gatewayUp){res.writeHead(503).end('{}');return;}res.end(JSON.stringify({online:true,onus:authorized?[{serial:'QAONU0001',pon:'1/1',name:'QA subscriber',online:true,power:-20.1,oltPower:-21.3}]:[],unconfigured:authorized?[]:[{serial:'QAONU0001',pon:'1/1'}]}));return;}
   {const m=url.pathname.match(/\/onus\/([^/]+)\/(reboot|disable|enable|deauthorize)$/);if(m){let body='';for await(const chunk of req)body+=chunk;const r=JSON.parse(body);assert.ok(r.idempotencyKey);onuOps.push(m[2]);res.end(JSON.stringify(onuConfirm?{done:true,serial:decodeURIComponent(m[1]),action:m[2]}:{}));return;}}
   if(url.pathname.endsWith('/authorize')){authCalls++;let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);assert.equal(request.profile.vlan,100);assert.ok(request.idempotencyKey);if(gatewayConfirmed){authorized=true;res.end(JSON.stringify({authorized:true,serial:request.serial}));}else res.end('{}');return;}
  }
  res.writeHead(404).end('{}');
 });
 let onuOps=[],onuConfirm=true;
 const deviceOrigin=await listen(fixture);
 async function api(route,method='GET',input,overrides={}){const response=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...overrides},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:response.status,body:await response.json(),response};}
 const create=async(kind,input)=>{const result=await api('records/'+kind,'POST',input);assert.equal(result.status,201,JSON.stringify(result.body));return result.body;};
 const patch=async(kind,item,input)=>api('records/'+kind+'/'+item.id,'PATCH',{...item,...input,version:item.version});
 try{
 await t.test('first-run setup, hashed credentials, session cookie and authentication boundary',async()=>{
  assert.equal((await api('dashboard')).status,401);assert.equal((await api('session')).body.setup,true);
  const setup=await api('setup','POST',owner);assert.equal(setup.status,201);csrf=setup.body.csrf;cookie=setup.response.headers.get('set-cookie').split(';')[0];assert.match(setup.response.headers.get('set-cookie'),/HttpOnly/);assert.match(setup.response.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await api('setup','POST',owner)).status,409);assert.equal((await api('records/devices')).body.length,0);const stored=app.store.db.prepare('SELECT password FROM users').get().password;assert.ok(!stored.includes(owner.password));
  assert.equal((await api('records/zones','POST',{name:'Blocked'},{'X-CSRF-Token':''})).status,403);
  assert.equal((await api('records/zones','POST',{name:'Blocked'},{Origin:'https://untrusted.example'})).status,403);
 });
 await t.test('network records, ODB capacity, reference validation and optimistic concurrency',async()=>{
  zone=await create('zones',{name:'North zone',latitude:-1.2,longitude:36.8});odb=await create('odbs',{name:'ODB1',zoneId:zone.id,capacity:1});
  await create('devices',{name:'Subscriber1',type:'onu',driver:'none',odbId:odb.id});assert.equal((await api('records/devices','POST',{name:'Subscriber2',type:'onu',driver:'none',odbId:odb.id})).status,400);
  assert.equal((await api('records/devices','POST',{name:'Bad parent',type:'onu',parentId:'missing'})).status,400);
  const updated=await patch('zones',zone,{description:'Stored description'});assert.equal(updated.status,200);assert.equal((await patch('zones',zone,{description:'Outdated edit'})).status,409);zone=updated.body;
  assert.equal((await api('records/zones/'+zone.id,'DELETE',{})).status,409);
 });
 await t.test('RouterOS fixture collector reads real protocol fields, encrypts credentials and records history',async()=>{
  router=await create('devices',{name:'Fixture router',type:'router',driver:'routeros-rest',endpoint:deviceOrigin,status:'online',metrics:{cpu:100}});assert.equal(router.status,'pending');assert.equal(router.metrics,undefined);
  const saved=await api('records/devices/'+router.id+'/connection','POST',{username:'monitor',password:'router-secret-value'});assert.equal(saved.status,200);
  const encrypted=app.store.db.prepare('SELECT encrypted FROM secrets WHERE device_id=?').get(router.id).encrypted;assert.ok(!encrypted.includes('router-secret-value'));assert.equal(app.store.secret(router.id).password,'router-secret-value');
  const check=await api('records/devices/'+router.id+'/poll','POST',{});assert.equal(check.body.online,true);assert.equal(check.body.snapshot.cpu,23);assert.equal(check.body.snapshot.memory,50);assert.equal(check.body.snapshot.routes[0].gateway,'192.0.2.1');
  await new Promise(resolve=>setTimeout(resolve,20));await api('records/devices/'+router.id+'/poll','POST',{});const history=(await api('records/devices/'+router.id+'/history')).body;assert.equal(history.length,2);assert.ok(history[1].traffic.rxMbps>0);
  const publicRows=JSON.stringify((await api('records/devices')).body);assert.ok(!publicRows.includes('router-secret-value'));assert.ok(!publicRows.includes('encrypted'));
 });
 await t.test('failure alerts deduplicate and recover; work completion checks the device',async()=>{
  const job=await create('jobs',{title:'Restore service',deviceId:router.id,customer:'Customer'});routerUp=false;
  assert.equal((await api('records/devices/'+router.id+'/poll','POST',{})).body.online,false);await api('records/devices/'+router.id+'/poll','POST',{});
  let alerts=(await api('records/alerts')).body.filter(a=>a.source==='collector'&&a.deviceId===router.id);assert.equal(alerts.length,1);assert.equal(alerts[0].status,'Open');
  assert.equal((await patch('jobs',job,{status:'Done'})).status,409);assert.equal((await api('records/jobs/'+job.id)).body.status,'Open');
  routerUp=true;const complete=await patch('jobs',job,{status:'Done'});assert.equal(complete.status,200);assert.match(complete.body.verification,/Device online/);alerts=(await api('records/alerts')).body.filter(a=>a.source==='collector'&&a.deviceId===router.id);assert.equal(alerts[0].status,'Resolved');
 });
 await t.test('fibre core allocation and immutable stock movements',async()=>{
  closure=await create('closures',{name:'Closure1',zoneId:zone.id});cableA=await create('cables',{name:'CableA',fromId:zone.id,toId:closure.id,cores:12});cableB=await create('cables',{name:'CableB',fromId:closure.id,toId:odb.id,cores:12});
  await create('splices',{name:'Splice1',closureId:closure.id,fromCableId:cableA.id,fromCore:1,toCableId:cableB.id,toCore:1});
  assert.equal((await api('records/splices','POST',{name:'Duplicate',closureId:closure.id,fromCableId:cableA.id,fromCore:1,toCableId:cableB.id,toCore:2})).status,400);
  assert.equal((await api('records/splices','POST',{name:'Outside capacity',closureId:closure.id,fromCableId:cableA.id,fromCore:13,toCableId:cableB.id,toCore:2})).status,400);
  stock=await create('stock',{name:'Drop cable',sku:'DROP',unit:'m',minimum:10});const receipt=await create('stockMoves',{stockId:stock.id,quantity:100,reason:'Delivery'});await create('stockMoves',{stockId:stock.id,quantity:-20,reason:'Installation'});
  assert.equal((await api('records/stockMoves','POST',{stockId:stock.id,quantity:-81,reason:'Too much'})).status,400);assert.equal((await api('records/stockMoves/'+receipt.id,'DELETE',{})).status,409);
 });
 await t.test('invoice payments are transactional, cannot overpay or reuse references',async()=>{
  assert.equal((await api('records/invoices','POST',{name:'Invalid currency',customer:'Customer',amount:1.001})).status,400);
  invoice=await create('invoices',{name:'INV-001',customer:'Customer',amount:1000});await create('payments',{invoiceId:invoice.id,amount:400,reference:'BANK-001',description:'Bank receipt'});
  assert.equal((await api('records/payments','POST',{invoiceId:invoice.id,amount:700,reference:'BANK-002',description:'Too much'})).status,400);assert.equal((await api('records/invoices/'+invoice.id)).body.status,'Unpaid');
  await create('payments',{invoiceId:invoice.id,amount:600,reference:'BANK-002',description:'Final receipt'});assert.equal((await api('records/invoices/'+invoice.id)).body.status,'Paid');assert.equal((await api('records/payments','POST',{amount:5,reference:'BANK-002',description:'Duplicate'})).status,409);
 });
 await t.test('OLT gateway fixture discovery, uncertain outcome guard and verified authorization',async()=>{
  olt=await create('devices',{name:'Fixture OLT',type:'olt',driver:'olt-gateway',endpoint:deviceOrigin,externalId:'olt1'});await api('records/devices/'+olt.id+'/connection','POST',{token:'gateway-secret-value'});await api('records/devices/'+olt.id+'/poll','POST',{});
  const discovery=await api('records/devices/'+olt.id+'/discover');assert.equal(discovery.body.onus[0].serial,'QAONU0001');profile=await create('profiles',{name:'100M',vendor:'Fixture',vlan:100,download:100,upload:100});const payload={serial:'QAONU0001',pon:'1/1',profileId:profile.id};
  gatewayConfirmed=false;assert.equal((await api('records/devices/'+olt.id+'/authorize','POST',payload)).status,502);assert.equal(authCalls,1);assert.equal((await api('records/devices/'+olt.id+'/authorize','POST',payload)).status,409);assert.equal(authCalls,1);
  const alert=(await api('records/alerts')).body.find(a=>a.source==='provisioning');await patch('alerts',alert,{status:'Resolved'});gatewayConfirmed=true;const response=await api('records/devices/'+olt.id+'/authorize','POST',payload);assert.equal(response.body.authorized,true);const onu=(await api('records/devices')).body.find(d=>d.serial==='QAONU0001');assert.equal(onu.metrics.power,-20.1);assert.equal(onu.status,'online');
  assert.equal((await api('records/devices/'+onu.id+'/onu-action','POST',{action:'reboot'})).body.done,true);assert.deepEqual(onuOps,['reboot']);
  assert.equal((await api('records/devices/'+onu.id+'/onu-action','POST',{action:'deauthorize',confirm:'WRONG'})).status,400);
  assert.equal((await api('records/devices/'+onu.id+'/onu-action','POST',{action:'disable'})).status,200);assert.equal((await api('records/devices')).body.find(d=>d.id===onu.id).onuState,'disabled');
  onuConfirm=false;assert.equal((await api('records/devices/'+onu.id+'/onu-action','POST',{action:'enable'})).status,502);assert.equal((await api('records/devices/'+onu.id+'/onu-action','POST',{action:'enable'})).status,409,'unverified operation blocks a retry until reconciled');
  {const al=(await api('records/alerts')).body.find(x=>x.source==='onu-operation'&&x.status!=='Resolved');await patch('alerts',al,{status:'Resolved'});}onuConfirm=true;
  const job=await create('jobs',{title:'Verify ONU service',deviceId:onu.id});gatewayUp=false;assert.equal((await patch('jobs',job,{status:'Done'})).status,409,'A previously online ONU must not pass when the current OLT check fails');gatewayUp=true;assert.equal((await patch('jobs',job,{status:'Done'})).status,200);
 });
 await t.test('team permissions enforce viewer boundaries and session revocation',async()=>{
  const added=await api('team','POST',{name:'Viewer',email:'viewer@example.test',role:'viewer',password:'viewer-test-password'});assert.equal(added.status,201);viewer=added.body;const ownerCookie=cookie,ownerCsrf=csrf;
  const login=await api('login','POST',{email:'viewer@example.test',password:'viewer-test-password'});cookie=login.response.headers.get('set-cookie').split(';')[0];csrf=login.body.csrf;assert.equal((await api('dashboard')).status,200);assert.equal((await api('records/zones','POST',{name:'Denied'})).status,403);assert.equal((await api('records/devices/'+router.id+'/connection','POST',{username:'bad',password:'bad'})).status,403);assert.equal((await api('audit')).status,403);const viewerCookie=cookie;
  cookie=ownerCookie;csrf=ownerCsrf;assert.equal((await api('team/'+viewer.id,'PATCH',{active:false})).status,200);assert.equal((await api('dashboard','GET',undefined,{Cookie:viewerCookie})).status,401);
 });
 await t.test('endpoint changes clear credentials and measurements; TLS cannot be bypassed',async()=>{
  assert.throws(()=>endpoint('http://192.0.2.1'));assert.throws(()=>endpoint('https://user:pass@example.test'));assert.throws(()=>endpoint('https://example.test/path'));assert.equal(endpoint('https://example.test'),'https://example.test');
  const current=(await api('records/devices/'+router.id)).body;const changed=await patch('devices',current,{endpoint:'https://new-router.example.test'});assert.equal(changed.status,200);assert.equal(changed.body.connectionConfigured,false);assert.deepEqual(changed.body.metrics,{});assert.equal(changed.body.status,'pending');
 });
 await t.test('inspected planning workflows: speeds, default presets, port occupancy and opening stock',async()=>{
  const speed=await create('speeds',{name:'25M',download:25,fixedUpstream:0});assert.equal(speed.fixedUpstream,0);assert.equal((await api('records/speeds','POST',{name:'Invalid upstream',download:25,fixedUpstream:-1})).status,400);
  const area=await create('zones',{name:'East'}),box=await create('odbs',{name:'Box A',zoneId:area.id,capacity:2,notes:'Pole 4'}),preset=await create('presets',{name:'East auto',zoneId:area.id,odbId:box.id,namePattern:'{zone}-{pon}-{onu}'});
  assert.equal((await api('presets/default','POST',{id:preset.id})).status,200);const first=await create('devices',{name:'Original',type:'onu',serial:'AUTO001',pon:'1'});assert.equal(first.name,'East-1-AUTO001');assert.equal(first.odbPort,1);assert.equal(first.zoneId,area.id);
  const second=await create('devices',{name:'Second',type:'onu',serial:'AUTO002'});assert.equal(second.odbPort,2);const third=await create('devices',{name:'Third',type:'onu',serial:'AUTO003'});assert.equal(third.odbId,'','A full default box must not discard a discovered ONU');await api('presets/default','POST',{id:null});
  assert.equal((await api('records/devices','POST',{name:'Duplicate port',type:'onu',odbId:box.id,odbPort:1})).status,400);assert.equal((await patch('odbs',box,{capacity:1})).status,400);
  const spare=await create('odbs',{name:'One port',capacity:1}),bulkPreset=await create('presets',{name:'Bulk',odbId:spare.id}),a=await create('devices',{name:'Bulk A',type:'onu'}),b=await create('devices',{name:'Bulk B',type:'onu'});
  assert.equal((await api('presets/apply','POST',{presetId:bulkPreset.id,deviceIds:[a.id,b.id]})).status,400);assert.equal((await api('records/devices/'+a.id)).body.odbId,'','Failed bulk placement must roll back all assignments');
  const item=await create('stock',{name:'Patch cords',category:'Patch cords / pigtails',unit:'pcs',unitCost:100,initialQuantity:12});const movements=(await api('records/stockMoves')).body.filter(m=>m.stockId===item.id);assert.equal(movements.length,1);assert.equal(movements[0].quantity,12);assert.equal(movements[0].reason,'Opening stock');
  const count=(await api('records/stock')).body.length;assert.equal((await api('records/stock','POST',{name:'Invalid stock',initialQuantity:-1})).status,400);assert.equal((await api('records/stock')).body.length,count);
  const pole=await create('closures',{name:'Pole closure',closureType:'Pole',trays:0});assert.equal(pole.closureType,'Pole');const partialCable=await create('cables',{name:'Planned feeder',cableType:'Feeder',cores:24});assert.equal(partialCable.fromId,'');
 });
 await t.test('reference team roles enforce customer-only support and installer job isolation',async()=>{
  const ownerCookie=cookie,ownerCsrf=csrf,people={};for(const r of ['manager','network-technician','support','installer']){const added=await api('team','POST',{name:r,email:r+'@example.test',role:r,password:'role-test-password-123'});assert.equal(added.status,201);people[r]=added.body;}
  async function as(r){const login=await api('login','POST',{email:r+'@example.test',password:'role-test-password-123'});assert.equal(login.status,200);cookie=login.response.headers.get('set-cookie').split(';')[0];csrf=login.body.csrf;}
  const owned=await create('jobs',{title:'Installer owned',assigneeId:people.installer.id}),other=await create('jobs',{title:'Other job',assigneeId:people.manager.id});
  try{
   await as('manager');assert.equal((await api('records/zones','POST',{name:'Manager zone'})).status,201);assert.equal((await api('records/invoices')).status,403);assert.equal((await api('team','POST',{name:'Forbidden'})).status,403);
   await as('network-technician');assert.equal((await api('records/speeds','POST',{name:'Technician speed',download:50,fixedUpstream:0})).status,201);assert.equal((await api('workspace','PATCH',{name:'Forbidden'})).status,403);
   await as('support');const current=(await api('records/devices/'+router.id)).body;assert.equal((await api('records/devices/'+router.id,'PATCH',{version:current.version,customer:'Support edited customer',phone:'0700000000'})).status,200);assert.equal((await api('records/devices/'+router.id,'PATCH',{version:current.version,driver:'none'})).status,403);assert.equal((await api('records/devices','POST',{name:'Forbidden',type:'router'})).status,403);assert.equal((await api('records/jobs','POST',{title:'Support request'})).status,201);
   await as('installer');const jobs=(await api('records/jobs')).body;assert.equal(jobs.length,1);assert.equal(jobs[0].id,owned.id);assert.equal((await api('records/jobs/'+other.id)).status,403);assert.equal((await api('records/invoices')).status,403);assert.equal((await api('dashboard')).status,403);const devices=(await api('records/devices')).body;assert.ok(devices.every(d=>d.type==='olt'));assert.ok(devices.every(d=>d.endpoint===undefined));assert.equal((await api('records/jobs/'+owned.id,'PATCH',{version:owned.version,status:'In progress'})).status,200);assert.equal((await api('records/jobs/'+owned.id,'PATCH',{version:owned.version,assigneeId:people.manager.id})).status,403);assert.equal((await api('records/jobs','POST',{title:'Forbidden'})).status,403);
  }finally{cookie=ownerCookie;csrf=ownerCsrf;}
 });
 await t.test('database, sessions and encryption survive process restart; static generator is absent',async()=>{
  const before=(await api('records/jobs')).body.length;await app.close();app=createApp({dataDir:directory,collector:false});origin=await listen(app.server);assert.equal((await api('session')).body.user.email,owner.email);assert.equal((await api('records/jobs')).body.length,before);assert.equal(app.store.secret(olt.id).token,'gateway-secret-value');assert.equal((await api('records/invoices/'+invoice.id)).body.status,'Paid');
  assert.equal((await fetch(origin+'/demo-telemetry.js')).status,404);assert.equal((await fetch(origin+'/dashboard-data')).status,404);assert.equal((await fetch(origin+'/')).status,200);
 });
 await t.test('availability excludes gaps without observations',async()=>{
  const before=app.store.availability(),base=Date.now()-600000,insert=app.store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,?,?)');
  for(const [offset,online]of [[0,1],[30000,0],[60000,1],[360000,0],[390000,1]])insert.run('availability-test',base+offset,online,'{}');
  const after=app.store.availability();assert.equal(after.observed-before.observed,90000);assert.equal(after.online-before.online,30000);
 });
 }finally{await app.close();await new Promise(resolve=>fixture.close(resolve));const target=path.resolve(directory);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.match(path.basename(target),/^network-hub-test-/);fs.rmSync(target,{recursive:true,force:true});}
});
