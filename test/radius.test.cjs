'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
const rest=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,{type:'string',value:[v]}]));
test('netops RADIUS decides logins, speeds and expiry, and records accounting',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-radius-')),app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test',radiusToken:'bridge-token-for-tests-0123456789'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>app.bridge.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port,bridgeOrigin='http://127.0.0.1:'+app.bridge.address().port;let cookie='',csrf='';
 const api=async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json(),response:r};};
 const ask=async(route,input,token='bridge-token-for-tests-0123456789')=>{const r=await fetch(bridgeOrigin+'/radius/'+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input)});return {status:r.status,body:r.status===204?null:await r.json()};};
 try{
  const owner=await api('setup','POST',{name:'Radius QA',workspace:'QA',email:'radius@example.test',password:'fixture-owner-password-123'});cookie=owner.response.headers.get('set-cookie').split(';')[0];csrf=owner.body.csrf;
  assert.equal((await fetch(bridgeOrigin+'/radius/authorize',{method:'POST',headers:{Authorization:'Basic '+Buffer.from('radius:bridge-token-for-tests-0123456789').toString('base64')},body:JSON.stringify(rest({'User-Name':'x'}))})).status,404,'FreeRADIUS basic auth is accepted');
  assert.equal((await ask('authorize',rest({'User-Name':'x'}),'wrong-token-wrong-token-wrong-tok')).status,401);
  assert.equal((await fetch(origin+'/radius/authorize',{method:'POST'})).status,405,'the public port never serves the bridge');
  const plan=(await api('radius/plans','POST',{name:'Home 10',service:'both',downloadMbps:10,uploadMbps:5,price:2500,durationValue:30,durationUnit:'days',devices:1})).body;assert.ok(plan.id);
  const created=await api('radius/subscribers','POST',{name:'Jane Wanjiru',username:'Jane.W',service:'pppoe',planId:plan.id,password:'secret-pass'});assert.equal(created.status,201);assert.equal(created.body.username,'jane.w');assert.equal(created.body.password,'secret-pass');
  assert.equal((await api('radius/subscribers','POST',{name:'Dup',username:'jane.w',service:'pppoe',planId:plan.id})).status,409);
  let r=await ask('authorize',rest({'User-Name':'nobody','Service-Type':'Framed-User'}));assert.equal(r.status,404);
  r=await ask('authorize',rest({'User-Name':'jane.w@kade','Service-Type':'Framed-User','Framed-Protocol':'PPP','NAS-IP-Address':'10.99.0.2'}));
  assert.equal(r.status,200);assert.equal(r.body['control:Cleartext-Password'],'secret-pass');assert.equal(r.body['reply:Mikrotik-Address-List'],'no-internet','a new subscriber starts expired until renewed');
  const renewed=(await api('radius/subscribers/'+created.body.id+'/renew','POST',{periods:1})).body;assert.ok(renewed.expiresAt>Date.now()+29*86400000);
  r=await ask('authorize',rest({'User-Name':'jane.w','Service-Type':'Framed-User'}));assert.ok(Number(r.body['reply:Session-Timeout'])>29*86400);assert.equal(r.body['reply:Mikrotik-Rate-Limit'],'5M/10M');assert.equal(r.body['reply:Mikrotik-Address-List'],undefined);
  await api('radius/subscribers/'+created.body.id,'PATCH',{expiresAt:Date.now()-1000});
  r=await ask('authorize',rest({'User-Name':'jane.w','Service-Type':'Framed-User'}));assert.equal(r.status,200,'expired PPPoE is restricted, not rejected');assert.equal(r.body['reply:Mikrotik-Address-List'],'no-internet');
  r=await ask('authorize',rest({'User-Name':'jane.w','Service-Type':'Login-User'}));assert.equal(r.status,401,'expired hotspot is rejected');
  await api('radius/subscribers/'+created.body.id,'PATCH',{status:'suspended',expiresAt:''});
  r=await ask('authorize',rest({'User-Name':'jane.w','Service-Type':'Framed-User'}));assert.equal(r.status,401);assert.equal(r.body['reply:Reply-Message'],'Account suspended');
  await api('radius/subscribers/'+created.body.id,'PATCH',{status:'active'});
  assert.equal((await ask('accounting',rest({'Acct-Status-Type':'Start','Acct-Session-Id':'81a00001','User-Name':'jane.w','NAS-IP-Address':'10.99.0.2','Framed-IP-Address':'10.40.0.9','Calling-Station-Id':'AA:BB:CC:00:11:22','Service-Type':'Framed-User'}))).status,204);
  await ask('accounting',rest({'Acct-Status-Type':'Interim-Update','Acct-Session-Id':'81a00001','User-Name':'jane.w','NAS-IP-Address':'10.99.0.2','Acct-Input-Octets':'1000','Acct-Output-Octets':'5','Acct-Output-Gigawords':'1','Acct-Session-Time':'300'}));
  let o=(await api('radius')).body;assert.equal(o.counts.online,1);assert.equal(o.sessions[0].downloadBytes,4294967301);assert.equal(o.sessions[0].uploadBytes,1000);assert.equal(o.subscribers[0].lastMac,'AA:BB:CC:00:11:22');assert.equal(o.sessions[0].ip,'10.40.0.9');assert.equal(o.sessions[0].service,'pppoe');assert.equal(o.subscribers[0].password,undefined,'overview never includes passwords');
  await ask('accounting',rest({'Acct-Status-Type':'Stop','Acct-Session-Id':'81a00001','User-Name':'jane.w','NAS-IP-Address':'10.99.0.2','Acct-Terminate-Cause':'User-Request'}));
  o=(await api('radius')).body;assert.equal(o.counts.online,0);assert.ok(o.log.some(l=>l.result==='reject'&&l.reason==='Account suspended'));
  const hotspotPlan=(await api('radius/plans','POST',{name:'Daily',service:'hotspot',downloadMbps:3,uploadMbps:1,price:50,durationValue:1,durationUnit:'days'})).body;
  const h=(await api('radius/subscribers','POST',{name:'Guest',username:'guest1',service:'hotspot',planId:hotspotPlan.id})).body;assert.ok(h.password.length>=6,'a password is generated when none is given');
  r=await ask('authorize',rest({'User-Name':'guest1','Service-Type':'Framed-User'}));assert.equal(r.status,401,'hotspot plans cannot log in over PPPoE');
  assert.equal((await api('radius/plans/'+plan.id,'DELETE')).status,409);
  assert.equal((await api('radius/subscribers/'+h.id+'/password')).body.password,h.password);
 }finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('ISPman-style CSV imports preview first and save all or nothing',()=>{
 const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'network-import-')),store=new Store(dir);
 try{store.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2500,durationValue:30,durationUnit:'days'}));
  const good='﻿Full Name,Username,Password,Phone,Package,Expiry Date\n"Wanjiru, Jane",Jane@kade,pass1234,0712345678,home 10,2026-11-30\nPeter,peter,secret99,,Home 10,\n';
  const preview=radius.importCsv(store,good);assert.equal(preview.create,2);assert.equal(preview.errors,0);assert.equal(preview.committed,false);assert.equal(store.list('subscribers').length,0,'preview saves nothing');
  const bad=good+'Ann,ann,pw123456,,Gold,2026-11-30\n';const r=radius.importCsv(store,bad,true);assert.equal(r.errors,1);assert.match(r.rows[2].error,/No plan named "Gold"/);assert.equal(store.list('subscribers').length,0,'one bad row saves nothing');
  const done=radius.importCsv(store,good,true);assert.equal(done.committed,true);const jane=store.list('subscribers').find(s=>s.username==='jane');
  assert.equal(jane.name,'Wanjiru, Jane');assert.equal(radius.password(store,jane.id),'pass1234');assert.equal(new Date(jane.expiresAt).toISOString(),'2026-11-30T20:59:00.000Z');
  const again=radius.importCsv(store,'username,plan,expires\njane,Home 10,2026-12-31\n',true);assert.equal(again.update,1);assert.equal(radius.password(store,jane.id),'pass1234','updates keep the password when the column is empty');
  assert.throws(()=>radius.importCsv(store,'name,phone\nx,1\n'),/username and plan/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
