'use strict';
// Public captive portal: hotspot customers buy a package with M-Pesa and are logged in; PPPoE customers renew
// their account. Every success is confirmed with Safaricom (stkQuery) before credit, and credit goes through
// billing.pay, whose unique receipt reference stops double crediting.
const crypto=require('node:crypto');
const radius=require('./radius.cjs'),billing=require('./billing.cjs'),mpesa=require('./mpesa.cjs'),paystack=require('./paystack.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const PENDING_MS=180000;
const id=()=>crypto.randomBytes(16).toString('hex');
const acctNo=store=>{const px=String((store.setting('portalSettings')||{}).accountPrefix||'KNE').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)||'KNE';return (px+'-'+code(6,'ABCDEFGHJKMNPQRSTUVWXYZ23456789')).toLowerCase();};
const code=(n,alphabet)=>Array.from(crypto.randomBytes(n),b=>alphabet[b%alphabet.length]).join('');
function plans(store,pppoe=false,now=Date.now()){return store.list('plans').filter(p=>p.active!==false&&!p.hidden&&(pppoe?p.service==='pppoe':p.service!=='pppoe')).sort((a,b)=>(a.order||0)-(b.order||0)||a.price-b.price).map(p=>({trial:p.trial?.enabled?{minutes:p.trial.minutes}:null,custom:p.custom?.enabled?{maxQty:p.custom.maxQty,discounts:p.custom.discounts}:null,features:p.features||[],popular:!!p.popular,available:packages.buyable(p,now).ok,availability:packages.buyable(p,now).reason||'',id:p.id,name:p.name,price:p.price,duration:p.durationValue+' '+(p.durationValue===1?p.durationUnit.replace(/s$/,''):p.durationUnit),downloadMbps:p.downloadMbps,uploadMbps:p.uploadMbps,devices:p.devices,description:p.description||''}));}
function settings(store){const w=store.setting('workspace')||{},c=store.setting('portalSettings')||{};return {name:c.name||w.name||'Kade Networks',support:c.support||'',accountPrefix:cleanPrefix(c.accountPrefix)};}
const cleanPrefix=v=>String(v||'KNE').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5)||'KNE';
function updateSettings(store,input){const prior=store.setting('portalSettings')||{},name=String(input.name??'').trim(),support=String(input.support??'').trim();if(name.length>40||/[\u0000-\u001f<>]/.test(name))fail('Portal name is up to 40 characters');if(support.length>80||/[\u0000-\u001f<>]/.test(support))fail('Support contact is up to 80 characters');const accountPrefix=input.accountPrefix===undefined?cleanPrefix(prior.accountPrefix):String(input.accountPrefix).trim().toUpperCase();if(accountPrefix&&!/^[A-Z0-9]{2,5}$/.test(accountPrefix))fail('Account number prefix is 2 to 5 letters or digits, like KNE');return store.setting('portalSettings',{...prior,name,support,accountPrefix:accountPrefix||'KNE'});}
// Per-router WiFi page settings: isolate (only this router's packages) and its own support contact. The router is
// found from the identity the hotspot login page sends (matches the device name).
function routerByIdentity(store,ident){const n=String(ident||'').trim().toLowerCase();if(!n)return null;return store.list('devices').find(d=>d.type==='router'&&(d.name.toLowerCase()===n||String(d.metrics?.identity||'').toLowerCase()===n))||null;}
function routerPortal(store,id){return {isolate:false,supportPhone:'',supportWhatsapp:'',...(store.setting('routerPortal:'+id)||{})};}
function saveRouterPortal(store,id,v){const billing=require('./billing.cjs'),ph=x=>{const t=String(x||'').trim();if(!t)return '';if(!billing.phone(t))fail('Enter a valid phone number');return t.slice(0,20);};
 return store.setting('routerPortal:'+id,{isolate:v.isolate===true,supportPhone:ph(v.supportPhone),supportWhatsapp:ph(v.supportWhatsapp)});}
