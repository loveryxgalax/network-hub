'use strict';
// What a hotspot customer can do from the WiFi page without typing a password, based on the device they are on:
// connect straight away when their package is still running, connect with an M-Pesa code, and see their usage.
// Logins are only ever handed out as a CHAP response (never the plain password), and every lookup is rate limited by the caller.
const landing=require('./landing.cjs'),portal=require('./portal.cjs'),radius=require('./radius.cjs');
const crypto=require('node:crypto');
const norm=m=>landing.mac(m)||'';
// A MAC address is only a claim (anyone can type or forge one into the portal link), so a device is trusted by a secret that only
// its own browser holds. The first time a device is recognised it is given one (trust on first use); after that, a request for
// that MAC without the matching secret is treated as "not found", so a forged MAC cannot be auto-connected or read.
const hashT=t=>crypto.createHash('sha256').update(String(t||'')).digest('hex');
function tokenOk(sub,m,token){const h=sub.devTokens?.[m];if(!h||!token)return false;const a=Buffer.from(hashT(token)),b=Buffer.from(h);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function issue(store,sub,m){const t=crypto.randomBytes(18).toString('base64url'),cur=store.get('subscribers',sub.id)||sub,all={...(cur.devTokens||{}),[m]:hashT(t)},keys=Object.keys(all);if(keys.length>10)delete all[keys[0]];store.put('subscribers',{...cur,devTokens:all},cur);return t;}
// Admin "View portal": a short-lived signed token (10 minutes) so staff can see a customer's portal without the customer's device secret.
const pvSig=(store,m,exp)=>crypto.createHmac('sha256',require('./selfservice.cjs').key(store)).update(m+'|'+exp).digest('base64url');
function previewToken(store,macValue,now=Date.now()){const m=norm(macValue);if(!m)return null;const exp=now+600000;return 'pv.'+exp+'.'+pvSig(store,m,exp);}
function previewOk(store,m,token,now=Date.now()){const [p,exp,sig]=String(token||'').split('.');if(p!=='pv'||!(Number(exp)>now))return false;const a=Buffer.from(pvSig(store,m,exp)),b=Buffer.from(String(sig||''));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
const okFor=(store,sub,m,token,now)=>tokenOk(sub,m,token)||previewOk(store,m,token,now);
// Called after something proved who is on this device (a phone check, a code, a login): trust it from now on.
function trust(store,username,macValue){const m=norm(macValue),sub=m&&store.subscriberByUsername(String(username||'').toLowerCase());return sub&&sub.service==='hotspot'?issue(store,sub,m):null;}
const live=(s,now)=>s.status==='active'&&(s.expiresAt==null||s.expiresAt>now);
function byMac(store,macValue,now=Date.now(),token='',needToken=true){
 const m=norm(macValue);if(!m)return null;
 const hit=store.sessionsSince(now-15*60000).filter(x=>norm(x.mac)===m&&now-x.updatedAt<15*60000).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
 const subs=store.list('subscribers').filter(s=>s.service==='hotspot');
 const sub=(hit&&subs.find(s=>s.username===hit.username))||subs.find(s=>norm(s.lastMac)===m)||null;
 return sub&&(!needToken||okFor(store,sub,m,token,now))?sub:null;}
const chapOnly=input=>{if(!(typeof input.chapId==='string'&&input.chapId&&typeof input.chapChallenge==='string'&&input.chapChallenge)){const e=new Error('Open this page from the WiFi network to connect');e.status=400;throw e;}};
function active(store,macValue,now=Date.now(),token=''){
 const s=byMac(store,macValue,now,token,false);if(!s||!live(s,now))return {found:false};
 const p=store.get('plans',s.planId);return {found:true,account:s.username,plan:p?.name||'',planId:s.planId,expiresAt:s.expiresAt??null,left:s.expiresAt==null?null:s.expiresAt-now,trusted:okFor(store,s,norm(macValue),token,now)};}
function connectNow(store,input,now=Date.now()){
 chapOnly(input);const s=byMac(store,input.mac,now,input.dt);if(!s||!live(s,now)){const e=new Error('No active package found for this device');e.status=404;throw e;}
 return portal.login(store,{username:s.username,password:radius.password(store,s.id),chapId:input.chapId,chapChallenge:input.chapChallenge});}
// "Connect with M-Pesa code": the confirmation code from an M-Pesa payment that credited a hotspot account.
function codeLogin(store,input,now=Date.now()){
 const code=String(input.code||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(code.length<8||code.length>14){const e=new Error('Enter the M-Pesa confirmation code, like UK3IF0TW26');e.status=400;throw e;}
 let sub=null;
 for(const p of store.list('subscriberPayments'))if(String(p.reference||'').toUpperCase().replace(/[^A-Z0-9]/g,'')===code){sub=store.get('subscribers',p.subscriberId);break;}
 if(!sub)for(const p of store.list('portalPayments'))if(p.status==='paid'&&String(p.mpesaReceipt||'').toUpperCase()===code){sub=store.list('subscribers').find(s=>s.id===p.subscriberId||s.username===p.username)||null;break;}
 if(!sub||sub.service!=='hotspot'||!live(sub,now)){const e=new Error('We could not connect with that code. It may be wrong, or the package has ended.');e.status=404;throw e;}
 const mode=refMode(store,sub,input.nas);
 if(mode==='off'){const e=new Error('Connecting with a payment code is turned off. Sign in with your account details.');e.status=403;throw e;}
 // Renewal pages have no CHAP challenge. Recognise an already connected, verified browser without returning credentials.
 if(!input.chapId||!input.chapChallenge){
  const m=norm(input.mac),own=tokenOk(sub,m,input.dt),connected=m&&store.sessionsSince(now-15*60000).some(x=>x.username===sub.username&&norm(x.mac)===m&&!x.stoppedAt&&now-x.updatedAt<15*60000);
  if(own&&connected)return {alreadyConnected:true,account:sub.username,mode};
  chapOnly(input);
 }
 const moved=mode==='migration'?migrate(store,sub,input.mac,now):null;
 const dt=input.mac?trust(store,sub.username,input.mac):null;
 return {...portal.login(store,{username:sub.username,password:radius.password(store,sub.id),chapId:input.chapId,chapChallenge:input.chapChallenge}),...(dt?{dt}:{}),mode,...(moved?{moved:moved.devices}:{})};}
// Payment reference login (ISPman's "Sharing" / "Migration"): the customer's own setting, else the router's, else the ISP's.
//  sharing:   the code signs this device in as one more device on the package (the package's device limit still applies);
//  migration: the package moves to this device: the other devices' sessions are ended and they are no longer trusted.
const MODES=['off','sharing','migration'];
function refMode(store,sub,nas){if(MODES.includes(sub.payRefLogin))return sub.payRefLogin;
 const n=String(nas||'').trim().toLowerCase(),r=n&&store.list('devices').find(d=>d.type==='router'&&(d.name.toLowerCase()===n||d.ip===n||d.tunnelIp===n));
 if(r&&MODES.includes(r.payRefLogin))return r.payRefLogin;return MODES.includes(radius.settings(store).payRefLogin)?radius.settings(store).payRefLogin:'sharing';}
function migrate(store,sub,macValue,now=Date.now()){const keep=norm(macValue),others=new Set();
 for(const x of store.sessionsOf(sub.username,now-864e5)){if(x.stoppedAt||norm(x.mac)===keep)continue;if(x.mac)others.add(norm(x.mac));
  store.db.prepare("UPDATE records SET body=?,version=version+1,updated=? WHERE kind='radiusSessions' AND id=?").run(JSON.stringify({...x,stoppedAt:now,updatedAt:now,terminateCause:'Payment-Ref-Migration'}),now,x.id);}
 const cur=store.get('subscribers',sub.id)||sub,tokens={...(cur.devTokens||{})};for(const m of Object.keys(tokens))if(m!==keep)delete tokens[m];
 store.put('subscribers',{...cur,devTokens:tokens,...(keep?{lastMac:keep}:{})},cur);
 // Drop the old devices on the router too, when it has the job runner (otherwise they stop at their next re-login).
 let rid='';try{rid=require('./compensation.cjs').routerOf(store).get(sub.username)||'';}catch{}
 if(rid&&store.secret('jobs:'+rid))for(const m of others){try{require('./jobs.cjs').create(store,{routerId:rid,type:'reset-device',params:{mac:m},subscriberId:sub.id},now);}catch{}}
 if(others.size)store.audit({id:'system'},`Moved ${sub.username}'s package to ${keep||'a new device'} with their payment code (${others.size} other device${others.size>1?'s':''} signed out)`,sub.id);
 return {devices:others.size};}
const mask=r=>{const t=String(r||'');return t.length>5?'•'.repeat(t.length-4)+t.slice(-4):t;};
function usage(store,macValue,now=Date.now(),token=''){
 const s=byMac(store,macValue,now,token);if(!s)return {found:false};
 const all=store.sessionsOf(s.username,0),ses=all.map(x=>({start:x.startedAt||x.updatedAt,end:x.stoppedAt||x.updatedAt,down:Number(x.downloadBytes)||0,up:Number(x.uploadBytes)||0,open:!x.stoppedAt&&now-x.updatedAt<=15*60000})).sort((a,b)=>b.start-a.start);
 const since=now-30*86400000,sum=(f,t)=>ses.filter(x=>x.start>=f&&x.start<t).reduce((a,x)=>({down:a.down+x.down,up:a.up+x.up}),{down:0,up:0});
 const pays=store.list('subscriberPayments').filter(p=>p.subscriberId===s.id).map(p=>({time:p.time||p.created,amount:p.amount,ref:mask(p.reference),plan:p.planName||''})).sort((a,b)=>b.time-a.time);
 const asc=[...pays].reverse(),connects=asc.map((p,i)=>{const end=asc[i+1]?.time??now+1,u=sum(p.time,end);return {time:p.time,plan:p.plan,amount:p.amount,down:u.down,up:u.up,status:i===asc.length-1&&live(s,now)?'active':'expired'};}).reverse();
 const tot=ses.reduce((a,x)=>({down:a.down+x.down,up:a.up+x.up}),{down:0,up:0}),l30=sum(since,now+1);
 const lo=require('./billing.cjs').loyalty(store);return {found:true,account:s.username,points:s.points||0,loyalty:{enabled:!!lo.enabled,pointValue:lo.pointValue},wallet:s.balance||0,total:tot,last30:l30,payments:pays.slice(0,60),connects:connects.slice(0,60),sessions:ses.slice(0,60)};}
function redeem(store,input){const s=byMac(store,input.mac,Date.now(),input.dt);if(!s){const e=new Error('We could not find your account on this device');e.status=404;throw e;}
 const saved=require('./billing.cjs').redeemPoints(store,s.id,s.points||0);return {points:saved.points||0,wallet:saved.balance||0};}
// "Which account is on this device" for the landing page header, held to the same device-secret rule.
function session(store,macValue,now=Date.now(),token=''){const s=byMac(store,macValue,now,token);if(!s)return {found:false};return landing.account(store,s.username,now,'');}
module.exports={refMode,migrate,redeem,active,connectNow,codeLogin,usage,byMac,session,trust,tokenOk,previewToken};
