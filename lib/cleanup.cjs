'use strict';
// "Delete data": one place to remove whatever you no longer want, feature by feature. Admin only. Every category can be
// listed, deleted one by one (or several) or cleared completely. A backup of the database is taken first (at most one per
// ten minutes), so a deletion can be undone by restoring it (see docs/ROLLBACK-AND-RESET.md).
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const str=v=>v==null?'':String(v);
const money=v=>v==null||v===''?'':'KES '+Number(v).toLocaleString('en-KE');
const when=v=>v?new Date(Number(v)).toISOString().replace('T',' ').slice(0,16):'';
const dot=(...a)=>a.map(str).filter(Boolean).join(' · ');

// kind-backed categories: [id, label, group, kind, hint, title(x), sub(x)]
const KIND=[
 ['customers','Customers','People & money','subscribers','Hotspot, PPPoE and static customers with their sessions, payments, notes and PINs.',x=>x.name||x.username,x=>dot(x.username,x.service,x.phone)],
 ['payments','Customer payments','People & money','subscriberPayments','Payments recorded against customers.',x=>dot(money(x.amount),x.name||x.username),x=>dot(x.method,x.reference,when(x.time||x.created))],
 ['portal-payments','Portal payment requests','People & money','portalPayments','M-Pesa / card requests started from the WiFi page.',x=>dot(money(x.amount),x.planName),x=>dot(x.status,x.phone,when(x.createdAt||x.created))],
 ['payouts','Payouts','People & money','payouts','Withdrawals and refunds.',x=>dot(money(x.amount),x.kind),x=>dot(x.status,when(x.created))],
 ['invoices','Invoices','People & money','invoices','Invoices raised to customers.',x=>dot(x.number||x.id.slice(0,8),money(x.amount||x.total)),x=>dot(x.status,x.customer,when(x.created))],
 ['deleted-customers','Recently deleted customers','People & money','deletedSubscribers','Customers in the 90-day recycle bin. Deleting here is final.',x=>x.name||x.username||x.id.slice(0,8),x=>dot(x.username,when(x.deletedAt||x.created))],
 ['plans','Packages','Services','plans','Hotspot and PPPoE packages. A package that customers still use cannot be deleted until they are.',x=>x.name,x=>dot(x.service,money(x.price))],
 ['promos','Promo codes','Services','promoCodes','Discount and campaign codes with their redemptions.',x=>x.code||x.name,x=>dot(x.type,x.status)],
 ['vouchers','Vouchers','Services','vouchers','Individual voucher codes.',x=>x.code,x=>dot(x.status,x.assignedName)],
 ['voucher-batches','Voucher batches','Services','voucherBatches','Voucher batches and all their codes.',x=>x.name||x.id.slice(0,8),x=>dot(x.count&&x.count+' codes',when(x.created))],
 ['campaigns','Campaigns','Services','campaigns','SMS / WhatsApp campaigns.',x=>x.name||x.title||x.id.slice(0,8),x=>dot(x.status,when(x.created))],
 ['mailouts','Email mailouts','Services','mailouts','Email mailouts sent or drafted.',x=>x.subject||x.name||x.id.slice(0,8),x=>dot(x.status,when(x.created))],
 ['ads','Adverts','Services','ads','Adverts shown on the WiFi page.',x=>x.title||x.name||x.id.slice(0,8),x=>dot(x.status,x.advertiser)],
 ['ad-plans','Advert plans','Services','adPlans','Plans advertisers can buy.',x=>x.name,x=>dot(money(x.price))],
 ['ad-orders','Advert orders','Services','adOrders','Orders from advertisers.',x=>dot(x.business||x.name,x.planName),x=>dot(x.status,when(x.created))],
 ['quizzes','Quizzes','Services','quizzes','Quizzes on the WiFi page.',x=>x.title||x.question||x.id.slice(0,8),x=>dot(x.status)],
 ['presets','Presets','Services','presets','Saved presets.',x=>x.name||x.id.slice(0,8),x=>''],
 ['routers','MikroTik routers','Network','devices','Routers and everything tied to them (credentials, jobs, health, logs). Nothing is sent to the router itself.',x=>x.name,x=>dot(x.type,x.ip||x.tunnelIp,x.status)],
 ['router-jobs','Router jobs','Network','routerJobs','Queued and finished router jobs.',x=>x.label||x.type,x=>dot(x.routerName,x.status,when(x.createdAt))],
 ['alerts','Alerts','Network','alerts','Device and system alerts.',x=>x.title||x.message||x.id.slice(0,8),x=>dot(x.severity,x.status,when(x.created))],
 ['outages','Outages','Network','outages','Recorded outages.',x=>x.title||x.name||x.id.slice(0,8),x=>dot(x.status,when(x.start||x.created))],
 ['compensation','Compensation grants','Network','compensationGrants','Outage compensation given to customers.',x=>dot(x.username||x.name),x=>dot(x.days&&x.days+' days',when(x.created))],
 ['acs-tasks','TR-069 / ACS tasks','Network','acsTasks','Tasks sent to customer routers through GenieACS.',x=>x.name||x.task||x.id.slice(0,8),x=>dot(x.status,when(x.created))],
 ['fibre','Fibre map (ODBs, splices, cables, zones)','Network','odbs','Fibre plant records. Splices, cables and zones are cleared with it.',x=>x.name||x.id.slice(0,8),x=>dot(x.zone)],
 ['tickets','Support tickets','Operations','tickets','Tickets and their messages.',x=>x.title,x=>dot(x.status,x.priority,x.customer)],
 ['stock','Stock items','Operations','stock','Equipment stock.',x=>x.name||x.id.slice(0,8),x=>dot(x.qty)],
 ['stock-moves','Stock movements','Operations','stockMoves','Stock in and out.',x=>x.item||x.name||x.id.slice(0,8),x=>dot(x.qty,when(x.created))],
 ['stock-requests','Stock requests','Operations','stockRequests','Installer stock requests.',x=>x.item||x.name||x.id.slice(0,8),x=>dot(x.status,when(x.created))],
 ['onboarding','Onboarding board','Operations','onboarding','New-customer onboarding cards.',x=>x.name||x.id.slice(0,8),x=>dot(x.stage||x.status)],
 ['labels','Customer router labels','Operations','customerLabels','Labels on customer routers.',x=>x.label||x.name||x.id.slice(0,8),x=>''],
 ['connects','Manual connects','Logs & history','manualConnects','Staff manual-connect records.',x=>dot(x.username,x.name),x=>dot(x.by,when(x.time||x.created))],
 ['expiry','Expiry changes','Logs & history','expiryChanges','Who changed a customer\'s paid-until date.',x=>dot(x.username,x.name),x=>dot(x.how,when(x.time))],
 ['sessions','Session history','Logs & history','radiusSessions','RADIUS session records (usage history).',x=>dot(x.username,x.mac),x=>dot(x.nasName,when(x.updatedAt||x.updated))],
];
const LOGS=[['sms-log','SMS log','smsLog'],['email-log','Email log','emailLog'],['auth-log','Authentication log','radiusAuthLog'],['acct-log','Accounting log','radiusAcctLog'],['roaming-log','Roaming log','roamingLog'],['access-log','Sign-in log (staff)','accessLog'],['quiz-log','Quiz log','quizLog'],['points-log','Loyalty points log','pointsLog']];

