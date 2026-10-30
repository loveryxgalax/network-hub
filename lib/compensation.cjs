'use strict';
// Outage compensation: customers whose paid time was running during an outage get that time back.
// Preview first; applying is idempotent per outage and customer (re-running only adds what was not yet granted).
const crypto=require('node:crypto');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const DAY=864e5;
// Which router each customer last used: RADIUS accounting first, then discovery reports.
function routerOf(store){
 const routers=store.list('devices').filter(d=>d.type==='router'),byName=new Map(routers.map(r=>[r.name.toLowerCase(),r.id])),out=new Map();
 for(const x of store.list('radiusSessions').sort((a,b)=>a.updatedAt-b.updatedAt)){const id=byName.get(String(x.nasName||'').toLowerCase());if(id)out.set(x.username,id);}
 for(const r of routers)for(const o of store.setting('customerDiscovery:'+r.id)?.observations||[]){const name=String(o.evidence?.ppp?.name||o.evidence?.hotspot?.name||'').toLowerCase();if(name&&!out.has(name))out.set(name,r.id);}
 return out;
}
function parse(input,now){
 const start=Number(input.start),end=input.end===''||input.end==null?null:Number(input.end);
 if(!Number.isFinite(start)||start>now)fail('Choose when the outage started (not in the future)');if(end!==null&&(!Number.isFinite(end)||end<=start))fail('The end must be after the start');if(now-start>90*DAY)fail('Outages older than 90 days cannot be compensated');
 const service=['pppoe','hotspot','all'].includes(input.service)?input.service:'all';
 const routerIds=(Array.isArray(input.routerIds)?input.routerIds:[]).map(String),planIds=(Array.isArray(input.planIds)?input.planIds:[]).map(String);
 return {start,end,service,routerIds,planIds,reason:String(input.reason||'').trim().slice(0,200)};
}
// Customers valid at the outage start get the overlap between the outage and their paid time.
function preview(store,input,now=Date.now()){
 // An ongoing outage is counted up to a fixed minute, so the preview and the apply see the same numbers.
 const o=parse(input,now),asOf=Math.floor(Math.min(now,Number(input.asOf)||now)/60000)*60000,stop=o.end??asOf,where=routerOf(store),granted=input.outageId?new Map(store.list('compensationGrants').filter(g=>g.outageId===input.outageId).map(g=>[g.subscriberId,g.ms])):new Map(),items=[];
 for(const s of store.list('subscribers')){
  if(s.status!=='active'||s.expiresAt==null||s.expiresAt-(granted.get(s.id)||0)<=o.start)continue;
  if(o.service!=='all'&&s.service!==o.service)continue;if(o.planIds.length&&!o.planIds.includes(s.planId))continue;
  const rid=where.get(s.username)||'';if(o.routerIds.length&&!o.routerIds.includes(rid))continue;
  // Measure against the expiry before this outage's own grants, or every grant would earn more grant.
  const already=granted.get(s.id)||0,base=s.expiresAt-already,ms=Math.max(0,Math.min(stop,base)-o.start),add=Math.max(0,ms-already);
  if(ms<60000)continue;items.push({id:s.id,name:s.name,username:s.username,service:s.service,routerId:rid,expiresAt:s.expiresAt,ms,already,add});
 }
 items.sort((a,b)=>b.add-a.add);
 const version=crypto.createHash('sha256').update(JSON.stringify([o,items.map(i=>[i.id,i.add])])).digest('hex').slice(0,16);
 return {...o,asOf:stop,ongoing:o.end===null,count:items.filter(i=>i.add>0).length,totalHours:Math.round(items.reduce((a,i)=>a+i.add,0)/36e5*10)/10,items,version};
}
function create(store,input,user,now=Date.now()){const o=parse(input,now);return store.put('outages',{...o,createdBy:user?.name||'',createdAt:now,status:'open',appliedCount:0});}
// Apply only the preview the operator saw (same version), in one transaction, recording before/after expiry.
function apply(store,outageId,input,user,now=Date.now()){
 const out=store.get('outages',outageId);if(!out)fail('Outage not found',404);
 const patch={...out,...(input.end!==undefined?{end:input.end===''||input.end==null?null:Number(input.end)}:{})};
 const pv=preview(store,{...patch,outageId,asOf:input.asOf},now);if(input.version!==pv.version)fail('The list changed since you previewed it. Preview again before applying.',409);
 return store.transaction(()=>{let applied=0;
  for(const i of pv.items){if(i.add<=0)continue;const s=store.get('subscribers',i.id);if(!s)continue;
   const key=outageId+':'+s.id,prev=store.list('compensationGrants').find(g=>g.key===key);
   const after=s.expiresAt+i.add;store.put('subscribers',{...s,expiresAt:after},s);
   store.put('compensationGrants',{key,outageId,subscriberId:s.id,username:s.username,ms:(prev?.ms||0)+i.add,lastAdd:i.add,before:s.expiresAt,after,time:now,by:user?.name||''},prev||undefined);applied++;}
  const saved=store.put('outages',{...patch,status:patch.end==null?'open':'compensated',appliedCount:(out.appliedCount||0)+applied,lastAppliedAt:now},out);
  return {outage:saved,applied};});
}
function list(store){const grants=store.list('compensationGrants');return store.list('outages').map(o=>{const g=grants.filter(x=>x.outageId===o.id);return {...o,customers:g.length,hours:Math.round(g.reduce((a,x)=>a+x.ms,0)/36e5*10)/10};});}
module.exports={preview,create,apply,list,routerOf};
