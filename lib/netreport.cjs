'use strict';
// Network reports: availability and outages per device, from the samples Kade Cloud actually recorded (router
// check-ins and polls). A device with no samples in the period has no availability figure, never 100 %.
const DAY=864e5,GAP=10*60000;
function availability(store,now=Date.now(),days=7){const since=now-days*DAY;
 return store.list('devices').filter(d=>d.driver&&d.driver!=='none'&&d.type!=='onu').map(d=>{
  const rows=store.db.prepare('SELECT time,online FROM measurements WHERE device_id=? AND time>=? ORDER BY time').all(d.id,since);
  // "Nothing heard" means a silence well beyond this device's normal spacing (old data is thinned to 15 minutes).
  const gaps=rows.slice(1).map((r,i)=>r.time-rows[i].time).sort((a,b)=>a-b),usual=gaps.length?gaps[Math.floor(gaps.length/2)]:0,limit=Math.max(GAP,usual*3),thin=now-2*DAY;
  const outages=[];let cur=null;
  for(let i=0;i<rows.length;i++){const r=rows[i];
   // A long silence between samples is an outage too (nothing heard from the device).
   if(i&&r.time-rows[i-1].time>(rows[i-1].time<thin?Math.max(limit,45*60000):limit)&&rows[i-1].online&&!cur)outages.push({start:rows[i-1].time,end:r.time,minutes:Math.round((r.time-rows[i-1].time)/60000),reason:'No data'});
   if(!r.online&&!cur)cur={start:r.time,reason:'Offline'};else if(r.online&&cur){cur.end=r.time;cur.minutes=Math.round((cur.end-cur.start)/60000);outages.push(cur);cur=null;}}
  if(cur){cur.end=null;cur.minutes=Math.round((now-cur.start)/60000);outages.push(cur);}
  const on=rows.filter(r=>r.online).length,down=outages.reduce((a,o)=>a+o.minutes,0),span=rows.length?Math.max(1,(Math.min(now,now)-rows[0].time)/60000):0;
  return {id:d.id,name:d.name,type:d.type,simulated:d.driver==='ap-sim',samples:rows.length,availability:rows.length?Math.max(0,Math.min(100,Math.round((span?(1-down/span):on/rows.length)*10000)/100)):null,
   outages:outages.sort((a,b)=>b.start-a.start),downMinutes:down,first:rows[0]?.time||null};});}
function csv(list){const q=v=>{const s=v==null?'':String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;},t=x=>x?new Date(x).toISOString():'';
 const out=['Device,Type,Availability %,Samples,Outage start,Outage end,Minutes,Reason'];
 for(const d of list){if(!d.outages.length)out.push([d.name,d.type,d.availability??'',d.samples,'','','',''].map(q).join(','));for(const o of d.outages)out.push([d.name,d.type,d.availability??'',d.samples,t(o.start),o.end?t(o.end):'ongoing',o.minutes,o.reason].map(q).join(','));}
 return out.join('\n');}
module.exports={availability,csv};
