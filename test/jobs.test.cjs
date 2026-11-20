'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),jobs=require('../lib/jobs.cjs'),{createApp}=require('../server.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jb-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
test('jobs: opt-in only, whitelist with validated values, typed confirmation for risky ones, retries with backoff',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'CCR',type:'router'}),now=Date.now(),u={name:'Owner'};
  assert.throws(()=>jobs.create(store,{routerId:r.id,type:'disconnect',params:{username:'ann'},user:u}),/job runner installed/);
  const {token}=jobs.enroll(store,r.id);assert.ok(jobs.validToken(store,r.id,token));assert.equal(jobs.validToken(store,r.id,'x'.repeat(43)),false);
  assert.throws(()=>jobs.create(store,{routerId:r.id,type:'disconnect',params:{username:'ann"; /system reset-configuration'},user:u}),/Invalid username/,'no injection');
  assert.throws(()=>jobs.create(store,{routerId:r.id,type:'run-anything',params:{}}),/Unknown job/);
  assert.throws(()=>jobs.create(store,{routerId:r.id,type:'reboot',confirm:'yes',user:u}),/Type the router name/);
  const j=jobs.create(store,{routerId:r.id,type:'disconnect',params:{username:'ann'},user:u},now);
  const n=jobs.next(store,r.id,now);assert.equal(n.id,j.id);assert.match(n.script,/\/ppp active remove/);assert.equal(jobs.next(store,r.id,now),null,'one job at a time');
  jobs.result(store,r.id,j.id,{ok:false,output:'boom'},now+1000);let x=store.get('routerJobs',j.id);assert.equal(x.status,'queued');assert.ok(x.nextAttemptAt>now+1000,'backoff');
  assert.equal(jobs.next(store,r.id,now+1500),null,'not before the backoff');
  const n2=jobs.next(store,r.id,x.nextAttemptAt);jobs.result(store,r.id,n2.id,{ok:true,output:'removed 1 session(s)'},x.nextAttemptAt+10);assert.equal(store.get('routerJobs',j.id).status,'succeeded');
  const rb=jobs.create(store,{routerId:r.id,type:'reboot',confirm:'CCR',user:u},now);const n3=jobs.next(store,r.id,now+5000);assert.equal(n3.id,rb.id);
  jobs.sweep(store,now+5000+6*60000);assert.equal(store.get('routerJobs',rb.id).status,'failed','risky jobs are never retried');assert.throws(()=>jobs.retry(store,rb.id),/never re-run/);
 }finally{done();}
});
test('job runner endpoints: scoped token, results mark provisioning, customer disconnect is queued on their router',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jb-app-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',radiusToken:'bridge-token-for-tests-0123456789',radiusPort:0});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 const api=async(route,method='GET',input,headers={})=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...headers},...(input===undefined?{}:{body:JSON.stringify(input)})});const t=await r.text();return {status:r.status,body:t?JSON.parse(t):{},response:r};};
 try{const owner=await api('setup','POST',{name:'Owner',workspace:'QA',email:'jobs@example.test',password:'fixture-owner-password-123'});cookie=owner.response.headers.get('set-cookie').split(';')[0];csrf=owner.body.csrf;
  const dev=(await api('records/devices','POST',{name:'CCR',type:'router',driver:'none'})).body;
  const en=await api('router-jobs/enroll','POST',{deviceId:dev.id});assert.equal(en.status,201);assert.match(en.body.script,/network-hub-jobs/);const token=en.body.script.match(/Bearer ([A-Za-z0-9_-]{43})/)[1];
  const plan=(await api('radius/plans','POST',{name:'H',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days',devices:1})).body;
  const sub=(await api('radius/subscribers','POST',{name:'Ann',username:'ann',service:'pppoe',planId:plan.id,password:'pw123456'})).body;
  assert.equal((await api('radius/subscribers/'+sub.id+'/disconnect','POST',{})).status,409,'router unknown until the customer has connected');
  app.store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions','s1',?,?,?)").run(JSON.stringify({username:'ann',nasName:'CCR',startedAt:Date.now()-1000,updatedAt:Date.now()}),Date.now(),Date.now());
  const d=await api('radius/subscribers/'+sub.id+'/disconnect','POST',{});assert.equal(d.status,201);
  const runner=h=>({Authorization:'Bearer '+h});
  assert.equal((await fetch(origin+'/api/router-jobs/next/'+dev.id,{headers:runner('x'.repeat(43))})).status,401);
  const next=await (await fetch(origin+'/api/router-jobs/next/'+dev.id,{headers:runner(token)})).json();assert.equal(next.id,d.body.job.id);
  const res=await fetch(origin+'/api/router-jobs/result/'+dev.id+'/'+next.id,{method:'POST',headers:{...runner(token),'Content-Type':'application/json'},body:JSON.stringify({ok:true,output:'removed 1 session(s)'})});assert.equal(res.status,200);
  assert.equal(app.store.get('subscribers',sub.id).provisioning.status,'ok');
  assert.equal((await api('router-jobs','POST',{routerId:dev.id,type:'reboot',confirm:'nope'})).status,400);
  assert.equal((await fetch(origin+'/portal/api/router/login.html')).status,200);
 }finally{app.server.close();app.bridge?.close?.();fs.rmSync(dir,{recursive:true,force:true});}
});
