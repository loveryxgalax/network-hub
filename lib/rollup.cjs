'use strict';
// Daily rollups that outlive the 30-day raw measurements: per router and Nairobi hour, average and peak internet
// download/upload, average CPU and the most customers online. They feed the 90-day trend and the weekday × hour
// heatmaps. A day is rolled once, after it has ended, from the raw samples (before they are pruned).
const {wanOf}=require('./overview.cjs');
const DAY=864e5,TZ=3*36e5,KEEP=400;
const dayKey=t=>new Date(t+TZ).toISOString().slice(0,10),dayStart=k=>Date.parse(k+'T00:00:00+03:00');
function rollDay(store,router,key){const from=dayStart(key),to=from+DAY;
 const rows=store.db.prepare('SELECT time,body FROM measurements WHERE device_id=? AND online=1 AND time>=? AND time<? ORDER BY time').all(router.id,from-10*60000,to).map(r=>({time:r.time,body:JSON.parse(r.body)}));
 const wan=wanOf(rows,store.setting('overviewWan')?.[router.id]),h=Array.from({length:24},()=>({down:0,up:0,n:0,peakDown:0,peakUp:0,cpu:0,cpuN:0,online:null}));let samples=0;
 for(let i=1;i<rows.length;i++){const a=rows[i-1],b=rows[i],dt=(b.time-a.time)/1000;if(b.time<from||dt<=0||dt>1800)continue;const x=(b.body.interfaces||[]).find(n=>n.name===wan),y=(a.body.interfaces||[]).find(n=>n.name===wan),hr=new Date(b.time+TZ).getUTCHours(),c=h[hr];
  if(b.body.cpu!=null){c.cpu+=Number(b.body.cpu)||0;c.cpuN++;}
  if(x&&y&&x.rx>=y.rx&&x.tx>=y.tx){const d=(x.rx-y.rx)*8/dt/1e6,u=(x.tx-y.tx)*8/dt/1e6;c.down+=d;c.up+=u;c.n++;c.peakDown=Math.max(c.peakDown,d);c.peakUp=Math.max(c.peakUp,u);samples++;}}
 for(const p of store.setting('onlineSeries:'+router.id)?.points||[]){if(p[0]<from||p[0]>=to)continue;const c=h[new Date(p[0]+TZ).getUTCHours()],n=(p[1]||0)+(p[2]||0);c.online=Math.max(c.online??0,n);}
 const r2=v=>Math.round(v*100)/100;
 return {samples,hours:h.map(c=>[c.n?r2(c.down/c.n):null,c.n?r2(c.up/c.n):null,r2(c.peakDown),r2(c.peakUp),c.cpuN?Math.round(c.cpu/c.cpuN):null,c.online])};}
// Roll every finished day still in the raw data that has not been rolled yet.
function run(store,now=Date.now()){const data=store.setting('dailyRollup')||{days:{}},today=dayKey(now),routers=store.list('devices').filter(d=>d.type==='router'&&d.driver!=='none');let rolled=0;
 for(let i=1;i<=30;i++){const key=dayKey(now-i*DAY);if(key>=today||data.days[key])continue;const day={};let any=false;
  for(const r of routers){const x=rollDay(store,r,key);if(x.samples||x.hours.some(h=>h[5]!=null)){day[r.id]=x.hours;any=true;}}
  data.days[key]=any?day:{};rolled++;}
 const keys=Object.keys(data.days).sort();for(const k of keys.slice(0,Math.max(0,keys.length-KEEP)))delete data.days[k];
 if(rolled)store.setting('dailyRollup',data);return {rolled};}
// One point per day: the busiest hour's average, the day's average CPU and most customers online.
function daily(store,routerId,since){const out=[];for(const [k,day] of Object.entries(store.setting('dailyRollup')?.days||{}).sort()){const t=dayStart(k);if(t<since||!day[routerId])continue;const hs=day[routerId],busy=hs.filter(h=>h[0]!=null).sort((a,b)=>b[0]-a[0])[0],cpus=hs.map(h=>h[4]).filter(v=>v!=null);
 out.push([t+12*36e5,busy?busy[0]:null,busy?busy[1]:null,cpus.length?Math.round(cpus.reduce((a,b)=>a+b,0)/cpus.length):null,null,Math.max(0,...hs.map(h=>h[5]||0))]);}return out;}
// Weekday (Mon=0) × hour averages over the last N days, summed across routers (or one router).
function heatmap(store,{days=30,routerId=''}={},now=Date.now()){const since=now-days*DAY,traffic=Array.from({length:7},()=>Array(24).fill(0)),online=Array.from({length:7},()=>Array(24).fill(0)),n=Array.from({length:7},()=>Array(24).fill(0));let covered=0;
 for(const [k,day] of Object.entries(store.setting('dailyRollup')?.days||{})){const t=dayStart(k);if(t<since)continue;const wd=(new Date(t+TZ).getUTCDay()+6)%7;let had=false;
  for(let hr=0;hr<24;hr++){let d=0,o=0,seen=false;for(const [rid,hs] of Object.entries(day)){if(routerId&&rid!==routerId)continue;const h=hs[hr];if(h[0]!=null){d+=h[0];seen=true;}if(h[5]!=null){o+=h[5];seen=true;}}if(seen){traffic[wd][hr]+=d;online[wd][hr]+=o;n[wd][hr]++;had=true;}}if(had)covered++;}
 const avg=(m)=>m.map((row,i)=>row.map((v,j)=>n[i][j]?Math.round(v/n[i][j]*100)/100:null));return {days,covered,traffic:avg(traffic),online:avg(online)};}
module.exports={run,rollDay,daily,heatmap,dayKey};
