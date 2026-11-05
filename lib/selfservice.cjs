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
function connection(store,sub,now){
 if(sub.service!=='hotspot')return null;const STALE=15*60000;
 const open=store.sessionsOf(sub.username,now-86400000).filter(x=>!x.stoppedAt&&now-x.updatedAt<STALE).sort((a,b)=>b.updatedAt-a.updatedAt);
 const last=open[0]||store.sessionsOf(sub.username,0)[0]||null;
 return {connected:open.length>0,devices:open.length,ip:last?.ip||'',};}
function view(store,sub,now=Date.now()){
 const base=landing.accountRaw(store,sub.username,now),verified=landing.account(store,sub.username,now,'');
 let down=0,up=0,last=0,open=0,n=0;const since=now-30*86400000;for(const x of store.sessionsOf(sub.username,since)){n++;down+=Number(x.downloadBytes)||0;up+=Number(x.uploadBytes)||0;last=Math.max(last,Number(x.updatedAt)||0);if(!x.stoppedAt&&now-(Number(x.updatedAt)||0)<15*60000)open++;}
 const lo=billing.loyalty(store),cfg=landing.get(store),plan=store.get('plans',sub.planId);
 const plans=portal.plans(store,sub.service==='pppoe',now).map(p=>({id:p.id,name:p.name,price:p.price,duration:p.duration,available:p.available,current:p.id===sub.planId}));
 return {account:sub.username,name:sub.name,phone:sub.phone||'',service:sub.service,status:base.status,expiresAt:sub.expiresAt??null,plan:plan?.name||'',price:plan?.price??null,
  points:sub.points||0,loyalty:{enabled:!!lo.enabled,perPoint:lo.pointValue},balance:sub.balance||0,usage:{down,up,days:30,lastReport:last||null,sessions:n,online:open>0},plans,
  connection:connection(store,sub,now),tvs:(sub.tvs||[]).map(t=>({mac:t.mac,name:t.name||''})),brand:{name:cfg.brandName||'',color:cfg.brandColor||'#0032fd',phone:cfg.phone||'',whatsapp:cfg.whatsapp||''},mpesa:true,sharedCode:verified.shareCode||null};}
// Customer-run actions from the account page. Reset closes this account's own stale session records so a stuck device
// limit clears; it does not touch the router or the package. TVs are devices that sign in by MAC address.
const MAXTV=3;
function resetSessions(store,sub,now=Date.now()){let n=0;for(const x of store.sessionsOf(sub.username,now-86400000)){if(!x.stoppedAt){store.db.prepare("UPDATE records SET body=?,version=version+1,updated=? WHERE kind='radiusSessions' AND id=?").run(JSON.stringify({...x,stoppedAt:now,updatedAt:now,terminateCause:'User-Reset'}),now,x.id);n++;}}return n;}
function normMac(v){const m=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');if(m.length!==12){const e=new Error('A MAC address has 12 characters, like AA:BB:CC:11:22:33');e.status=400;throw e;}return m.match(/.{2}/g).join(':');}
function addTv(store,sub,input){
 if(sub.service!=='hotspot'){const e=new Error('TVs can only be registered on hotspot accounts');e.status=400;throw e;}
 const mac=normMac(input.mac),name=String(input.name||'').replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,40),tvs=sub.tvs||[];
 if(tvs.some(t=>t.mac===mac)){const e=new Error('That TV is already registered');e.status=409;throw e;}
 if(tvs.length>=MAXTV){const e=new Error('You can register up to '+MAXTV+' TVs');e.status=409;throw e;}
 const other=store.list('subscribers').find(s=>s.id!==sub.id&&(s.tvs||[]).some(t=>t.mac===mac));if(other){const e=new Error('That TV is registered on another account');e.status=409;throw e;}
 return store.put('subscribers',{...sub,tvs:[...tvs,{mac,name,addedAt:Date.now()}]},sub);}
function removeTv(store,sub,macValue){const mac=normMac(macValue);return store.put('subscribers',{...sub,tvs:(sub.tvs||[]).filter(t=>t.mac!==mac)},sub);}
module.exports={key,token,subscriberOf,view,resetSessions,addTv,removeTv};
