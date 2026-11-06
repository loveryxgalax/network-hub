'use strict';
// A customer's data usage over a chosen range, by day, week or month (ISPman's profile "Data Usage"). Two sources:
// netops RADIUS sessions and the daily totals routers report for the customer's login. On each day the larger one is
// used, so the same traffic is never counted twice. Days are Nairobi calendar days.
const DAY=864e5,NBO=3*36e5,dayKey=t=>new Date(t+NBO).toISOString().slice(0,10);
function routerDays(store,username){const u=String(username||'').toLowerCase(),out=new Map(),bare=v=>{const n=String(v||'').trim().toLowerCase();try{return require('./radius.cjs').stripRealm(store,n);}catch{return n;}};
 for(const d of store.list('devices').filter(d=>d.type==='router'))for(const o of store.setting('customerDiscovery:'+d.id)?.observations||[]){
  const names=['ppp','hotspot'].map(k=>bare(o.evidence?.[k]?.name));if(!names.includes(u)||!o.usageDays)continue;
  for(const [k,v] of Object.entries(o.usageDays)){const e=out.get(k)||{down:0,up:0};e.down+=Number(v.down)||0;e.up+=Number(v.up)||0;out.set(k,e);}}
 return out;}
function bucketOf(date,group){if(group==='month')return date.slice(0,7);if(group==='week'){const t=Date.parse(date+'T00:00:00Z'),wd=(new Date(t).getUTCDay()+6)%7;return new Date(t-wd*DAY).toISOString().slice(0,10);}return date;}
function usage(store,s,{from,to,group='day'}={},now=Date.now()){group=['day','week','month'].includes(group)?group:'day';
 const end=to?Date.parse(to+'T23:59:59+03:00'):now,start=from?Date.parse(from+'T00:00:00+03:00'):end-29*DAY;if(!Number.isFinite(start)||!Number.isFinite(end)||start>end)throw Object.assign(new Error('Choose a valid date range'),{status:400});
 if(end-start>400*DAY)throw Object.assign(new Error('Choose up to 400 days'),{status:400});
 const radius=new Map(),sessions=store.sessionsOf(s.username).filter(x=>(x.startedAt||0)<=end&&(x.stoppedAt||x.updatedAt||0)>=start);
 for(const x of sessions){const k=dayKey(x.stoppedAt||x.updatedAt);const e=radius.get(k)||{down:0,up:0};e.down+=Number(x.downloadBytes)||0;e.up+=Number(x.uploadBytes)||0;radius.set(k,e);}
 const router=routerDays(store,s.username),buckets=new Map();let down=0,up=0;
 for(let t=start;t<=end;t+=DAY){const k=dayKey(t),a=radius.get(k)||{down:0,up:0},b=router.get(k)||{down:0,up:0},use=a.down+a.up>=b.down+b.up?a:b,bk=bucketOf(k,group),e=buckets.get(bk)||{label:bk,down:0,up:0};
  e.down+=use.down;e.up+=use.up;down+=use.down;up+=use.up;buckets.set(bk,e);}
 return {from:dayKey(start),to:dayKey(end),group,series:[...buckets.values()],totals:{down,up,sessions:sessions.length},sources:{radius:radius.size>0,router:router.size>0}};}
function sessionsPage(store,s,page=0,size=25){const all=store.sessionsOf(s.username).sort((a,b)=>(b.startedAt||0)-(a.startedAt||0)),p=Math.max(0,Math.floor(Number(page)||0));
 return {total:all.length,page:p,size,items:all.slice(p*size,p*size+size).map(x=>({startedAt:x.startedAt,updatedAt:x.updatedAt,stoppedAt:x.stoppedAt,down:x.downloadBytes||0,up:x.uploadBytes||0,ip:x.ip||'',mac:x.mac||'',router:x.nasName||x.nas||'',cause:x.cause||''}))};}
// Totals for the customer's own account page: this month, the last 30 days and everything kept, with the same
// per-day rule as above (RADIUS accounting or the router's own counters, whichever saw more that day).
function summary(store,s,now=Date.now()){const today=dayKey(now),month=today.slice(0,8)+'01',d30=dayKey(now-29*DAY),all=dayKey(now-399*DAY);
 const m=usage(store,s,{from:month,to:today},now),l=usage(store,s,{from:d30,to:today},now),a=usage(store,s,{from:all,to:today},now);
 const source=a.sources.radius?'radius':a.sources.router?'router':'none';
 return {month:{down:m.totals.down,up:m.totals.up},last30:{down:l.totals.down,up:l.totals.up,sessions:l.totals.sessions},all:{down:a.totals.down,up:a.totals.up,sessions:a.totals.sessions},source};}
module.exports={usage,sessionsPage,routerDays,summary};
