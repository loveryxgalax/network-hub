'use strict';
// Bulk actions on customers matching explicit filters. Preview returns the exact count and a version; applying
// requires that count and version, so "all matching" never silently changes between preview and apply.
const crypto=require('node:crypto');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const ACTIONS=['change-plan','add-days','deactivate','activate','delete'];
function match(store,f,stateOf,now=Date.now()){
 const where=f.routerId?require('./compensation.cjs').routerOf(store):null;
 return store.list('subscribers').filter(s=>(!f.service||f.service==='all'||s.service===f.service)&&(!f.state||f.state==='all'||stateOf(s,now)===f.state)&&(!f.planId||s.planId===f.planId)&&(!where||where.get(s.username)===f.routerId||s.routerId===f.routerId)&&(!f.q||(s.name+' '+s.username+' '+(s.phone||'')).toLowerCase().includes(String(f.q).toLowerCase())));
}
function preview(store,f,stateOf,now=Date.now()){const items=match(store,f,stateOf,now);return {count:items.length,sample:items.slice(0,20).map(s=>({id:s.id,name:s.name,username:s.username,service:s.service,state:stateOf(s,now)})),version:crypto.createHash('sha256').update(items.map(s=>s.id+':'+s.version).join(',')).digest('hex').slice(0,16)};}
function apply(store,f,action,params,{count,version,confirm},stateOf,user,now=Date.now()){
 if(!ACTIONS.includes(action))fail('Choose an action');const pv=preview(store,f,stateOf,now);
 if(pv.version!==version||pv.count!==Number(count))fail('The matching customers changed since the preview. Preview again.',409);
 if(action==='delete'&&String(confirm).trim()!==`DELETE ${pv.count}`)fail(`Type DELETE ${pv.count} to confirm`);
 if(action==='change-plan'&&!store.get('plans',String(params.planId||'')))fail('Choose the new package');
 const days=Number(params.days);if(action==='add-days'&&!(days>=1&&days<=365))fail('Add 1–365 days');
 return store.transaction(()=>{let done=0;for(const s of match(store,f,stateOf,now)){
  if(action==='delete'){store.remove('subscribers',s.id);store.secret('subscriber:'+s.id,null);}
  else store.put('subscribers',action==='change-plan'?{...s,planId:params.planId}:action==='add-days'?{...s,expiresAt:Math.max(now,s.expiresAt||now)+days*864e5,paidEver:s.paidEver??true}:action==='deactivate'?{...s,status:'suspended',deactivatedReason:String(params.reason||'Bulk action').slice(0,120),deactivatedAt:now}:{...s,status:'active',deactivatedReason:''},s);
  done++;}return {done};});
}
module.exports={ACTIONS,preview,apply};
