'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),mpesa=require('../lib/mpesa.cjs'),portal=require('../lib/portal.cjs');
const {createApp}=require('../server.cjs');
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
test('a PPPoE customer can pay to extend, or pay for another package that then becomes theirs',async()=>{
 const {store,home,secret,done}=fixture(),d=daraja();
 try{const fast=store.put('plans',radius.plan({name:'Home 20',service:'pppoe',downloadMbps:20,uploadMbps:10,price:3500,durationValue:30,durationUnit:'days'}));
  const sub=store.put('subscribers',radius.subscriber(store,{name:'Jane',username:'jane',service:'pppoe',planId:home.id,phone:'0712345678',expiresAt:Date.now()+86400000}));
  // Extend: the current package and its price
  const a=await portal.start(store,{kind:'account',username:'jane',phone:'0722000000'},'https://n',d.fetchImpl);assert.equal(d.pushes[0].Amount,2500);
  // Change: the new package's price; not a hotspot purchase ("Choose a package" error before)
  const b=await portal.start(store,{kind:'account',username:'jane',phone:'0733000000',changeTo:fast.id},'https://n',d.fetchImpl);assert.equal(d.pushes[1].Amount,3500);
  assert.equal(store.get('subscribers',sub.id).planId,home.id,'nothing changes before payment');
  d.answers.set(d.pushes[1].id,'0');await portal.callback(store,secret,callbackBody(d.pushes[1].id,0,'TJK1CHANGE',3500),d.fetchImpl);
  const after=store.get('subscribers',sub.id);assert.equal(after.planId,fast.id,'package changed once paid');assert.ok(after.expiresAt>Date.now()+29*86400000);
  await assert.rejects(portal.start(store,{kind:'account',username:'jane',phone:'0744000000',changeTo:'no-such-plan'},'https://n',d.fetchImpl),/not available/);
  radius.updateSettings(store,{selfPackageChange:false});
  await assert.rejects(portal.start(store,{kind:'account',username:'jane',phone:'0755000000',changeTo:home.id},'https://n',d.fetchImpl),/handled by our team/);
 }finally{done();}
});
