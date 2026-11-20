'use strict';
// Paystack (card and mobile money) for portal purchases. The customer is sent to Paystack's checkout page;
// a payment is credited only after the server itself verifies it with Paystack (webhooks are signed but still
// verified, and the amount and currency must match what we asked for).
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const BASE='https://api.paystack.co';
function config(store){return store.secret('paystack:config');}
function publicConfig(store){const c=config(store);return c?{configured:true,enabled:c.enabled!==false,currency:c.currency,mode:c.secretKey.startsWith('sk_live_')?'live':'test'}:{configured:false,enabled:false};}
function setConfig(store,input){const prior=config(store)||{},key=String(input.secretKey||'').trim()||prior.secretKey;
 if(!key||!/^sk_(test|live)_[A-Za-z0-9]{20,80}$/.test(key))fail('Enter the Paystack secret key (starts with sk_live_ or sk_test_)');
 const currency=['KES','NGN','GHS','ZAR','USD'].includes(input.currency)?input.currency:prior.currency||'KES';
 store.secret('paystack:config',{secretKey:key,currency,enabled:input.enabled!==false});return publicConfig(store);}
async function call(store,path,options={},fetchImpl=fetch){const c=config(store);if(!c||c.enabled===false)fail('Card payments are not available',503);
 const r=await fetchImpl(BASE+path,{...options,headers:{Authorization:'Bearer '+c.secretKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000)});let data=null;try{data=await r.json();}catch{}
 if(!r.ok||!data?.status)fail('Paystack: '+(data?.message||'HTTP '+r.status),502);return data.data;}
async function initialize(store,{email,amount,reference,callbackUrl,metadata},fetchImpl=fetch){const c=config(store);
 const d=await call(store,'/transaction/initialize',{method:'POST',body:JSON.stringify({email,amount:Math.round(amount*100),currency:c.currency,reference,callback_url:callbackUrl,metadata,channels:['card','mobile_money','bank']})},fetchImpl);
 if(!d?.authorization_url)fail('Paystack did not return a checkout link',502);return {url:d.authorization_url,reference:d.reference||reference};}
// Returns {paid, amountMinor, currency, reason}.
async function verify(store,reference,fetchImpl=fetch){const d=await call(store,'/transaction/verify/'+encodeURIComponent(reference),{},fetchImpl);
 return {paid:d?.status==='success',status:d?.status||'unknown',amountMinor:Number(d?.amount)||0,currency:d?.currency||'',reason:d?.gateway_response||''};}
function validSignature(store,raw,given){const c=config(store);if(!c||typeof given!=='string'||!/^[a-f0-9]{128}$/.test(given))return false;
 const want=crypto.createHmac('sha512',c.secretKey).update(raw).digest('hex');return crypto.timingSafeEqual(Buffer.from(want),Buffer.from(given));}
module.exports={config,publicConfig,setConfig,initialize,verify,validSignature};
