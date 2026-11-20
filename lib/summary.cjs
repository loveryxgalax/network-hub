'use strict';
// A short end-of-day text for the owner: money in, customers gained and lost, routers and alerts.
const billing=require('./billing.cjs');
const DAY=864e5,NAIROBI=3*36e5;
const dayStart=t=>{const d=new Date(t+NAIROBI);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-NAIROBI;};
function settings(store){const s=store.setting('dailySummary')||{};return {enabled:s.enabled===true,phone:s.phone||'',hour:Number.isInteger(s.hour)?s.hour:20,lastSent:s.lastSent||null};}
function update(store,input){const cur=settings(store),phone=String(input.phone||'').trim();if(phone&&!billing.phone(phone))throw Object.assign(new Error('Enter a Kenyan phone number like 0712 345 678'),{status:400});
 const hour=Math.round(Number(input.hour??cur.hour));if(!(hour>=0&&hour<=23))throw Object.assign(new Error('Hour must be 0–23'),{status:400});
 return store.setting('dailySummary',{enabled:input.enabled===true,phone,hour,lastSent:cur.lastSent});}
// Sent before noon it reports yesterday (a morning briefing); later in the day it reports today so far.
function build(store,now=Date.now(),{yesterday=false}={}){
 const to=yesterday?dayStart(now):now+1,from=yesterday?dayStart(now)-864e5:dayStart(now),money=n=>'KSh '+Math.round(n).toLocaleString('en-KE');
 const pays=store.list('subscriberPayments').filter(p=>!p.reversedAt).filter(p=>(p.time||p.created)>=from&&(p.time||p.created)<to),revenue=pays.reduce((a,p)=>a+(Number(p.amount)||0),0);
 const subs=store.list('subscribers'),active=subs.filter(s=>s.status==='active'&&(s.expiresAt==null||s.expiresAt>now)).length;
 const expiredToday=subs.filter(s=>s.expiresAt!=null&&s.expiresAt>=from&&s.expiresAt<Math.min(now,to)).length,fresh=subs.filter(s=>s.created>=from&&s.created<to).length;
 const routers=store.list('devices').filter(d=>d.type==='router'),up=routers.filter(r=>r.status==='online').length;
 const alerts=store.list('alerts').filter(a=>a.status!=='Resolved').length,failed=store.list('portalPayments').filter(p=>p.createdAt>=from&&p.status==='failed').length;
 const lines=[`Kade ${yesterday?'yesterday, ':''}${new Date(from+36e5).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'Africa/Nairobi'})}:`,`Revenue ${money(revenue)} (${pays.length} payments)`,`Customers: ${active} active, +${fresh} new, ${expiredToday} expired ${yesterday?'that day':'today'}`,`Routers: ${up}/${routers.length} online${alerts?`, ${alerts} open alert${alerts===1?'':'s'}`:''}`];
 if(failed)lines.push(`${failed} failed M-Pesa attempt${failed===1?'':'s'}`);
 // What needs attention today.
 const down=routers.filter(r=>r.status!=='online').map(r=>r.name);if(down.length)lines.push('Down: '+down.slice(0,5).join(', ')+(down.length>5?` +${down.length-5}`:''));
 const un=store.list('c2bPayments').filter(p=>p.status==='unallocated');if(un.length)lines.push(`${un.length} unmatched paybill payment${un.length===1?'':'s'} (${money(un.reduce((a,p)=>a+(Number(p.amount)||0),0))})`);
 const end=dayStart(now)+864e5,dueTomorrow=yesterday?subs.filter(s=>s.expiresAt!=null&&s.expiresAt>=dayStart(now)&&s.expiresAt<end).length:subs.filter(s=>s.expiresAt!=null&&s.expiresAt>=end&&s.expiresAt<end+864e5).length;if(dueTomorrow)lines.push(`${dueTomorrow} renewal${dueTomorrow===1?'':'s'} due ${yesterday?'today':'tomorrow'}`);
 const lost=subs.filter(s=>s.service==='pppoe'&&s.expiresAt!=null&&s.expiresAt<now-7*864e5&&s.expiresAt>=now-8*864e5).length;if(lost)lines.push(`${lost} PPPoE customer${lost===1?'':'s'} 7 days past expiry (likely lost)`);
 const tk=store.list('tickets').filter(t=>!['Resolved','Closed'].includes(t.status)).length;if(tk)lines.push(`${tk} open ticket${tk===1?'':'s'}`);
 return lines.join('\n');
}
// Called from the server's periodic job; sends at most once per Nairobi day, after the chosen hour.
async function run(store,fetchImpl=fetch,now=Date.now()){
 const s=settings(store);if(!s.enabled||!billing.phone(s.phone)||!store.secret('sms:config'))return null;
 const hour=new Date(now+NAIROBI).getUTCHours();if(hour<s.hour||(s.lastSent&&s.lastSent>=dayStart(now)))return null;
 store.setting('dailySummary',{...s,lastSent:now});return billing.sendSms(store,s.phone,build(store,now,{yesterday:s.hour<12}),'summary',fetchImpl,now);
}
module.exports={settings,update,build,run};
