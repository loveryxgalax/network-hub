'use strict';
// Regression tests for refund (14-16) and reversed-payment (17-18) findings.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),ledger=require('../lib/ledger.cjs'),payouts=require('../lib/payouts.cjs'),mpesa=require('../lib/mpesa.cjs'),hm=require('../lib/hotspotme.cjs');
const admin={id:'a1',email:'a@x.test',role:'admin'};
function fx(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'refund-')),store=new Store(dir);mpesa._reset();
 store.secret('mpesa:config',{env:'sandbox',type:'paybill',shortcode:'600000',consumerKey:'k',consumerSecret:'s',passkey:'p',callbackSecret:'c'.repeat(32),c2bSecret:'d'.repeat(32)});
 payouts.setB2c(store,{initiatorName:'apiop',shortcode:'600000',securityCredential:'X'.repeat(300)});
 const plan=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:10,price:1000,durationValue:30,durationUnit:'days'}));
 const s=store.put('subscribers',{...radius.subscriber(store,{name:'E',username:'e1',service:'pppoe',planId:plan.id}),balance:500});
 return {store,s,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};}
const tokenOr=(fn)=>async(url,o)=>url.includes('oauth')?new Response(JSON.stringify({access_token:'t',expires_in:3599})):fn(JSON.parse(o.body));
const ok=b=>new Response(JSON.stringify({ResponseCode:'0',ConversationID:'AG_'+b.OriginatorConversationID}));
const approved=(store,s,amount=200)=>{const x=payouts.request(store,{kind:'refund',subscriberId:s.id,amount,reason:'service ended',to:'0712345678',method:'mpesa-b2c'},admin);payouts.approve(store,x.id,admin);return x;};
const bal=(store,s)=>store.get('subscribers',s.id).balance;
const paidEntries=(store,id)=>store.list('ledger').filter(e=>e.payoutId===id&&e.type==='refund').length;

test('14. a success that arrives after a queue timeout is booked once; the wallet is not credited back',async()=>{
 const {store,s,done}=fx();try{let oc;const x=approved(store,s);
  await payouts.send(store,x.id,admin,'https://n.test',tokenOr(b=>{oc=b.OriginatorConversationID;return ok(b);}));
  payouts.result(store,{Result:{OriginatorConversationID:oc}},true);
  assert.equal(bal(store,s),300,'timeout keeps the money held');assert.equal(store.get('payouts',x.id).status,'sent');
  payouts.result(store,{Result:{ResultCode:0,OriginatorConversationID:oc,TransactionID:'QKX1LATE01'}});
  payouts.result(store,{Result:{ResultCode:0,OriginatorConversationID:oc,TransactionID:'QKX1LATE01'}});
  const f=store.get('payouts',x.id);assert.equal(f.status,'paid');assert.equal(f.reference,'QKX1LATE01');assert.equal(bal(store,s),300);assert.equal(paidEntries(store,x.id),1);
  assert.equal(ledger.verify(store).ok,true);
 }finally{done();}});
test('14b. a payout that older code failed on timeout (hold released) is re-held when the late success comes',()=>{
 const {store,s,done}=fx();try{const x=store.put('payouts',{kind:'refund',method:'mpesa-b2c',to:'254712345678',subscriberId:s.id,source:'wallet',amountMinor:20000,amount:200,reason:'r',status:'failed',error:'M-Pesa timed out; check the org portal before retrying',originatorConversationId:'NHOLD1',history:[]});
  payouts.result(store,{Result:{ResultCode:0,OriginatorConversationID:'NHOLD1',TransactionID:'QKX1LATE02'}});
  assert.equal(store.get('payouts',x.id).status,'paid');assert.equal(bal(store,s),300,'credit taken back once');
  payouts.result(store,{Result:{ResultCode:0,OriginatorConversationID:'NHOLD1',TransactionID:'QKX1LATE02'}});assert.equal(bal(store,s),300);assert.equal(paidEntries(store,x.id),1);
 }finally{done();}});
test('14c. a failure after a timeout releases the hold once',async()=>{
 const {store,s,done}=fx();try{let oc;const x=approved(store,s);
  await payouts.send(store,x.id,admin,'https://n.test',tokenOr(b=>{oc=b.OriginatorConversationID;return ok(b);}));
  payouts.result(store,{Result:{OriginatorConversationID:oc}},true);
  payouts.result(store,{Result:{ResultCode:2001,ResultDesc:'Bad',OriginatorConversationID:oc}});payouts.result(store,{Result:{ResultCode:2001,ResultDesc:'Bad',OriginatorConversationID:oc}});
  assert.equal(store.get('payouts',x.id).status,'failed');assert.equal(bal(store,s),500);
 }finally{done();}});
