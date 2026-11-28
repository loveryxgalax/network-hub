'use strict';
// Apply a change to a customer who is online right now. RADIUS only decides at login (there is no CoA), so the way to make
// a renewal or a package change take effect immediately is to drop the live session: the customer's router redials within
// seconds and is logged in again with the new speed and expiry. It uses the router job channel ("disconnect") and only when:
//   * Settings → "Apply changes to customers who are online right away" is on (off by default),
//   * the customer has a live session on a router that has the job runner installed,
//   * this is not a rehearsal copy (NETWORK_PASSIVE).
const LIVE=15*60000;
const radius=()=>require('./radius.cjs');
function enabled(store){return radius().settings(store).liveApply===true&&process.env.NETWORK_PASSIVE!=='1';}
function kick(store,sub,reason,user,now=Date.now(),force=false){
 if(process.env.NETWORK_PASSIVE==='1')return {skipped:'rehearsal copy'};
 if(!force&&!enabled(store))return {skipped:'off'};
 if(!store.sessionsOf(sub.username,now-LIVE).some(x=>!x.stoppedAt&&now-x.updatedAt<LIVE))return {skipped:'not online'};
 const rid=require('./compensation.cjs').routerOf(store).get(sub.username);if(!rid)return {skipped:'router unknown'};
 if(!store.secret('jobs:'+rid))return {skipped:'no job runner'};
 if(store.list('routerJobs').some(j=>j.type==='disconnect'&&j.params?.username===sub.username&&['queued','sent'].includes(j.status)))return {skipped:'already queued'};
 try{const j=require('./jobs.cjs').create(store,{routerId:rid,type:'disconnect',params:{username:sub.username},subscriberId:sub.id,user:user||null},now);
  store.audit(user||{id:'system'},`Queued a reconnect for ${sub.username} so ${reason} takes effect now`,sub.id);return {queued:j.id};}catch(e){return {skipped:e.message};}
}
// A renewal or payment: only an account that was not active (expired, unpaid, suspended) needs its live session refreshed.
function renewed(store,after,before,now=Date.now()){if(radius().stateOf(before,now)==='active')return {skipped:'was active'};return kick(store,after,'the renewal',null,now);}
// A package change on a customer record.
function planChanged(store,after,before,user,now=Date.now()){if(!before||after.planId===before.planId)return {skipped:'same package'};return kick(store,after,'the new package',user,now);}
// The customer pressed Reset connection themselves: do it whether or not the automatic setting is on.
function kickNow(store,sub,reason,now=Date.now()){return kick(store,sub,reason,null,now,true);}
module.exports={enabled,kick,kickNow,renewed,planChanged};
