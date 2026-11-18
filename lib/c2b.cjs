'use strict';
// Paybill (C2B) payments: customers pay the paybill with their username as the account number. Safaricom tells us
// (confirmation URL); we credit the matching subscriber once per M-Pesa receipt, or keep the payment unallocated for a
// person to assign. URLs avoid words Safaricom forbids (mpesa, safaricom, sql, exec, cmd) and use a hex secret.
const mpesa=require('./mpesa.cjs'),billing=require('./billing.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const accountKey=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,'').replace(/@[a-z0-9.-]+$/,'');
function urls(store,origin){const c=mpesa.config(store);if(!c)fail('M-Pesa is not set up yet',503);const base=origin+'/portal/api/c2b/'+c.c2bSecret;return {confirmation:base+'/confirmation',validation:base+'/validation'};}
function validSecret(store,given){const c=mpesa.config(store);return !!c&&typeof given==='string'&&given.length===c.c2bSecret.length&&require('node:crypto').timingSafeEqual(Buffer.from(given),Buffer.from(c.c2bSecret));}
// Which subscriber does this account number mean? Username first, then a phone number that belongs to exactly one subscriber.
function match(store,account){const key=accountKey(account);if(!key)return null;const subs=store.list('subscribers'),byName=subs.find(s=>s.username===key||accountKey(s.username)===key);if(byName)return byName;
 const phone=billing.phone(account);if(phone){const hits=subs.filter(s=>billing.phone(s.phone)===phone);if(hits.length===1)return hits[0];}return null;}
const ours=(c,code)=>[c.shortcode,c.till].filter(Boolean).includes(String(code));
// Optional pre-check (Safaricom enables it only on request): refuse accounts that don't exist so the customer's money is not taken.
function validate(store,body){const c=mpesa.config(store);if(!c||!ours(c,body.BusinessShortCode))return {ResultCode:'C2B00011',ResultDesc:'Rejected'};
 return match(store,body.BillRefNumber)?{ResultCode:0,ResultDesc:'Accepted'}:{ResultCode:'C2B00012',ResultDesc:'Rejected'};}
// Where a confirmation came from. The address is secret, but anyone who has seen it (it is shown to admins and
// managers) could post a made-up payment, so the sender's network address is checked against Safaricom's.
//  mode 'flag': credit as usual, mark payments from other addresses;  'hold': do not credit those, keep them for an
//  admin to check on the M-Pesa statement and credit by hand;  'auto' (default): hold only once at least one payment
//  has really arrived from a Safaricom address here, which proves the check works on this server before it can stop money.
const SAFARICOM=['196.201.212.','196.201.213.','196.201.214.'];
function guard(store){const g=store.setting('c2bGuard')||{};const prefixes=Array.isArray(g.prefixes)&&g.prefixes.length?g.prefixes.map(String):SAFARICOM;
 return {mode:['flag','hold','auto'].includes(g.mode)?g.mode:'auto',prefixes,seenSafaricom:g.seenSafaricom||0};}
function setGuard(store,input){const cur=guard(store),mode=['flag','hold','auto'].includes(input.mode)?input.mode:cur.mode;
 let prefixes=cur.prefixes;if(input.prefixes!==undefined){prefixes=String(Array.isArray(input.prefixes)?input.prefixes.join(','):input.prefixes).split(/[\s,]+/).map(x=>x.trim()).filter(Boolean);
  if(!prefixes.length)prefixes=SAFARICOM;for(const x of prefixes)if(!/^(\d{1,3}\.){1,3}(\d{1,3})?$/.test(x)&&!/^(\d{1,3}\.){3}\d{1,3}$/.test(x))fail('Write each address like 196.201.214.200 or a beginning like 196.201.214.');if(prefixes.length>40)fail('Too many addresses');}
 store.setting('c2bGuard',{mode,prefixes,seenSafaricom:cur.seenSafaricom});return guard(store);}
const fromSafaricom=(g,ip)=>{const a=String(ip||'').trim();return !!a&&g.prefixes.some(p=>p.endsWith('.')?a.startsWith(p):a===p);};
function confirm(store,body,now=Date.now(),meta={}){
 const c=mpesa.config(store);if(!c)fail('M-Pesa is not set up yet',503);
 const transId=String(body.TransID||'').trim().toUpperCase(),amount=Number(body.TransAmount);
 if(!/^[A-Z0-9]{8,14}$/.test(transId)||!(amount>0&&amount<=1e7))fail('Not a payment confirmation');
 if(!ours(c,body.BusinessShortCode))return {ok:true,ignored:true};
 if(store.list('c2bPayments').some(p=>p.transId===transId))return {ok:true,duplicate:true};
 const payer=[body.FirstName,body.MiddleName,body.LastName].filter(Boolean).join(' ').slice(0,80),account=String(body.BillRefNumber||'').slice(0,60);
 const g=guard(store),ip=String(meta.ip||'').slice(0,64),trusted=fromSafaricom(g,ip),hold=!trusted&&(g.mode==='hold'||(g.mode==='auto'&&g.seenSafaricom>0));
 if(trusted)store.setting('c2bGuard',{mode:g.mode,prefixes:g.prefixes,seenSafaricom:g.seenSafaricom+1});
 const record={transId,amount,account,payer,msisdn:String(body.MSISDN||'').slice(0,80),paidAt:now,status:hold?'held':'unallocated',subscriberId:null,sourceIp:ip,source:trusted?'safaricom':'unknown'};
 const saved=store.put('c2bPayments',record);
 if(hold){try{store.audit({id:'system'},`Paybill confirmation ${transId} (KSh ${amount}) came from ${ip||'an unknown address'}, not Safaricom. It was not credited: check it on the M-Pesa statement, then credit it by hand.`,saved.id);}catch{}return {ok:true,status:'held',id:saved.id};}
 return allocate(store,saved,match(store,account),now);
}
// Credit a payment to a subscriber (automatically or by an admin choosing one).
function allocate(store,payment,subscriber,now=Date.now()){
 if(!subscriber)return {ok:true,status:'unallocated',id:payment.id};
 if(payment.status==='credited')fail('This payment was already credited',409);
 let result;try{result=billing.pay(store,subscriber.id,{amount:payment.amount,reference:payment.transId,method:'mpesa',note:'Paybill '+(payment.account||'')+(payment.payer?' · '+payment.payer:'')},now);}
 catch(error){if(error.status!==409)throw error;}
 const saved=store.put('c2bPayments',{...payment,status:'credited',subscriberId:subscriber.id,username:subscriber.username,creditedAt:now},payment);
 if(result)billing.receipt(store,result).catch(()=>{});
 if(payment.payer)try{require('./payername.cjs').apply(store,subscriber.id,payment.payer,'paybill');}catch{}
 return {ok:true,status:'credited',id:saved.id,username:subscriber.username};
}
function assign(store,id,subscriberId){const p=store.get('c2bPayments',String(id||''));if(!p)fail('Payment not found',404);const s=store.get('subscribers',String(subscriberId||''));if(!s)fail('Choose a subscriber');return allocate(store,p,s);}
// Tell Safaricom where to send paybill payment notifications. In production a shortcode can usually be registered once;
// changing existing URLs is done in the M-Pesa business portal.
async function register(store,origin,fetchImpl=fetch){
 const c=mpesa.config(store);if(!c)fail('M-Pesa is not set up yet',503);const u=urls(store,origin);
 try{const r=await mpesa.post(store,'/mpesa/c2b/v2/registerurl',{ShortCode:c.shortcode,ResponseType:'Completed',ConfirmationURL:u.confirmation,ValidationURL:u.validation},fetchImpl);
  const ok=/^0+$/.test(String(r?.ResponseCode??''));/* Safaricom answers "0" or "00000000" for success */const out={time:Date.now(),ok,message:String(r?.ResponseDescription||r?.errorMessage||'').slice(0,200)};store.setting('c2bRegistration',out);return out;}
 catch(error){const out={time:Date.now(),ok:false,message:error.message.slice(0,200)};store.setting('c2bRegistration',out);return out;}
}
function overview(store,origin){const c=mpesa.config(store);return {guard:guard(store),registration:(r=>r?{...r,ok:r.ok||/^success$/i.test(String(r.message||'').trim())}:null)(store.setting('c2bRegistration')),urls:c?urls(store,origin):null,payments:store.list('c2bPayments').slice(0,300)};}
module.exports={guard,setGuard,urls,validSecret,match,validate,confirm,assign,register,overview,accountKey};
