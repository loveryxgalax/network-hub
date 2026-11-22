'use strict';
// Deactivating (suspending) an account: RADIUS refuses every new login at once (status check in radius.authorize), and
// the sessions that are on now are ended with a scoped "disconnect" job on each router that has them. RADIUS cannot end
// a session by itself (there is no CoA), so the router job channel is the only way.
//
// Login names covered: the account's username, its child (family) accounts, its share code and its registered TVs (MAC
// logins). Routers covered: every router with a live connection for one of those names (online.cjs: fresh router
// reports and RADIUS), plus the account's last known router when there is no fresh evidence (a disconnect for a name that
// is not connected changes nothing on the router).
//
// Each disconnect job carries a guard: it is handed to the router only while the account is still suspended by the same
// deactivation. Reactivating cancels queued ones; a job already on its way is reported, never hidden.
const low=v=>String(v??'').trim().toLowerCase();
const SAFE=/^[A-Za-z0-9._@:\- ]{1,64}$/;
function names(store,sub){const out=new Map(),add=v=>{if(v&&SAFE.test(String(v)))out.set(low(v),String(v));};
 add(sub.username);for(const c of store.list('subscribers').filter(x=>x.parentId===sub.id))add(c.username);
 if(sub.shareCode)add(sub.shareCode);for(const t of sub.tvs||[])add(t.mac);return out;}
function enforce(store,sub,{user=null,now=Date.now()}={}){
 const jobs=require('./jobs.cjs'),online=require('./online.cjs'),all=names(store,sub),routers=new Map();
 const devs=new Map(store.list('devices').filter(d=>d.type==='router').map(d=>[d.id,d]));
 // RouterOS compares login names case-sensitively and RADIUS keeps them lowercased, so each router gets the spelling the
 // account has on record and every spelling seen live (a disconnect for a name that is not on changes nothing).
 const want=(rid,name,why)=>{const e=routers.get(rid)||{names:new Map(),why:new Set()};for(const v of new Set([all.get(low(name)),String(name)]))if(v&&SAFE.test(v))e.names.set(v,v);e.why.add(why);routers.set(rid,e);};
 const unidentified=[];
 for(const c of online.connections(store,now).rows){if(!all.has(low(c.username)))continue;if(c.routerId)want(c.routerId,c.username,'live');else unidentified.push(c.router);}
 // No fresh evidence for the account itself: also cover the router it was last seen on.
 if(![...routers.values()].some(e=>e.why.has('live'))){let rid='';try{rid=require('./compensation.cjs').routerOf(store).get(sub.username)||'';}catch{}rid=rid||sub.routerId||'';
  if(rid&&devs.has(rid))for(const n of all.values())want(rid,n,'last-known');}
 const result=[];
 for(const [rid,e] of routers){const r=devs.get(rid);
  if(!store.secret('jobs:'+rid)){result.push({routerId:rid,router:r?.name||rid,status:'unavailable',reason:'no job runner on this router',names:[...e.names.values()],evidence:[...e.why]});continue;}
  for(const n of e.names.values()){
   const dup=store.list('routerJobs').find(j=>j.routerId===rid&&j.type==='disconnect'&&j.params?.username===n&&['queued','sent'].includes(j.status));
   if(dup){// A waiting suspension disconnect from an earlier suspension now belongs to this one; a staff Disconnect stays as it is.
    if(dup.guard&&dup.guard.deactivatedAt!==sub.deactivatedAt)store.put('routerJobs',{...dup,guard:{subscriberId:sub.id,deactivatedAt:sub.deactivatedAt}},dup);result.push({routerId:rid,router:r.name,status:'queued',jobId:dup.id,name:n,evidence:[...e.why]});continue;}
   try{const j=jobs.create(store,{routerId:rid,type:'disconnect',params:{username:n},subscriberId:sub.id,user},now);
    store.put('routerJobs',{...j,guard:{subscriberId:sub.id,deactivatedAt:sub.deactivatedAt},reason:'suspension'},j);
    result.push({routerId:rid,router:r.name,status:'queued',jobId:j.id,name:n,evidence:[...e.why]});}
   catch(x){result.push({routerId:rid,router:r?.name||rid,status:'failed',reason:x.message,name:n,evidence:[...e.why]});}}}
 for(const n of new Set(unidentified))result.push({routerId:'',router:n,status:'unavailable',reason:'the session\'s router is not one Kade Cloud knows',names:[]});
 const saved=store.put('subscribers',{...store.get('subscribers',sub.id),suspension:{at:sub.deactivatedAt,targets:result,checkedAt:now}},store.get('subscribers',sub.id));
 return {subscriber:saved,targets:result};}
// Current enforcement state for the profile: each target with its job's real status.
function status(store,sub){const s=sub.suspension;if(!s)return null;
 const map={queued:'queued',sent:'queued',succeeded:'applied',failed:'failed',cancelled:'cancelled'};
 const targets=(s.targets||[]).map(t=>{if(!t.jobId)return t;const j=store.get('routerJobs',t.jobId);return {...t,status:j?map[j.status]||j.status:'unknown',output:j?.output||'',error:j?.error||''};});
 const st=sub.status!=='suspended'?'lifted':!targets.length?'no-live-session':targets.every(t=>t.status==='applied')?'applied':targets.some(t=>t.status==='failed'||t.status==='unavailable')?'incomplete':'queued';
 return {at:s.at,checkedAt:s.checkedAt,state:st,targets};}
// Reactivation: cancel suspension disconnects still waiting; report any already sent to the router.
function lift(store,sub,now=Date.now()){const out={cancelled:0,inFlight:0};
 for(const j of store.list('routerJobs').filter(x=>x.guard?.subscriberId===sub.id&&['queued','sent'].includes(x.status))){
  if(j.status==='queued'){store.put('routerJobs',{...j,status:'cancelled',finishedAt:now,output:'Account activated again before the disconnect ran'},j);out.cancelled++;}else out.inFlight++;}
 return out;}
// Used by jobs.next(): may this guarded job still run?
function stillWanted(store,j){if(!j.guard)return true;const s=store.get('subscribers',j.guard.subscriberId);return !!s&&s.status==='suspended'&&s.deactivatedAt===j.guard.deactivatedAt;}
module.exports={names,enforce,status,lift,stillWanted};
