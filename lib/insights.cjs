'use strict';
// Four automatic checks, each from data netops already collects:
//  churn     PPPoE customers whose daily use fell sharply (or who went silent) while their package runs out soon.
//  winback   Hotspot regulars (3+ packages in 60 days) who have not bought or been online for 7+ days.
//  capacity  Routers whose busiest 10 minutes this week came close to their uplink (or, without an uplink speed set,
//            how much customers' package speeds exceed what the router carried at its peak).
//  fibre     Customer fibre boxes (ONUs on the OLT, or ONTs on TR-069) whose receive signal is weak or falling.
// Staff act from the Insights page; messages are only sent on request, or daily for win-backs when that is turned on.
const radius=require('./radius.cjs'),health=require('./health.cjs');
const DAY=864e5,NBO=3*36e5,dayKey=t=>new Date(t+NBO).toISOString().slice(0,10);
const r1=v=>Math.round(v*10)/10;
function dailyUse(store,s,now){let u;try{u=require('./usage.cjs').usage(store,s,{from:dayKey(now-27*DAY),to:dayKey(now),group:'day'},now);}catch{return null;}
 return u.series.map(x=>(x.down+x.up)/1e6);}// MB per day, oldest first (28 days)
function churn(store,now=Date.now()){const out=[];
 for(const s of store.list('subscribers')){if(s.service!=='pppoe'||s.parentId||s.status!=='active')continue;
  const left=s.expiresAt==null?null:s.expiresAt-now;if(left!=null&&(left>10*DAY||left<-3*DAY))continue;
  const mb=dailyUse(store,s,now);if(!mb||mb.length<28)continue;
  const before=mb.slice(0,21).reduce((a,b)=>a+b,0)/21,recent=mb.slice(21).reduce((a,b)=>a+b,0)/7,silent=mb.slice(-3).every(v=>v<1);
  if(before<200)continue;// under 200 MB a day before: too little to judge
  const drop=1-recent/before;if(!(drop>=0.6||silent))continue;
  out.push({id:s.id,name:s.name,username:s.username,phone:s.phone||'',expiresAt:s.expiresAt??null,beforeMB:Math.round(before),recentMB:Math.round(recent),dropPct:Math.round(drop*100),silent,
   reason:silent?`No use for 3 days (was ${Math.round(before)} MB a day)`:`Use fell ${Math.round(drop*100)}%: ${Math.round(recent)} MB a day this week, was ${Math.round(before)} MB`,lastContact:s.insight?.churn||null});}
 return out.sort((a,b)=>(a.expiresAt??Infinity)-(b.expiresAt??Infinity));}
function winback(store,now=Date.now()){const pays=new Map();
 for(const p of store.list('subscriberPayments')){if(p.reversedAt)continue;const t=p.time||p.created;if(t<now-60*DAY)continue;const a=pays.get(p.subscriberId)||[];a.push({t,amount:Number(p.amount)||0});pays.set(p.subscriberId,a);}
 const out=[];
 for(const s of store.list('subscribers')){if(s.service!=='hotspot'||s.parentId)continue;const list=pays.get(s.id)||[];if(list.length<3)continue;
  const last=Math.max(...list.map(x=>x.t)),seen=Math.max(s.lastSeen||0,s.expiresAt||0,last);if(now-seen<7*DAY)continue;
  if(s.status==='active'&&s.expiresAt!=null&&s.expiresAt>now)continue;
  const spent=list.reduce((a,x)=>a+x.amount,0);
  out.push({id:s.id,name:s.name,username:s.username,phone:s.phone||'',purchases:list.length,spent:Math.round(spent),lastPaid:last,daysAway:Math.floor((now-seen)/DAY),
   reason:`${list.length} packages (KES ${Math.round(spent)}) in 60 days, nothing for ${Math.floor((now-seen)/DAY)} days`,lastContact:s.insight?.winback||null});}
 return out.sort((a,b)=>b.spent-a.spent);}