// extra records removed together with a category item
function cascade(store,cat,x){
 const del=(kind,pred)=>{for(const r of store.list(kind))if(pred(r))store.remove(kind,r.id);};
 if(cat==='customers'){
  for(const r of store.sessionsOf(x.username,0))store.remove('radiusSessions',r.id);
  del('subscriberPayments',r=>r.subscriberId===x.id);del('manualConnects',r=>r.subscriberId===x.id);del('expiryChanges',r=>r.subscriberId===x.id);del('compensationGrants',r=>r.subscriberId===x.id||r.username===x.username);
  for(const k of ['pin:'+x.id,'subscriber:'+x.id])store.db.prepare('DELETE FROM secrets WHERE device_id=?').run(k);
 }
 if(cat==='tickets')del('ticketMessages',r=>r.ticketId===x.id);
 if(cat==='promos')del('promoActivations',r=>r.codeId===x.id||r.promoId===x.id||r.code===x.code);
 if(cat==='voucher-batches')del('vouchers',r=>r.batchId===x.id);
 if(cat==='plans')del('planVersions',r=>r.planId===x.id);
 if(cat==='fibre')for(const k of ['splices','cables','zones'])for(const r of store.list(k))store.remove(k,r.id);
}
const find=id=>KIND.find(c=>c[0]===id);
const hasTable=(store,t)=>!!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const count=(store,k)=>store.db.prepare('SELECT count(*) n FROM records WHERE kind=?').get(k).n;
const logItems=(store,key)=>{const v=store.setting(key);return Array.isArray(v?.items)?v.items.length:0;};

