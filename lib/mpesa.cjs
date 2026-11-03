'use strict';
// Safaricom Daraja: M-Pesa Express (STK Push), its status query and callback parsing. Credentials are encrypted
// in the secrets table. Callbacks are unsigned, so callers confirm every success with stkQuery before crediting.
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const BASE={sandbox:'https://sandbox.safaricom.co.ke',production:'https://api.safaricom.co.ke'};
let token=null;
// Settings saved before paybill (C2B) support have no c2bSecret: add one once so the paybill addresses are complete.
function config(store){const c=store.secret('mpesa:config');if(c&&!c.c2bSecret){const crypto=require('node:crypto'),fixed={...c,c2bSecret:crypto.randomBytes(16).toString('hex'),callbackSecret:c.callbackSecret||crypto.randomBytes(24).toString('base64url')};store.secret('mpesa:config',fixed);return fixed;}return c;}
function publicConfig(store){const c=config(store);return c?{configured:true,env:c.env,shortcode:c.shortcode,type:c.type,till:c.till||'',accountName:c.accountName||''}:{configured:false};}
function setConfig(store,input){const prior=config(store)||{},v=k=>String(input[k]??'').trim();
 const env=input.env==='production'?'production':'sandbox',type=input.type==='till'?'till':'paybill',shortcode=v('shortcode'),till=v('till');
 if(!/^\d{5,8}$/.test(shortcode))fail(type==='till'?'Enter the store number (head office) for your till':'Enter your paybill number');
 if(type==='till'&&!/^\d{5,8}$/.test(till))fail('Enter your till number');
 const consumerKey=v('consumerKey')||prior.consumerKey,consumerSecret=v('consumerSecret')||prior.consumerSecret,passkey=v('passkey')||prior.passkey;
 if(!consumerKey||!consumerSecret||!passkey)fail('Enter the consumer key, consumer secret and passkey from the Daraja portal');
 token=null;
 store.secret('mpesa:config',{env,type,shortcode,till:type==='till'?till:'',consumerKey,consumerSecret,passkey,accountName:v('accountName').slice(0,40),callbackSecret:prior.callbackSecret||crypto.randomBytes(24).toString('base64url'),c2bSecret:prior.c2bSecret||crypto.randomBytes(16).toString('hex')});
 return publicConfig(store);}
// Daraja wants the time in Kenya: YYYYMMDDHHmmss.
function timestamp(now=Date.now()){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));return p.year+p.month+p.day+(p.hour==='24'?'00':p.hour)+p.minute+p.second;}
async function call(fetchImpl,url,options){const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=null;}if(!r.ok)fail('M-Pesa: '+(data?.errorMessage||data?.ResultDesc||'HTTP '+r.status),502);return data;}
async function accessToken(c,fetchImpl,now=Date.now()){
 if(token&&token.env===c.env&&token.key===c.consumerKey&&token.expires>now+60000)return token.value;
 const data=await call(fetchImpl,BASE[c.env]+'/oauth/v1/generate?grant_type=client_credentials',{headers:{Authorization:'Basic '+Buffer.from(c.consumerKey+':'+c.consumerSecret).toString('base64')}});
 if(!data?.access_token)fail('M-Pesa did not return an access token',502);
 token={value:data.access_token,env:c.env,key:c.consumerKey,expires:now+Number(data.expires_in||3599)*1000};return token.value;
}
function password(c,ts){return Buffer.from(c.shortcode+c.passkey+ts).toString('base64');}
// Ask the customer's phone for payment. phone is +2547/1........; reference shows on the M-Pesa prompt (max 12).
async function stkPush(store,{phone,amount,reference,description,callbackUrl},fetchImpl=fetch,now=Date.now()){
 const c=config(store);if(!c)fail('M-Pesa is not set up yet',503);const ts=timestamp(now),msisdn=String(phone).replace(/^\+/,'');
 const data=await call(fetchImpl,BASE[c.env]+'/mpesa/stkpush/v1/processrequest',{method:'POST',headers:{Authorization:'Bearer '+await accessToken(c,fetchImpl,now),'Content-Type':'application/json'},body:JSON.stringify({
  BusinessShortCode:c.shortcode,Password:password(c,ts),Timestamp:ts,TransactionType:c.type==='till'?'CustomerBuyGoodsOnline':'CustomerPayBillOnline',Amount:Math.ceil(amount),PartyA:msisdn,PartyB:c.type==='till'?c.till:c.shortcode,PhoneNumber:msisdn,CallBackURL:callbackUrl,AccountReference:String(reference).slice(0,12),TransactionDesc:String(description||'Internet').slice(0,13)})});
 if(String(data?.ResponseCode)!=='0'||!data.CheckoutRequestID)fail('M-Pesa: '+(data?.ResponseDescription||data?.errorMessage||'request was not accepted'),502);
 return {checkoutRequestId:data.CheckoutRequestID,merchantRequestId:data.MerchantRequestID,message:data.CustomerMessage||''};
}
// The authoritative answer for one STK request. resultCode '0' = paid; undefined = still waiting.
async function stkQuery(store,checkoutRequestId,fetchImpl=fetch,now=Date.now()){
 const c=config(store);if(!c)fail('M-Pesa is not set up yet',503);const ts=timestamp(now);
 const r=await fetchImpl(BASE[c.env]+'/mpesa/stkpushquery/v1/query',{method:'POST',headers:{Authorization:'Bearer '+await accessToken(c,fetchImpl,now),'Content-Type':'application/json'},body:JSON.stringify({BusinessShortCode:c.shortcode,Password:password(c,ts),Timestamp:ts,CheckoutRequestID:checkoutRequestId}),signal:AbortSignal.timeout(20000)});
 let data=null;try{data=JSON.parse(await r.text());}catch{}
 // "The transaction is being processed" comes back as an error code while the customer is still on the prompt.
 // 4999 = "still under processing": the customer is on the prompt; it is not a failure.
 if(data?.ResultCode===undefined||String(data.ResultCode)==='4999')return {resultCode:undefined,resultDesc:String(data?.ResultDesc||data?.errorMessage||'Waiting for the customer')};
 return {resultCode:String(data.ResultCode),resultDesc:String(data.ResultDesc||'')};
}
function parseCallback(body){const cb=body?.Body?.stkCallback;if(!cb||typeof cb.CheckoutRequestID!=='string')fail('Not an M-Pesa callback');
 const items=Object.fromEntries((cb.CallbackMetadata?.Item||[]).filter(i=>i&&typeof i.Name==='string').map(i=>[i.Name,i.Value]));
 return {checkoutRequestId:cb.CheckoutRequestID,resultCode:String(cb.ResultCode),resultDesc:String(cb.ResultDesc||''),amount:Number(items.Amount)||0,receipt:String(items.MpesaReceiptNumber||''),phone:String(items.PhoneNumber||'')};}
async function post(store,route,body,fetchImpl=fetch,now=Date.now()){const c=config(store);if(!c)fail('M-Pesa is not set up yet',503);return call(fetchImpl,BASE[c.env]+route,{method:'POST',headers:{Authorization:'Bearer '+await accessToken(c,fetchImpl,now),'Content-Type':'application/json'},body:JSON.stringify(body)});}
function validCallbackSecret(store,given){const c=config(store);if(!c||typeof given!=='string')return false;const a=Buffer.from(given),b=Buffer.from(c.callbackSecret);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
module.exports={post,config,publicConfig,setConfig,stkPush,stkQuery,parseCallback,validCallbackSecret,timestamp,_reset:()=>{token=null;}};
