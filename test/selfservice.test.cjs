'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs');
test('minute plans and the signed self-service account page',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ss-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'ss@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store;
  const plan=st.put('plans',radius.plan(st,{name:'Quick 90',service:'hotspot',downloadMbps:5,uploadMbps:5,price:10,durationValue:90,durationUnit:'minutes',devices:1}));
  assert.equal(radius.planMs(plan),90*60000);
  const sub=st.put('subscribers',radius.subscriber(st,{name:'Amina',username:'kne-test01',service:'hotspot',planId:plan.id,phone:'0712345678',expiresAt:Date.now()+3600000}));
  const link=await fetch(o+'/api/radius/subscribers/'+sub.id+'/self-service',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:'{}'}).then(r=>r.json());
  assert.match(link.link,/^https?:\/\/[^/]+\/[A-Za-z0-9]{7}$/,'the link is short, bit.ly style');
  const hop=await fetch(o+new URL(link.link).pathname,{redirect:'manual'});assert.equal(hop.status,302);assert.match(hop.headers.get('location'),/^\/portal\/account\.html\?t=/);
  assert.equal((await fetch(o+'/s/AAAAAAAAAA',{redirect:'manual'})).status,404);
  assert.equal((await fetch(o+'/s'+new URL(link.link).pathname,{redirect:'manual'})).status,302,'older /s/<code> links keep working');
  assert.notEqual((await fetch(o+'/ZZZZZZZ',{redirect:'manual'})).status,302,'an unknown code is not a redirect');
  const t=new URL(hop.headers.get('location'),o).searchParams.get('t');
  const me=await fetch(o+'/portal/api/me?t='+encodeURIComponent(t)).then(r=>r.json());
assert.equal(me.account,'kne-test01');assert.equal(me.status,'active');assert.ok(me.plans.some(p=>p.current&&p.duration==='90 minutes'));
  assert.equal((await fetch(o+'/portal/api/me?t='+encodeURIComponent(t.slice(0,-2)+'xx'))).status,404);
  assert.equal((await fetch(o+'/portal/account.html')).status,200);
 }finally{app.server.close();}
});
test('PPPoE dashboard data, PIN/phone hand-over to the dashboard, and customer-pressed reset',async()=>{
 const ss=require('../lib/selfservice.cjs');
 const st=new (require('../lib/store.cjs').Store)(fs.mkdtempSync(path.join(os.tmpdir(),'pp-')));
 const r=st.put('devices',{name:'HAP-NEW',type:'router',driver:'none'});st.secret('jobs:'+r.id,{h:1});
 const plan=st.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:10,price:2000,durationValue:1,durationUnit:'months'}));
 const s=st.put('subscribers',{...radius.subscriber(st,{name:'M',username:'kne-pp1',phone:'0721275260',service:'pppoe',planId:plan.id,expiresAt:Date.now()+864e5}),balance:3000});
 st.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions','s1',?,?,?)").run(JSON.stringify({username:'kne-pp1',nasName:'HAP-NEW',service:'pppoe',downloadBytes:2e9,uploadBytes:1e9,updatedAt:Date.now()}),Date.now(),Date.now());
 const v=ss.view(st,st.get('subscribers',s.id));assert.equal(v.usage.month.down,2e9);assert.equal(v.usage.all.sessions,1);assert.equal(v.planInfo.price,2000);assert.equal(v.canReset,true);assert.equal(v.usage.online,true);
 const out=ss.reset(st,st.get('subscribers',s.id));assert.equal(out.queued,true);assert.equal(st.list('routerJobs')[0].type,'disconnect');
 assert.equal(ss.reset(st,st.get('subscribers',s.id)).queued,false,'a second press while one is queued does not stack');
});
test('self-service view exposes masked recent payments and a 7-day usage series',async()=>{
 const ss=require('../lib/selfservice.cjs');
 const st=new (require('../lib/store.cjs').Store)(fs.mkdtempSync(path.join(os.tmpdir(),'pp2-')));
 const plan=st.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:10,price:2000,durationValue:1,durationUnit:'months'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'J',username:'kne-pp2',phone:'0721000111',service:'pppoe',planId:plan.id,expiresAt:Date.now()+864e5}));
 st.put('subscriberPayments',{subscriberId:s.id,amount:1500,method:'mpesa',reference:'QGR1A2B3C4',time:Date.now()-3600000});
 st.put('subscriberPayments',{subscriberId:s.id,amount:500,method:'mpesa',reference:'XYZ987',time:Date.now()-7200000});
 const v=ss.view(st,st.get('subscribers',s.id));
 assert.ok(Array.isArray(v.recentPayments));assert.equal(v.recentPayments.length,2);
 assert.equal(v.recentPayments[0].amount,1500,'most recent payment first');
 assert.equal(v.recentPayments[0].ref,'\u2022\u2022\u2022\u2022\u2022\u2022B3C4','reference is masked, keeping only the last 4 characters');
 assert.ok(Array.isArray(v.weeklyUsageMB),'weeklyUsageMB is present even with no usage data');
 assert.ok(v.weeklyUsageMB.length<=7);
});
