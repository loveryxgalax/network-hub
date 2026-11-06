'use strict';
// Revenue protection: who has stopped paying, which payment attempts need follow-up, and a full profile per customer.
const billing=require('./billing.cjs'),radius=require('./radius.cjs');
const DAY=864e5,r2=n=>Math.round(n*100)/100;
// Static customer details for the profile: the router network it sits in and the last change sent to the router.
function staticInfo(store,s){const st=require('./statics.cjs').settings(store,s.routerId)||null,bits=st?Number(String(st.network).split('/')[1]):null;
 const mask=st&&Number.isInteger(bits)&&bits>=0&&bits<=32?[24,16,8,0].map(sh=>((bits?(0xffffffff<<(32-bits))>>>0:0)>>>sh)&255).join('.'):'';
 const job=store.list('routerJobs').filter(j=>j.subscriberId===s.id&&/^static-/.test(j.type)).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
 return {ip:s.staticIp,mac:s.staticMac||'',routerId:s.routerId,network:st?.network||'',gateway:st?.gateway||'',netmask:mask,iface:st?.iface||'',arpPinning:st?st.arpPinning!==false:null,
  queue:'netops-'+String(s.username).replace(/[^A-Za-z0-9._@:-]/g,'-'),runner:!!store.secret('jobs:'+s.routerId),inSync:!!s.staticApplied&&s.provisioning?.status==='ok',
  lastJob:job?{type:job.type,action:job.type==='static-remove'?'removed':job.params?.enabled==='no'?'disconnected':'connected',status:job.status,time:job.finishedAt||job.createdAt,error:job.error||'',rate:job.params?.rate||''}:null};}
