'use strict';
// QA findings against ecc3338: a wrong password used up a voucher; customer logout left copied links working; a password
// change left old links and device secrets working; a removed TV kept its device secret.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('../server.cjs'),{Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),vouchers=require('../lib/vouchers.cjs'),portal=require('../lib/portal.cjs'),self=require('../lib/selfservice.cjs'),hm=require('../lib/hotspotme.cjs');
const chap={chapId:'01',chapChallenge:'0a0b0c0d'};
function store(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rev-')),st=new Store(dir);return {st,done:()=>{st.close();fs.rmSync(dir,{recursive:true,force:true});}};}
async function app(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'revh-')),a=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});await new Promise(r=>a.server.listen(0,'127.0.0.1',r));
 const o='http://127.0.0.1:'+a.server.address().port,j=async r=>({status:r.status,body:await r.json().catch(()=>({}))});
 return {st:a.store,get:u=>fetch(o+u).then(j),post:(u,b)=>fetch(o+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(j),done:async()=>{await new Promise(r=>a.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};}
const hotPlan=st=>st.put('plans',radius.plan({name:'Hour',service:'hotspot',downloadMbps:5,uploadMbps:5,price:20,durationValue:1,durationUnit:'hours',devices:3}));
const voucher=st=>{const p=hotPlan(st);return vouchers.generate(st,{planId:p.id,count:1,length:8,name:'QA'},{email:'qa@x'}).codes[0];};
const vState=(st,code)=>st.list('vouchers').find(v=>v.code===code);

test('1. a wrong password leaves an unused voucher unused (portal and RADIUS PAP/CHAP); the right one then redeems it once',()=>{
 const {st,done}=store();try{const code=voucher(st),u=code.toLowerCase();
  assert.throws(()=>portal.login(st,{username:code,password:'wrong-pass'}),e=>e.status===401);
  assert.equal(radius.authorize(st,{'User-Name':u,'User-Password':'nope','Calling-Station-Id':'AA:00:00:00:00:01','NAS-IP-Address':'10.0.0.1'}).status,404);
  const badChap=Buffer.concat([Buffer.from([1]),crypto.createHash('md5').update(Buffer.concat([Buffer.from([1]),Buffer.from('nope'),Buffer.from('abcd')])).digest()]);
  assert.equal(radius.authorize(st,{'User-Name':u,'CHAP-Password':'0x'+badChap.toString('hex'),'CHAP-Challenge':'0x'+Buffer.from('abcd').toString('hex'),'Calling-Station-Id':'AA:00:00:00:00:01','NAS-IP-Address':'10.0.0.1'}).status,404);
  assert.equal(vState(st,code).status,'unused');assert.equal(vState(st,code).usedAt,undefined);assert.equal(st.subscriberByUsername(u),null,'no account created, no expiry started');
  const goodChap=Buffer.concat([Buffer.from([1]),crypto.createHash('md5').update(Buffer.concat([Buffer.from([1]),Buffer.from(u),Buffer.from('abcd')])).digest()]);
  assert.equal(radius.authorize(st,{'User-Name':u,'CHAP-Password':'0x'+goodChap.toString('hex'),'CHAP-Challenge':'0x'+Buffer.from('abcd').toString('hex'),'Calling-Station-Id':'AA:00:00:00:00:01','NAS-IP-Address':'10.0.0.1'}).status,200);
  assert.equal(vState(st,code).status,'used');
  // The portal login with the right code now uses that same account (no second redemption).
  const r=portal.login(st,{username:code,password:code});assert.equal(r.username,u);assert.equal(st.list('subscribers').filter(s=>s.username===u).length,1);
 }finally{done();}});
test('1b. concurrent logins: wrong ones change nothing, right ones redeem exactly once',async()=>{
 const a=await app();try{const code=voucher(a.st);
  const wrong=await Promise.all([1,2,3,4,5].map(i=>a.post('/portal/api/login',{username:code,password:'bad'+i})));assert.ok(wrong.every(r=>r.status===401));assert.equal(vState(a.st,code).status,'unused');
  const right=await Promise.all([1,2,3,4,5].map(()=>a.post('/portal/api/login',{username:code,password:code})));assert.ok(right.every(r=>r.status===200),JSON.stringify(right.map(r=>r.status)));
  assert.equal(a.st.list('subscribers').filter(s=>s.username===code.toLowerCase()).length,1);const v=vState(a.st,code);assert.equal(v.status,'used');
 }finally{await a.done();}});
test('1c. a failure inside redemption rolls back: voucher stays unused and no account is left behind',()=>{
 const {st,done}=store();try{const code=voucher(st),orig=radius.setPassword;radius.setPassword=()=>{throw new Error('disk full');};
  try{assert.throws(()=>portal.login(st,{username:code,password:code}),/disk full/);}finally{radius.setPassword=orig;}
  assert.equal(vState(st,code).status,'unused');assert.equal(st.subscriberByUsername(code.toLowerCase()),null);
  assert.equal(portal.login(st,{username:code,password:code}).username,code.toLowerCase(),'retry succeeds');
 }finally{done();}});

function customer(st){const p=hotPlan(st),s=st.put('subscribers',{...radius.subscriber(st,{name:'Ann',username:'kne-ann001',service:'hotspot',planId:p.id,phone:'0712000111',expiresAt:Date.now()+864e5}),balance:70});radius.setPassword(st,s.id,'old-pass-1');
 st.put('subscriberPayments',{subscriberId:s.id,amount:20,reference:'UK1PAY0001',time:Date.now()-1000});return s;}
test('2. customer logout revokes the session on the server: copied links and other tabs stop working; new login works',async()=>{
 const a=await app();try{const s=customer(a.st),t=self.token(a.st,s),dt=hm.trust(a.st,s.username,'AA:00:00:00:00:07'),other=self.token(a.st,s);
  radius.accounting(a.st,{'Acct-Status-Type':'Start','Acct-Session-Id':'w1','NAS-IP-Address':'10.0.0.1','User-Name':s.username,'Calling-Station-Id':'AA:00:00:00:00:07'});
  assert.equal((await a.get('/portal/api/me?t='+encodeURIComponent(t))).status,200);
  assert.equal((await a.post('/portal/api/me/logout',{t,dt})).status,200);assert.equal((await a.post('/portal/api/me/logout',{t,dt})).status,200,'retry is harmless');
  for(let tab=0;tab<3;tab++)assert.equal((await a.get('/portal/api/me?t='+encodeURIComponent(t))).status,404,'copied link / tab '+tab);
  assert.equal((await a.post('/portal/api/me/tv',{t,mac:'BB:00:00:00:00:01'})).status,404);
  assert.equal(hm.active(a.st,'AA:00:00:00:00:07',Date.now(),dt).found,false,'this browser\'s device secret is forgotten');
  assert.equal((await a.get('/portal/api/me?t='+encodeURIComponent(other))).status,200,'another device\'s session is not logged out');
  assert.ok(!a.st.sessionsOf(s.username,0)[0].stoppedAt,'logout does not disconnect the WiFi');
  const fresh=self.token(a.st,a.st.get('subscribers',s.id));assert.equal((await a.get('/portal/api/me?t='+encodeURIComponent(fresh))).status,200,'signing in again works');
  // A link issued before session ids existed: logout ends all of that account's sessions.
  const legacyBody=Buffer.from(JSON.stringify({s:s.id,e:Date.now()+864e5})).toString('base64url'),legacy=legacyBody+'.'+crypto.createHmac('sha256',self.key(a.st)).update(legacyBody).digest('base64url').slice(0,32);
  assert.equal((await a.get('/portal/api/me?t='+encodeURIComponent(legacy))).status,200);await a.post('/portal/api/me/logout',{t:legacy});
  assert.equal((await a.get('/portal/api/me?t='+encodeURIComponent(legacy))).status,404);
  assert.match(fs.readFileSync(path.join(__dirname,'../portal/account.js'),'utf8'),/onclick=\(\)=>\{signOut\(\);/,'the Log Out button calls the server');
 }finally{await a.done();}});
test('3. a password change ends old account links and device secrets; the new password works; money and package untouched',async()=>{
 const a=await app();try{const s=customer(a.st),t=self.token(a.st,s),dt=hm.trust(a.st,s.username,'AA:00:00:00:00:08');
  const before=a.st.get('subscribers',s.id);radius.setPassword(a.st,s.id,'new-pass-2');
  assert.equal((await a.get('/portal/api/me?t='+encodeURIComponent(t))).status,404);
  assert.equal(hm.active(a.st,'AA:00:00:00:00:08',Date.now(),dt).found,false);assert.throws(()=>hm.connectNow(a.st,{mac:'AA:00:00:00:00:08',dt,...chap}),e=>e.status===404);
  assert.equal((await a.post('/portal/api/login',{username:s.username,password:'old-pass-1'})).status,401);
  const ok=await a.post('/portal/api/login',{username:s.username,password:'new-pass-2',mac:'AA:00:00:00:00:08'});assert.equal(ok.status,200);assert.ok(ok.body.dt);
  assert.equal(hm.active(a.st,'AA:00:00:00:00:08',Date.now(),ok.body.dt).found,true,'new secret works');
  const after=a.st.get('subscribers',s.id);assert.equal(after.balance,before.balance);assert.equal(after.expiresAt,before.expiresAt);assert.equal(after.planId,before.planId);
  assert.equal(a.st.list('subscriberPayments').length,1);assert.equal(radius.setPassword(a.st,s.id,'new-pass-2'),'new-pass-2');
  assert.equal(hm.active(a.st,'AA:00:00:00:00:08',Date.now(),ok.body.dt).found,true,'setting the same password again revokes nothing');
 }finally{await a.done();}});
test('4. a removed TV can no longer log in with its old device secret or its MAC; history and other devices are kept',()=>{
 const {st,done}=store();try{const s=customer(st),TV='CC:00:00:00:00:01',PHONE='AA:00:00:00:00:09';
  self.addTv(st,st.get('subscribers',s.id),{mac:TV,name:'Lounge'});const tvDt=hm.trust(st,s.username,TV),phoneDt=hm.trust(st,s.username,PHONE);
  radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':'tv1','NAS-IP-Address':'10.0.0.1','User-Name':TV.toLowerCase(),'Calling-Station-Id':TV});
  assert.equal(hm.connectNow(st,{mac:TV,dt:tvDt,...chap}).username,s.username);
  const r=self.removeTv(st,st.get('subscribers',s.id),TV);assert.equal(r.tvStillOnline,true,'an open router session is reported, not silently assumed gone');
  assert.throws(()=>hm.connectNow(st,{mac:TV,dt:tvDt,...chap}),e=>e.status===404,'old TV secret refused');
  assert.equal(hm.active(st,TV,Date.now(),tvDt).found,false);
  assert.equal(radius.authorize(st,{'User-Name':TV.toLowerCase(),'Calling-Station-Id':TV,'NAS-IP-Address':'10.0.0.1'}).status,404,'TV MAC login refused');
  assert.equal(hm.connectNow(st,{mac:PHONE,dt:phoneDt,...chap}).username,s.username,'the phone keeps its access');
  assert.equal(st.sessionsOf(TV.toLowerCase(),0).length,1,'TV history kept');
 }finally{done();}});
test('3b. password change is atomic: if revoking sessions fails, the old password and sessions stay exactly as they were',()=>{
 const {st,done}=store();try{const s=customer(st),t=self.token(st,s),dt=hm.trust(st,s.username,'AA:00:00:00:00:0A');
  const put=st.put.bind(st);let armed=true;st.put=(kind,...rest)=>{if(armed&&kind==='subscribers'){armed=false;throw new Error('write failed');}return put(kind,...rest);};
  try{assert.throws(()=>radius.setPassword(st,s.id,'new-pass-9'),/write failed/);}finally{st.put=put;}
  assert.equal(radius.password(st,s.id),'old-pass-1','password not changed');
  assert.ok(self.subscriberOf(st,t),'old session still valid (nothing half-applied)');assert.equal(hm.active(st,'AA:00:00:00:00:0A',Date.now(),dt).found,true);
  radius.setPassword(st,s.id,'new-pass-9');assert.equal(radius.password(st,s.id),'new-pass-9');assert.equal(self.subscriberOf(st,t),null,'retry applies both together');
 }finally{done();}});
test('2b. retrying a logout of an already-invalid session changes nothing (legacy and current links)',()=>{
 const {st,done}=store();try{const s=customer(st);
  const legacyBody=Buffer.from(JSON.stringify({s:s.id,e:Date.now()+864e5})).toString('base64url'),legacy=legacyBody+'.'+crypto.createHmac('sha256',self.key(st)).update(legacyBody).digest('base64url').slice(0,32);
  self.logout(st,legacy);const fresh=self.token(st,st.get('subscribers',s.id));assert.ok(self.subscriberOf(st,fresh));
  const epoch=st.get('subscribers',s.id).sessionEpoch;
  for(let i=0;i<3;i++)self.logout(st,legacy);
  assert.equal(st.get('subscribers',s.id).sessionEpoch,epoch,'epoch not raised again');assert.ok(self.subscriberOf(st,fresh),'the new session survives the retries');
  // A current-format link from before a password change is also a no-op when logged out late.
  const older=self.token(st,st.get('subscribers',s.id));radius.setPassword(st,s.id,'pw-after-1');const newest=self.token(st,st.get('subscribers',s.id));
  self.logout(st,older);self.logout(st,older);assert.ok(self.subscriberOf(st,newest));
  self.logout(st,newest);self.logout(st,newest);assert.equal(self.subscriberOf(st,newest),null);
 }finally{done();}});
test('4b. removing a TV that is online sends its router a disconnect for that device only; without a job runner it says so',()=>{
 const {st,done}=store();try{const jobs=require('../lib/jobs.cjs'),s=customer(st),TV='CC:00:00:00:00:02',PHONE='AA:00:00:00:00:0B';
  const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});
  self.addTv(st,st.get('subscribers',s.id),{mac:TV,name:'Lounge'});
  const start=(user,mac,id)=>radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':id,'NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX','User-Name':user,'Calling-Station-Id':mac});
  start(TV.toLowerCase(),TV,'tv2');start(s.username,PHONE,'ph2');
  // No job runner on the router: nothing is queued and the result says the session ends at its next login.
  let out=self.removeTv(st,st.get('subscribers',s.id),TV);assert.equal(out.tvStillOnline,true);assert.match(out.tvDisconnect,/no job runner/);assert.equal(st.list('routerJobs').length,0);
  // With the job runner: one reset-device job for the TV's MAC, nothing for the phone.
  self.addTv(st,st.get('subscribers',s.id),{mac:TV,name:'Lounge'});jobs.enroll(st,r.id);
  out=self.removeTv(st,st.get('subscribers',s.id),TV);assert.equal(out.tvDisconnect,'disconnect sent to the router');
  const q=st.list('routerJobs').filter(j=>j.type==='reset-device');assert.equal(q.length,1,JSON.stringify(st.list('routerJobs').map(j=>j.type+':'+JSON.stringify(j.params))));assert.equal(q[0].params.mac,TV);assert.equal(q[0].routerId,r.id);
  assert.ok(!st.sessionsOf(TV.toLowerCase(),0)[0].stoppedAt,'accounting is not edited: the Stop comes from the router');
  // A TV that is not online queues nothing.
  self.addTv(st,st.get('subscribers',s.id),{mac:'CC:00:00:00:00:03',name:'Spare'});out=self.removeTv(st,st.get('subscribers',s.id),'CC:00:00:00:00:03');assert.equal(out.tvDisconnect,'not online');assert.equal(st.list('routerJobs').filter(j=>j.type==='reset-device').length,1);
 }finally{done();}});
test('9. campaigns: every audience the server offers has a label on the page',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../dist/ispmenu.js'),'utf8'),m=/const labels=\{(all:'Everyone'[^}]*)\}/.exec(src);assert.ok(m);
 const keys=[...m[1].matchAll(/(\w+):'/g)].map(x=>x[1]);for(const seg of require('../lib/campaigns.cjs').SEGMENTS)assert.ok(keys.includes(seg),'label for '+seg);});
