'use strict';
// Live NOC feed for the Phoenix live view (Phase 1). One compact snapshot of what changes minute to minute:
// customers online (by router and service), routers, open alerts, captive portal visitors and today's payments.
// Read-only; Phoenix polls it every few seconds and pushes changes to everyone watching.
const presence=require('./presence.cjs');
const STALE=15*60000,DAY=864e5,dayKey=t=>new Date(t+3*36e5).toISOString().slice(0,10);
function snapshot(store,now=Date.now()){
 const subs=new Map(store.list('subscribers').map(s=>[String(s.username).toLowerCase(),s]));
 // Who is online and how much they used: the same merged connections the counts use (online.cjs). A connection both
 // the router and Kade Cloud RADIUS report is listed once.
 const ol=require('./online.cjs'),conn=ol.connections(store,now),conns=conn.rows,upSecs=v=>{const m=/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):([0-5]\d):([0-5]\d))$/.exec(v||'');return m?(+m[1]||0)*604800+(+m[2]||0)*86400+(+m[3])*3600+(+m[4])*60+(+m[5]):null;};
 const people=conns.map(c=>{const r=c.radius,u=c.username||c.mac||'',x=subs.get(String(c.username||'').toLowerCase()),up=upSecs(c.uptime);
  return {username:u,name:x?.name||'',service:c.service,router:c.router,ip:c.ip||'',since:c.source==='radius'?r.startedAt||null:up===null?(r?.startedAt||null):c.reportedAt-up*1000,down:c.source==='radius'?r.downloadBytes||0:c.tx||0,up:c.source==='radius'?r.uploadBytes||0:c.rx||0};});
 const online=people.sort((a,b)=>b.down-a.down).slice(0,100);
 const routers=store.list('devices').filter(d=>d.type==='router').map(d=>({id:d.id,name:d.name,online:!!(d.lastSeen&&now-d.lastSeen<120000),lastSeen:d.lastSeen||null,cpu:d.metrics?.cpu??null,memory:d.metrics?.memory??null})).sort((a,b)=>a.name.localeCompare(b.name));
 const alerts=store.list('alerts').filter(a=>a.status!=='Resolved').sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,20).map(a=>({id:a.id,title:a.title,severity:a.severity||'warning',status:a.status,since:a.created||null}));
 const today=dayKey(now),pays=store.list('subscriberPayments').filter(p=>!p.reversedAt&&dayKey(p.time||p.created)===today).sort((a,b)=>(b.time||b.created)-(a.time||a.created));
 // Counts: the shared reconciled rule (online.cjs), the same numbers as the dashboard's Online now.
 const on=ol.summary(store,now,conn);
 const p=presence.now(now);
 return {at:now,online:{total:on.total,hotspot:on.byService.hotspot,pppoe:on.byService.pppoe,byRouter:on.byRouter.filter(r=>r.total>0).map(r=>({name:r.name,hotspot:r.hotspot,pppoe:r.pppoe})),top:online,unit:on.unit,customers:on.customers,byStatus:on.byStatus,staleRouters:on.stale.map(r=>r.name)},
  routers,alerts,portal:{total:p.total,hotspot:p.hotspot,pppoe:p.pppoe,pages:p.pages,devices:p.devices},
  payments:{today:Math.round(pays.reduce((a,x)=>a+(Number(x.amount)||0),0)*100)/100,count:pays.length,recent:pays.slice(0,8).map(x=>({name:x.name||x.username,amount:x.amount,method:x.method,at:x.time||x.created}))}};}
module.exports={snapshot};