test('15. the result arriving before the send response is kept; a dropped response never releases confirmed money',async()=>{
 const {store,s,done}=fx();try{
  const x=approved(store,s);
  const r=await payouts.send(store,x.id,admin,'https://n.test',tokenOr(b=>{payouts.result(store,{Result:{ResultCode:0,OriginatorConversationID:b.OriginatorConversationID,TransactionID:'QKX1EARLY1'}});return ok(b);}));
  assert.equal(store.get('payouts',x.id).status,'paid');assert.equal(r.status,'paid');assert.equal(bal(store,s),300);
  const y=approved(store,s,100);
  await payouts.send(store,y.id,admin,'https://n.test',tokenOr(b=>{payouts.result(store,{Result:{ResultCode:0,OriginatorConversationID:b.OriginatorConversationID,TransactionID:'QKX1EARLY2'}});throw new Error('socket hang up');}));
  assert.equal(store.get('payouts',y.id).status,'paid');assert.equal(bal(store,s),200,'paid refund not credited back');
  const z=approved(store,s,50);
  await payouts.send(store,z.id,admin,'https://n.test',tokenOr(()=>{throw new Error('socket hang up');}));
  const zz=store.get('payouts',z.id);assert.equal(zz.status,'sent','unknown outcome stays held');assert.equal(zz.uncertain,true);assert.equal(bal(store,s),150);
  assert.equal(ledger.verify(store).ok,true);
 }finally{done();}});
test('16. an M-Pesa refund must be whole shillings: KSh 100.49 is refused, not sent as 100',async()=>{
 const {store,s,done}=fx();try{
  assert.throws(()=>payouts.request(store,{kind:'refund',subscriberId:s.id,amount:100.49,reason:'service ended',to:'0712345678',method:'mpesa-b2c'},admin),/whole shillings/);
  const m=payouts.request(store,{kind:'refund',subscriberId:s.id,amount:100.49,reason:'service ended',to:'cash',method:'manual'},admin);assert.equal(m.amountMinor,10049);
 }finally{done();}});
function hs(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rev-')),st=new Store(dir);
 const plan=st.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',{...radius.subscriber(st,{name:'Ann',username:'ann',service:'hotspot',planId:plan.id,expiresAt:Date.now()+864e5}),lastMac:'AA:BB:CC:00:00:02'});radius.setPassword(st,s.id,'secret123');
 const p=st.put('subscriberPayments',{subscriberId:s.id,amount:50,reference:'UK3IF0TW26',planName:'Day',time:Date.now()-1000});
 const p2=st.put('subscriberPayments',{subscriberId:s.id,amount:50,reference:'UK3IF0GOOD',planName:'Day',time:Date.now()-500});
 st.put('portalPayments',{kind:'hotspot',status:'paid',subscriberId:s.id,username:'ann',receipt:'UK3IF0TW26',mpesaReceipt:'UK3IF0TW26',amount:50});
 return {st,s,p,p2,done:()=>{st.close();fs.rmSync(dir,{recursive:true,force:true});}};}
test('17. a reversed M-Pesa code cannot sign a device in; the account and its other codes still work',()=>{
 const {st,s,p,done}=hs();try{
  ledger.reverse(st,radius,p.id,{reason:'chargeback',confirm:'UK3IF0TW26',rollbackExpiry:false,user:admin});
  const login=code=>hm.codeLogin(st,{code,mac:'AA:BB:CC:00:00:02',chapId:'\\001',chapChallenge:'\\002'});
  assert.throws(()=>login('UK3IF0TW26'),/could not connect/);
  assert.ok(login('UK3IF0GOOD').mode,'valid code still connects');
  assert.ok(st.get('subscribers',s.id).expiresAt>Date.now(),'entitlement kept');assert.ok(radius.password(st,s.id));
 }finally{done();}});
test('18. usage history labels a reversed payment and does not count it as a purchase',()=>{
 const {st,s,p,done}=hs();try{
  ledger.reverse(st,radius,p.id,{reason:'chargeback',confirm:'UK3IF0TW26',rollbackExpiry:false,user:admin});
  const tok=hm.trust(st,'ann','AA:BB:CC:00:00:02'),u=hm.usage(st,'AA:BB:CC:00:00:02',Date.now(),tok);
  assert.equal(u.payments.length,2);assert.equal(u.payments.find(x=>x.ref.endsWith('TW26')).reversed,true);assert.equal(u.payments.find(x=>x.ref.endsWith('GOOD')).reversed,undefined);
  assert.equal(u.connects.length,1,'only the valid purchase is a connect/purchase row');
  assert.match(fs.readFileSync(path.join(__dirname,'../portal/portal.js'),'utf8'),/p\.reversed\?' · Reversed'/);
 }finally{done();}});
