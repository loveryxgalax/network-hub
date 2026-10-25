'use strict';
// Public captive portal: hotspot customers buy a package with M-Pesa and are logged in; PPPoE customers renew
// their account. Every success is confirmed with Safaricom (stkQuery) before credit, and credit goes through
// billing.pay, whose unique receipt reference stops double crediting.
const crypto=require('node:crypto');
const radius=require('./radius.cjs'),billing=require('./billing.cjs'),mpesa=require('./mpesa.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const PENDING_MS=180000;
const id=()=>crypto.randomBytes(16).toString('hex');
const code=(n,alphabet)=>Array.from(crypto.randomBytes(n),b=>alphabet[b%alphabet.length]).join('');
function plans(store){return store.list('plans').filter(p=>p.active!==false&&p.service!=='pppoe').sort((a,b)=>a.price-b.price).map(p=>({id:p.id,name:p.name,price:p.price,duration:p.durationValue+' '+(p.durationValue===1?p.durationUnit.replace(/s$/,''):p.durationUnit),downloadMbps:p.downloadMbps,uploadMbps:p.uploadMbps,devices:p.devices,description:p.description||''}));}
function settings(store){const w=store.setting('workspace')||{},c=store.setting('portalSettings')||{};return {name:c.name||w.name||'Kade Networks',support:c.support||''};}
function updateSettings(store,input){const name=String(input.name??'').trim(),support=String(input.support??'').trim();if(name.length>40||/[\u0000-\u001f<>]/.test(name))fail('Portal name is up to 40 characters');if(support.length>80||/[\u0000-\u001f<>]/.test(support))fail('Support contact is up to 80 characters');return store.setting('portalSettings',{name,support});}
function info(store){const m=mpesa.publicConfig(store);return {...settings(store),plans:plans(store),mpesa:m.configured};}
const record=(store,pid)=>store.get('portalPayments',pid);
// Start an STK Push. kind 'hotspot' buys a plan for this phone; kind 'account' renews an existing subscriber.
async function start(store,input,origin,fetchImpl=fetch,now=Date.now()){
 const phone=billing.phone(input.phone);if(!phone)fail('Enter a Safaricom number like 0712 345 678');
 let plan,subscriber=null,kind=input.kind==='account'?'account':'hotspot';
 if(kind==='account'){const username=String(input.username||'').trim().toLowerCase().replace(/@.*$/,'');subscriber=store.list('subscribers').find(s=>s.username===username);if(!subscriber)fail('No account with that username. Check it and try again.',404);plan=store.get('plans',subscriber.planId);if(!plan)fail('This account has no package. Contact support.',409);}
 else{plan=store.get('plans',String(input.planId||''));if(!plan||plan.active===false||plan.service==='pppoe')fail('Choose a package');}
 // One open request per phone at a time keeps the customer from stacking prompts.
 if(store.list('portalPayments').some(p=>p.phone===phone&&p.status==='pending'&&now-p.createdAt<60000))fail('A payment request was just sent to this phone. Check your phone or wait a minute.',429);
 const amount=Math.max(1,Math.ceil(kind==='account'?plan.price-Math.min(subscriber.balance||0,plan.price-1):plan.price));
 const c=mpesa.config(store);if(!c)fail('M-Pesa payments are not available yet',503);
 const pid=id(),token=crypto.randomBytes(24).toString('base64url');
 const push=await mpesa.stkPush(store,{phone,amount,reference:kind==='account'?subscriber.username:'WIFI',description:plan.name,callbackUrl:origin+'/portal/api/mpesa/'+c.callbackSecret},fetchImpl,now);
 store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('portalPayments',?,?,?,?)").run(pid,JSON.stringify({kind,planId:plan.id,planName:plan.name,subscriberId:subscriber?.id||null,phone,amount,mac:String(input.mac||'').slice(0,17).toUpperCase(),checkoutRequestId:push.checkoutRequestId,status:'pending',createdAt:now,updatedAt:now,tokenHash:crypto.createHash('sha256').update(token).digest('hex')}),now,now);
 return {id:pid,token,amount,message:'Check your phone and enter your M-Pesa PIN.'};
}
function update(store,p,changes){return store.put('portalPayments',{...p,...changes,updatedAt:Date.now()},p);}
// Credit a confirmed payment exactly once. Hotspot buyers reuse their earlier hotspot login for the same phone.
function credit(store,p,{receipt,amount}){
 if(p.status==='paid')return p;
 let subscriberId=p.subscriberId,password=null;
 if(p.kind==='hotspot'){
  const existing=store.list('subscribers').find(s=>s.service==='hotspot'&&s.phone===p.phone&&s.planId===p.planId);
  if(existing)subscriberId=existing.id;
  else{let username;do{username='w'+code(6,'abcdefghjkmnpqrstuvwxyz23456789');}while(store.list('subscribers').some(s=>s.username===username));
   const s=store.put('subscribers',radius.subscriber(store,{name:'Hotspot '+p.phone.replace(/^\+254/,'0'),username,service:'hotspot',planId:p.planId,phone:p.phone}));password=radius.setPassword(store,s.id,code(6,'0123456789'));subscriberId=s.id;}
 }
 let result;try{result=billing.pay(store,subscriberId,{amount:amount||p.amount,reference:receipt,method:'mpesa',phone:p.phone,note:'Portal '+p.planName});}
 catch(error){if(error.status!==409)throw error;}// already credited (duplicate callback): fall through
 const s=store.get('subscribers',subscriberId);
 const saved=update(store,p,{status:'paid',receipt,subscriberId,username:s?.username||'',paidAt:Date.now()});
 if(password)store.secret('portal:'+p.id,{password});
 if(result)billing.receipt(store,result).catch(()=>{});
 return saved;
}
// Safaricom's callback: trust nothing in it except the CheckoutRequestID; confirm with stkQuery first.
async function callback(store,secret,body,fetchImpl=fetch){
 if(!mpesa.validCallbackSecret(store,secret))fail('Not found',404);
 const cb=mpesa.parseCallback(body),p=store.list('portalPayments').find(x=>x.checkoutRequestId===cb.checkoutRequestId);
 if(!p)return {ok:true};
 // Keep the real M-Pesa receipt when we credited earlier from a status query.
 if(p.status==='paid'){if(cb.resultCode==='0'&&!p.mpesaReceipt&&/^[A-Z0-9]{8,14}$/.test(cb.receipt.toUpperCase()))update(store,p,{mpesaReceipt:cb.receipt.toUpperCase()});return {ok:true};}
 if(cb.resultCode!=='0'){if(p.status==='pending')update(store,p,{status:'failed',reason:cb.resultDesc.slice(0,160)});return {ok:true};}
 const q=await mpesa.stkQuery(store,p.checkoutRequestId,fetchImpl);
 if(q.resultCode!=='0'){if(q.resultCode!==undefined)update(store,p,{status:'failed',reason:q.resultDesc.slice(0,160)});return {ok:true};}
 if(!/^[A-Z0-9]{8,14}$/.test(cb.receipt.toUpperCase()))fail('Callback has no receipt number');
 credit(store,p,{receipt:cb.receipt.toUpperCase(),amount:cb.amount});return {ok:true};
}
// The customer's page polls this. After a while without a callback it asks Safaricom itself.
async function status(store,pid,token,fetchImpl=fetch,now=Date.now()){
 const p=record(store,String(pid||''));if(!p||typeof token!=='string'||crypto.createHash('sha256').update(token).digest('hex')!==p.tokenHash)fail('Payment not found',404);
 let current=p;
 if(p.status==='pending'&&now-p.createdAt>30000&&now-(p.queriedAt||0)>15000){
  const q=await mpesa.stkQuery(store,p.checkoutRequestId,fetchImpl).catch(()=>({resultCode:undefined}));current=update(store,p,{queriedAt:now});
  // Failed: close it. Paid but no callback after a minute: credit now under the request ID (a late callback finds it paid).
  if(q.resultCode!==undefined&&q.resultCode!=='0')current=update(store,current,{status:'failed',reason:q.resultDesc.slice(0,160)});
  else if(q.resultCode==='0'&&now-p.createdAt>60000)current=credit(store,current,{receipt:('STK-'+p.checkoutRequestId).toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40),amount:p.amount});
  else if(q.resultCode===undefined&&now-p.createdAt>PENDING_MS)current=update(store,current,{status:'failed',reason:'No answer from M-Pesa. If you were charged, contact support with your M-Pesa message.'});
 }
 const out={status:current.status,kind:current.kind,amount:current.amount,reason:current.reason||''};
 if(current.status==='paid'){const s=store.get('subscribers',current.subscriberId);out.username=s?.username;out.expiresAt=s?.expiresAt;if(current.kind==='hotspot'){out.password=store.secret('portal:'+current.id)?.password||radius.password(store,current.subscriberId);}}
 return out;
}
// MikroTik CHAP: the router sends chap-id and chap-challenge; the page submits md5(id + password + challenge).
function chapResponse(chapId,password,challenge){return crypto.createHash('md5').update(Buffer.concat([Buffer.from(chapId,'latin1'),Buffer.from(password,'utf8'),Buffer.from(challenge,'latin1')])).digest('hex');}
// Check a hotspot login before sending the customer to the router, and prepare the CHAP answer if needed.
function login(store,input){
 const username=String(input.username||'').trim().toLowerCase(),password=String(input.password||'');
 const s=store.list('subscribers').find(x=>x.username===username);
 if(!s||radius.password(store,s.id)!==password)fail('Wrong code or password',401);
 if(s.status!=='active')fail('This account is suspended. Contact support.',403);
 if(s.expiresAt!=null&&s.expiresAt<=Date.now())fail('This package has expired. Buy a new one below.',403);
 const chapId=typeof input.chapId==='string'?input.chapId:'',challenge=typeof input.chapChallenge==='string'?input.chapChallenge:'';
 return {username:s.username,password:chapId&&challenge?chapResponse(chapId,password,challenge):password,chap:!!(chapId&&challenge),expiresAt:s.expiresAt};
}
// login.html for the MikroTik's hotspot folder: sends every new device to this portal with the router's details.
function hotspotLoginPage(origin){return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting…</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px">Connecting to Kade Networks…
$(if chap-id)<script>var p={mac:'$(mac)',ip:'$(ip)',login:'$(link-login-only)',dst:'$(link-orig)',chapId:'$(chap-id)',chapChallenge:'$(chap-challenge)',error:'$(error)'};</script>$(else)<script>var p={mac:'$(mac)',ip:'$(ip)',login:'$(link-login-only)',dst:'$(link-orig)',error:'$(error)'};</script>$(endif)
<script>location.replace('${origin}/portal/?'+new URLSearchParams(p).toString());</script>
<noscript><a href="${origin}/portal/">Continue</a></noscript></body></html>
`;}
// Admin: ask Safaricom again about a payment that is still pending or was marked failed, and credit it if it was paid.
async function recheck(store,pid,fetchImpl=fetch){const p=record(store,String(pid||''));if(!p)fail('Payment not found',404);if(p.status==='paid')return {status:'paid',message:'Already credited'};
 const q=await mpesa.stkQuery(store,p.checkoutRequestId,fetchImpl);
 if(q.resultCode==='0'){const saved=credit(store,p,{receipt:('STK-'+p.checkoutRequestId).toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40),amount:p.amount});return {status:saved.status,message:'Paid: credited '+saved.username};}
 if(q.resultCode===undefined)return {status:p.status,message:q.resultDesc||'Safaricom has no final answer yet'};
 return {status:'failed',message:q.resultDesc};}
module.exports={recheck,info,settings,updateSettings,plans,start,callback,status,login,credit,chapResponse,hotspotLoginPage};
