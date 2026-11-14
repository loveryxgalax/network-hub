'use strict';
// Trends (as in ISPman), from RADIUS accounting: customers online over time and on a typical day, hotspot visits by
// weekday and hour, and PPPoE session activity per day for the last 4 weeks. Times are Nairobi time.
const HOUR=36e5,DAY=864e5,TZ=3*HOUR;
const dayKey=t=>new Date(t+TZ).toISOString().slice(0,10),dayStart=t=>Date.parse(dayKey(t)+'T00:00:00+03:00');
function build(store,{days=7}={},now=Date.now()){days=[1,7,30].includes(Number(days))?Number(days):7;
 const since=now-days*DAY,s4=dayStart(now)-27*DAY,rows=store.sessionFieldsSince(Math.min(since,s4));
 // Online users: a session counts at each hour mark between its start and its end (or last update if still open).
 const first=Math.ceil(since/HOUR)*HOUR,points=Math.floor((now-first)/HOUR)+1,online={hotspot:Array(points).fill(0),pppoe:Array(points).fill(0)};
 for(const r of rows){const a=Number(r.startedAt)||0,b=Number(r.stoppedAt||r.updatedAt)||a;if(b<first)continue;const svc=r.service==='hotspot'?'hotspot':'pppoe';
  for(let i=Math.max(0,Math.ceil((a-first)/HOUR));i<points;i++){const t=first+i*HOUR;if(t>b)break;online[svc][i]++;}}
 const series=Array.from({length:points},(_,i)=>({t:first+i*HOUR,hotspot:online.hotspot[i],pppoe:online.pppoe[i]}));
 // Typical day: the average online at each hour of the day over the period.
 const sum=Array.from({length:24},()=>({hotspot:0,pppoe:0,n:0}));for(const p of series){const h=new Date(p.t+TZ).getUTCHours();sum[h].hotspot+=p.hotspot;sum[h].pppoe+=p.pppoe;sum[h].n++;}
 const typical=sum.map((x,h)=>({hour:h,hotspot:x.n?Math.round(x.hotspot/x.n*10)/10:0,pppoe:x.n?Math.round(x.pppoe/x.n*10)/10:0}));
 // Hotspot visits: hotspot sessions started, by weekday (Monday first) and hour.
 const visits=Array.from({length:7},()=>Array(24).fill(0));for(const r of rows){const a=Number(r.startedAt);if(r.service!=='hotspot'||!(a>=since))continue;const d=new Date(a+TZ);visits[(d.getUTCDay()+6)%7][d.getUTCHours()]++;}
 // PPPoE activity per day (last 4 weeks): sessions started, distinct customers, data; a day with none is a gap.
 const act=new Map();for(let t=s4;t<=now;t+=DAY)act.set(dayKey(t),{date:dayKey(t),sessions:0,users:new Set(),download:0,upload:0});
 for(const r of rows){if(r.service==='hotspot')continue;const a=Number(r.startedAt),d=act.get(dayKey(a));if(!d||!(a>=s4))continue;d.sessions++;if(r.username)d.users.add(r.username);d.download+=Number(r.downloadBytes)||0;d.upload+=Number(r.uploadBytes)||0;}
 // A gap is a day on which no PPPoE session was active at all (a long session spanning the day counts as active).
 const activeDays=new Set();for(const r of rows){if(r.service==='hotspot')continue;const a=Number(r.startedAt)||0,b=Number(r.stoppedAt||r.updatedAt)||a;for(let t=dayStart(Math.max(a,s4));t<=b&&t<=now;t+=DAY)activeDays.add(dayKey(t));}
 // Days before netops received any PPPoE accounting are "no data", not gaps.
 const firstPp=store.db.prepare("SELECT MIN(created) t FROM records WHERE kind='radiusSessions' AND json_extract(body,'$.service')!='hotspot'").get().t;
 const pppoe=[...act.values()].map(d=>{const before=!firstPp||Date.parse(d.date+'T00:00:00+03:00')+DAY<=firstPp;return {date:d.date,sessions:d.sessions,customers:d.users.size,download:d.download,upload:d.upload,gap:!activeDays.has(d.date)&&!before,noData:!activeDays.has(d.date)&&before};});
 return {days,series,typical,visits,pppoe,peak:series.reduce((m,p)=>p.hotspot+p.pppoe>m.total?{t:p.t,total:p.hotspot+p.pppoe}:m,{t:null,total:0})};}
module.exports={build};
