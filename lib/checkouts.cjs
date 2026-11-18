'use strict';
// Checkout links: a small public M-Pesa payment page with its own short code (installation fees, equipment, event WiFi,
// a payment to share on WhatsApp or print as a QR code). Payments are confirmed with Safaricom (stkQuery) before they
// count, are kept in their own list (they never touch customer balances or the ledger), and can be posted, signed, to
// your own system's callback URL.
const crypto=require('node:crypto'),mpesa=require('./mpesa.cjs');
const fail=(m,s=400)=>{const e=new Error(m);e.status=s;throw e;};
const CODE=/^[A-Z0-9]{3}$/;
const links=store=>store.list('checkoutLinks'),pays=store=>store.list('checkoutPays');
const byCode=(store,code)=>links(store).find(l=>l.code===String(code||'').toUpperCase());
function newCode(store){const used=new Set(links(store).map(l=>l.code)),A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 for(let i=0;i<500;i++){const c=Array.from(crypto.randomBytes(3),b=>A[b%A.length]).join('');if(!used.has(c))return c;}fail('No free code left; use a custom code');}
function validUrl(raw){const s=String(raw||'').trim();if(!s)return '';let u;try{u=new URL(s);}catch{fail('Callback URL is not a valid address');}
 if(u.protocol!=='https:')fail('Callback URL must start with https://');if(u.username||u.password)fail('Callback URL must not contain a password');
 if(/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1)/i.test(u.hostname))fail('Callback URL must be a public address');return u.toString().slice(0,300);}
function create(store,input,by){
 const description=String(input.description||'').trim().slice(0,120);if(!description)fail('Description is required');
 const amount=input.amount===''||input.amount==null?null:Math.round(Number(input.amount));if(amount!==null&&!(amount>=1&&amount<=250000))fail('Amount: 1–250,000, or leave it empty for a variable amount');
 const currency=['KES'].includes(input.currency||'KES')?'KES':fail('M-Pesa checkout links collect KES');
 let code=String(input.code||'').trim().toUpperCase();if(code){if(!CODE.test(code))fail('Custom code: exactly 3 letters or digits');if(byCode(store,code))fail('That code is already used');}else code=newCode(store);
 return store.put('checkoutLinks',{code,description,amount,currency,callbackUrl:validUrl(input.callbackUrl),apiSecret:crypto.randomBytes(24).toString('hex'),active:true,by:by||''});}
function update(store,code,input){const l=byCode(store,code);if(!l)fail('Checkout link not found',404);
 return store.put('checkoutLinks',{...l,active:input.active===undefined?l.active:input.active===true,callbackUrl:input.callbackUrl===undefined?l.callbackUrl:validUrl(input.callbackUrl)},l);}
function totals(store,l){const p=pays(store).filter(x=>x.linkId===l.id&&x.status==='paid');return {collected:p.reduce((a,x)=>a+(x.amount||0),0),count:p.length,payers:new Set(p.map(x=>x.phone)).size};}
function list(store){return links(store).map(l=>({...l,apiSecret:undefined,...totals(store,l)})).sort((a,b)=>(b.created||0)-(a.created||0));}
function detail(store,code){const l=byCode(store,code);if(!l)fail('Checkout link not found',404);
 return {...l,...totals(store,l),payments:pays(store).filter(x=>x.linkId===l.id).sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,300)};}
// What the public page shows.
function publicInfo(store,code,ws={}){const l=byCode(store,code);if(!l||!l.active)fail('This payment link is not active',404);
 return {code:l.code,description:l.description,amount:l.amount,currency:l.currency,business:ws.name||'Kade Networks'};}
