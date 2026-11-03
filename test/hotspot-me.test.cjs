'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs');
test('hotspot device flow: connect now, M-Pesa code, usage, loaders, new designs',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hm-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'hm@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store;
  const plan=st.put('plans',radius.plan(st,{name:'NET PLUS',service:'hotspot',downloadMbps:5,uploadMbps:5,price:7,durationValue:30,durationUnit:'minutes',devices:1}));
  const sub=st.put('subscribers',radius.subscriber(st,{name:'Amina',username:'kne-abc123',service:'hotspot',planId:plan.id,phone:'0712345678',expiresAt:Date.now()+25*60000}));st.put('subscribers',{...sub,lastMac:'AA:BB:CC:DD:EE:01'},sub);radius.setPassword(st,sub.id,'pass-12345');
  st.put('subscriberPayments',{subscriberId:sub.id,username:sub.username,amount:7,reference:'UK3IF0TW26',method:'mpesa',time:Date.now()-60000,planName:'NET PLUS'});
  const get=u=>fetch(o+u).then(async r=>({status:r.status,body:await r.json()})),post=(u,b)=>fetch(o+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
  const a=await get('/portal/api/active?mac=AA:BB:CC:DD:EE:01');assert.equal(a.body.found,true);assert.equal(a.body.plan,'NET PLUS');assert.ok(a.body.left>20*60000);
  assert.equal((await get('/portal/api/active?mac=AA:BB:CC:DD:EE:99')).body.found,false);
  // never a plain password: needs a CHAP challenge
  assert.equal((await post('/portal/api/connect-now',{mac:'AA:BB:CC:DD:EE:01'})).status,400);
  const cn=await post('/portal/api/connect-now',{mac:'AA:BB:CC:DD:EE:01',chapId:'01',chapChallenge:'0a0b0c'});assert.equal(cn.status,200);assert.equal(cn.body.username,'kne-abc123');assert.equal(cn.body.chap,true);
  assert.equal((await post('/portal/api/code-login',{code:'WRONGCODE1',chapId:'01',chapChallenge:'0a0b0c'})).status,404);
  const cl=await post('/portal/api/code-login',{code:'uk3if0tw26',chapId:'01',chapChallenge:'0a0b0c'});assert.equal(cl.status,200);assert.equal(cl.body.username,'kne-abc123');
  const u=await get('/portal/api/usage?mac=AA:BB:CC:DD:EE:01');assert.equal(u.body.found,true);assert.equal(u.body.payments[0].ref.endsWith('TW26'),true);assert.ok(u.body.payments[0].ref.startsWith('•'));assert.equal(u.body.connects[0].status,'active');
  // expired package: no auto connect
  st.put('subscribers',{...st.get('subscribers',sub.id),expiresAt:Date.now()-1000},st.get('subscribers',sub.id));
  assert.equal((await get('/portal/api/active?mac=AA:BB:CC:DD:EE:01')).body.found,false);
  // designs and loaders accepted and saved
  const api=(m,u,b)=>fetch(o+'/api/'+u,{method:m,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(b?{body:JSON.stringify(b)}:{})}).then(async r=>({status:r.status,body:await r.json()}));
  const cur=(await api('GET','portal/landing')).body;assert.ok(cur.themes.includes('essential')&&cur.themes.includes('together'));
  const saved=await api('PUT','portal/landing',{...cur.config,theme:'daypass',loadingStyle:'wave',loadingBg:'#0a0f24',loadingFg:'#38bdf8'});assert.equal(saved.status,200);assert.equal(saved.body.theme,'daypass');assert.equal(saved.body.loadingStyle,'wave');
  assert.equal((await api('PUT','portal/landing',{...cur.config,loadingFg:'red'})).status,400);
  assert.equal((await api('PUT','portal/status',{...(await api('GET','portal/status')).body.config,design:'boarding'})).status,200);
 }finally{app.server.close();}
});