function overdue(store,now=Date.now()){
 const plans=new Map(store.list('plans').map(p=>[p.id,p])),pays=new Map();
 for(const p of store.list('subscriberPayments').filter(p=>!p.reversedAt)){const e=pays.get(p.subscriberId)||{total:0,count:0,last:0};e.total+=Number(p.amount)||0;e.count++;e.last=Math.max(e.last,p.time||p.created||0);pays.set(p.subscriberId,e);}
 const online=new Set(store.sessionsSince(now-15*60000).filter(s=>!s.stoppedAt&&now-s.updatedAt<15*60000).map(s=>s.username));
 const items=[];
 for(const s of store.list('subscribers')){if(s.expiresAt==null||s.expiresAt>now)continue;const plan=plans.get(s.planId),pay=pays.get(s.id)||{total:0,count:0,last:0},days=Math.floor((now-s.expiresAt)/DAY);
  const monthly=plan&&plan.price?plan.price*(30*DAY/Math.max(radius.planMs(plan),DAY)):0;
  items.push({id:s.id,name:s.name,username:s.username,phone:s.phone,service:s.service,status:s.status,plan:plan?.name||'—',price:plan?.price||0,monthly:r2(monthly),expiresAt:s.expiresAt,daysOverdue:days,online:online.has(s.username),paidTotal:r2(pay.total),payments:pay.count,lastPayment:pay.last||null,bucket:days<=7?'1-7 days':days<=30?'8-30 days':days<=90?'31-90 days':'90+ days',valuable:pay.total>=3000});}
 items.sort((a,b)=>b.paidTotal-a.paidTotal||a.daysOverdue-b.daysOverdue);
 const buckets=['1-7 days','8-30 days','31-90 days','90+ days'].map(b=>({bucket:b,count:items.filter(x=>x.bucket===b).length,monthly:r2(items.filter(x=>x.bucket===b).reduce((a,x)=>a+x.monthly,0))}));
 return {items,buckets,atRiskMonthly:r2(items.filter(x=>x.status==='active'&&x.daysOverdue<=90).reduce((a,x)=>a+x.monthly,0)),stillOnline:items.filter(x=>x.online).length};
}
// Portal payment attempts that did not end in a credited payment.
function payments(store,now=Date.now()){
 const items=store.list('portalPayments').map(p=>({id:p.id,time:p.createdAt,phone:p.phone,amount:p.amount,planName:p.planName,kind:p.kind,status:p.status,reason:p.reason||'',receipt:p.receipt||'',credited:!!p.creditedAt||p.status==='paid',ageMinutes:Math.round((now-p.createdAt)/60000),canRecheck:p.status!=='paid'&&!!p.checkoutRequestId&&now-p.createdAt<7*DAY,subscriberId:p.subscriberId}));
 items.sort((a,b)=>b.time-a.time);
 const attention=items.filter(p=>p.status==='failed'||(p.status==='pending'&&p.ageMinutes>=3));
 return {items:items.slice(0,300),attention:attention.length,counts:{paid:items.filter(p=>p.status==='paid').length,failed:items.filter(p=>p.status==='failed').length,pending:items.filter(p=>p.status==='pending').length}};
}
function profile(store,id,now=Date.now()){
 const s=store.get('subscribers',id);if(!s)throw Object.assign(new Error('Subscriber not found'),{status:404});
 const plan=store.get('plans',s.planId),phone=billing.phone(s.phone),pays=store.list('subscriberPayments').filter(p=>p.subscriberId===s.id).sort((a,b)=>(b.time||b.created)-(a.time||a.created));
 const sessions=store.sessionsOf(s.username).sort((a,b)=>b.startedAt-a.startedAt);
 const usage=new Map();for(let i=13;i>=0;i--){usage.set(new Date(now-i*DAY+3*36e5).toISOString().slice(0,10),{down:0,up:0});}
 for(const x of sessions){const k=new Date((x.stoppedAt||x.updatedAt)+3*36e5).toISOString().slice(0,10);if(usage.has(k)){usage.get(k).down+=Number(x.downloadBytes)||0;usage.get(k).up+=Number(x.uploadBytes)||0;}}
 const sms=(store.setting('smsLog')?.items||[]).filter(m=>phone&&billing.phone(m.to)===phone).slice(0,20);
 const portal=store.list('portalPayments').filter(p=>p.subscriberId===s.id||(phone&&billing.phone(p.phone)===phone)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,20).map(p=>({time:p.createdAt,amount:p.amount,status:p.status,planName:p.planName,receipt:p.receipt||'',reason:p.reason||''}));
 const log=(store.setting('radiusAuthLog')?.items||[]).filter(l=>String(l.username).toLowerCase().split('@')[0]===s.username).slice(0,15);
 const tickets=store.list('tickets').filter(t=>t.subscriberId===s.id||(s.name&&String(t.customer||'').toLowerCase()===s.name.toLowerCase())).slice(0,10).map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,created:t.created}));
 const di=require('./devices-info.cjs'),hs=require('./hotspot.cjs'),removed=new Map((s.removedMacs||[]).map(r=>[r.mac,r.at])),blocked=new Set((require('./radius.cjs').settings(store).blockedMacs||[]).map(b=>b.mac));
 const macs=[...new Set([s.boundMac,...sessions.map(x=>x.mac).filter(Boolean),s.lastMac].filter(Boolean).map(m=>hs.macOf(m)))].filter(m=>{const at=removed.get(m);if(!at)return true;const seen=sessions.find(x=>hs.macOf(x.mac)===m);return !!seen&&seen.updatedAt>at;}).slice(0,10);
 const devices=macs.map(m=>{const sx=sessions.find(x=>hs.macOf(x.mac)===m),info=di.lookup(store,m)||{};return {mac:m,...info,engine:/AppleWebKit/i.test(info.ua||'')?(/Chrome\//i.test(info.ua||'')?'Blink':'WebKit'):/Gecko\//i.test(info.ua||'')?'Gecko':'',captiveSeen:info.last||null,lastSeen:sx?.updatedAt||null,lastIp:sx?.ip||'',bound:hs.macOf(s.boundMac)===m,blocked:blocked.has(m)};});
 // Recent connectivity: each purchase or manual connect with the session that followed it.
 const fupOn=!!plan?.fup?.enabled,after=t=>sessions.filter(x=>x.startedAt>=t-120000&&x.startedAt<=t+DAY).sort((a,b)=>a.startedAt-b.startedAt)[0];
 const connectivity=[...pays.filter(p=>!p.reversedAt).map(p=>({time:p.time||p.created,mode:'Paid · '+(p.method||''),planName:p.planName,expiry:p.expiresAt})),...store.list('manualConnects').filter(m=>m.subscriberId===s.id).map(m=>({time:m.time,mode:'Manual · '+(m.by||''),planName:m.planName,expiry:m.after})),...store.list('vouchers').filter(v=>v.usedBy===s.username&&v.usedAt).map(v=>({time:v.usedAt,mode:'Voucher '+v.code,planName:store.get('plans',v.planId)?.name||'',expiry:null}))]
  .sort((a,b)=>b.time-a.time).slice(0,20).map(c=>{const x=after(c.time);return {...c,router:x?(x.nasName||x.nas):'',mac:x?.mac||'',ip:x?.ip||'',download:x?.downloadBytes||0,upload:x?.uploadBytes||0,fup:fupOn};});
 const children=store.list('subscribers').filter(x=>x.parentId===s.id).map(x=>({id:x.id,name:x.name,username:x.username})),parent=s.parentId?store.get('subscribers',s.parentId):null;
 const total=pays.filter(p=>!p.reversedAt).reduce((a,p)=>a+(Number(p.amount)||0),0),state=require('./radius.cjs').stateOf(s,now);
 return {subscriber:{id:s.id,name:s.name,username:s.username,phone:s.phone,email:s.email,address:s.address||'',latitude:s.latitude??null,longitude:s.longitude??null,routerId:s.routerId||'',roaming:s.roaming||'',service:s.service,status:s.status,state,expiresAt:s.expiresAt,balance:s.balance||0,points:s.points||0,provisioning:s.provisioning||null,boundMac:s.boundMac||'',lastMac:s.lastMac||'',lastSeen:s.lastSeen||null,staticIp:s.staticIp||'',notes:s.notes||'',address:s.address||'',created:s.created,plan:plan?{name:plan.name,price:plan.price,downloadMbps:plan.downloadMbps,uploadMbps:plan.uploadMbps}:null},
  cpe:Object.entries(store.setting('acsLinks')||{}).find(([,l])=>l.subscriberId===s.id)?.[0]||null,devicesOnRouter:(()=>{const rows=Object.values(store.setting('cpeHosts')||{}).filter(x=>x.subscriberId===s.id).flatMap(x=>x.points||[]);if(!rows.length)return null;const last=rows.sort((a,b)=>b.time-a.time)[0];return {now:last.count,peak:Math.max(...rows.map(x=>x.count)),time:last.time};})(),paidTotal:r2(total),wallet:require('./ledger.cjs').wallet(store,s,now),ledger:require('./ledger.cjs').list(store,{subscriberId:s.id,limit:20}),devices,children,parent:parent?{id:parent.id,name:parent.name,username:parent.username}:null,hasPin:!!store.secret('pin:'+s.id),connectivity,autoBilling:s.autoBilling===true,paymentRef:s.paymentRef||'',staticInfo:s.service==='static'?staticInfo(store,s):null,payments:pays.slice(0,30),portalPayments:portal,sessions:sessions.slice(0,15),usage:[...usage].map(([date,v])=>({date,...v})),sms,authLog:log,routerJobs:store.list('routerJobs').filter(j=>j.subscriberId===s.id).sort((a,b)=>b.createdAt-a.createdAt).slice(0,20).map(j=>({label:j.label,status:j.status,routerName:j.routerName,createdAt:j.createdAt,attempts:j.attempts,maxAttempts:j.maxAttempts,error:j.error||'',output:j.output||''})),fup:(()=>{if(!plan?.fup?.enabled)return null;try{const st=require('./packages.cjs').fupState(store,s,plan,require('./radius.cjs').planMs(plan),now);return {capMB:plan.fup.downCapMB||0,timeCapMinutes:plan.fup.timeCapMinutes||0,down:st.usage?.down||0,seconds:st.usage?.seconds||0,percent:st.percent,active:st.active,reasons:st.reasons||[],period:plan.fup.period};}catch{return null;}})(),tickets,invoices:store.list('invoices').filter(i=>i.subscriberId===s.id).slice(0,10).map(i=>({id:i.id,name:i.name,amount:i.amount,due:i.due,status:i.status})),online:sessions.some(x=>!x.stoppedAt&&now-x.updatedAt<15*60000)};
}
module.exports={overdue,payments,profile};