function capacity(store,now=Date.now()){const plans=new Map(store.list('plans').map(p=>[p.id,p])),subs=new Map(store.list('subscribers').map(s=>[String(s.username).toLowerCase(),s])),out=[];
 for(const r of store.list('devices').filter(d=>d.type==='router')){const rep=store.setting('customerDiscovery:'+r.id);if(!rep)continue;
  const buckets=new Map();let sold=0;const users=new Set();
  for(const o of rep.observations||[]){for(const x of o.trafficHistory||[]){if(x.time<now-7*DAY)continue;const k=Math.floor(x.time/6e5);const b=buckets.get(k)||{down:0,up:0,n:0};b.down+=x.downloadMbps||0;b.up+=x.uploadMbps||0;b.n++;buckets.set(k,b);}
   const name=String(o.evidence?.ppp?.name||o.evidence?.hotspot?.name||'').toLowerCase();if(name&&!users.has(name)&&now-(o.lastObserved||0)<DAY){users.add(name);const p=plans.get(subs.get(name)?.planId);if(p)sold+=p.downloadMbps||0;}}
  if(!buckets.size)continue;
  const peakB=[...buckets].sort((a,b)=>b[1].down-a[1].down)[0],peak=peakB[1].down,peakAt=peakB[0]*6e5;
  const hours=new Map();for(const [k,b] of buckets){const h=new Date(k*6e5+NBO).getUTCHours();hours.set(h,Math.max(hours.get(h)||0,b.down));}
  const busy=[...hours].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([h])=>`${String(h).padStart(2,'0')}:00`).sort();
  const up=Number(r.uplinkMbps)||0,pct=up?Math.round(peak/up*100):null;
  const level=pct==null?'unknown':pct>=90?'critical':pct>=75?'warning':'ok';
  out.push({id:r.id,name:r.name,uplinkMbps:up||null,peakMbps:r1(peak),peakAt,peakPct:pct,busyHours:busy,customers:users.size,soldMbps:r1(sold),ratio:peak>0?r1(sold/peak):null,level,
   reason:up?`Busiest 10 minutes: ${r1(peak)} of ${up} Mbps (${pct}%)`:`Busiest 10 minutes: ${r1(peak)} Mbps. Set the uplink speed to see how full it is`});}
 return out.sort((a,b)=>(b.peakPct??-1)-(a.peakPct??-1)||b.peakMbps-a.peakMbps);}
// Signal readings: ONUs from the OLT (measurements), ONTs from TR-069 (kept by recordSignal below). dBm, higher is better.
const WEAK=-25,BAD=-27;
function trend(points,now){const p=points.filter(x=>Number.isFinite(x.v)&&x.t>now-30*DAY);if(p.length<3)return null;
 const cur=p.filter(x=>x.t>now-DAY),old=p.filter(x=>x.t<=now-7*DAY&&x.t>now-21*DAY),avg=a=>a.reduce((s,x)=>s+x.v,0)/a.length;
 const now_=cur.length?avg(cur):p.at(-1).v,then=old.length?avg(old):null;return {now:r1(now_),then:then==null?null:r1(then),fall:then==null?0:r1(then-now_),points:p.length};}
function fibre(store,now=Date.now()){const out=[],subs=store.list('subscribers');
 const owner=d=>d.subscriberId?subs.find(s=>s.id===d.subscriberId):(d.customer?subs.find(s=>s.name===d.customer||s.username===d.customer):null);
 for(const d of store.list('devices').filter(x=>x.type==='onu')){let pts=[];try{pts=store.history(d.id,now-30*DAY).map(m=>({t:m.time,v:Number(m.power)})).filter(x=>Number.isFinite(x.v)&&x.v!==0);}catch{}
  const t=trend(pts,now);if(!t)continue;const s=owner(d);out.push({id:d.id,kind:'ONU (OLT)',name:d.name,serial:d.serial||'',customer:s?.name||d.customer||'',subscriberId:s?.id||null,...t});}
 for(const [id,x] of Object.entries(store.setting('cpeSignal')||{})){const t=trend(x.points.map(p=>({t:p.time,v:p.rx})),now);if(!t)continue;const s=x.subscriberId&&subs.find(y=>y.id===x.subscriberId);
  out.push({id,kind:'ONT (TR-069)',name:x.model||id,serial:x.serial||'',customer:s?.name||'',subscriberId:s?.id||null,...t});}
 return out.map(x=>({...x,level:x.now<=BAD||x.fall>=3?'critical':x.now<=WEAK||x.fall>=2?'warning':'ok',
   reason:`${x.now} dBm now${x.then!=null?`, ${x.then} dBm two weeks ago${x.fall>0?` (down ${x.fall} dB)`:''}`:''}`})).filter(x=>x.level!=='ok').sort((a,b)=>a.now-b.now);}
