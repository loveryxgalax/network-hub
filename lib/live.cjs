'use strict';
// Live NOC feed for the Phoenix live view (Phase 1). One compact snapshot of what changes minute to minute:
// customers online (by router and service), routers, open alerts, captive portal visitors and today's payments.
// Read-only; Phoenix polls it every few seconds and pushes changes to everyone watching.
const presence=require('./presence.cjs');
const STALE=15*60000,DAY=864e5,dayKey=t=>new Date(t+3*36e5).toISOString().slice(0,10);
function snapshot(store,now=Date.now()){
 const subs=new Map(store.list('subscribers').map(s=>[String(s.username).toLowerCase(),s]));
 const sessions=store.sessionsSince(now-STALE).filter(s=>!s.stoppedAt&&now-s.updatedAt<STALE);
 // Counts come from what each router reports as connected (every ~5 min), so customers who sign in through another
 // RADIUS server still count. Netops RADIUS sessions only add routers that have not reported recently.
 const byRouter=new Map(),reporting=new Set();
 for(const d of store.list('devices').filter(d=>d.type==='router')){const pt=store.setting('onlineSeries:'+d.id)?.points?.at(-1);if(!pt||now-pt[0]>STALE)continue;
  byRouter.set(d.name,{name:d.name,hotspot:pt[2]||0,pppoe:pt[1]||0});for(const n of [d.name,d.ip,d.host])if(n)reporting.add(String(n).toLowerCase());}
 for(const s of sessions){const k=s.nasName||s.nas||'Unknown';if(reporting.has(String(k).toLowerCase()))continue;const r=byRouter.get(k)||{name:k,hotspot:0,pppoe:0};r[s.service==='hotspot'?'hotspot':'pppoe']++;byRouter.set(k,r);}
 const counted=[...byRouter.values()],sum=f=>counted.reduce((a,r)=>a+r[f],0);
 // Who is online and how much they used: each router's own session list (name, IP, uptime, bytes this session),
 // plus netops RADIUS sessions on routers that do not report.
 const upSecs=v=>{const m=/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):([0-5]\d):([0-5]\d))$/.exec(v||'');return m?(+m[1]||0)*604800+(+m[2]||0)*86400+(+m[3])*3600+(+m[4])*60+(+m[5]):null;};
 const people=[];for(const d of store.list('devices').filter(d=>d.type==='router')){if(!byRouter.has(d.name))continue;
  for(const o of store.setting('customerDiscovery:'+d.id)?.observations||[])for(const src of ['ppp','hotspot']){const ev=o.evidence?.[src];if(!ev||now-(ev.observedAt||0)>STALE)continue;const up=upSecs(ev.uptime),c=subs.get(String(ev.name||'').toLowerCase());
   people.push({username:ev.name||ev.mac||'',name:c?.name||'',service:src==='ppp'?'pppoe':'hotspot',router:d.name,ip:ev.ip||'',since:up===null?null:now-up*1000,down:ev.tx||0,up:ev.rx||0});}}
 for(const x of sessions){const k=x.nasName||x.nas||'';if(reporting.has(String(k).toLowerCase()))continue;const c=subs.get(String(x.username||'').toLowerCase());people.push({username:x.username,name:c?.name||'',service:x.service==='hotspot'?'hotspot':'pppoe',router:k,ip:x.ip||'',since:x.startedAt||null,down:x.downloadBytes||0,up:x.uploadBytes||0});}
 const online=people.sort((a,b)=>b.down-a.down).slice(0,100);
 const routers=store.list('devices').filter(d=>d.type==='router').map(d=>({id:d.id,name:d.name,online:!!(d.lastSeen&&now-d.lastSeen<120000),lastSeen:d.lastSeen||null,cpu:d.metrics?.cpu??null,memory:d.metrics?.memory??null})).sort((a,b)=>a.name.localeCompare(b.name));
 const alerts=store.list('alerts').filter(a=>a.status!=='Resolved').sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,20).map(a=>({id:a.id,title:a.title,severity:a.severity||'warning',status:a.status,since:a.created||null}));
 const today=dayKey(now),pays=store.list('subscriberPayments').filter(p=>!p.reversedAt&&dayKey(p.time||p.created)===today).sort((a,b)=>(b.time||b.created)-(a.time||a.created));
 const p=presence.now(now);
 return {at:now,online:{total:sum('hotspot')+sum('pppoe'),hotspot:sum('hotspot'),pppoe:sum('pppoe'),byRouter:counted.filter(r=>r.hotspot+r.pppoe>0).sort((a,b)=>b.hotspot+b.pppoe-a.hotspot-a.pppoe),top:online},
  routers,alerts,portal:{total:p.total,hotspot:p.hotspot,pppoe:p.pppoe,pages:p.pages,devices:p.devices},
  payments:{today:Math.round(pays.reduce((a,x)=>a+(Number(x.amount)||0),0)*100)/100,count:pays.length,recent:pays.slice(0,8).map(x=>({name:x.name||x.username,amount:x.amount,method:x.method,at:x.time||x.created}))}};}
module.exports={snapshot};
