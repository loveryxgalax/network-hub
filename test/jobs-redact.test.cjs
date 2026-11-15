'use strict';
// Router jobs: credentials never reach dashboard responses, logs or the customer profile, while the router's job runner
// still receives them (first attempt and retries). The password below is a test fixture, not a real credential.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),jobs=require('../lib/jobs.cjs');
const PW='Fixture-pw-7731';
test('connect-hotspot-device jobs: password redacted for staff, delivered to the runner, kept for retries',async()=>{
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'jr-')),collector:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'jr@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store,H={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  const get=async p=>{const r=await fetch(o+p,{headers:H});return {status:r.status,text:await r.text()};};
  const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'}),{token}=jobs.enroll(st,r.id),runner={Authorization:'Bearer '+token};
  const plan=st.put('plans',radius.plan({name:'Lab Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'}));
  const sub=st.put('subscribers',radius.subscriber(st,{name:'LAB Two Device Limit QA',username:'lab-two-device-qa',service:'hotspot',planId:plan.id,routerId:r.id,expiresAt:Date.now()+864e5}));
  radius.setPassword(st,sub.id,PW);
  // The customer page's Connect: the account's last session gives the device.
  radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':'s1','NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX','User-Name':'lab-two-device-qa','Calling-Station-Id':'AA:BB:CC:00:00:01','Framed-IP-Address':'10.5.0.20','Service-Type':'Login-User'});
  const c=await fetch(o+'/api/radius/subscribers/'+sub.id+'/connect',{method:'POST',headers:H,body:'{}'}),ct=await c.text();
  assert.equal(c.status,201,ct);assert.ok(!ct.includes(PW),'connect response has no password');assert.equal(JSON.parse(ct).job.params.password,'••••••');
  // Router jobs page (create through the generic route too).
  const q=await fetch(o+'/api/router-jobs',{method:'POST',headers:H,body:JSON.stringify({routerId:r.id,type:'connect',params:{username:'lab-two-device-qa',password:PW,mac:'AA:BB:CC:00:00:02',ip:'10.5.0.21'}})}),qt=await q.text();
  assert.equal(q.status,201,qt);assert.ok(!qt.includes(PW),'create response has no password');
  let list=await get('/api/router-jobs');assert.equal(list.status,200);assert.ok(!list.text.includes(PW),'job list has no password');
  const shown=JSON.parse(list.text).jobs.filter(j=>j.type==='connect');assert.equal(shown.length,2);assert.ok(shown.every(j=>j.params.password==='••••••'&&j.params.username==='lab-two-device-qa'));
  // The runner gets the real password in its script; the router echoes it in an error; that text is stored scrubbed.
  const first=await fetch(o+'/api/router-jobs/next/'+r.id,{headers:runner}).then(x=>x.json());assert.ok(first.script.includes(PW),'runner receives the credential');
  await fetch(o+'/api/router-jobs/result/'+r.id+'/'+first.id,{method:'POST',headers:{...runner,'Content-Type':'application/json'},body:JSON.stringify({ok:false,error:'failure: login user=lab-two-device-qa password='+PW+' rejected'})});
  const stored=st.get('routerJobs',first.id);assert.ok(!stored.error.includes(PW),'stored router error is scrubbed');assert.equal(stored.params.password,PW,'credential kept for the retry');assert.equal(stored.status,'queued');
  // Retry attempt: delivered again.
  st.put('routerJobs',{...stored,nextAttemptAt:0},stored);const again=await fetch(o+'/api/router-jobs/next/'+r.id,{headers:runner}).then(x=>x.json());
  assert.equal(again.id,first.id);assert.ok(again.script.includes(PW),'retry still delivers the credential');
  // Failed job, staff Retry: response redacted, stored credential intact.
  const cur=st.get('routerJobs',first.id);st.put('routerJobs',{...cur,status:'failed'},cur);
  const rt=await fetch(o+'/api/router-jobs/'+first.id+'/retry',{method:'POST',headers:H,body:'{}'}),rtt=await rt.text();
  assert.equal(rt.status,200,rtt);assert.ok(!rtt.includes(PW));assert.equal(st.get('routerJobs',first.id).params.password,PW);
  // Customer profile job history, system logs and audit: nothing.
  for(const p of ['/api/customers/'+sub.id+'/profile','/api/router-jobs','/api/system-logs','/api/audit']){const x=await get(p);assert.equal(x.status,200,p);assert.ok(!x.text.includes(PW),p+' has no password');}
  assert.ok(!JSON.stringify(st.db.prepare('SELECT action FROM audit').all()).includes(PW),'audit rows have no password');
 }finally{app.server.close();}
});
test('redact masks nested secret fields and their values in text, and leaves other fields alone',()=>{
 const j={type:'x',params:{username:'u1',wifi:{psk:'abc12345',ssid:'Home'},apiKey:'k-999-zz',list:[{token:'t-1-2-3'}]},output:'used abc12345 and k-999-zz',error:'',label:'Job'};
 const r=jobs.redact(j);
 assert.deepEqual(r.params,{username:'u1',wifi:{psk:'••••••',ssid:'Home'},apiKey:'••••••',list:[{token:'••••••'}]});
 assert.equal(r.output,'used •••••• and ••••••');assert.equal(j.params.wifi.psk,'abc12345','the stored job is not changed');
 assert.equal(jobs.redact(null),null);
});
