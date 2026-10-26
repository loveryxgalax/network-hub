'use strict';
// A short end-of-day text for the owner: money in, customers gained and lost, routers and alerts.
const billing=require('./billing.cjs');
const DAY=864e5,NAIROBI=3*36e5;
const dayStart=t=>{const d=new Date(t+NAIROBI);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-NAIROBI;};
function settings(store){const s=store.setting('dailySummary')||{};return {enabled:s.enabled===true,phone:s.phone||'',hour:Number.isInteger(s.hour)?s.hour:20,lastSent:s.lastSent||null};}
function update(store,input){const cur=settings(store),phone=String(input.phone||'').trim();if(phone&&!billing.phone(phone))throw Object.assign(new Error('Enter a Kenyan phone number like 0712 345 678'),{status:400});
 const hour=Math.round(Number(input.hour??cur.hour));if(!(hour>=0&&hour<=23))throw Object.assign(new Error('Hour must be 0–23'),{status:400});
 return store.setting('dailySummary',{enabled:input.enabled===true,phone,hour,lastSent:cur.lastSent});}
function build(store,now=Date.now()){
 const from=dayStart(now),money=n=>'KSh '+Math.round(n).toLocaleString('en-KE');
 const pays=store.list('subscriberPayments').filter(p=>(p.time||p.created)>=from),revenue=pays.reduce((a,p)=>a+(Number(p.amount)||0),0);
 const subs=store.list('subscribers'),active=subs.filter(s=>s.status==='active'&&(s.expiresAt==null||s.expiresAt>now)).length;
 const expiredToday=subs.filter(s=>s.expiresAt!=null&&s.expiresAt>=from&&s.expiresAt<now).length,fresh=subs.filter(s=>s.created>=from).length;
 const routers=store.list('devices').filter(d=>d.type==='router'),up=routers.filter(r=>r.status==='online').length;
 const alerts=store.list('alerts').filter(a=>a.status!=='Resolved').length,failed=store.list('portalPayments').filter(p=>p.createdAt>=from&&p.status==='failed').length;
 const lines=[`Kade ${new Date(now).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'Africa/Nairobi'})}:`,`Revenue ${money(revenue)} (${pays.length} payments)`,`Customers: ${active} active, +${fresh} new, ${expiredToday} expired today`,`Routers: ${up}/${routers.length} online${alerts?`, ${alerts} open alert${alerts===1?'':'s'}`:''}`];
 if(failed)lines.push(`${failed} failed M-Pesa attempt${failed===1?'':'s'}`);
 return lines.join('\n');
}
// Called from the server's periodic job; sends at most once per Nairobi day, after the chosen hour.
async function run(store,fetchImpl=fetch,now=Date.now()){
 const s=settings(store);if(!s.enabled||!billing.phone(s.phone)||!store.secret('sms:config'))return null;
 const hour=new Date(now+NAIROBI).getUTCHours();if(hour<s.hour||(s.lastSent&&s.lastSent>=dayStart(now)))return null;
 store.setting('dailySummary',{...s,lastSent:now});return billing.sendSms(store,s.phone,build(store,now),'summary',fetchImpl,now);
}
module.exports={settings,update,build,run};
