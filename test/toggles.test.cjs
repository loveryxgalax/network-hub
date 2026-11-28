'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('on/off switches flip only `active` for adverts and SMS templates',async()=>{
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'tg-')),collector:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'tg@example.test',password:'fixture-owner-password-123'})});
  const H={'Content-Type':'application/json',Cookie:owner.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await owner.json()).csrf},st=app.store;
  const post=p=>fetch(o+p,{method:'POST',headers:H,body:'{}'}).then(async r=>({status:r.status,body:await r.json()}));
  const ad=st.put('ads',{title:'Test ad',text:'x',active:false,views:7,seconds:15});
  let r=await post('/api/engage/ads/'+ad.id+'/toggle');assert.equal(r.status,200);assert.equal(r.body.active,true);assert.equal(st.get('ads',ad.id).views,7);
  r=await post('/api/engage/ads/'+ad.id+'/toggle');assert.equal(r.body.active,false);
  const t=require('../lib/billing.cjs').saveLibrary(st,{name:'Kade Support',content:'hi {name}',active:false});
  r=await post('/api/sms-templates/'+t.id+'/toggle');assert.equal(r.status,200);assert.equal(r.body.active,true);
  const saved=require('../lib/billing.cjs').library(st).find(x=>x.id===t.id);assert.equal(saved.content,'hi {name}');assert.equal(saved.active,true);
  assert.equal((await post('/api/sms-templates/00000000-0000-0000-0000-000000000000/toggle')).status,404);
 }finally{app.server.close();}
});