// Packages for a visitor coming through a router: packages tied to other routers are left out; isolated routers show
// only their own.
function plansFor(store,pppoe,router){const all=plans(store,pppoe),raw=new Map(store.list('plans').map(p=>[p.id,p]));if(!router)return all;const rp=routerPortal(store,router.id);
 return all.filter(p=>{const ids=raw.get(p.id)?.routerIds||[];return ids.length?ids.includes(router.id):!rp.isolate;});}
function info(store){const m=mpesa.publicConfig(store);return {...settings(store),freeMode:freeInfo(store),plans:plans(store),pppoePlans:require('./radius.cjs').settings(store).selfPackageChange===false?[]:plans(store,true),mpesa:m.configured};}
const promos=require('./promos.cjs'),packages=require('./packages.cjs');
const record=(store,pid)=>store.get('portalPayments',pid);
// Start an STK Push. kind 'hotspot' buys a plan for this phone; kind 'account' renews an existing subscriber.
async function start(store,input,origin,fetchImpl=fetch,now=Date.now(),authorizedSubscriber=''){
 expirePending(store,now);const phone=billing.phone(input.phone);if(!phone&&!authorizedSubscriber)fail('Enter a Safaricom number like 0712 345 678');
 let plan,subscriber=null,changeTo=null,kind=input.kind==='account'?'account':'hotspot';
 if(kind==='account'){const username=String(input.username||'').trim().toLowerCase().replace(/@.*$/,'');subscriber=store.list('subscribers').find(s=>s.username===username);if(!subscriber)fail('No account with that username. Check it and try again.',404);if(subscriber.banned)fail('This account cannot be renewed. Please contact support.',403);plan=store.get('plans',subscriber.planId);
  // A PPPoE customer moving to another package pays that package's price; the package changes when the payment is confirmed.
  if(input.changeTo&&input.changeTo!==subscriber.planId){if(require('./radius.cjs').settings(store).selfPackageChange===false)fail('Package changes are handled by our team. Please contact support.',403);
   const to=plans(store,subscriber.service==='pppoe',now).find(x=>x.id===String(input.changeTo));if(!to||!to.available)fail('That package is not available right now. Choose another one.');plan=store.get('plans',to.id);changeTo=plan.id;}
  if(!plan)fail('This account has no package. Contact support.',409);}
 else{if(store.list('subscribers').some(s=>s.service==='hotspot'&&s.banned&&billing.phone(s.phone)===phone))fail('This account is permanently banned. Contact support.',403);plan=store.get('plans',String(input.planId||''));if(!plan||plan.active===false||plan.service==='pppoe')fail('Choose a package');{const m=String(input.mac||'').toUpperCase();if(m&&(require('./radius.cjs').settings(store).blockedMacs||[]).some(b=>b.mac===m))fail('This device cannot buy packages here. Please contact support.',403);}const b=packages.buyable(plan,now);if(!b.ok)fail(b.reason);}
 if(!authorizedSubscriber&&subscriber&&(subscriber.balance||0)>=billing.priceOf(subscriber,plan)+Math.max(0,subscriber.installFeeDue||0))fail('Your wallet covers this package. Sign in to your account to activate it without M-Pesa.',409);
 if(authorizedSubscriber){
  if(!subscriber||subscriber.id!==authorizedSubscriber)fail('Account authorization did not match',403);
  const key=String(input.idempotencyKey||'').slice(0,80);if(!/^[a-zA-Z0-9-]{8,80}$/.test(key))fail('Refresh the payment form and try again');
  const previous=store.list('portalPayments').find(p=>p.subscriberId===subscriber.id&&p.requestKey===key);
  if(previous){if(previous.status==='paid'&&previous.provider==='wallet')return {status:'paid',walletOnly:true,amount:0,message:'Package activated from your wallet.'};fail(previous.status==='pending'?'A payment is already pending. Check your phone.':'This payment attempt ended. Open a new payment form.',409);}
  const cost=Math.round(((changeTo?plan.price:billing.priceOf(subscriber,plan))+Math.max(0,subscriber.installFeeDue||0))*100)/100;
  const available=Math.max(0,Number(subscriber.balance)||0);
  if(available>=cost)return store.transaction(()=>{const cur=store.get('subscribers',subscriber.id);require('./restrictions.cjs').assertAllowed(cur);if((cur.balance||0)<cost)fail('Your balance changed. Refresh and try again.',409);
   const before=cur.expiresAt??null,changed=changeTo?store.put('subscribers',{...cur,planId:changeTo,specialPrice:null},cur):cur;
   const renewed=radius.renew(store,changed.id,1,now),saved=store.put('subscribers',{...renewed,balance:Math.round(((cur.balance||0)-cost)*100)/100,installFeeDue:0},renewed);
   require('./ledger.cjs').post(store,{subscriberId:cur.id,type:'wallet-debit',walletMinor:-Math.round(cost*100),ref:'WALLET-'+key.slice(0,32),note:'Portal purchase · '+plan.name},now);
   store.put('expiryChanges',{subscriberId:cur.id,username:cur.username,name:cur.name,service:cur.service,planName:plan.name,before,after:saved.expiresAt,how:'Customer portal (wallet)',by:'customer',time:now});
   store.put('portalPayments',{kind:'account',provider:'wallet',requestKey:key,subscriberId:cur.id,planId:plan.id,planName:plan.name,amount:0,walletUsed:cost,status:'paid',createdAt:now,paidAt:now});
   store.audit({id:'customer',name:cur.username},'Activated '+plan.name+' from wallet',cur.id);return {status:'paid',walletOnly:true,amount:0,walletUsed:cost,message:'Package activated from your wallet.'};});
  if(!phone)fail('Enter a Safaricom number like 0712 345 678');
  if(store.list('portalPayments').some(p=>p.subscriberId===subscriber.id&&p.status==='pending'&&now-p.createdAt<10*60000))fail('A payment is already pending. Check your phone.',409);
 }
 // One open request per phone at a time keeps the customer from stacking prompts.
 if(store.list('portalPayments').some(p=>p.phone===phone&&p.status==='pending'&&now-p.createdAt<60000))fail('A payment request was just sent to this phone. Check your phone or wait a minute.',429);
 const qp=kind==='account'?{qty:1,amount:changeTo?plan.price:require('./billing.cjs').priceOf(subscriber,plan),percent:0}:packages.quantityPrice(plan,input.qty||1);let amount=Math.max(1,Math.ceil(kind==='account'?qp.amount-Math.min(subscriber.balance||0,qp.amount-1):qp.amount)),promo=null;
 if(String(input.promo||'').trim()){promo=promos.apply(store,input.promo,{plan,kind,price:amount},now);amount=promo.amount;}
 const walletHeld=authorizedSubscriber?Math.min(Math.max(0,subscriber.balance||0),qp.amount+Math.max(0,subscriber.installFeeDue||0)):0;
 if(authorizedSubscriber)amount=Math.max(1,Math.ceil(qp.amount+Math.max(0,subscriber.installFeeDue||0)-walletHeld));
 const pid=id(),token=crypto.randomBytes(24).toString('base64url');
 const base={kind,...(authorizedSubscriber?{requestKey:String(input.idempotencyKey),walletHeld,onePeriod:true}:{}),...(changeTo?{changeTo}:{}),planId:plan.id,planName:plan.name,subscriberId:subscriber?.id||null,phone,amount,mac:String(input.mac||'').slice(0,17).toUpperCase(),qty:qp.qty,fullValue:plan.price*qp.qty,promoCode:promo?.code||'',promoId:promo?.promoId||'',discount:promo?.discount||0,bonusDays:promo?.bonusDays||0,status:'pending',createdAt:now,updatedAt:now,tokenHash:crypto.createHash('sha256').update(token).digest('hex')};
 if(authorizedSubscriber)store.transaction(()=>{const cur=store.get('subscribers',subscriber.id);require('./restrictions.cjs').assertAllowed(cur);if((cur.balance||0)<walletHeld)fail('Your balance changed. Refresh and try again.',409);
  if(store.list('portalPayments').some(p=>p.subscriberId===cur.id&&p.status==='pending'&&now-p.createdAt<10*60000))fail('A payment is already pending.',409);
  if(walletHeld){store.put('subscribers',{...cur,balance:Math.round(((cur.balance||0)-walletHeld)*100)/100},cur);require('./ledger.cjs').post(store,{subscriberId:cur.id,type:'wallet-debit',walletMinor:-Math.round(walletHeld*100),ref:'HOLD-'+pid,note:'Reserved for portal purchase · '+plan.name},now);}
  store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('portalPayments',?,?,?,?)").run(pid,JSON.stringify({...base,provider:'mpesa'}),now,now);
 });
 try{
 // Card / mobile money through Paystack: the page goes to Paystack and comes back here with the payment id and token.
 if(input.provider==='paystack'){const email=String(input.email||'').trim().toLowerCase();if(!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(email))fail('Enter your email address for the card receipt');
  const ref='PS'+code(14,'ABCDEFGHJKMNPQRSTUVWXYZ23456789'),back=new URLSearchParams({ps:pid,pt:token});for(const k of ['login','dst','mac'])if(typeof input.router?.[k]==='string'&&input.router[k])back.set(k,input.router[k].slice(0,300));
  const init=await paystack.initialize(store,{email,amount,reference:ref,callbackUrl:origin+'/portal/?'+back,metadata:{payment:pid,plan:plan.name}},fetchImpl);
  if(authorizedSubscriber)update(store,record(store,pid),{provider:'paystack',paystackRef:init.reference,email});else  store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('portalPayments',?,?,?,?)").run(pid,JSON.stringify({...base,provider:'paystack',paystackRef:init.reference,email}),now,now);
  return {id:pid,token,amount,redirect:init.url,message:'Opening the secure card page…'};}
 const c=mpesa.config(store);if(!c)fail('M-Pesa payments are not available yet',503);
 const push=await mpesa.stkPush(store,{phone,amount,reference:kind==='account'?subscriber.username:'WIFI',description:plan.name,callbackUrl:origin+'/portal/api/mpesa/'+c.callbackSecret},fetchImpl,now);
 if(authorizedSubscriber)update(store,record(store,pid),{checkoutRequestId:push.checkoutRequestId});else store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('portalPayments',?,?,?,?)").run(pid,JSON.stringify({...base,provider:'mpesa',checkoutRequestId:push.checkoutRequestId}),now,now);
 return {id:pid,token,amount,walletUsed:walletHeld,message:'Check your phone and enter your M-Pesa PIN.'};
 }catch(e){if(authorizedSubscriber){const pending=record(store,pid);if(pending)update(store,pending,{status:'failed',reason:'Payment request was not sent. Try again.'});}throw e;}
}
function expirePending(store,now=Date.now()){for(const p of store.list('portalPayments'))if(p.onePeriod&&p.status==='pending'&&now-p.createdAt>10*60000)update(store,p,{status:'failed',reason:'Payment timed out. Your wallet reservation has been returned.'});}
function releaseWallet(store,p){if(!(p.walletHeld>0)||p.walletReleased)return p;const sub=store.get('subscribers',p.subscriberId);if(!sub)fail('Customer not found',404);
 const amount=p.walletHeld;store.put('subscribers',{...sub,balance:Math.round(((sub.balance||0)+amount)*100)/100},sub);require('./ledger.cjs').post(store,{subscriberId:sub.id,type:'wallet-credit',walletMinor:Math.round(amount*100),ref:'RELEASE-'+p.id,note:'Released portal wallet reservation'});return {...p,walletReleased:true};}
