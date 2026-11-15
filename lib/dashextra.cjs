'use strict';
// Extra dashboard cards: SMS sent (by customer type, by message type, sent vs failed over time) and today's portal
// checkouts (pending / paid / failed, success rate). Read-only, from the SMS log and the portal payment attempts.
const billing=require('./billing.cjs');
const NAIROBI=3*36e5,DAY=864e5,dayStart=t=>Math.floor((t+NAIROBI)/DAY)*DAY-NAIROBI;
const KIND={manual:'Manual',reminder:'Expiry reminder',expired:'Expired notice',receipt:'Receipt',ticket:'Support ticket',welcome:'Welcome',campaign:'Campaign',otp:'PIN / code',usage:'Usage notice'};
function build(store,period='today',now=Date.now()){
 const p=['today','7d','30d'].includes(period)?period:'today',since=p==='today'?dayStart(now):now-(p==='7d'?7:30)*DAY;
 const svc=new Map();for(const s of store.list('subscribers')){const ph=billing.phone(s.phone);if(ph&&!svc.has(ph))svc.set(ph,s.service);}
 const items=(store.setting('smsLog')?.items||[]).filter(m=>(m.time||0)>=since),byType={Hotspot:0,PPPoE:0,'Static IP':0,Other:0},byKind={},buckets=new Map();
 const key=t=>p==='today'?String(new Date(t+NAIROBI).getUTCHours()).padStart(2,'0')+':00':new Date(t+NAIROBI).toISOString().slice(5,10);
 if(p==='today')for(let h=0;h<=new Date(now+NAIROBI).getUTCHours();h++)buckets.set(String(h).padStart(2,'0')+':00',{sent:0,failed:0});
 else for(let t=dayStart(since);t<=now;t+=DAY)buckets.set(key(t),{sent:0,failed:0});
 let sent=0,failed=0;
 for(const m of items){const ok=m.status==='sent';if(ok)sent++;else failed++;const b=buckets.get(key(m.time));if(b)b[ok?'sent':'failed']++;
  if(!ok)continue;const s=svc.get(billing.phone(m.to));byType[s==='hotspot'?'Hotspot':s==='pppoe'?'PPPoE':s==='static'?'Static IP':'Other']++;const k=KIND[m.kind]||String(m.kind||'Other');byKind[k]=(byKind[k]||0)+1;}
 const pay=store.list('portalPayments').filter(x=>(x.createdAt||0)>=dayStart(now)),c={pending:0,paid:0,failed:0};for(const x of pay)c[x.status==='paid'?'paid':x.status==='pending'?'pending':'failed']++;
 const done=c.paid+c.failed;
 // Revenue today against yesterday up to the same time, with the latest payments; and where the period's money came from.
 const subs=new Map(store.list('subscribers').map(x=>[x.id,x])),plans=new Map(store.list('plans').map(x=>[x.id,x.name])),routers=new Map(store.list('devices').map(x=>[x.id,x.name]));
 const allPays=store.list('subscriberPayments').filter(x=>!x.reversedAt).map(x=>({...x,t:x.time||x.created||0})),d0=dayStart(now),sumOf=l=>Math.round(l.reduce((a,x)=>a+(Number(x.amount)||0),0));
 const todayPays=allPays.filter(x=>x.t>=d0),yestSame=sumOf(allPays.filter(x=>x.t>=d0-DAY&&x.t<now-DAY)),yestFull=sumOf(allPays.filter(x=>x.t>=d0-DAY&&x.t<d0)),todayTotal=sumOf(todayPays);
 const svcOf=x=>{const s=subs.get(x.subscriberId)?.service;return s==='hotspot'?'Hotspot':s==='pppoe'?'PPPoE':s==='static'?'Static IP':'Other';};
 const mask=ph=>{const v=String(ph||'');return v.length>6?v.slice(0,5)+'•••'+v.slice(-3):v;};
 const revenue={today:todayTotal,yesterdaySameTime:yestSame,yesterdayFull:yestFull,changePct:yestSame?Math.round((todayTotal-yestSame)/yestSame*1000)/10:null,hotspot:sumOf(todayPays.filter(x=>svcOf(x)==='Hotspot')),pppoe:sumOf(todayPays.filter(x=>svcOf(x)==='PPPoE')),
  latest:allPays.sort((a,b)=>b.t-a.t).slice(0,6).map(x=>{const sb=subs.get(x.subscriberId);return {account:sb?.username||x.username||'',phone:mask(x.phone||sb?.phone),router:routers.get(sb?.routerId)||'',time:x.t,amount:x.amount,method:x.method||''};})};
 const inPeriod=allPays.filter(x=>x.t>=since),group=f=>{const m=new Map();for(const x of inPeriod){const k=f(x)||'Other';m.set(k,(m.get(k)||0)+(Number(x.amount)||0));}return [...m].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value])=>({label,value:Math.round(value)}));};
 const breakdown={total:sumOf(inPeriod),count:inPeriod.length,byMethod:group(x=>({mpesa:'M-Pesa',cash:'Cash',bank:'Bank',wallet:'Wallet',paystack:'Card'})[x.method]||x.method),byPackage:group(x=>x.planName||plans.get(subs.get(x.subscriberId)?.planId)),byService:group(svcOf)};
 return {period:p,sms:{sent,failed,byType:Object.entries(byType).filter(([,v])=>v).map(([label,value])=>({label,value})),byKind:Object.entries(byKind).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value})),series:[...buckets].map(([label,v])=>({label,...v}))},
  revenue,breakdown,
  checkouts:{...c,total:pay.length,successPct:done?Math.round(c.paid/done*100):null,amountPaid:Math.round(pay.filter(x=>x.status==='paid').reduce((a,x)=>a+(Number(x.amount)||0),0))}};}
// Trends: data used per day for the last 14 days by service, and the heaviest users. Alias logins (TVs) count under their owner.
function usage(store,now=Date.now()){const since=dayStart(now)-13*DAY,days=new Map();for(let t=since;t<=now;t+=DAY)days.set(new Date(t+NAIROBI).toISOString().slice(5,10),{hotspot:0,pppoe:0});
 const users=new Map();let down=0,up=0;
 for(const x of store.sessionsSince(since)){const t=x.stoppedAt||x.updatedAt||0;if(t<since)continue;const b=(Number(x.downloadBytes)||0)+(Number(x.uploadBytes)||0),d=days.get(new Date(t+NAIROBI).toISOString().slice(5,10));if(d)d[x.service==='hotspot'?'hotspot':'pppoe']+=b;
  down+=Number(x.downloadBytes)||0;up+=Number(x.uploadBytes)||0;const u=x.account||x.username||'';if(u){const e=users.get(u)||{username:u,service:x.service==='hotspot'?'Hotspot':'PPPoE',bytes:0,sessions:0};e.bytes+=b;e.sessions++;users.set(u,e);}}
 const names=new Map(store.list('subscribers').map(s=>[String(s.username).toLowerCase(),{id:s.id,name:s.name}]));
 return {days:[...days].map(([label,v])=>({label,...v})),totals:{down,up,users:users.size},top:[...users.values()].sort((a,b)=>b.bytes-a.bytes).slice(0,10).map(u=>({...u,...(names.get(String(u.username).toLowerCase())||{})}))};}
module.exports={build,usage};
