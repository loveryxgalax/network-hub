'use strict';
// Reports & analytics: revenue (payments recorded in netops), data usage and customer behaviour (from the routers'
// RADIUS accounting). Everything is computed from netops' own records, so it works with any number of routers.
const NAIROBI=3*36e5,DAY=864e5;
const dayKey=t=>new Date(t+NAIROBI).toISOString().slice(0,10);
const dayStart=t=>{const d=new Date(t+NAIROBI);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-NAIROBI;};
const r2=n=>Math.round(n*100)/100;
function range(period,fromStr,toStr,now){
 const today=dayStart(now),d=new Date(now+NAIROBI),monthStart=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)-NAIROBI;
 const weekStart=today-((d.getUTCDay()+6)%7)*DAY;
 const map={today:[today,today+DAY],yesterday:[today-DAY,today],week:[weekStart,today+DAY],'7d':[today-6*DAY,today+DAY],month:[monthStart,today+DAY],
  lastmonth:[Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)-NAIROBI,monthStart],'3m':[Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-2,1)-NAIROBI,today+DAY],'30d':[today-29*DAY,today+DAY],
  ytd:[Date.UTC(d.getUTCFullYear(),0,1)-NAIROBI,today+DAY]};
 if(period==='custom'){const f=Date.parse(fromStr+'T00:00:00+03:00'),t=Date.parse(toStr+'T00:00:00+03:00');if(Number.isFinite(f)&&Number.isFinite(t)&&t>=f)return [f,Math.min(t+DAY,today+DAY)];}
 return map[period]||map.month;
}
const bucket=h=>h<4?'Late night':h<7?'Early morning':h<12?'Morning':h<17?'Afternoon':h<21?'Evening':'Night';
const BUCKETS=['Late night','Early morning','Morning','Afternoon','Evening','Night'];
// Payment times analysis (as ISPman): which weekdays and times of day bring in money, over the last 7 or 30 full days
// (up to yesterday). Not a revenue report: it shows patterns.
const TIMES=[['Late Night','12am–3am'],['Early Morning','4am–7am'],['Morning','8am–11am'],['Afternoon','12pm–3pm'],['Evening','4pm–7pm'],['Night','8pm–11pm']],WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function paymentTimes(store,days,now=Date.now()){const to=dayStart(now),from=to-days*DAY,grid=WD.map(()=>TIMES.map(()=>0)),tot=WD.map(()=>0);
 for(const p of store.list('subscriberPayments')){if(p.reversedAt)continue;const t=p.time||p.created;if(t<from||t>=to)continue;const d=new Date(t+NAIROBI),w=d.getUTCDay(),b=Math.floor(d.getUTCHours()/4),a=Number(p.amount)||0;grid[w][b]+=a;tot[w]+=a;}
 // Order the weekdays from yesterday backwards, as ISPman lists them.
 const y=new Date(to-DAY+NAIROBI).getUTCDay(),order=Array.from({length:7},(_,i)=>(y-i+7)%7);
 return {from,to,days,total:r2(tot.reduce((a,b)=>a+b,0)),weekdays:order.map(w=>({day:WD[w],total:r2(tot[w]),times:TIMES.map(([name,hours],i)=>({name,hours,amount:r2(grid[w][i])}))})),
  all:TIMES.map(([name,hours],i)=>({name,hours,amount:r2(grid.reduce((a,row)=>a+row[i],0))}))};}