function update(store,p,changes){return store.transaction(()=>{const cur=record(store,p.id)||p,next=changes.status==='failed'?releaseWallet(store,cur):cur;return store.put('portalPayments',{...next,...changes,updatedAt:Date.now()},cur);});}
// Credit a confirmed payment exactly once. Hotspot buyers reuse their earlier hotspot login for the same phone.
function credit(store,p,{receipt,amount}){return store.transaction(()=>{
 p=record(store,p.id)||p;if(p.status==='paid')return p;
 if(p.walletHeld>0&&!p.walletReleased){const released=releaseWallet(store,p);p=store.put('portalPayments',released,p);}
 let subscriberId=p.subscriberId,password=null;
 if(p.kind==='hotspot'){
  const existing=store.list('subscribers').find(s=>s.service==='hotspot'&&s.phone===p.phone&&s.planId===p.planId);
  if(existing)subscriberId=existing.id;
  else{let username;do{username=acctNo(store);}while(store.list('subscribers').some(s=>s.username===username));
   const s=store.put('subscribers',radius.subscriber(store,{name:'Hotspot '+p.phone.replace(/^\+254/,'0'),username,service:'hotspot',planId:p.planId,phone:p.phone}));password=radius.setPassword(store,s.id,code(6,'0123456789'));subscriberId=s.id;}
 }
 if(p.changeTo){const cur=store.get('subscribers',subscriberId);if(cur&&!cur.banned&&cur.planId!==p.changeTo&&store.get('plans',p.changeTo)){store.put('subscribers',{...cur,planId:p.changeTo,specialPrice:null},cur);store.audit({id:'system',name:'Customer portal'},`${cur.username} changed package to ${p.planName} and paid`,cur.id);}}
 let result;try{result=billing.pay(store,subscriberId,{amount:amount||p.amount,creditAmount:p.qty>1?p.fullValue:(amount||p.amount)+(p.discount||0),reference:receipt,method:p.provider==='paystack'?'card':'mpesa',phone:p.phone,onePeriod:p.onePeriod===true,note:'Portal '+p.planName});}
 catch(error){if(error.status!==409)throw error;}// already credited (duplicate callback): fall through
 let s=store.get('subscribers',subscriberId);
 if(result&&p.promoCode){promos.redeemed(store,p.promoCode,{subscriberId,username:s?.username||'',name:s?.name||'',amount:amount||p.amount,discount:p.discount||0,reference:receipt});if(p.bonusDays&&s&&s.expiresAt)s=store.put('subscribers',{...s,expiresAt:s.expiresAt+p.bonusDays*864e5},s);}
 const saved=update(store,p,{status:'paid',receipt,subscriberId,username:s?.username||'',paidAt:Date.now()});
 if(password)store.secret('portal:'+p.id,{password});
 if(result)billing.receipt(store,result).catch(()=>{});
 return saved;
 });}
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
 let current=p;if(p.onePeriod&&p.status==='pending'&&now-p.createdAt>10*60000)current=update(store,p,{status:'failed',reason:'Payment timed out. Your wallet reservation has been returned.'});
 if(p.provider==='paystack'){if(current.status==='pending'&&now-(p.queriedAt||0)>4000)current=await settlePaystack(store,p,fetchImpl,now).catch(()=>p);}
 else if(current.status==='pending'&&p.checkoutRequestId&&now-p.createdAt>30000&&now-(p.queriedAt||0)>15000){
  const q=await mpesa.stkQuery(store,p.checkoutRequestId,fetchImpl).catch(()=>({resultCode:undefined}));current=update(store,p,{queriedAt:now});
  // Failed: close it. Paid but no callback after a minute: credit now under the request ID (a late callback finds it paid).
  if(q.resultCode!==undefined&&q.resultCode!=='0')current=update(store,current,{status:'failed',reason:q.resultDesc.slice(0,160)});
  else if(q.resultCode==='0'&&now-p.createdAt>60000)current=credit(store,current,{receipt:('STK-'+p.checkoutRequestId).toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40),amount:p.amount});
  else if(q.resultCode===undefined&&now-p.createdAt>PENDING_MS)current=update(store,current,{status:'failed',reason:'No answer from M-Pesa. If you were charged, contact support with your M-Pesa message.'});
 }
 const out={status:current.status,kind:current.kind,amount:current.amount,reason:current.reason||''};
 if(current.status==='paid'){const s=store.get('subscribers',current.subscriberId);out.username=s?.username;out.expiresAt=s?.expiresAt;out.service=s?.service||'';if(current.kind==='hotspot'||s?.service==='hotspot'){out.password=store.secret('portal:'+current.id)?.password||radius.password(store,current.subscriberId);}
  // The device that paid is now a known device: give its browser a secret (once) so the portal can recognise it safely later.
  if(current.mac&&s&&s.service==='hotspot'&&!(s.devTokens&&s.devTokens[require('./landing.cjs').mac(current.mac)||'']))try{const dt=require('./hotspotme.cjs').trust(store,s.username,current.mac);if(dt)out.dt=dt;}catch{}}
 return out;
}
// Credit a Paystack payment only after asking Paystack, and only for the exact amount and currency requested.
async function settlePaystack(store,p,fetchImpl=fetch,now=Date.now()){
 if(p.status!=='pending')return p;const v=await paystack.verify(store,p.paystackRef,fetchImpl);let cur=update(store,p,{queriedAt:now});
 if(v.paid){const want=Math.round(p.amount*100),cfg=paystack.config(store);if(v.amountMinor!==want||v.currency!==cfg.currency)return update(store,cur,{status:'failed',reason:'Amount or currency did not match. Contact support.'});return credit(store,cur,{receipt:p.paystackRef,amount:p.amount});}
 if(['failed','abandoned','reversed'].includes(v.status)&&now-p.createdAt>60000)return update(store,cur,{status:'failed',reason:v.reason||'Card payment was not completed'});
 if(now-p.createdAt>30*60000)return update(store,cur,{status:'failed',reason:'Card payment was not completed'});return cur;}
