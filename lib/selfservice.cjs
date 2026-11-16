'use strict';
const STALE=15*60000;
// A customer's own account page (/portal/account.html?t=TOKEN). The link staff send carries a signed token, so
// opening it shows the account without a PIN; it cannot be guessed, stops working after 60 days and never
// carries a password. Staff can issue a fresh link at any time.
const crypto=require('node:crypto'),landing=require('./landing.cjs'),portal=require('./portal.cjs'),billing=require('./billing.cjs');
const TTL=60*86400000;
function key(store){let k=store.secret('selfservice:key');if(!k){k={k:crypto.randomBytes(32).toString('hex')};store.secret('selfservice:key',k);}return k.k;}
function sign(store,body){return crypto.createHmac('sha256',key(store)).update(body).digest('base64url').slice(0,32);}
// Each session carries its own id (j) and the account's session epoch (v). Logging out revokes that id; a password change
// raises the epoch and so ends every older session at once.
function token(store,sub,now=Date.now()){const cur=store.get('subscribers',sub.id)||sub;const body=Buffer.from(JSON.stringify({s:sub.id,e:now+TTL,j:crypto.randomBytes(9).toString('base64url'),v:cur.sessionEpoch||0})).toString('base64url');return body+'.'+sign(store,body);}
function claims(store,tok,now=Date.now()){const [body,sig]=String(tok||'').split('.');if(!body||!sig)return null;
 const want=Buffer.from(sign(store,body)),got=Buffer.from(sig);if(want.length!==got.length||!crypto.timingSafeEqual(want,got))return null;
 let p;try{p=JSON.parse(Buffer.from(body,'base64url').toString());}catch{return null;}return p&&p.e>now?p:null;}
const revoked=store=>store.setting('customerSessionsRevoked')||{};
// Customer logout: this session stops working everywhere (every tab and every copy of the link). Older links without a
// session id can only be ended together, so their logout ends all of that account's sessions.
function logout(store,tok,now=Date.now()){const p=claims(store,tok,now);if(!p)return {ok:true};const sub=store.get('subscribers',p.s);if(!sub)return {ok:true};
 store.transaction(()=>{
  // A session that is already invalid (older epoch, already revoked) changes nothing: retrying the logout of an old link
  // must not end the sessions created after it.
  const cur=store.get('subscribers',sub.id);if(!cur||(p.v||0)!==(cur.sessionEpoch||0)||(p.j&&revoked(store)[p.j]))return;
  if(p.j){const r=revoked(store),keep={};for(const [k,exp] of Object.entries(r))if(exp>now)keep[k]=exp;keep[p.j]=p.e;store.setting('customerSessionsRevoked',keep);}
  else store.put('subscribers',{...cur,sessionEpoch:(cur.sessionEpoch||0)+1},cur);});
 return {ok:true};}
function subscriberOf(store,tok,now=Date.now()){const p=claims(store,tok,now);if(!p)return null;
 const sub=store.get('subscribers',p.s);if(!sub)return null;if((p.v||0)!==(sub.sessionEpoch||0))return null;if(p.j&&revoked(store)[p.j])return null;return sub;}
function connection(store,sub,now){
 if(sub.service!=='hotspot')return null;const STALE=15*60000;
 const open=store.sessionsOf(sub.username,now-86400000).filter(x=>!x.stoppedAt&&now-x.updatedAt<STALE).sort((a,b)=>b.updatedAt-a.updatedAt);
 const last=open[0]||store.sessionsOf(sub.username,0)[0]||null;
 // Same "connected now" rule as the rest of netops: the routers' own active lists plus RADIUS accounting, with registered
 // TVs / share codes counted for their owner. The MACs let the page tell "this device" from another device on the account.
 let rows=[];try{const R=require('./radius.cjs'),al=R.aliases(store),me=String(sub.username).toLowerCase();rows=require('./online.cjs').connections(store,now).rows.filter(r=>r.service==='hotspot'&&(String(r.username).toLowerCase()===me||String(r.radius?.account||'').toLowerCase()===me||al.get(R.aliasKey(r.username))?.id===sub.id));}catch{}
 const macs=[...new Set([...rows.map(r=>r.mac),...open.map(x=>require('./online.cjs').macOf(x.mac))].filter(Boolean))];
 return {connected:rows.length>0||open.length>0,devices:Math.max(rows.length,open.length),macs,ip:rows[0]?.ip||last?.ip||'',};}
