'use strict';
// Revenue protection: who has stopped paying, which payment attempts need follow-up, and a full profile per customer.
const billing=require('./billing.cjs'),radius=require('./radius.cjs');
const DAY=864e5,r2=n=>Math.round(n*100)/100;
function overdue(store,now=Date.now()){
 const plans=new Map(store.list('plans').map(p=>[p.id,p])),pays=new Map();
 for(const p of store.list('subscriberPayments')){const e=pays.get(p.subscriberId)||{total:0,count:0,last:0};e.total+=Number(p.amount)||0;e.count++;e.last=Math.max(e.last,p.time||p.created||0);pays.set(p.subscriberId,e);}
 const online=new Set(store.list('radiusSessions').filter(s=>!s.stoppedAt&&now-s.updatedAt<15*60000).map(s=>s.username));
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
 const sessions=store.list('radiusSessions').filter(x=>x.username===s.username).sort((a,b)=>b.startedAt-a.startedAt);
 const usage=new Map();for(let i=13;i>=0;i--){usage.set(new Date(now-i*DAY+3*36e5).toISOString().slice(0,10),{down:0,up:0});}
 for(const x of sessions){const k=new Date((x.stoppedAt||x.updatedAt)+3*36e5).toISOString().slice(0,10);if(usage.has(k)){usage.get(k).down+=Number(x.downloadBytes)||0;usage.get(k).up+=Number(x.uploadBytes)||0;}}
 const sms=(store.setting('smsLog')?.items||[]).filter(m=>phone&&billing.phone(m.to)===phone).slice(0,20);
 const portal=store.list('portalPayments').filter(p=>p.subscriberId===s.id||(phone&&billing.phone(p.phone)===phone)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,20).map(p=>({time:p.createdAt,amount:p.amount,status:p.status,planName:p.planName,receipt:p.receipt||'',reason:p.reason||''}));
 const log=(store.setting('radiusAuthLog')?.items||[]).filter(l=>String(l.username).toLowerCase().split('@')[0]===s.username).slice(0,15);
 const tickets=store.list('tickets').filter(t=>t.subscriberId===s.id||(s.name&&String(t.customer||'').toLowerCase()===s.name.toLowerCase())).slice(0,10).map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,created:t.created}));
 const total=pays.reduce((a,p)=>a+(Number(p.amount)||0),0),state=s.status!=='active'?'suspended':s.expiresAt!=null&&s.expiresAt<=now?'expired':'active';
 return {subscriber:{id:s.id,name:s.name,username:s.username,phone:s.phone,email:s.email,service:s.service,status:s.status,state,expiresAt:s.expiresAt,balance:s.balance||0,boundMac:s.boundMac||'',lastMac:s.lastMac||'',lastSeen:s.lastSeen||null,staticIp:s.staticIp||'',notes:s.notes||'',address:s.address||'',created:s.created,plan:plan?{name:plan.name,price:plan.price,downloadMbps:plan.downloadMbps,uploadMbps:plan.uploadMbps}:null},
  paidTotal:r2(total),payments:pays.slice(0,30),portalPayments:portal,sessions:sessions.slice(0,15),usage:[...usage].map(([date,v])=>({date,...v})),sms,authLog:log,tickets,online:sessions.some(x=>!x.stoppedAt&&now-x.updatedAt<15*60000)};
}
module.exports={overdue,payments,profile};
