'use strict';
// What a hotspot customer can do from the WiFi page without typing a password, based on the device they are on:
// connect straight away when their package is still running, connect with an M-Pesa code, and see their usage.
// Logins are only ever handed out as a CHAP response (never the plain password), and every lookup is rate limited by the caller.
const landing=require('./landing.cjs'),portal=require('./portal.cjs'),radius=require('./radius.cjs');
const crypto=require('node:crypto');
const norm=m=>landing.mac(m)||'';
// The MAC address and CHAP challenge in a request come from the caller, so neither proves anything: anyone can copy a
// neighbour's MAC into the portal link or make up a challenge. Recognising a device, connecting it and issuing it a new
// device secret need one of: this device's secret (issued after a password, code, phone or payment proof), or a signed
// customer account session for the same account. The challenge is only used to compute the answer once that is proven.
// A MAC address is only a claim (anyone can type or forge one into the portal link), so a device is trusted by a secret that only
// its own browser holds. The first time a device is recognised it is given one (trust on first use); after that, a request for
// that MAC without the matching secret is treated as "not found", so a forged MAC cannot be auto-connected or read.
const hashT=t=>crypto.createHash('sha256').update(String(t||'')).digest('hex');
// On open WiFi the router's pages are plain HTTP, so someone on the same network could copy a device secret out of a
// customer's browser. The hub cannot encrypt those pages, so it limits what a copied secret is worth:
//  * the secret changes every time the device connects (the old one is remembered only to spot reuse);
//  * presenting an old, already-replaced secret means two holders exist: the device's secret is revoked and logged, and
//    the customer proves the device again (password, M-Pesa code or phone check);
//  * a secret not used for 30 days stops working.
// A stored secret is {h: hash, at: last used, prev: hash it replaced}; older records are just the hash.
const IDLE=30*86400000,GRACE=120000,rec=v=>typeof v==='string'?{h:v,at:0,prev:''}:(v||{h:'',at:0,prev:''});
const same=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);};
function tokenOk(sub,m,token,now=Date.now()){const r=rec(sub.devTokens?.[m]);if(!r.h||!token)return false;if(r.at&&now-r.at>IDLE)return false;const h=hashT(token);
 // For two minutes after a change the previous secret still works, so a reply lost on weak WiFi does not lock the device out.
 return same(h,r.h)||(!!r.prev&&now-r.at<GRACE&&same(h,r.prev));}
function issue(store,sub,m,rotate=false,now=Date.now()){const t=crypto.randomBytes(18).toString('base64url'),cur=store.get('subscribers',sub.id)||sub,old=rec(cur.devTokens?.[m]),all={...(cur.devTokens||{}),[m]:{h:hashT(t),at:now,prev:rotate?old.h:''}},keys=Object.keys(all);if(keys.length>10)delete all[keys[0]];store.put('subscribers',{...cur,devTokens:all},cur);return t;}
// A replaced secret shown again: revoke the device's current secret and record it. Returns true when that happened.
function reused(store,sub,m,token,now=Date.now()){const r=rec(sub.devTokens?.[m]);if(!token||!r.prev||now-r.at<GRACE||!same(hashT(token),r.prev))return false;
 const cur=store.get('subscribers',sub.id)||sub,all={...(cur.devTokens||{})};delete all[m];store.put('subscribers',{...cur,devTokens:all},cur);
 try{store.audit({id:'system'},`Device secret for ${m} on ${cur.username} was used after it had been replaced (possible copy on open WiFi). The device must prove itself again.`,cur.id);}catch{}return true;}
