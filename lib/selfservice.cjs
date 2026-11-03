'use strict';
// A customer's own account page (/portal/account.html?t=TOKEN). The link staff send carries a signed token, so
// opening it shows the account without a PIN; it cannot be guessed, stops working after 60 days and never
// carries a password. Staff can issue a fresh link at any time.
const crypto=require('node:crypto'),landing=require('./landing.cjs'),portal=require('./portal.cjs'),billing=require('./billing.cjs');
const TTL=60*86400000;
function key(store){let k=store.secret('selfservice:key');if(!k){k={k:crypto.randomBytes(32).toString('hex')};store.secret('selfservice:key',k);}return k.k;}
function sign(store,body){return crypto.createHmac('sha256',key(store)).update(body).digest('base64url').slice(0,32);}
function token(store,sub,now=Date.now()){const body=Buffer.from(JSON.stringify({s:sub.id,e:now+TTL})).toString('base64url');return body+'.'+sign(store,body);}
function subscriberOf(store,tok,now=Date.now()){
 const [body,sig]=String(tok||'').split('.');if(!body||!sig)return null;
 const want=Buffer.from(sign(store,body)),got=Buffer.from(sig);if(want.length!==got.length||!crypto.timingSafeEqual(want,got))return null;
 let p;try{p=JSON.parse(Buffer.from(body,'base64url').toString());}catch{return null;}
 if(!p||!(p.e>now))return null;return store.get('subscribers',p.s)||null;}
function view(store,sub,now=Date.now()){
 const base=landing.accountRaw(store,sub.username,now),verified=landing.account(store,sub.username,now,'');
 let down=0,up=0;const since=now-30*86400000;for(const x of store.sessionsOf(sub.username,since)){down+=Number(x.downloadBytes)||0;up+=Number(x.uploadBytes)||0;}
 const lo=billing.loyalty(store),cfg=landing.get(store),plan=store.get('plans',sub.planId);
 const plans=portal.plans(store,sub.service==='pppoe',now).map(p=>({id:p.id,name:p.name,price:p.price,duration:p.duration,available:p.available,current:p.id===sub.planId}));
 return {account:sub.username,name:sub.name,phone:sub.phone||'',service:sub.service,status:base.status,expiresAt:sub.expiresAt??null,plan:plan?.name||'',price:plan?.price??null,
  points:sub.points||0,loyalty:{enabled:!!lo.enabled,perPoint:lo.pointValue},balance:sub.balance||0,usage:{down,up,days:30},plans,
  brand:{name:cfg.brandName||'',color:cfg.brandColor||'#0032fd',phone:cfg.phone||'',whatsapp:cfg.whatsapp||''},mpesa:true,sharedCode:verified.shareCode||null};}
module.exports={token,subscriberOf,view};
