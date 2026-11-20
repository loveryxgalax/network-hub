'use strict';
// End-to-end over HTTP: an attacker on the WiFi who copies a paying customer's MAC address and makes up CHAP challenges
// tries every step of the takeover chain (recognition, connect-now, connect-account, account lookup, device secret,
// account page, TV registration). Every step must fail without independent proof, and the victim's account is unchanged.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),self=require('../lib/selfservice.cjs');
const VICTIM='1A:84:B6:88:64:76',ATTACKER='AA:AA:AA:00:00:66',chap={chapId:'01',chapChallenge:'0a0b0c0d'};
test('HTTP takeover chain: cloned MAC + made-up challenge + forged secrets get nothing; real proof still works',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chain-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const st=app.store,now=Date.now();
  const plan=st.put('plans',radius.plan(st,{name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days',devices:2}));
  // Victim has no phone on file (the weakest case), is the last user of VICTIM and is online on it now.
  const v0=st.put('subscribers',radius.subscriber(st,{name:'Victim',username:'kne-vic001',service:'hotspot',planId:plan.id,expiresAt:now+864e5}));
  const v=st.put('subscribers',{...v0,lastMac:VICTIM,boundMac:VICTIM},v0);radius.setPassword(st,v.id,'pass-48213');
  radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':'v1','NAS-IP-Address':'10.0.0.1','User-Name':'kne-vic001','Calling-Station-Id':VICTIM,'Framed-IP-Address':'10.5.0.9'},now);
  // The attacker has a real account of their own.
  const atk=st.put('subscribers',radius.subscriber(st,{name:'Attacker',username:'kne-atk001',service:'hotspot',planId:plan.id,phone:'0799000000',expiresAt:now+864e5}));
  const get=u=>fetch(o+u).then(async r=>({status:r.status,body:await r.json()}));
  const post=(u,b)=>fetch(o+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
  const before=JSON.stringify({...st.get('subscribers',v.id),version:0,updatedAt:0});
  // 1. Recognition by MAC (with and without forged secrets).
  for(const dt of ['','forged','pv.9999999999999.x'])assert.equal((await get('/portal/api/active?mac='+VICTIM+'&dt='+dt)).body.found,false,'active '+dt);
  assert.equal((await get('/portal/api/session?mac='+VICTIM)).body.found,false);assert.equal((await get('/portal/api/usage?mac='+VICTIM)).body.found,false);
  // 2. One-tap connect with a made-up challenge.
  assert.equal((await post('/portal/api/connect-now',{mac:VICTIM,...chap})).status,404);
  assert.equal((await post('/portal/api/connect-now',{mac:VICTIM,dt:'forged',...chap})).status,404);
  // 3. Connect from the account by its number.
  const ca=await post('/portal/api/connect-account',{account:'kne-vic001',mac:VICTIM,...chap});assert.equal(ca.status,403);assert.equal(ca.body.password,undefined);
  assert.equal((await post('/portal/api/connect-account',{account:'kne-vic001',mac:VICTIM,st:self.token(st,atk),...chap})).status,403,'another account\'s session');
  // 4. Account lookup from the cloned MAC: no device secret, no account-page link.
  for(const extra of [{},{dt:'forged'}]){const lk=await post('/portal/api/account',{query:'kne-vic001',mac:VICTIM,...extra});assert.equal(lk.body.dt,undefined,'no device secret');assert.equal(lk.body.link,undefined,'no account page');}
  // 5. Account page and TV registration with forged or foreign tokens.
  assert.equal((await post('/portal/api/me/tv',{t:'forged.token',mac:ATTACKER,name:'TV'})).status,404);
  assert.equal((await get('/portal/api/me?t=forged.token')).status,404);
  // 6. Registering the victim's device as a "TV" on the attacker's own account is refused.
  const tv=await post('/portal/api/me/tv',{t:self.token(st,atk),mac:VICTIM,name:'TV'});assert.equal(tv.status,409);
  // Nothing about the victim changed: no device secret, no TV, same password.
  assert.equal(JSON.stringify({...st.get('subscribers',v.id),version:0,updatedAt:0}),before);assert.equal(radius.password(st,v.id),'pass-48213');
  assert.ok(!(st.get('subscribers',atk.id).tvs||[]).length);
  // 7. Real proof still works: the password signs the device in and gives it a secret; that secret then opens the chain.
  const signed=await post('/portal/api/login',{username:'kne-vic001',password:'pass-48213',mac:VICTIM});assert.equal(signed.status,200);const dt=signed.body.dt;assert.ok(dt);
  assert.equal((await get('/portal/api/active?mac='+VICTIM+'&dt='+encodeURIComponent(dt))).body.found,true);
  assert.equal((await post('/portal/api/connect-now',{mac:VICTIM,dt,...chap})).status,200);
  const lk=await post('/portal/api/account',{query:'kne-vic001',mac:VICTIM,dt});assert.ok(lk.body.link,'proved device gets the account page');
  const t=decodeURIComponent(/[?&]t=([^&]+)/.exec(lk.body.link)[1]);
  assert.equal((await post('/portal/api/me/tv',{t,mac:'BB:BB:BB:00:00:01',name:'Living room'})).status,200,'a new TV on the proved account');
 }finally{await new Promise(r=>app.server.close(r));app.store.close?.();fs.rmSync(dir,{recursive:true,force:true});}
});