// Keep "last used" fresh (at most one write a day) so secrets in regular use never expire.
function touch(store,sub,m,now=Date.now()){const r=rec(sub.devTokens?.[m]);if(!r.h||now-r.at<86400000)return;const cur=store.get('subscribers',sub.id)||sub;if(!cur.devTokens?.[m])return;store.put('subscribers',{...cur,devTokens:{...cur.devTokens,[m]:{...rec(cur.devTokens[m]),at:now}}},cur);}
// Admin "View portal": a short-lived signed token (10 minutes) so staff can see a customer's portal without the customer's device secret.
const pvSig=(store,m,exp)=>crypto.createHmac('sha256',require('./selfservice.cjs').key(store)).update(m+'|'+exp).digest('base64url');
function previewToken(store,macValue,now=Date.now()){const m=norm(macValue);if(!m)return null;const exp=now+600000;return 'pv.'+exp+'.'+pvSig(store,m,exp);}
function previewOk(store,m,token,now=Date.now()){const [p,exp,sig]=String(token||'').split('.');if(p!=='pv'||!(Number(exp)>now))return false;const a=Buffer.from(pvSig(store,m,exp)),b=Buffer.from(String(sig||''));return a.length===b.length&&crypto.timingSafeEqual(a,b);}
const okFor=(store,sub,m,token,now)=>tokenOk(sub,m,token,now)||previewOk(store,m,token,now);
function sessionOk(store,sub,st,now=Date.now()){if(!st)return false;try{const x=require('./selfservice.cjs').subscriberOf(store,st,now);return !!x&&x.id===sub.id;}catch{return false;}}
// Connecting (a CHAP answer) needs the device's own secret or the account's session. A staff preview token only views.
const mayConnect=(store,sub,m,input,now)=>tokenOk(sub,m,input.dt,now)||sessionOk(store,sub,input.st,now);
// Customer logout on this device: the account forgets the secret this browser holds (other devices keep theirs).
function forget(store,sub,token){if(!sub||!token)return false;const h=hashT(token),cur=store.get('subscribers',sub.id)||sub,all={...(cur.devTokens||{})};let hit=false;
 for(const [m,v] of Object.entries(all))if(rec(v).h===h){delete all[m];hit=true;}if(hit)store.put('subscribers',{...cur,devTokens:all},cur);return hit;}
// Called after something proved who is on this device (a phone check, a code, a login): trust it from now on.
function trust(store,username,macValue,rotate=false){const m=norm(macValue),sub=m&&store.subscriberByUsername(String(username||'').toLowerCase());return sub&&sub.service==='hotspot'?issue(store,sub,m,rotate):null;}
const live=(s,now)=>!s.banned&&s.status==='active'&&(s.expiresAt==null||s.expiresAt>now);
function byMac(store,macValue,now=Date.now(),token='',needToken=true){
 const m=norm(macValue);if(!m)return null;
 const hit=store.sessionsSince(now-15*60000).filter(x=>norm(x.mac)===m&&now-x.updatedAt<15*60000).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
 const subs=store.list('subscribers').filter(s=>s.service==='hotspot');
 // A valid device secret identifies its own account directly (also for a device that is not online and not the last used).
 if(token&&!String(token).startsWith('pv.')){const hit2=subs.find(s=>reused(store,s,m,token,now));if(hit2)return null;}
 const byTok=token?subs.find(s=>tokenOk(s,m,token,now)):null;if(byTok)touch(store,byTok,m,now);
 const sub=byTok||(hit&&subs.find(s=>s.username===hit.username))||subs.find(s=>norm(s.lastMac)===m)||null;
 return sub&&(!needToken||okFor(store,sub,m,token,now))?sub:null;}
const chapOnly=input=>{if(!(typeof input.chapId==='string'&&input.chapId&&typeof input.chapChallenge==='string'&&input.chapChallenge)){const e=new Error('Join our WiFi first, then open this page again and tap Connect.');e.status=400;throw e;}};
function active(store,macValue,now=Date.now(),token=''){
 const s=byMac(store,macValue,now,token,true);if(!s||!live(s,now))return {found:false};
 const p=store.get('plans',s.planId),left=s.expiresAt==null?null:s.expiresAt-now;let total=null;try{if(p&&left!=null)total=Math.max(require('./radius.cjs').planMs(p),left);}catch{}
 // total: the package length (or the time left, if more was stacked) so the status page can show the share left.
 return {found:true,account:s.username,plan:p?.name||'',planId:s.planId,expiresAt:s.expiresAt??null,left,total,trusted:true};}