async function paystackEvent(store,event,fetchImpl=fetch){const ref=event?.data?.reference;if(typeof ref!=='string')return {ok:true};const p=store.list('portalPayments').find(x=>x.paystackRef===ref);if(!p)return {ok:true};await settlePaystack(store,p,fetchImpl);return {ok:true};}
// MikroTik CHAP: the router sends chap-id and chap-challenge; the page submits md5(id + password + challenge).
function chapResponse(chapId,password,challenge){return crypto.createHash('md5').update(Buffer.concat([Buffer.from(chapId,'latin1'),Buffer.from(password,'utf8'),Buffer.from(challenge,'latin1')])).digest('hex');}
// Check a hotspot login before sending the customer to the router, and prepare the CHAP answer if needed.
function freeInfo(store,now=Date.now()){const f=radius.settings(store).freeMode;if(!f?.enabled||now>=f.until)return null;const p=store.get('plans',f.planId);return {until:f.until,reason:f.reason||'',plan:p?.name||''};}
// Free trial: one per device (MAC) per N days, on packages that offer it. Creates a short hotspot login.
function trial(store,input,now=Date.now()){
 const plan=store.get('plans',String(input.planId||''));if(!plan||plan.active===false||!plan.trial?.enabled)fail('This package has no free trial');
 const m=String(input.mac||'').toUpperCase().replace(/[^0-9A-F]/g,'');if(m.length!==12)fail('Open this page from the WiFi network to start a trial');
 const log=store.setting('trials')||{byMac:{}},last=log.byMac[m];if(last&&now-last<plan.trial.everyDays*864e5)fail('This device has already had a free trial. Buy a package to continue.',429);
 log.byMac[m]=now;store.setting('trials',log);
 return grantFree(store,{plan,minutes:plan.trial.minutes,mac:m,label:'Trial',kind:'trial',chapId:input.chapId,chapChallenge:input.chapChallenge},now);
}
// A short free hotspot login on a package's speed: used by trials, watched adverts and answered quizzes.
function grantFree(store,{plan,minutes,mac,label,kind,chapId,chapChallenge},now=Date.now()){
 const nm=require('./landing.cjs').mac(mac);if(nm&&(radius.settings(store).blockedMacs||[]).some(b=>b.mac===nm))fail('This device is blocked. Contact support.',403);
 let username;do{username=acctNo(store);}while(store.list('subscribers').some(s=>s.username===username));
 const s=store.put('subscribers',{...radius.subscriber(store,{name:label+' '+mac.slice(-6),username,service:'hotspot',planId:plan.id,expiresAt:now+minutes*60000}),trial:true,freeKind:kind,lastMac:mac.match(/.{2}/g).join(':')});const password=radius.setPassword(store,s.id,code(6,'0123456789'));
 const id=typeof chapId==='string'?chapId:'',challenge=typeof chapChallenge==='string'?chapChallenge:'';
 return {username,password:id&&challenge?chapResponse(id,password,challenge):password,chap:!!(id&&challenge),expiresAt:s.expiresAt};
}
function login(store,input){const m=require('./landing.cjs').mac(input.mac);if(m&&(radius.settings(store).blockedMacs||[]).some(b=>b.mac===m))fail('This device is blocked. Contact support.',403);
 if(input.free===true){const f=freeInfo(store),m=String(input.mac||'').toLowerCase().replace(/[^0-9a-f]/g,'');if(!f)fail('Free access is not on right now',403);if(m.length!==12)fail('Open this page from the WiFi network to connect');
  const chapId=typeof input.chapId==='string'?input.chapId:'',challenge=typeof input.chapChallenge==='string'?input.chapChallenge:'';return {username:'free-'+m,password:chapId&&challenge?chapResponse(chapId,'free',challenge):'free',chap:!!(chapId&&challenge),expiresAt:f.until};}
 const username=String(input.username||'').trim().toLowerCase();let password=String(input.password||'');
 let s=store.list('subscribers').find(x=>x.username===username);
 if(!s)s=require('./vouchers.cjs').redeem(store,username)||undefined;
 const typed=s?.voucher?password.trim().toLowerCase():password;
 if(!s||radius.password(store,s.id)!==typed)fail('Wrong code or password',401);
 password=typed;
 require('./restrictions.cjs').assertAllowed(s);
 if(s.status!=='active')fail('This account is suspended. Contact support.',403);
 if(s.expiresAt!=null&&s.expiresAt<=Date.now())fail('This package has expired. Buy a new one below.',403);
 const chapId=typeof input.chapId==='string'?input.chapId:'',challenge=typeof input.chapChallenge==='string'?input.chapChallenge:'';
 const dt=require('./hotspotme.cjs').trust(store,s.username,input.mac);
 return {username:s.username,password:chapId&&challenge?chapResponse(chapId,password,challenge):password,chap:!!(chapId&&challenge),expiresAt:s.expiresAt,...(dt?{dt}:{})};
}
// login.html for the MikroTik's hotspot folder: sends every new device to this portal with the router's details.
function hotspotLoginPage(origin){return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connecting…</title></head>
<body style="font-family:sans-serif;text-align:center;padding:40px">Connecting to Kade Networks…
$(if chap-id)<script>var p={mac:'$(mac)',ip:'$(ip)',login:'$(link-login-only)',dst:'$(link-orig)',chapId:'$(chap-id)',chapChallenge:'$(chap-challenge)',error:'$(error)',nas:'$(identity)'};</script>$(else)<script>var p={mac:'$(mac)',ip:'$(ip)',login:'$(link-login-only)',dst:'$(link-orig)',error:'$(error)',nas:'$(identity)'};</script>$(endif)
<script>location.replace('${origin}/portal/?'+new URLSearchParams(p).toString());</script>
<noscript><a href="${origin}/portal/">Continue</a></noscript></body></html>
`;}
// Admin: ask Safaricom again about a payment that is still pending or was marked failed, and credit it if it was paid.
async function recheck(store,pid,fetchImpl=fetch){const p=record(store,String(pid||''));if(!p)fail('Payment not found',404);if(p.status==='paid')return {status:'paid',message:'Already credited'};
 const q=await mpesa.stkQuery(store,p.checkoutRequestId,fetchImpl);
 if(q.resultCode==='0'){const saved=credit(store,p,{receipt:('STK-'+p.checkoutRequestId).toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,40),amount:p.amount});return {status:saved.status,message:'Paid: credited '+saved.username};}
 if(q.resultCode===undefined)return {status:p.status,message:q.resultDesc||'Safaricom has no final answer yet'};
 return {status:'failed',message:q.resultDesc};}
module.exports={expirePending,routerByIdentity,routerPortal,saveRouterPortal,plansFor,grantFree,settlePaystack,paystackEvent,trial,recheck,info,settings,updateSettings,plans,start,callback,status,login,credit,chapResponse,hotspotLoginPage};
