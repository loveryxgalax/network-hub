'use strict';
// Dashboard "Customer behaviour" (portal visits by hour, device and OS) and "Data usage" (per customer and per device).
const di=require('./devices-info.cjs'),DAY=864e5;
const PERIODS={today:1,'7d':7,'30d':30,'90d':90};
function build(store,period='7d',now=Date.now()){
 const days=PERIODS[period]||7,to=now+DAY,from=new Date(new Date(now+3*36e5).toISOString().slice(0,10)+'T00:00:00+03:00').getTime()-(days-1)*DAY;
 const v=di.stats(store,from,to),subs=new Map(store.list('subscribers').map(s=>[String(s.username).toLowerCase(),s])),by=new Map(),dev=new Map();
 for(const x of store.sessionsSince(from)){const d=Number(x.downloadBytes)||0,u=Number(x.uploadBytes)||0;if(!d&&!u)continue;
  const k=String(x.username||'').toLowerCase(),s=subs.get(k)||subs.get(k.split('@')[0]),key=s?s.id:'u:'+k,e=by.get(key)||{id:s?.id||'',phone:s?.phone||'',name:s?.name||x.username||'—',username:s?.username||x.username||'',service:s?.service||x.service||'',sessions:0,down:0,up:0};
  e.sessions++;e.down+=d;e.up+=u;by.set(key,e);
  const info=di.lookup(store,x.mac)||{},dn=info.device||info.os||'Unknown device';dev.set(dn,(dev.get(dn)||0)+d+u);}
 const customers=[...by.values()].map(e=>({...e,total:e.down+e.up})).sort((a,b)=>b.total-a.total).slice(0,25);
 return {period,days,visits:{total:v.total,hours:v.hours,os:v.os,devices:v.devices},usage:{customers,byDevice:[...dev].map(([name,bytes])=>({name,bytes})).sort((a,b)=>b.bytes-a.bytes).slice(0,12)}};}
module.exports={build};