function build(store,input={},now=Date.now()){
 const period=String(input.period||'month'),[from,to]=range(period,input.from,input.to,now);
 const days=Math.max(1,Math.min(400,Math.round((to-from)/DAY)));
 const plans=new Map(store.list('plans').map(p=>[p.id,p])),subs=new Map(store.list('subscribers').map(s=>[s.id,s])),byName=new Map([...subs.values()].map(s=>[s.username,s]));
 const routers=store.list('devices').filter(d=>d.type==='router'),routerName=n=>{const k=String(n||'').toLowerCase();return routers.find(r=>r.name.toLowerCase()===k)?.name||n||'Unknown';};
 // Only sessions that touch the period are read; each customer's location is their latest router overall.
 const sessions=store.sessionFieldsSince(from),lastNas=new Map();
 for(const [u,x] of store.lastNasByUser())lastNas.set(u,routerName(x.nasName||x.nas));
 // Revenue
 const perDay=new Map(),perDayService=new Map(),byPlan=new Map(),byLocation=new Map(),byMethod=new Map(),byService=new Map();let total=0,count=0;
 for(let t=from;t<to;t+=DAY){perDay.set(dayKey(t),0);}
 // Revenue chart split into hotspot and PPPoE: hourly for a single day, otherwise per day.
 const hourly=to-from<=DAY,split=new Map();
 const add=(m,k,v)=>m.set(k,(m.get(k)||0)+v);
 for(const p of store.list('subscriberPayments').filter(p=>!p.reversedAt)){const t=p.time||p.created;if(t<from||t>=to)continue;const a=Number(p.amount)||0,s=subs.get(p.subscriberId),plan=plans.get(s?.planId)?.name||'Other';
  total+=a;count++;if(perDay.has(dayKey(t)))add(perDay,dayKey(t),a);add(split,(hourly?Math.floor((t-from)/36e5):dayKey(t))+'|'+(s?.service==='hotspot'?'h':'p'),a);add(byPlan,plan,a);add(byLocation,lastNas.get(s?.username||p.username)||'Unknown',a);add(byMethod,p.method||'other',a);add(byService,s?.service==='hotspot'?'Hotspot':'PPPoE',a);}
 // Vouchers redeemed in the period (their plan price counts as voucher revenue)
 const vPlan=new Map(),vLoc=new Map();let vTotal=0;
 const manual=new Set(store.list('voucherBatches').filter(b=>b.manual).map(b=>b.id));
 for(const v of store.list('vouchers')){if(manual.has(v.batchId))continue;if(v.status!=='used'||!v.usedAt||v.usedAt<from||v.usedAt>=to)continue;const pl=plans.get(v.planId),price=pl?.price||0;vTotal+=price;add(vPlan,pl?.name||'Other',price);add(vLoc,lastNas.get(v.usedBy)||'Unknown',price);}
 // Usage and behaviour (sessions seen in the period)
 const usageDay=new Map(),usageNas=new Map(),usageUser=new Map(),visits=new Map(BUCKETS.map(b=>[b,0])),custPlan=new Map(),custLoc=new Map(),custService=new Map(),seenUsers=new Set();let down=0,up=0;
 for(let t=from;t<to;t+=DAY)usageDay.set(dayKey(t),{down:0,up:0});
 for(const x of sessions){const end=x.stoppedAt||x.updatedAt;if(end<from||(x.startedAt||end)>=to)continue;
  const d=Number(x.downloadBytes)||0,u=Number(x.uploadBytes)||0;down+=d;up+=u;const k=dayKey(Math.min(Math.max(end,from),to-1));if(usageDay.has(k)){usageDay.get(k).down+=d;usageDay.get(k).up+=u;}
  const loc=routerName(x.nasName||x.nas);add(usageNas,loc,d+u);
  const row=usageUser.get(x.username)||{username:x.username,service:x.service,mac:'',down:0,up:0,last:0};row.down+=d;row.up+=u;row.last=Math.max(row.last,end);if(x.mac)row.mac=x.mac;usageUser.set(x.username,row);
  if(x.startedAt>=from&&x.startedAt<to)visits.set(bucket(new Date(x.startedAt+NAIROBI).getUTCHours()),visits.get(bucket(new Date(x.startedAt+NAIROBI).getUTCHours()))+1);
  if(!seenUsers.has(x.username)){seenUsers.add(x.username);const s=byName.get(x.username);add(custPlan,plans.get(s?.planId)?.name||'Other',1);add(custLoc,loc,1);add(custService,x.service==='pppoe'?'PPPoE':'Hotspot',1);}}
 // Before the routers send RADIUS accounting, daily usage comes from the discovery reports (PPPoE and hotspot session counters).
 if(!seenUsers.size){for(const r of routers){const rep=store.setting('customerDiscovery:'+r.id);for(const o of rep?.observations||[]){if(!o.usageDays)continue;const ev=o.evidence||{},sess=ev.ppp||ev.hotspot;if(!sess)continue;const name=sess.name||o.key,service=ev.ppp?'pppoe':'hotspot';let d=0,u=0;
   for(const [k,v] of Object.entries(o.usageDays)){const t=Date.parse(k+'T00:00:00+03:00');if(t<from||t>=to)continue;d+=v.down;u+=v.up;if(usageDay.has(k)){usageDay.get(k).down+=v.down;usageDay.get(k).up+=v.up;}}
   if(!d&&!u)continue;down+=d;up+=u;add(usageNas,r.name,d+u);const row=usageUser.get(name)||{username:name,service,mac:o.snapshot?.macs?.[0]||'',down:0,up:0,last:0};row.down+=d;row.up+=u;row.last=Math.max(row.last,o.lastObserved||0);usageUser.set(name,row);
   if(!seenUsers.has(name)){seenUsers.add(name);const sub=byName.get(String(name).toLowerCase());add(custPlan,plans.get(sub?.planId)?.name||'Other',1);add(custLoc,r.name,1);add(custService,service==='pppoe'?'PPPoE':'Hotspot',1);}}}}
 const list=m=>[...m].map(([name,amount])=>({name,amount:r2(amount)})).sort((a,b)=>b.amount-a.amount);
 const newSubs=[...subs.values()].filter(s=>s.created>=from&&s.created<to);
 const portalVisits=require('./devices-info.cjs').stats(store,from,to);
 const series=hourly?Array.from({length:24},(_,h)=>({label:String(h).padStart(2,'0')+':00',hotspot:r2(split.get(h+'|h')||0),pppoe:r2(split.get(h+'|p')||0)})):[...perDay.keys()].map(k=>({label:k,hotspot:r2(split.get(k+'|h')||0),pppoe:r2(split.get(k+'|p')||0)}));
 return {portalVisits,period,from,to,days,total:r2(total),count,average:count?r2(total/count):0,series,hourly,paymentTimes:{d7:paymentTimes(store,7,now),d30:paymentTimes(store,30,now)},
  perDay:[...perDay].map(([date,amount])=>({date,amount:r2(amount)})),byPlan:list(byPlan),byMethod:list(byMethod),byLocation:list(byLocation),byService:list(byService),
  vouchers:{total:r2(vTotal),byPlan:list(vPlan),byLocation:list(vLoc)},
  usage:{down,up,perDay:[...usageDay].map(([date,v])=>({date,down:v.down,up:v.up})),byDevice:list(usageNas),
   top:[...usageUser.values()].map(u=>({...u,name:byName.get(u.username)?.name||u.username,phone:byName.get(u.username)?.phone||''})).sort((a,b)=>b.down+b.up-a.down-a.up).slice(0,200)},
  customers:{active:seenUsers.size,byPlan:list(custPlan),byLocation:list(custLoc),byService:list(custService),visits:BUCKETS.map(b=>({name:b,amount:visits.get(b)}))},
  newCustomers:newSubs.length,newHotspot:newSubs.filter(s=>s.service==='hotspot').length,newPppoe:newSubs.filter(s=>s.service==='pppoe').length};
}
module.exports={build,range};