function resetPossible(store,sub){try{const rid=require('./compensation.cjs').routerOf(store).get(sub.username);return sub.service==='pppoe'?!!(rid&&store.secret('jobs:'+rid)):true;}catch{return false;}}
// Usage on the account page counts RADIUS accounting and, where a router is not sending accounting to netops,
// the byte counters that router reports for the customer's PPPoE line (taking the larger of the two each day).
function maskRef(r){const t=String(r||'');return t.length>5?'•'.repeat(t.length-4)+t.slice(-4):t;}
function recentPayments(store,sub){return store.list('subscriberPayments').filter(p=>p.subscriberId===sub.id&&!p.reversedAt).sort((a,b)=>(b.time||b.created)-(a.time||a.created)).slice(0,5).map(p=>({time:p.time||p.created,amount:p.amount,method:p.method||'',ref:maskRef(p.reference)}));}
function weeklyUsageMB(store,sub,now){try{const d=require('./insights.cjs').dailyUse(store,sub,now);return Array.isArray(d)?d.slice(-7).map(v=>Math.round(v)):[];}catch{return [];}}
function usageOf(store,sub,now,r){let u=null;try{u=require('./usage.cjs').summary(store,sub,now);}catch{}
 const out={down:r.down,up:r.up,days:30,lastReport:r.last||null,sessions:r.n,online:r.open>0,month:{down:r.mDown,up:r.mUp},all:{down:r.aDown,up:r.aUp,sessions:r.aN},source:r.aN?'radius':'none'};
 if(u){out.month={down:Math.max(r.mDown,u.month.down),up:Math.max(r.mUp,u.month.up)};out.down=Math.max(r.down,u.last30.down);out.up=Math.max(r.up,u.last30.up);out.all={down:Math.max(r.aDown,u.all.down),up:Math.max(r.aUp,u.all.up),sessions:r.aN};out.source=u.source==='none'&&r.aN?'radius':u.source;}
 return out;}
function view(store,sub,now=Date.now()){
 const base=landing.accountRaw(store,sub.username,now),verified=landing.account(store,sub.username,now,'');
 let down=0,up=0,last=0,open=0,n=0,mDown=0,mUp=0,aDown=0,aUp=0,aN=0;const since=now-30*86400000,ms=new Date(now+3*36e5);ms.setUTCDate(1);ms.setUTCHours(0,0,0,0);const monthStart=ms.getTime()-3*36e5;
 for(const x of store.sessionsOf(sub.username,0)){const dn=Number(x.downloadBytes)||0,upb=Number(x.uploadBytes)||0,u=Number(x.updatedAt)||0;aN++;aDown+=dn;aUp+=upb;last=Math.max(last,u);if(u>=monthStart){mDown+=dn;mUp+=upb;}if(u>=since){n++;down+=dn;up+=upb;}if(!x.stoppedAt&&now-u<15*60000)open++;}
 const lo=billing.loyalty(store),cfg=landing.get(store),plan=store.get('plans',sub.planId);
 const plans=portal.plans(store,sub.service==='pppoe',now).map(p=>({id:p.id,name:p.name,price:p.id===sub.planId?billing.priceOf(sub,store.get('plans',p.id)):p.price,duration:p.duration,available:p.available,current:p.id===sub.planId}));
 return {account:sub.username,name:sub.name,phone:sub.phone||'',service:sub.service,status:base.status,banned:!!sub.banned,expiresAt:sub.expiresAt??null,plan:plan?.name||'',price:plan?billing.priceOf(sub,plan):null,installFeeDue:sub.installFeeDue||0,
  points:sub.points||0,loyalty:{enabled:!!lo.enabled,perPoint:lo.pointValue},balance:sub.balance||0,usage:usageOf(store,sub,now,{down,up,last,n,open,mDown,mUp,aDown,aUp,aN}),email:sub.email||'',planInfo:plan?{name:plan.name,price:billing.priceOf(sub,plan),duration:plan.durationValue+' '+(plan.durationValue===1?String(plan.durationUnit).replace(/s$/,''):plan.durationUnit),downMbps:plan.downloadMbps,upMbps:plan.uploadMbps}:null,canChange:!sub.banned&&require('./radius.cjs').settings(store).selfPackageChange!==false,canReset:!sub.banned&&resetPossible(store,sub),plans,
  share:(()=>{try{const sc=require('./sharecode.cjs');if(!sc.enabled(store))return null;const c=sc.codeOf(store,sub);if(!c)return null;const used=store.sessionsOf(sub.username,now-86400000).filter(x=>!x.stoppedAt&&now-x.updatedAt<STALE).length;return {code:c,left:Math.max(0,sc.devicesOf(store,sub)-used)};}catch{return null;}})(),
  connection:connection(store,sub,now),tvs:(sub.tvs||[]).map(t=>({mac:t.mac,name:t.name||''})),brand:{name:cfg.brandName||'',color:cfg.brandColor||'#0032fd',phone:cfg.phone||'',whatsapp:cfg.whatsapp||''},mpesa:true,sharedCode:verified.shareCode||null,recentPayments:recentPayments(store,sub),weeklyUsageMB:weeklyUsageMB(store,sub,now)};}