function connectNow(store,input,now=Date.now()){
 chapOnly(input);const m=norm(input.mac);let cand=byMac(store,input.mac,now,input.dt,false);
 const s=cand&&mayConnect(store,cand,m,input,now)?cand:null;if(!s||!live(s,now)){const e=new Error('No active package found for this device');e.status=404;throw e;}
 // Every connect replaces the device secret (the reply carries the new one for this browser).
 const out=portal.login(store,{username:s.username,password:radius.password(store,s.id),chapId:input.chapId,chapChallenge:input.chapChallenge}),dt=trust(store,s.username,m,true);return {...out,...(dt?{dt}:{})};}
// "Connect now" from an account looked up on the portal: no password needed when this device has already proved it
// belongs to the account (its device secret, or it is the device the account last used / is online on right now).
function connectAccount(store,input,now=Date.now()){chapOnly(input);const m=norm(input.mac),sub=store.subscriberByUsername(String(input.account||'').trim().toLowerCase());
 const no=(msg,st)=>{const e=new Error(msg);e.status=st;throw e;};if(!sub||sub.service!=='hotspot')no('Account not found',404);if(!m)no('Join our WiFi first, then open this page again and tap Connect.',400);
 if(!live(sub,now))no(sub.banned?'This account cannot connect. Please contact support.':'This package is not active. Buy a package below.',403);
 if(input.dt&&reused(store,sub,m,input.dt,now)){const e=new Error('This device must be confirmed again. Enter the hotspot password we sent you by SMS.');e.status=403;e.needPassword=true;throw e;}
 const own=mayConnect(store,sub,m,input,now);
 if(!own){const e=new Error('This device is not linked to the account yet. Enter the hotspot password we sent you by SMS.');e.status=403;e.needPassword=true;throw e;}
 const out=portal.login(store,{username:sub.username,password:radius.password(store,sub.id),mac:m,chapId:input.chapId,chapChallenge:input.chapChallenge,skipTrust:true}),dt=trust(store,sub.username,m,true);return {...out,...(dt?{dt}:{})};}
