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
 return {period:p,sms:{sent,failed,byType:Object.entries(byType).filter(([,v])=>v).map(([label,value])=>({label,value})),byKind:Object.entries(byKind).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value})),series:[...buckets].map(([label,v])=>({label,...v}))},
  checkouts:{...c,total:pay.length,successPct:done?Math.round(c.paid/done*100):null,amountPaid:Math.round(pay.filter(x=>x.status==='paid').reduce((a,x)=>a+(Number(x.amount)||0),0))}};}
module.exports={build};