// Customer-run actions from the account page. Reset closes this account's own stale session records so a stuck device
// limit clears; it does not touch the router or the package. TVs are devices that sign in by MAC address.
// Reset connection: hotspot customers clear their own stale session records; a PPPoE customer's line is dropped through the router
// job channel (the router redials in seconds). The router must have the job runner installed.
function reset(store,sub,now=Date.now()){require('./restrictions.cjs').assertAllowed(sub);
 if(sub.service!=='pppoe'){return {closed:resetSessions(store,sub,now)};}
 const r=require('./livechange.cjs').kickNow(store,sub,'a reset connection',now);return r.queued?{queued:true}:{queued:false,why:r.skipped};}
const MAXTV=3;
// Reset: the customer asks to drop their live hotspot session(s). Accounting records are never edited (no invented Stop);
// the request is kept on its own, a disconnect job goes to the router when it has the job runner, and a slot is only freed
// when the router's Stop arrives. The same device can always log in again meanwhile (re-authentication never needs a slot).
function resetSessions(store,sub,now=Date.now()){const open=store.sessionsOf(sub.username,now-86400000).filter(x=>!x.stoppedAt&&now-x.updatedAt<STALE);
 const log=store.setting('resetRequests')||{items:[]};log.items=[{at:now,subscriberId:sub.id,username:sub.username,sessions:open.map(x=>x.sessionId)},...log.items].slice(0,500);store.setting('resetRequests',log);
 let job=null;if(open.length){try{job=require('./livechange.cjs').kickNow(store,sub,'a reset connection',now);}catch{}}
 return open.length;}
