'use strict';
// Hotspot fair usage (ISPman's "Hotspot Fair Usage Trend" and "Fair Usage by Package"): how far active bundles with
// a data cap have got through their allowance. Bundles on packages without a cap have nothing to measure against and
// are counted separately. Today's figures are kept per day so the trend builds up over time.
const packages=require('./packages.cjs'),radius=require('./radius.cjs');
const BANDS=[['under30','Under 30%',0,30],['b30','30–49%',30,50],['b50','50–79%',50,80],['b80','80–99%',80,100],['limit','Limit reached',100,Infinity]];
function summary(store,now=Date.now()){const plans=new Map(store.list('plans').map(p=>[p.id,p])),counts=Object.fromEntries(BANDS.map(b=>[b[0],0])),byPlan=new Map(),reached=new Set();let inUse=0,capped=0;
 for(const s of store.list('subscribers')){if(s.service!=='hotspot'||radius.stateOf(s,now)!=='active')continue;inUse++;const p=plans.get(s.planId);if(!p?.fup?.enabled||!p.fup.downCapMB)continue;capped++;
  const st=packages.fupState(store,s,p,radius.planMs(p),now),pct=st.percent??0,band=BANDS.find(b=>pct>=b[2]&&pct<b[3])[0];counts[band]++;if(band==='limit')reached.add(s.id);
  if(pct>=30){const e=byPlan.get(p.id)||{name:p.name,capMB:p.fup.downCapMB,b30:0,b50:0,b80:0,limit:0};e[band]++;byPlan.set(p.id,e);}}
 const day=new Date(now+3*36e5).toISOString().slice(0,10),hist=store.setting('fairUseDaily')||{days:{}};hist.days[day]={...counts,inUse,capped};for(const k of Object.keys(hist.days).sort().slice(0,-90))delete hist.days[k];store.setting('fairUseDaily',hist);
 return {inUse,capped,uncapped:inUse-capped,counts,bands:BANDS.map(([key,label])=>({key,label})),reachedCustomers:reached.size,byPlan:[...byPlan.values()].sort((a,b)=>(b.b30+b.b50+b.b80+b.limit)-(a.b30+a.b50+a.b80+a.limit)),
  history:Object.entries(hist.days).sort().slice(-30).map(([date,v])=>({date,...v}))};}
module.exports={summary,BANDS};
