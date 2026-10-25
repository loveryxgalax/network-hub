'use strict';
// Dashboard data: router throughput/CPU history, customers online over time, revenue, expiries, top sites and live
// talkers, all from what the MikroTiks and the billing already record. Built to be cheap: history is sampled in SQL.
const sites=require('./sites.cjs');
const DAY=86400000,POINTS=240,RANGES={'1h':3600000,'24h':DAY,'7d':7*DAY};
const tz='Africa/Nairobi';
const dayKey=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:tz});
const round=(n,d=2)=>Math.round(n*10**d)/10**d;
// The internet port: the busiest physical port. Customer traffic enters and leaves through it, so its counters give the
// network's real download (in) and upload (out) without double-counting bridges, VLANs and Wi-Fi.
function wanOf(rows,override){
 const totals=new Map();for(let i=1;i<rows.length;i++)for(const nic of rows[i].body.interfaces||[]){if(!/^(ether|sfp|sfpplus|qsfp)/i.test(nic.type||nic.name)&&nic.type!=='ether')continue;const old=(rows[i-1].body.interfaces||[]).find(x=>x.name===nic.name);if(old&&nic.rx>=old.rx&&nic.tx>=old.tx)totals.set(nic.name,(totals.get(nic.name)||0)+(nic.rx-old.rx)+(nic.tx-old.tx));}
 if(override&&totals.has(override))return override;return [...totals].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
}
function history(store,id,since){
 const n=store.db.prepare('SELECT COUNT(*) n FROM measurements WHERE device_id=? AND time>=?').get(id,since).n,step=Math.max(1,Math.floor(n/POINTS));
 return store.db.prepare('SELECT time,online,body FROM (SELECT time,online,body,ROW_NUMBER() OVER (ORDER BY time) rn FROM measurements WHERE device_id=? AND time>=?) WHERE rn % ? = 0 ORDER BY time').all(id,since,step).map(r=>({time:r.time,online:!!r.online,body:JSON.parse(r.body)}));
}
function routerSeries(store,device,since,now){
 const rows=history(store,device.id,since).filter(r=>r.online),wan=wanOf(rows,store.setting('overviewWan')?.[device.id]),series=[];
 for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i],dt=(b.time-a.time)/1000;if(dt<=0||dt>1800)continue;
  const x=(b.body.interfaces||[]).find(n=>n.name===wan),y=(a.body.interfaces||[]).find(n=>n.name===wan);let down=null,up=null;
  if(x&&y&&x.rx>=y.rx&&x.tx>=y.tx){down=round((x.rx-y.rx)*8/dt/1e6);up=round((x.tx-y.tx)*8/dt/1e6);}
  series.push([b.time,down,up,b.body.cpu??null,b.body.memory??null]);}
 return {wan,series};
}
function online(store,routerId,since){
 const s=store.setting('onlineSeries:'+routerId)?.points||[];return s.filter(p=>p[0]>=since);
}
function merge(routers,since,now){
 const size=Math.max(60000,Math.round((now-since)/120)),buckets=new Map();
 for(const r of routers)for(const [t,down,up] of r.series){if(down==null)continue;const k=Math.floor(t/size)*size,b=buckets.get(k)||{down:new Map(),up:new Map()};b.down.set(r.id,Math.max(b.down.get(r.id)||0,down));b.up.set(r.id,Math.max(b.up.get(r.id)||0,up));buckets.set(k,b);}
 return [...buckets].sort((a,b)=>a[0]-b[0]).map(([t,b])=>[t,round([...b.down.values()].reduce((x,y)=>x+y,0)),round([...b.up.values()].reduce((x,y)=>x+y,0))]);
}
function build(store,range='24h',now=Date.now()){
 const span=RANGES[range]||RANGES['24h'],since=now-span;
 const devices=store.list('devices').filter(d=>d.type==='router'&&d.driver!=='none');
 const routers=devices.map(d=>{
  const m=d.metrics||{},{wan,series}=routerSeries(store,d,since,now),disc=store.setting('customerDiscovery:'+d.id),t=disc?.tables||{},last=series.filter(p=>p[1]!=null).at(-1);
  const stale=!d.lastSeen||now-d.lastSeen>120000;
  return {id:d.id,name:d.name,status:stale?'offline':'online',lastSeen:d.lastSeen||null,model:m.model||'',version:m.version||'',uptime:m.uptime||'',cpu:m.cpu??null,memory:m.memory??null,wan,
   downMbps:last&&!stale?last[1]:null,upMbps:last&&!stale?last[2]:null,series,
   customers:{ppp:t.ppp?.count??null,hotspot:t.hotspot?.count??null,dhcp:t.dhcp?.count??null,reportedAt:disc?.lastReport||null},onlineSeries:online(store,d.id,since)};});
 const subs=store.list('subscribers'),plans=new Map(store.list('plans').map(p=>[p.id,p]));
 const state=s=>s.status!=='active'?'suspended':s.expiresAt!=null&&s.expiresAt<=now?'expired':'active';
 const counts={total:subs.length,active:0,expired:0,suspended:0,expiringSoon:0};for(const s of subs){const st=state(s);counts[st]++;if(st==='active'&&s.expiresAt!=null&&s.expiresAt-now<3*DAY)counts.expiringSoon++;}
 const sessions=store.list('radiusSessions').filter(s=>!s.stoppedAt&&now-s.updatedAt<15*60000);
 const planCounts=new Map();for(const s of subs){if(state(s)!=='active')continue;const p=plans.get(s.planId);planCounts.set(p?.name||'—',(planCounts.get(p?.name||'—')||0)+1);}
 // Revenue by Nairobi calendar day, last 14 days, from the subscriber payment ledger.
 const pays=store.list('subscriberPayments'),days=[];for(let i=13;i>=0;i--)days.push(dayKey(now-i*DAY));
 const byDay=new Map(days.map(d=>[d,{day:d,amount:0,count:0}])),byMethod={};let today=0,week=0,month=0;const today0=dayKey(now),monthKey=today0.slice(0,7);
 for(const p of pays){const k=dayKey(p.time),b=byDay.get(k);if(b){b.amount+=p.amount;b.count++;}if(k===today0)today+=p.amount;if(now-p.time<7*DAY)week+=p.amount;if(k.slice(0,7)===monthKey){month+=p.amount;byMethod[p.method||'other']=(byMethod[p.method||'other']||0)+p.amount;}}
 const expiring=subs.filter(s=>state(s)==='active'&&s.expiresAt!=null&&s.expiresAt-now<3*DAY).sort((a,b)=>a.expiresAt-b.expiresAt).slice(0,8).map(s=>({name:s.name,username:s.username,plan:plans.get(s.planId)?.name||'',expiresAt:s.expiresAt,phone:s.phone||''}));
 const sr=sites.report(store,new URLSearchParams('range=1'),now);
 const alerts=store.list('alerts').filter(a=>a.status!=='Resolved');
 return {now,range:RANGES[range]?range:'24h',since,routers,totals:{series:merge(routers,since,now),downMbps:round(routers.reduce((n,r)=>n+(r.downMbps||0),0)),upMbps:round(routers.reduce((n,r)=>n+(r.upMbps||0),0))},
  customers:{...counts,onlineNow:sessions.length,connected:routers.reduce((n,r)=>n+(r.customers.ppp||0)+(r.customers.hotspot||0),0),plans:[...planCounts].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,count])=>({name,count}))},
  revenue:{today:round(today),week:round(week),month:round(month),days:[...byDay.values()].map(d=>({...d,amount:round(d.amount)})),byMethod,recent:pays.slice(0,6).map(p=>({time:p.time,name:p.name,amount:p.amount,method:p.method,reference:p.reference}))},
  expiring,sites:{lookups:sr.lookups,unique:sr.uniqueSites,top:sr.topSites.slice(0,8),live:sr.live.slice(0,8).map(r=>({name:r.name,remote:r.remote,port:r.port,bytes:r.bytes,downBps:r.downBps,upBps:r.upBps}))},
  alerts:{open:alerts.length,items:alerts.slice(0,5).map(a=>({title:a.title,details:a.details,severity:a.severity,time:a.updated||a.created}))}};
}
// Called from customer discovery reports: one point per router every 5 minutes, kept for 8 days.
function recordOnline(store,router,tables,now=Date.now()){
 const key='onlineSeries:'+router.id,cur=store.setting(key)||{points:[]},last=cur.points.at(-1);if(last&&now-last[0]<300000)return;
 cur.points.push([now,tables.ppp?.rows?.length??0,tables.hotspot?.rows?.length??0]);cur.points=cur.points.filter(p=>now-p[0]<8*DAY);store.setting(key,cur);
}
module.exports={build,recordOnline,wanOf,RANGES};
