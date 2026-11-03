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
  assert.match(link.link,/\/portal\/account\.html\?t=/);const t=new URL(link.link).searchParams.get('t');
  const me=await fetch(o+'/portal/api/me?t='+encodeURIComponent(t)).then(r=>r.json());
  assert.equal(me.account,'kne-test01');assert.equal(me.status,'active');assert.ok(me.plans.some(p=>p.current&&p.duration==='90 minutes'));
  assert.equal((await fetch(o+'/portal/api/me?t='+encodeURIComponent(t.slice(0,-2)+'xx'))).status,404);
  assert.equal((await fetch(o+'/portal/account.html')).status,200);
 }finally{app.server.close();}
});