// "Connect with M-Pesa code": the confirmation code from an M-Pesa payment that credited a hotspot account.
function codeLogin(store,input,now=Date.now()){
 const code=String(input.code||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(code.length<8||code.length>14){const e=new Error('Enter the M-Pesa confirmation code, like UK3IF0TW26');e.status=400;throw e;}
 let sub=null,reversed=false;const clean=r=>String(r||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
 // A reversed payment no longer proves anything: its code cannot sign a device in (the account's own login is unaffected).
 for(const p of store.list('subscriberPayments'))if(clean(p.reference)===code){if(p.reversedAt){reversed=true;continue;}sub=store.get('subscribers',p.subscriberId);break;}
 if(!sub&&!reversed)for(const p of store.list('portalPayments'))if(p.status==='paid'&&String(p.mpesaReceipt||'').toUpperCase()===code){
  if(store.list('subscriberPayments').some(x=>x.reversedAt&&(clean(x.reference)===clean(p.receipt)||clean(x.reference)===code)))break;sub=store.list('subscribers').find(s=>s.id===p.subscriberId||s.username===p.username)||null;break;}
 if(!sub||sub.service!=='hotspot'||!live(sub,now)){const e=new Error('We could not connect with that code. It may be wrong, or the package has ended.');e.status=404;throw e;}
 const mode=refMode(store,sub,input.nas);
 if(mode==='off'){const e=new Error('Connecting with a payment code is turned off. Sign in with your account details.');e.status=403;throw e;}
 // Renewal pages have no CHAP challenge. Recognise an already connected, verified browser without returning credentials.
 if(!input.chapId||!input.chapChallenge){
  const m=norm(input.mac),own=tokenOk(sub,m,input.dt),connected=m&&store.sessionsSince(now-15*60000).some(x=>x.username===sub.username&&norm(x.mac)===m&&!x.stoppedAt&&now-x.updatedAt<15*60000);
  if(own&&connected){const moved=mode==='migration'?migrate(store,sub,input.mac,now):null;return {alreadyConnected:true,account:sub.username,mode,...(moved?{moved:moved.devices}:{})};}
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
 const s=norm(macValue)?byMac(store,macValue,now,token):byToken(store,token);if(!s)return {found:false};
 const all=store.sessionsOf(s.username,0),ses=all.map(x=>({start:x.startedAt||x.updatedAt,end:x.stoppedAt||x.updatedAt,down:Number(x.downloadBytes)||0,up:Number(x.uploadBytes)||0,open:!x.stoppedAt&&now-x.updatedAt<=15*60000})).sort((a,b)=>b.start-a.start);
 const since=now-30*86400000,sum=(f,t)=>ses.filter(x=>x.start>=f&&x.start<t).reduce((a,x)=>({down:a.down+x.down,up:a.up+x.up}),{down:0,up:0});
 // A reversed payment stays in the history, labelled, but is not a purchase.
 const pays=store.list('subscriberPayments').filter(p=>p.subscriberId===s.id).map(p=>({time:p.time||p.created,amount:p.amount,ref:mask(p.reference),plan:p.planName||'',...(p.reversedAt?{reversed:true,reversedAt:p.reversedAt}:{})}))
  // Vouchers this account used count as purchases too (paid when the voucher was sold).
  .concat(store.list('vouchers').filter(v=>v.usedAt&&String(v.usedBy||'').toLowerCase()===String(s.username).toLowerCase()).map(v=>{const pl=store.get('plans',v.planId);return {time:v.usedAt,amount:Number(pl?.price)||0,ref:'Voucher '+mask(v.code),plan:pl?.name||'Voucher',voucher:true};}))
  .sort((a,b)=>b.time-a.time);
 const asc=pays.filter(p=>!p.reversed).reverse(),connects=asc.map((p,i)=>{const end=asc[i+1]?.time??now+1,u=sum(p.time,end);return {time:p.time,plan:p.plan,amount:p.amount,down:u.down,up:u.up,status:i===asc.length-1&&live(s,now)?'active':'expired'};}).reverse();
 const tot=ses.reduce((a,x)=>({down:a.down+x.down,up:a.up+x.up}),{down:0,up:0}),l30=sum(since,now+1);
 const lo=require('./billing.cjs').loyalty(store);return {found:true,account:s.username,points:s.points||0,loyalty:{enabled:!!lo.enabled,pointValue:lo.pointValue},wallet:s.balance||0,total:tot,last30:l30,payments:pays.slice(0,60),connects:connects.slice(0,60),sessions:ses.slice(0,60)};}
function redeem(store,input){const s=norm(input.mac)?byMac(store,input.mac,Date.now(),input.dt):byToken(store,input.dt);if(!s){const e=new Error('We could not find your account on this device');e.status=404;throw e;}
 require('./restrictions.cjs').assertAllowed(s);const saved=require('./billing.cjs').redeemPoints(store,s.id,s.points||0);return {points:saved.points||0,wallet:saved.balance||0};}
// "Which account is on this device" for the landing page header, held to the same device-secret rule.
// A browser that was recognised before (it keeps a device secret) is found even when the page was not opened from the WiFi
// login (so the router did not pass its MAC).
function byToken(store,token){if(!token||String(token).startsWith('pv.'))return null;const h=hashT(String(token));
 return store.list('subscribers').find(s=>s.service==='hotspot'&&Object.values(s.devTokens||{}).some(v=>same(rec(v).h,h)))||null;}
function session(store,macValue,now=Date.now(),token=''){const s=norm(macValue)?byMac(store,macValue,now,token):byToken(store,token);if(!s)return {found:false};return landing.account(store,s.username,now,'');}
module.exports={forget,connectAccount,refMode,migrate,redeem,active,connectNow,codeLogin,usage,byMac,session,trust,tokenOk,previewToken};