// TR-069 receive power history (hourly), with the customer it belongs to.
function recordSignal(store,rows,now=Date.now()){const h=store.setting('cpeSignal')||{},links=store.setting('acsLinks')||{};let changed=false;
 for(const d of rows||[]){const rx=Number(d.rxPower);if(!Number.isFinite(rx)||rx===0||rx>10||rx<-50)continue;const cur=h[d.id]||{points:[]},last=cur.points.at(-1);if(last&&now-last.time<36e5)continue;
  const byPpp=d.ppp?.[0]?.username&&store.subscriberByUsername(String(d.ppp[0].username).toLowerCase().split('@')[0]);
  h[d.id]={subscriberId:links[d.id]?.subscriberId||byPpp?.id||cur.subscriberId||null,serial:d.serial||'',model:d.model||'',points:[...cur.points,{time:now,rx}].filter(x=>x.time>now-30*DAY).slice(-800)};changed=true;}
 if(changed)store.setting('cpeSignal',h);}
// Alerts for routers near their uplink and fibre boxes with a bad signal (opened and closed automatically).
function raiseAlerts(store,now=Date.now()){
 for(const c of capacity(store,now)){const r=store.get('devices',c.id);if(!r)continue;health.raise(store,r,'capacity',c.level==='critical'||c.level==='warning',c.level==='critical'?'critical':'warning',`${r.name} uplink nearly full at peak`,`${c.reason}. Busiest around ${c.busyHours.join(', ')}. Plan a bigger uplink or move customers.`);}
 const bad=new Set();for(const f of fibre(store,now)){const d=store.get('devices',f.id);if(!d)continue;bad.add(d.id);health.raise(store,d,'fibre-signal',true,f.level==='critical'?'critical':'warning',`Weak fibre signal: ${f.customer||f.name}`,`${f.reason}. Check the drop cable, connectors and splitter before the line fails.`);}
 for(const a of store.list('alerts'))if(a.logKey==='fibre-signal'&&a.status!=='Resolved'&&!bad.has(a.deviceId))store.put('alerts',{...a,status:'Resolved'},a);}
function settings(store){return {winbackAuto:false,winbackTemplate:'',churnTemplate:'',...(store.setting('insightSettings')||{})};}
function text(store,kind,s,link){const first=String(s.name||'').split(' ')[0]||'there',cfg=settings(store);
 const def=kind==='churn'?'Hi {first}, we noticed you have used your internet much less this week. Is everything working well? Reply or call us and we will check your line. Your account: {link}'
  :'Hi {first}, we miss you on our WiFi! Your next package is one tap away: {link}';
 return (cfg[kind+'Template']||def).replace(/\{first\}/g,first).replace(/\{link\}/g,link).slice(0,459);}
async function contact(store,kind,id,{origin='',user,force=false}={},now=Date.now()){if(!['churn','winback'].includes(kind))throw Object.assign(new Error('Unknown message'),{status:400});
 const s=store.get('subscribers',id);if(!s)throw Object.assign(new Error('Customer not found'),{status:404});
 if(!force&&s.insight?.[kind]&&now-s.insight[kind]<14*DAY)throw Object.assign(new Error('This customer was contacted about this in the last 14 days'),{status:409});
 const billing=require('./billing.cjs');if(!billing.phone(s.phone))throw Object.assign(new Error('This customer has no valid phone number'),{status:400});
 const link=kind==='churn'&&origin?origin+'/portal/account.html?t='+require('./selfservice.cjs').token(store,s,now):(origin?origin+'/portal/':'');
 const r=await billing.sendSms(store,s.phone,text(store,kind,s,link),kind==='churn'?'retention':'win-back');
 const cur=store.get('subscribers',id);store.put('subscribers',{...cur,insight:{...(cur.insight||{}),[kind]:now}},cur);store.audit(user||{id:'system'},(kind==='churn'?'Check-in':'Win-back')+' SMS to '+s.username,id);
 return {sent:r?.status==='sent',detail:r?.detail||''};}
async function daily(store,origin,now=Date.now()){if(process.env.NETWORK_PASSIVE==='1')return {sent:0};try{raiseAlerts(store,now);}catch{}let sent=0;
 if(settings(store).winbackAuto)for(const w of winback(store,now).filter(x=>x.phone&&(!x.lastContact||now-x.lastContact>=30*DAY)).slice(0,20)){try{await contact(store,'winback',w.id,{origin},now);sent++;}catch{}}
 return {sent};}
module.exports={churn,winback,capacity,fibre,recordSignal,raiseAlerts,contact,daily,settings,text,trend,dailyUse};