function normMac(v){const m=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');if(m.length!==12){const e=new Error('A MAC address has 12 characters, like AA:BB:CC:11:22:33');e.status=400;throw e;}return m.match(/.{2}/g).join(':');}
function addTv(store,sub,input){require('./restrictions.cjs').assertAllowed(sub);
 if(sub.service!=='hotspot'){const e=new Error('TVs can only be registered on hotspot accounts');e.status=400;throw e;}
 const mac=normMac(input.mac),name=String(input.name||'').replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,40),tvs=sub.tvs||[];
 if(tvs.some(t=>t.mac===mac)){const e=new Error('That TV is already registered');e.status=409;throw e;}
 if(tvs.length>=MAXTV){const e=new Error('You can register up to '+MAXTV+' TVs');e.status=409;throw e;}
 const other=store.list('subscribers').find(s=>s.id!==sub.id&&(s.tvs||[]).some(t=>t.mac===mac));if(other){const e=new Error('That TV is registered on another account');e.status=409;throw e;}
 // A TV MAC becomes a login for this account, so it must not be a device another account already uses: its last or bound
 // device, a device it trusts, or a device online on it in the last 15 minutes. Otherwise registering a neighbour's MAC
 // would take over (or bill) their device.
 const nm=v=>{try{return normMac(v);}catch{return '';}},recent=Date.now()-15*60000;
 const usedElsewhere=store.list('subscribers').some(s=>s.id!==sub.id&&(nm(s.lastMac)===mac||nm(s.boundMac)===mac||Object.keys(s.devTokens||{}).some(k=>nm(k)===mac)||String(s.username).toLowerCase()===mac.toLowerCase()))
  ||store.sessionsSince(recent).some(x=>nm(x.mac)===mac&&x.username!==sub.username&&String(x.username).toLowerCase()!==mac.toLowerCase()&&!x.stoppedAt);// a session under the TV's own MAC login is the TV itself
 if(usedElsewhere){const e=new Error('That device is in use on another account and cannot be registered as a TV');e.status=409;throw e;}
 return store.put('subscribers',{...sub,tvs:[...tvs,{mac,name,addedAt:Date.now()}]},sub);}
// (Sessions the TV starts from now on are attributed to this account by RADIUS accounting.)
// Removing a TV stops it logging in again: its alias goes and the account forgets the secret its browser was given.
// Its past sessions stay attributed to the account. A session already open on the router is not cut here (that needs a
// disconnect on the router); it ends at its next re-login or when staff disconnect it.
function removeTv(store,sub,macValue){require('./restrictions.cjs').assertAllowed(sub);const mac=normMac(macValue);const cur=store.get('subscribers',sub.id)||sub,tokens={...(cur.devTokens||{})};delete tokens[mac];
 const online=store.sessionsSince(Date.now()-STALE).some(x=>String(x.username).toUpperCase()===mac&&!x.stoppedAt);
 const saved=store.put('subscribers',{...cur,tvs:(cur.tvs||[]).filter(t=>t.mac!==mac),devTokens:tokens,removedTvs:[...(cur.removedTvs||[]).filter(t=>t.mac!==mac),{mac,removedAt:Date.now()}].slice(-20)},cur);
 // If the TV is connected right now, ask its router to drop it (session, cookie and host entry) so the removal takes effect
 // at once. Needs the router's job runner; without it the session runs until it ends and the result says so.
 let cut='not online';if(online){cut='router has no job runner; ends at its next login';
  if(process.env.NETWORK_PASSIVE==='1')cut='rehearsal copy';
  else{try{const rid=require('./compensation.cjs').routerOf(store).get(mac.toLowerCase())||require('./compensation.cjs').routerOf(store).get(cur.username)||'';
   if(rid&&store.secret('jobs:'+rid)){require('./jobs.cjs').create(store,{routerId:rid,type:'reset-device',params:{mac},subscriberId:cur.id},Date.now());cut='disconnect sent to the router';
    store.audit({id:'system'},`Removed TV ${mac} from ${cur.username}: disconnect sent to its router`,cur.id);}}catch(e){cut='could not queue the disconnect: '+String(e.message).slice(0,80);}}}
 return Object.assign(saved,{tvStillOnline:online,tvDisconnect:cut});}
// Customer edits their own phone / email (empty value removes it). Phone is stored in the usual local form.
function setContact(store,sub,input){const cur=store.get('subscribers',sub.id)||sub,out={...cur};
 if('phone' in input){const raw=String(input.phone||'').trim();if(!raw)out.phone='';else{const n=require('./billing.cjs').phone(raw);if(!n)throw Object.assign(new Error('Enter a valid phone number, e.g. 0712 345 678'),{status:400});out.phone=n.replace(/^\+254/,'0');}}
 if('email' in input){const e=String(input.email||'').trim().slice(0,120);if(e&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw Object.assign(new Error('Enter a valid email address'),{status:400});out.email=e;}
 store.put('subscribers',out,cur);return out;}
module.exports={setContact,key,token,subscriberOf,logout,view,reset,resetSessions,addTv,removeTv};
