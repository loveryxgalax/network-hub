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
  const a=await get('/portal/api/active?mac=AA:BB:CC:DD:EE:01');assert.equal(a.body.found,true);assert.equal(a.body.trusted,false,'a MAC alone is not trusted');assert.equal(a.body.plan,'NET PLUS');assert.ok(a.body.left>20*60000);
  assert.equal((await get('/portal/api/active?mac=AA:BB:CC:DD:EE:99')).body.found,false);
  // never a plain password: needs a CHAP challenge
  assert.equal((await post('/portal/api/connect-now',{mac:'AA:BB:CC:DD:EE:01'})).status,400);
  // A forged MAC (no device secret) cannot be auto-connected, read or redeemed.
  assert.equal((await post('/portal/api/connect-now',{mac:'AA:BB:CC:DD:EE:01',chapId:'01',chapChallenge:'0a0b0c'})).status,404);
  assert.equal((await get('/portal/api/usage?mac=AA:BB:CC:DD:EE:01')).body.found,false);assert.equal((await get('/portal/api/session?mac=AA:BB:CC:DD:EE:01')).body.found,false);
  assert.equal((await post('/portal/api/login',{username:sub.username,password:'wrong',mac:'AA:BB:CC:DD:EE:01'})).status,401);
  const signed=await post('/portal/api/login',{username:sub.username,password:'pass-12345',mac:'AA:BB:CC:DD:EE:01'});assert.equal(signed.status,200);
  const dt=signed.body.dt;assert.ok(dt,'successful credential login remembers this browser');
  assert.equal((await get('/portal/api/session?mac=AA:BB:CC:DD:EE:01&dt='+dt)).body.found,true);
  assert.equal((await post('/portal/api/connect-now',{mac:'AA:BB:CC:DD:EE:01',chapId:'01',chapChallenge:'0a0b0c',dt:'wrong-secret'})).status,404);
  assert.equal((await get('/portal/api/active?mac=AA:BB:CC:DD:EE:01&dt='+dt)).body.trusted,true);
  const cn=await post('/portal/api/connect-now',{mac:'AA:BB:CC:DD:EE:01',chapId:'01',chapChallenge:'0a0b0c',dt});assert.equal(cn.status,200);assert.equal(cn.body.username,'kne-abc123');assert.equal(cn.body.chap,true);
  assert.equal((await post('/portal/api/code-login',{code:'WRONGCODE1',chapId:'01',chapChallenge:'0a0b0c'})).status,404);
  st.put('radiusSessions',{username:sub.username,mac:'AA:BB:CC:DD:EE:01',startedAt:Date.now(),updatedAt:Date.now()});
  const existing=await post('/portal/api/code-login',{code:'uk3if0tw26',mac:'AA:BB:CC:DD:EE:01',dt});assert.equal(existing.status,200);assert.equal(existing.body.alreadyConnected,true);assert.equal(existing.body.password,undefined);
  assert.equal((await post('/portal/api/code-login',{code:'uk3if0tw26',mac:'AA:BB:CC:DD:EE:01',dt:'wrong'})).status,400);
  const cl=await post('/portal/api/code-login',{code:'uk3if0tw26',chapId:'01',chapChallenge:'0a0b0c'});assert.equal(cl.status,200);assert.equal(cl.body.username,'kne-abc123');
  const u=await get('/portal/api/usage?mac=AA:BB:CC:DD:EE:01&dt='+dt);assert.equal(u.body.found,true);assert.equal(u.body.payments[0].ref.endsWith('TW26'),true);assert.ok(u.body.payments[0].ref.startsWith('•'));assert.equal(u.body.connects[0].status,'active');
  const stp=require('../lib/status.cjs');assert.match(stp.page({...stp.DEFAULTS,showPackage:true},'https://network.example.test',false,''),/id="pk"[\s\S]*\/portal\/api\/active\?mac=/);assert.doesNotMatch(stp.page({...stp.DEFAULTS},'https://network.example.test',false,''),/id="pk"/);
  const lo=require('../lib/billing.cjs');st.setting('loyalty',{enabled:true,pointsPer100:1,pointValue:2});st.put('subscribers',{...st.get('subscribers',sub.id),points:10},st.get('subscribers',sub.id));
  const us=await get('/portal/api/usage?mac=AA:BB:CC:DD:EE:01&dt='+dt);assert.equal(us.body.points,10);assert.equal(us.body.loyalty.enabled,true);
  const rd=await post('/portal/api/redeem-points',{mac:'AA:BB:CC:DD:EE:01',dt});assert.equal(rd.status,200);assert.equal(rd.body.points,0);assert.equal(rd.body.wallet,20);
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
test('admin preview token: valid for that MAC for ten minutes, forged or expired ones are refused',async()=>{
 const fs2=require('node:fs'),os2=require('node:os'),p2=require('node:path'),{Store:S}=require('../lib/store.cjs'),r2=require('../lib/radius.cjs'),hm=require('../lib/hotspotme.cjs');
 const st=new S(fs2.mkdtempSync(p2.join(os2.tmpdir(),'pv-'))),plan=st.put('plans',r2.plan({name:'P',service:'hotspot',downloadMbps:1,uploadMbps:1,price:1,durationValue:1,durationUnit:'hours'}));
 st.put('subscribers',{...r2.subscriber(st,{name:'A',username:'a1',service:'hotspot',planId:plan.id,expiresAt:Date.now()+3600000}),lastMac:'AA:BB:CC:00:00:07'});
 const t=hm.previewToken(st,'AA:BB:CC:00:00:07');assert.equal(hm.active(st,'AA:BB:CC:00:00:07',Date.now(),t).trusted,true);
 assert.equal(hm.active(st,'AA:BB:CC:00:00:08',Date.now(),t).found,false);assert.equal(hm.usage(st,'AA:BB:CC:00:00:07',Date.now(),t).found,true);
 assert.equal(hm.usage(st,'AA:BB:CC:00:00:07',Date.now(),'pv.99999999999999.forged').found,false);assert.equal(hm.usage(st,'AA:BB:CC:00:00:07',Date.now()+700000,t).found,false);
});