const phoneOf=raw=>{const d=String(raw||'').replace(/\D/g,'');const m=d.match(/^(?:254|0)?([17]\d{8})$/);return m?'254'+m[1]:fail('Enter an M-Pesa number like 0712 345 678');};
async function pay(store,code,input,origin,fetchImpl=fetch,now=Date.now()){
 const l=byCode(store,code);if(!l||!l.active)fail('This payment link is not active',404);const c=mpesa.config(store);if(!c)fail('M-Pesa is not set up yet',503);
 const phone=phoneOf(input.phone),amount=l.amount??Math.round(Number(input.amount));if(!(amount>=1&&amount<=250000))fail('Enter an amount between 1 and 250,000');
 const push=await mpesa.stkPush(store,{phone,amount,reference:'PAY'+l.code,description:l.description,callbackUrl:origin+'/portal/api/mpesa/'+c.callbackSecret},fetchImpl,now);
 const p=store.put('checkoutPays',{linkId:l.id,code:l.code,phone,amount,status:'pending',checkoutRequestId:push.checkoutRequestId,token:crypto.randomBytes(12).toString('hex')});
 return {id:p.id,token:p.token,message:push.message||'Check your phone and enter your M-Pesa PIN'};}
async function settle(store,p,receipt,fetchImpl){const q=await mpesa.stkQuery(store,p.checkoutRequestId,fetchImpl);
 if(q.resultCode===undefined)return p;
 if(q.resultCode!=='0')return store.put('checkoutPays',{...p,status:'failed',reason:String(q.resultDesc||'').slice(0,160)},p);
 const saved=store.put('checkoutPays',{...p,status:'paid',paidAt:Date.now(),receipt:receipt||p.receipt||''},p);notify(store,saved,fetchImpl).catch(()=>{});return saved;}
// Called from the portal's M-Pesa callback when the CheckoutRequestID is not a portal purchase.
async function callback(store,cb,fetchImpl=fetch){const p=pays(store).find(x=>x.checkoutRequestId===cb.checkoutRequestId);if(!p||p.status!=='pending')return {ok:true};
 if(cb.resultCode!=='0'){store.put('checkoutPays',{...p,status:'failed',reason:String(cb.resultDesc||'').slice(0,160)},p);return {ok:true};}
 const r=String(cb.receipt||'').toUpperCase();await settle(store,p,/^[A-Z0-9]{8,14}$/.test(r)?r:'',fetchImpl);return {ok:true};}
// The public page polls this; after 20 s without a callback we ask Safaricom ourselves.
async function status(store,id,token,fetchImpl=fetch,now=Date.now()){let p=store.get('checkoutPays',id);if(!p||typeof token!=='string'||p.token!==token)fail('Not found',404);
 if(p.status==='pending'&&now-(p.created||now)>20000&&now-(p.queriedAt||0)>10000){p=store.put('checkoutPays',{...p,queriedAt:now},p);try{p=await settle(store,p,'',fetchImpl);}catch{}}
 return {status:p.status,amount:p.amount,receipt:p.receipt||'',reason:p.reason||''};}
// Signed confirmation to the owner's own system: header X-Netops-Signature = hex HMAC-SHA256 of the body with the API secret.
async function notify(store,p,fetchImpl=fetch){const l=links(store).find(x=>x.id===p.linkId);if(!l?.callbackUrl)return;
 const body=JSON.stringify({event:'checkout.paid',code:l.code,description:l.description,amount:p.amount,currency:l.currency,phone:p.phone,receipt:p.receipt||'',paidAt:new Date(p.paidAt||Date.now()).toISOString(),id:p.id});
 const sig=crypto.createHmac('sha256',l.apiSecret).update(body).digest('hex');let ok=false,code=0;
 try{const r=await fetchImpl(l.callbackUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Netops-Signature':sig},body,redirect:'manual',signal:AbortSignal.timeout(10000)});code=r.status;ok=r.ok;}catch{}
 const cur=store.get('checkoutPays',p.id);if(cur)store.put('checkoutPays',{...cur,notified:ok,notifyStatus:code},cur);}
module.exports={create,update,list,detail,publicInfo,pay,callback,status,notify,byCode};
