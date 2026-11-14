'use strict';
// Bulk actions on customers matching explicit filters. Preview returns the exact count and a version; applying
// requires that count and version, so "all matching" never silently changes between preview and apply.
const crypto=require('node:crypto');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const ACTIONS=['change-plan','add-days','deactivate','activate','delete'];
function match(store,f,stateOf,now=Date.now()){
 const where=f.routerId?require('./compensation.cjs').routerOf(store):null;
 // An explicit selection (ticked rows) narrows the filter further; it never adds customers the filter does not match.
 const only=Array.isArray(f.ids)&&f.ids.length?new Set(f.ids.map(String)):null;
 return store.list('subscribers').filter(s=>(!only||only.has(s.id))&&(!f.service||f.service==='all'||s.service===f.service)&&(!f.state||f.state==='all'||stateOf(s,now)===f.state)&&(!f.planId||s.planId===f.planId)&&(!where||where.get(s.username)===f.routerId||s.routerId===f.routerId)&&(!f.q||(s.name+' '+s.username+' '+(s.phone||'')).toLowerCase().includes(String(f.q).toLowerCase())));
}
function preview(store,f,stateOf,now=Date.now()){const items=match(store,f,stateOf,now);return {count:items.length,sample:items.slice(0,20).map(s=>({id:s.id,name:s.name,username:s.username,service:s.service,state:stateOf(s,now)})),items:items.slice(0,2000).map(s=>({id:s.id,name:s.name,username:s.username,phone:s.phone||'',service:s.service,planId:s.planId,state:stateOf(s,now),expiresAt:s.expiresAt,lastSeen:s.lastSeen||null})),version:crypto.createHash('sha256').update(items.map(s=>s.id+':'+s.version).join(',')).digest('hex').slice(0,16)};}
function apply(store,f,action,params,{count,version,confirm},stateOf,user,now=Date.now()){
 if(!ACTIONS.includes(action))fail('Choose an action');const pv=preview(store,f,stateOf,now);
 if(pv.version!==version||pv.count!==Number(count))fail('The matching customers changed since the preview. Preview again.',409);
 if(action==='delete'&&String(confirm).trim()!==`DELETE ${pv.count}`)fail(`Type DELETE ${pv.count} to confirm`);
 if(action==='change-plan'&&!store.get('plans',String(params.planId||'')))fail('Choose the new package');
 const days=Number(params.days);if(action==='add-days'&&!(days>=1&&days<=365))fail('Add 1–365 days');
 return store.transaction(()=>{let done=0;for(const s of match(store,f,stateOf,now)){
  // Deleting goes to Recently deleted (restorable for 90 days); a static customer's router entries are removed too.
  if(action==='delete'){if(s.service==='static'&&s.routerId&&s.staticIp&&store.secret('jobs:'+s.routerId)){try{require('./jobs.cjs').create(store,{routerId:s.routerId,type:'static-remove',params:{ip:s.staticIp,name:s.username.replace(/[^A-Za-z0-9._@:-]/g,'-')},user},now);}catch{}}require('./trash.cjs').remove(store,s,user,now);}
  else store.put('subscribers',action==='change-plan'?{...s,planId:params.planId}:action==='add-days'?{...s,expiresAt:Math.max(now,s.expiresAt||now)+days*864e5,paidEver:s.paidEver??true}:action==='deactivate'?{...s,status:'suspended',deactivatedReason:String(params.reason||'Bulk action').slice(0,120),deactivatedAt:now}:{...s,status:'active',deactivatedReason:''},s);
  done++;}return {done};});
}
module.exports={ACTIONS,preview,apply};
