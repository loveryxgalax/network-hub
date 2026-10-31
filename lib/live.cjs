'use strict';
// Live NOC feed for the Phoenix live view (Phase 1). One compact snapshot of what changes minute to minute:
// customers online (by router and service), routers, open alerts, captive portal visitors and today's payments.
// Read-only; Phoenix polls it every few seconds and pushes changes to everyone watching.
const presence=require('./presence.cjs');
const STALE=15*60000,DAY=864e5,dayKey=t=>new Date(t+3*36e5).toISOString().slice(0,10);
function snapshot(store,now=Date.now()){
 const subs=new Map(store.list('subscribers').map(s=>[String(s.username).toLowerCase(),s]));
 const sessions=store.sessionsSince(now-STALE).filter(s=>!s.stoppedAt&&now-s.updatedAt<STALE);
 const byRouter=new Map();for(const s of sessions){const k=s.nasName||s.nas||'Unknown',r=byRouter.get(k)||{name:k,hotspot:0,pppoe:0};r[s.service==='hotspot'?'hotspot':'pppoe']++;byRouter.set(k,r);}
 const online=sessions.sort((a,b)=>(b.downloadBytes||0)-(a.downloadBytes||0)).slice(0,100).map(s=>{const c=subs.get(String(s.username||'').toLowerCase());return {username:s.username,name:c?.name||'',service:s.service==='hotspot'?'hotspot':'pppoe',router:s.nasName||s.nas||'',ip:s.ip||'',since:s.startedAt||null,down:s.downloadBytes||0,up:s.uploadBytes||0};});
 const routers=store.list('devices').filter(d=>d.type==='router').map(d=>({id:d.id,name:d.name,online:!!(d.lastSeen&&now-d.lastSeen<120000),lastSeen:d.lastSeen||null,cpu:d.metrics?.cpu??null,memory:d.metrics?.memory??null})).sort((a,b)=>a.name.localeCompare(b.name));
 const alerts=store.list('alerts').filter(a=>a.status!=='Resolved').sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,20).map(a=>({id:a.id,title:a.title,severity:a.severity||'warning',status:a.status,since:a.created||null}));
 const today=dayKey(now),pays=store.list('subscriberPayments').filter(p=>!p.reversedAt&&dayKey(p.time||p.created)===today).sort((a,b)=>(b.time||b.created)-(a.time||a.created));
 const p=presence.now(now);
 return {at:now,online:{total:sessions.length,hotspot:sessions.filter(s=>s.service==='hotspot').length,pppoe:sessions.filter(s=>s.service!=='hotspot').length,byRouter:[...byRouter.values()].sort((a,b)=>b.hotspot+b.pppoe-a.hotspot-a.pppoe),top:online},
  routers,alerts,portal:{total:p.total,hotspot:p.hotspot,pppoe:p.pppoe,pages:p.pages,devices:p.devices},
  payments:{today:Math.round(pays.reduce((a,x)=>a+(Number(x.amount)||0),0)*100)/100,count:pays.length,recent:pays.slice(0,8).map(x=>({name:x.name||x.username,amount:x.amount,method:x.method,at:x.time||x.created}))}};}
module.exports={snapshot};
