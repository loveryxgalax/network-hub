'use strict';
// A caller-supplied MAC address or CHAP challenge is never proof of identity: recognising, connecting or issuing a device
// secret needs the device's own secret or the account's signed session.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),hm=require('../lib/hotspotme.cjs'),self=require('../lib/selfservice.cjs');
const VICTIM='1A:84:B6:88:64:76',chap={chapId:'\\001',chapChallenge:'\\x41\\x42attacker-made'};
function mk(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'proof-')),st=new Store(dir),now=Date.now();
 const p=st.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days'}));
 const s0=st.put('subscribers',radius.subscriber(st,{name:'Victim',username:'kne-vic001',service:'hotspot',planId:p.id,expiresAt:now+864e5}));
 const s=st.put('subscribers',{...s0,lastMac:VICTIM,boundMac:VICTIM},s0);radius.setPassword(st,s.id,'4821');
 // The victim is online right now on that MAC.
 radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':'v1','NAS-IP-Address':'10.0.0.1','User-Name':'kne-vic001','Calling-Station-Id':VICTIM,'Framed-IP-Address':'10.5.0.9'},now);
 return {st,s,now,done:()=>{st.close();fs.rmSync(dir,{recursive:true,force:true});}};}
const tokens=(st,s)=>Object.keys(st.get('subscribers',s.id).devTokens||{});

test('cloned MAC: active, connect-now and connect-account give nothing and issue no device secret',()=>{
 const {st,s,now,done}=mk();try{
  assert.equal(hm.active(st,VICTIM,now,'').found,false);
  assert.throws(()=>hm.connectNow(st,{mac:VICTIM,...chap},now),e=>e.status===404);
  assert.throws(()=>hm.connectAccount(st,{account:'kne-vic001',mac:VICTIM,...chap},now),e=>e.status===403&&e.needPassword);
  assert.deepEqual(tokens(st,s),[],'no device secret was issued to the clone');
 }finally{done();}});
test('invalid, other-device and other-account secrets are refused',()=>{
 const {st,s,now,done}=mk();try{
  const real=hm.trust(st,'kne-vic001',VICTIM),otherDev=hm.trust(st,'kne-vic001','AA:AA:AA:AA:AA:01');
  for(const dt of ['forged','',real+'x',otherDev,'pv.9999999999999.bad']){
   assert.equal(hm.active(st,VICTIM,now,dt).found,false,'active '+dt);
   assert.throws(()=>hm.connectNow(st,{mac:VICTIM,dt,...chap},now),e=>e.status===404,'connect-now '+dt);
   assert.throws(()=>hm.connectAccount(st,{account:'kne-vic001',mac:VICTIM,dt,...chap},now),e=>e.status===403,'connect-account '+dt);}
  // A session for a different account does not unlock this one.
  const p=st.get('plans',s.planId),o=st.put('subscribers',radius.subscriber(st,{name:'O',username:'kne-oth001',service:'hotspot',planId:p.id,expiresAt:now+864e5}));
  assert.throws(()=>hm.connectAccount(st,{account:'kne-vic001',mac:VICTIM,st:self.token(st,o),...chap},now),e=>e.status===403);
  assert.throws(()=>hm.connectNow(st,{mac:VICTIM,st:self.token(st,o),...chap},now),e=>e.status===404);
 }finally{done();}});
test('caller-generated challenges: no CHAP answer is ever computed without proof; with proof it is a CHAP answer, never the password',()=>{
 const {st,s,now,done}=mk();try{
  for(let i=0;i<5;i++){const c={chapId:'\\00'+i,chapChallenge:'made-up-'+i};
   assert.throws(()=>hm.connectNow(st,{mac:VICTIM,...c},now));assert.throws(()=>hm.connectAccount(st,{account:'kne-vic001',mac:VICTIM,...c},now));}
  const dt=hm.trust(st,'kne-vic001',VICTIM),r=hm.connectNow(st,{mac:VICTIM,dt,...chap},now);
  assert.equal(r.chap,true);assert.notEqual(r.password,'4821');
  const viaSession=hm.connectAccount(st,{account:'kne-vic001',mac:VICTIM,st:self.token(st,s),...chap},now);assert.equal(viaSession.chap,true);assert.notEqual(viaSession.password,'4821');
 }finally{done();}});
test('the device secret and the account session are the only ways in',()=>{
 const {st,s,now,done}=mk();try{
  const dt=hm.trust(st,'kne-vic001',VICTIM);
  assert.equal(hm.active(st,VICTIM,now,dt).found,true);
  assert.equal(hm.connectNow(st,{mac:VICTIM,dt,...chap},now).username,'kne-vic001');
  assert.equal(hm.connectAccount(st,{account:'kne-vic001',mac:VICTIM,dt,...chap},now).username,'kne-vic001');
 }finally{done();}});
