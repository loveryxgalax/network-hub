'use strict';
// Regression tests for purchase and incoming-payment findings 9-13.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),mpesa=require('../lib/mpesa.cjs'),portal=require('../lib/portal.cjs'),promos=require('../lib/promos.cjs');
// A fake Daraja: records STK pushes and answers queries from a table the test controls.
function daraja(){const pushes=[],answers=new Map();let n=0;
 const fetchImpl=async(url,options={})=>{const json=v=>({ok:true,status:200,text:async()=>JSON.stringify(v)});
  if(url.includes('/oauth/'))return json({access_token:'tok',expires_in:'3599'});
  const body=JSON.parse(options.body);
  if(url.endsWith('/processrequest')){const id='ws_CO_'+(++n);pushes.push({...body,id});return json({MerchantRequestID:'m'+n,CheckoutRequestID:id,ResponseCode:'0',CustomerMessage:'Success. Request accepted for processing'});}
  if(url.endsWith('/query')){const a=answers.get(body.CheckoutRequestID);return a?json({ResultCode:a,ResultDesc:a==='0'?'The service request is processed successfully.':'Request cancelled by user'}):{ok:false,status:500,text:async()=>JSON.stringify({errorCode:'500.001.1001',errorMessage:'The transaction is being processed'})};}
  throw new Error('unexpected '+url);};
 return {pushes,answers,fetchImpl};}
const callbackBody=(id,code,receipt='TJK1ABC2DE',amount=50)=>({Body:{stkCallback:{MerchantRequestID:'m',CheckoutRequestID:id,ResultCode:code,ResultDesc:code===0?'The service request is processed successfully.':'Request cancelled by user',...(code===0?{CallbackMetadata:{Item:[{Name:'Amount',Value:amount},{Name:'MpesaReceiptNumber',Value:receipt},{Name:'TransactionDate',Value:20261025120000},{Name:'PhoneNumber',Value:254712345678}]}}:{})}}});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'network-portal-')),store=new Store(dir);mpesa._reset();
 mpesa.setConfig(store,{env:'production',type:'paybill',shortcode:'174379',consumerKey:'ck',consumerSecret:'cs',passkey:'pk'});
 const daily=store.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}));
 const home=store.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2500,durationValue:30,durationUnit:'days'}));
 return {store,daily,home,secret:mpesa.config(store).callbackSecret,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};}

const O='https://netops.example';
const acctSub=(store,plan,balance=0)=>{const s=store.put('subscribers',{...radius.subscriber(store,{name:'B',username:'kne-bbb222',service:'pppoe',planId:plan.id,phone:'0711111111',expiresAt:Date.now()-1000}),balance});return s;};
test('9. a receipt already credited to account A does not mark account B paid',async()=>{
 const {store,home,secret,done}=fixture(),d=daraja();try{
  const a=store.put('subscribers',radius.subscriber(store,{name:'A',username:'kne-aaa111',service:'pppoe',planId:home.id,phone:'0700000001',expiresAt:Date.now()}));
  require('../lib/billing.cjs').pay(store,a.id,{amount:2500,reference:'TJK1ABC2DE',method:'mpesa'});
  const b=acctSub(store,home);const st=await portal.start(store,{kind:'account',username:'kne-bbb222',phone:'0711111111'},O,d.fetchImpl);
  const push=d.pushes[0];d.answers.set(push.id,'0');await portal.callback(store,secret,callbackBody(push.id,0,'TJK1ABC2DE',2500),d.fetchImpl);
  const p=store.list('portalPayments').find(x=>x.id===st.id);assert.equal(p.status,'review');assert.match(p.reason,/another account/);
  assert.equal(store.get('subscribers',b.id).expiresAt<Date.now(),true,'B not extended');assert.equal(store.list('subscriberPayments').filter(x=>x.subscriberId===b.id).length,0);
 }finally{done();}});
test('10. five simultaneous purchases for one phone send one prompt',async()=>{
 const {store,daily,done}=fixture(),d=daraja();try{
  const r=await Promise.allSettled([1,2,3,4,5].map(()=>portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0712345678'},O,d.fetchImpl)));
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(d.pushes.length,1);assert.equal(store.list('portalPayments').filter(p=>p.status==='pending').length,1);
 }finally{done();}});
test('11. a single-use promo cannot be held by two open checkouts',async()=>{
 const {store,daily,done}=fixture(),d=daraja();try{
  store.put('promoCodes',promos.validate({code:'HALF50',type:'percent',value:50,maxUses:1}));
  await portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0712345678',promo:'HALF50'},O,d.fetchImpl);
  await assert.rejects(portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0722345678',promo:'HALF50'},O,d.fetchImpl),/fully used/);
  assert.equal(d.pushes.length,1);
 }finally{done();}});
test('12. wallet + promo: discount first, then wallet; full, partial and empty wallets',async()=>{
 const {store,done}=fixture(),d=daraja();try{
  const plan=store.put('plans',radius.plan({name:'Hundred',service:'pppoe',downloadMbps:5,uploadMbps:5,price:100,durationValue:30,durationUnit:'days'}));store.put('promoCodes',promos.validate({code:'HALF50',type:'percent',value:50}));
  const mk=(u,bal)=>store.put('subscribers',{...radius.subscriber(store,{name:u,username:u,service:'pppoe',planId:plan.id,phone:'0711111111',expiresAt:Date.now()-1000}),balance:bal});
  const s1=mk('kne-w20',20);const r1=await portal.start(store,{kind:'account',username:'kne-w20',phone:'0711111111',promo:'HALF50',idempotencyKey:'key-0000001'},O,d.fetchImpl,Date.now(),s1.id);
  assert.equal(r1.amount,30,'KSh100 at 50% = 50, wallet 20 → 30 by M-Pesa');assert.equal(r1.walletUsed,20);assert.equal(d.pushes.at(-1).Amount,30);
  const s0=mk('kne-w00',0);const r0=await portal.start(store,{kind:'account',username:'kne-w00',phone:'0722222222',promo:'HALF50',idempotencyKey:'key-0000002'},O,d.fetchImpl,Date.now(),s0.id);assert.equal(r0.amount,50);
  const s9=mk('kne-w90',90);const r9=await portal.start(store,{kind:'account',username:'kne-w90',phone:'0733333333',promo:'HALF50',idempotencyKey:'key-0000003'},O,d.fetchImpl,Date.now(),s9.id);assert.equal(r9.amount,1,'wallet covers the discounted 50 except the 1 shilling minimum');assert.equal(r9.walletUsed,49);
 }finally{done();}});
test('13. a callback amount different from the request is held for review, never credited',async()=>{
 const {store,daily,secret,done}=fixture(),d=daraja();try{
  const st=await portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0712345678'},O,d.fetchImpl);const push=d.pushes[0];d.answers.set(push.id,'0');
  await portal.callback(store,secret,callbackBody(push.id,0,'TJK9ZZZ9ZZ',1000),d.fetchImpl);
  const p=store.list('portalPayments').find(x=>x.id===st.id);assert.equal(p.status,'review');assert.equal(store.list('subscriberPayments').length,0);
 }finally{done();}});