function overview(store,user){
 const out=KIND.map(([id,label,group,kind,hint])=>({id,label,group,hint,count:count(store,kind),listable:true}));
 for(const [id,label,key] of LOGS)out.push({id,label,group:'Logs & history',hint:'Clears the whole log.',count:logItems(store,key)});
 out.push({id:'hotspot-logs',label:'Hotspot logs (connect requests, manual, etc.)',group:'Logs & history',hint:'Hotspot request and event logs.',count:hasTable(store,'hslog')?store.db.prepare('SELECT count(*) n FROM hslog').get().n:0});
 out.push({id:'activity-log',label:'Activity log (audit)',group:'Logs & history',hint:'The record of staff actions. Clearing it removes the trail.',count:store.db.prepare('SELECT count(*) n FROM audit').get().n});
 out.push({id:'measurements',label:'Router health history',group:'Logs & history',hint:'Online / offline measurements.',count:store.db.prepare('SELECT count(*) n FROM measurements').get().n});
 out.push({id:'staff',label:'Staff accounts (not admins)',group:'Operations',listable:true,hint:'Staff, installers and other non-admin sign-ins. Admins are never listed.',count:store.db.prepare("SELECT count(*) n FROM users WHERE role<>'admin'").get().n});
 return out;
}
function items(store,id,{q='',limit=300}={}){
 const lq=String(q).toLowerCase().trim(),match=t=>!lq||t.toLowerCase().includes(lq);
 const c=find(id);
 if(c){const rows=store.list(c[3]).map(x=>({id:x.id,title:str(c[5](x)),sub:str(c[6](x)),time:x.created||x.updated||0})).filter(r=>match(r.title+' '+r.sub));return {total:rows.length,items:rows.slice(0,limit)};}
 if(id==='staff'){const rows=store.db.prepare("SELECT id,name,email,role,created FROM users WHERE role<>'admin' ORDER BY created DESC").all().map(u=>({id:u.id,title:u.name,sub:dot(u.email,u.role),time:u.created})).filter(r=>match(r.title+' '+r.sub));return {total:rows.length,items:rows.slice(0,limit)};}
 return {total:0,items:[],note:'This is cleared as a whole.'};
}
function remove(store,id,{ids=[],all=false,confirm=''},user){
 if(String(confirm).trim()!=='DELETE')fail('Type DELETE to confirm');
 const c=find(id),log=LOGS.find(l=>l[0]===id);let deleted=0;
 const backup=store.backupNow?store.backupNow('pre-delete'):null;
 store.transaction(()=>{
  if(c){
   const rows=all?store.list(c[3]):ids.map(i=>store.get(c[3],String(i))).filter(Boolean);
   if(id==='plans'){const inUse=new Set(store.list('subscribers').map(s=>s.planId)),used=rows.filter(p=>inUse.has(p.id));if(used.length)fail(`${used.length} package${used.length===1?' is':'s are'} still used by customers (${used.slice(0,3).map(p=>p.name).join(', ')}). Delete or move those customers first.`,409);}
   for(const x of rows){
    if(id==='routers'){if(x.type==='router'){require('./purge.cjs').run(store,x.id,{customers:false,confirm:x.name},user);}else{store.remove('devices',x.id);}}
    else{cascade(store,id,x);store.remove(c[3],x.id);}
    deleted++;}
  }else if(log){const l=store.setting(log[2])||{};deleted=Array.isArray(l.items)?l.items.length:0;store.setting(log[2],{...l,items:[]});}
  else if(id==='hotspot-logs'){if(hasTable(store,'hslog')){deleted=store.db.prepare('SELECT count(*) n FROM hslog').get().n;store.db.exec('DELETE FROM hslog');}}
  else if(id==='activity-log'){deleted=store.db.prepare('SELECT count(*) n FROM audit').get().n;store.db.exec('DELETE FROM audit');}
  else if(id==='measurements'){deleted=store.db.prepare('SELECT count(*) n FROM measurements').get().n;store.db.exec('DELETE FROM measurements');}
  else if(id==='staff'){
   const rows=all?store.db.prepare("SELECT id FROM users WHERE role<>'admin'").all().map(r=>r.id):ids.map(String);
   for(const uid of rows){if(uid===user.id)continue;const u=store.db.prepare("SELECT id FROM users WHERE id=? AND role<>'admin'").get(uid);if(!u)continue;store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(uid);store.db.prepare('DELETE FROM users WHERE id=?').run(uid);deleted++;}
  }else fail('Unknown category',404);
 });
 if(deleted)store.audit(user,`Deleted ${deleted} from "${(c&&c[1])||(log&&log[1])||id}" (Delete data)`,id);
 return {deleted,backup};
}
module.exports={overview,items,remove};
