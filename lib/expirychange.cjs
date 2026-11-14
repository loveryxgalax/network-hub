'use strict';
// RADIUS supplies Session-Timeout at login. Shortening an entitlement later must refresh
// those live sessions; otherwise they retain the old timeout. Only the edited account
// is touched, never a background scan of already-expired customers.
const radius=require('./radius.cjs');
const LIVE=10*60000;
function aliases(store,sub){return new Set([sub.username,...store.list('subscribers').filter(s=>s.parentId===sub.id).map(s=>s.username),...(sub.shareCode?[sub.shareCode.toLowerCase()]:[]),...(sub.tvs||[]).map(t=>t.mac.toLowerCase())]);}
function changed(store,after,before,user,now=Date.now()){
 const out={queued:[],skipped:[]};
 if(process.env.NETWORK_PASSIVE==='1'||after.service!=='hotspot'||after.parentId||after.expiresAt==null||!before||after.expiresAt>=(before.expiresAt??Infinity))return out;
 const names=aliases(store,after),groups=new Map();
 for(const x of store.sessionsSince(now-LIVE)){
  if(x.stoppedAt||now-x.updatedAt>=LIVE||!names.has(x.username))continue;
  const rid=radius.routerOf(store,{'NAS-Identifier':x.nasName,'NAS-IP-Address':x.nas});
  if(!rid||!store.secret('jobs:'+rid)){out.skipped.push('No job runner for '+x.username);continue;}
  if(!groups.has(rid))groups.set(rid,new Set());groups.get(rid).add(x.username);
 }
 const jobs=require('./jobs.cjs');
 for(const [routerId,users] of groups){
  const pending=store.list('routerJobs').find(j=>j.type==='hotspot-expiry-refresh'&&j.subscriberId===after.id&&j.routerId===routerId&&j.params.expiresAt===String(after.expiresAt)&&['queued','sent'].includes(j.status));
  if(pending){out.queued.push(pending.id);continue;}
  const j=jobs.create(store,{routerId,type:'hotspot-expiry-refresh',params:{usernames:[...users].join(','),expiresAt:String(after.expiresAt)},subscriberId:after.id,user},now);out.queued.push(j.id);
 }
 if(out.queued.length)store.audit(user||{id:'system'},'Queued hotspot expiry refresh on '+out.queued.length+' router(s)',after.id);
 return out;
}
// A payment/restore may overtake the runner. Never disconnect using a superseded
// expiry, and never include a TV/family login that no longer belongs to the account.
function currentNames(store,job){const sub=store.get('subscribers',job.subscriberId);if(!sub||sub.parentId||sub.service!=='hotspot'||String(sub.expiresAt)!==job.params.expiresAt)return [];
 const own=aliases(store,sub);return job.params.usernames.split(',').filter(u=>own.has(u));}
module.exports={changed,currentNames};
