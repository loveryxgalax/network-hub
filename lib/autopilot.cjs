'use strict';
// Autopilot: the routine follow-ups netops does by itself. Each part has its own switch (Automation page) and every
// action it takes is written to the autopilot log, so staff can see what was done and why.
//  outages    SMS customers on a router/OLT that has been down for N minutes, and again when it is back.
//  payments   Paybill payments with a mistyped account: credit the one obvious customer, suggest the rest.
//  selfheal   Safe fixes on routers with the job runner (flush a full DNS cache).
//  tickets    Tickets for critical alerts (assigned in the router's branch), customer SMS when opened / resolved
//             with a 1–5 rating link, overdue tickets escalated.
//  welcome    New customers from onboarding get a welcome SMS (account link, how to pay); 3 days later a ticket if
//             they have not used the line.
//  checks     SMS credit running out, the site certificate close to expiry, stock below its minimum.
const crypto=require('node:crypto'),billing=require('./billing.cjs'),health=require('./health.cjs');
const MIN=6e4,HOUR=36e5,DAY=864e5;
const DEFAULTS={outageSms:true,outageMinutes:15,restoreSms:true,payMatch:true,selfHeal:true,ticketAuto:true,ticketSms:true,ticketRating:true,ticketSlaHours:24,welcome:true,followUp:true,smsCredit:true,certCheck:true,stockAlert:true,poolForecast:true,autoActivate:true,domainCheck:true,stockReorder:true};
function settings(store){return {...DEFAULTS,...(store.setting('autopilot')||{})};}
function save(store,input){const cur=settings(store),out={...cur};for(const [k,v] of Object.entries(DEFAULTS)){if(input[k]===undefined)continue;
 if(typeof v==='boolean')out[k]=input[k]===true;else{const n=Math.round(Number(input[k]));if(k==='outageMinutes'&&!(n>=5&&n<=240))throw Object.assign(new Error('Outage wait: 5–240 minutes'),{status:400});if(k==='ticketSlaHours'&&!(n>=1&&n<=720))throw Object.assign(new Error('Ticket deadline: 1–720 hours'),{status:400});out[k]=n;}}
 if(!cur.since)out.since=Date.now();store.setting('autopilot',out);return out;}
// Started-at: nothing that happened before autopilot first ran is acted on (no flood of old tickets or welcomes).
function since(store,now){const s=store.setting('autopilot')||{};if(!s.since){store.setting('autopilot',{...s,since:now});return now;}return s.since;}
function log(store,kind,text,now=Date.now()){const l=store.setting('autopilotLog')||{items:[]};l.items=[{time:now,kind,text:String(text).slice(0,300)},...l.items].slice(0,500);store.setting('autopilotLog',l);}
const first=s=>String(s?.name||'').split(' ')[0]||'there';
const live=(s,now)=>s.status==='active'&&(s.expiresAt==null||s.expiresAt>now);
// ---------- outages ----------
function affected(store,device,now){const subs=store.list('subscribers').filter(s=>!s.parentId&&live(s,now)&&billing.phone(s.phone));
 if(device.type==='olt'){const ids=new Set(store.list('devices').filter(d=>d.type==='onu'&&d.parentId===device.id&&d.subscriberId).map(d=>d.subscriberId));return subs.filter(s=>ids.has(s.id));}
 let map=new Map();try{map=require('./compensation.cjs').routerOf(store);}catch{}return subs.filter(s=>map.get(s.username)===device.id||(!map.get(s.username)&&s.routerId===device.id));}
async function outages(store,now=Date.now()){const cfg=settings(store);if(!cfg.outageSms)return 0;const devs=store.list('devices').filter(d=>d.type==='router'||d.type==='olt');if(!devs.length)return 0;
 const down=d=>d.status==='offline'&&d.lastSeen&&now-d.lastSeen>=cfg.outageMinutes*MIN;
 // Most of the network "down" at once is far more likely netops itself losing contact than a real outage: send nothing.
 const wide=devs.length>=3&&devs.filter(d=>d.status==='offline').length/devs.length>0.5;let sent=0;
 let maint=()=>false;try{const m=require('./maintenance.cjs');maint=id=>m.active(store,now).some(x=>!x.routerIds.length||x.routerIds.includes(id));}catch{}
 for(const d of devs){const key='outageSms:'+d.id,st=store.setting(key)||{};
  if(down(d)&&!st.notifiedAt&&!wide&&!maint(d.id)){const who=affected(store,d,now).slice(0,500);store.setting(key,{since:d.lastSeen,notifiedAt:now,ids:who.map(s=>s.id)});
   for(const s of who){const r=await billing.sendSms(store,s.phone,`Hi ${first(s)}, there is an internet outage in your area. Our team is working on it and we will text you when it is back. Sorry for the trouble.`,'outage');if(r?.status==='sent')sent++;}
   if(who.length)log(store,'outage',`${d.name} down ${Math.round((now-d.lastSeen)/MIN)} min: outage SMS to ${who.length} customer${who.length===1?'':'s'}`,now);}
  else if(d.status==='online'&&st.notifiedAt){store.setting(key,{});
   if(cfg.restoreSms&&st.ids?.length){let n=0;for(const id of st.ids){const s=store.get('subscribers',id);if(!s||!billing.phone(s.phone))continue;await billing.sendSms(store,s.phone,`Hi ${first(s)}, your internet is back. Thank you for your patience.`,'outage');n++;}
    log(store,'outage',`${d.name} back after ${Math.round((now-st.since)/MIN)} min: restored SMS to ${n}`,now);}}}
 return sent;}
// ---------- payments ----------
// Edits between two usernames; two swapped letters count as one edit (the commonest typo).
function lev(a,b){if(a===b)return 0;if(Math.abs(a.length-b.length)>2)return 9;const m=Array.from({length:a.length+1},(_,i)=>[i,...Array(b.length).fill(0)]);for(let j=1;j<=b.length;j++)m[0][j]=j;
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){m[i][j]=Math.min(m[i-1][j]+1,m[i][j-1]+1,m[i-1][j-1]+(a[i-1]===b[j-1]?0:1));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])m[i][j]=Math.min(m[i][j],m[i-2][j-2]+1);}return m[a.length][b.length];}
const key=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,'').replace(/@[a-z0-9.-]+$/,'');
// Who did this paybill payment probably mean? Close usernames, the payer's name, and a package price equal to the amount.
function suggest(store,p){const acct=key(p.account),payer=String(p.payer||'').toLowerCase().split(/\s+/).filter(w=>w.length>2),plans=new Map(store.list('plans').map(x=>[x.id,x])),out=[];
 for(const s of store.list('subscribers')){if(s.parentId)continue;const u=key(s.username),d=acct?lev(acct,u):9,name=String(s.name||'').toLowerCase();
  const nameHit=payer.length&&payer.some(w=>name.split(/\s+/).includes(w)),price=plans.get(s.planId)?.price,priceHit=price!=null&&Number(price)===Number(p.amount);
  if(d>2&&!(nameHit&&priceHit))continue;
  const why=[d<=2?`account "${p.account}" is ${d===0?'their username':d+' letter'+(d===1?'':'s')+' from '+s.username}`:'',nameHit?'payer name matches':'',priceHit?'amount = their package price':''].filter(Boolean);
  out.push({id:s.id,name:s.name,username:s.username,score:(3-Math.min(d,3))*3+(nameHit?3:0)+(priceHit?2:0),distance:d,nameHit,priceHit,why:why.join(', ')});}
 return out.sort((a,b)=>b.score-a.score).slice(0,5);}
// Credit only when exactly one customer is one letter away AND the payer's name or the amount agrees.
function sure(c){const close=c.filter(x=>x.distance<=1);return close.length===1&&(close[0].nameHit||close[0].priceHit)?close[0]:null;}
function payments(store,now=Date.now()){if(!settings(store).payMatch)return 0;const c2b=require('./c2b.cjs');let n=0;
 for(const p of store.list('c2bPayments').filter(x=>x.status==='unallocated'&&!x.autoTried)){const best=sure(suggest(store,p));const cur=store.get('c2bPayments',p.id);store.put('c2bPayments',{...cur,autoTried:now},cur);
  if(!best)continue;try{c2b.assign(store,p.id,best.id);n++;log(store,'payment',`Paybill ${p.transId} KES ${p.amount} (account "${p.account}") credited to ${best.username}: ${best.why}`,now);}catch{}}
 return n;}
// ---------- self-healing ----------
function selfHeal(store,now=Date.now()){if(!settings(store).selfHeal)return 0;const jobs=require('./jobs.cjs');let n=0;
 for(const a of store.list('alerts').filter(x=>x.status!=='Resolved'&&x.logKey==='dns-cache-full'&&x.deviceId)){const r=store.get('devices',a.deviceId);if(!r||!store.secret('jobs:'+r.id))continue;
  const k='heal:dns:'+r.id,last=store.setting(k)?.at||0;if(now-last<30*MIN)continue;
  if(store.list('routerJobs').some(j=>j.routerId===r.id&&j.type==='dns-flush'&&['queued','sent'].includes(j.status)))continue;
  try{jobs.create(store,{routerId:r.id,type:'dns-flush',user:{name:'Autopilot'}},now);store.setting(k,{at:now});store.put('alerts',{...a,status:'Resolved',details:(a.details||'')+' · Autopilot flushed the DNS cache.'},a);n++;log(store,'heal',`${r.name}: DNS cache full, flush queued`,now);}catch{}}
 return n;}
// ---------- tickets ----------
function team(store){try{return store.db.prepare('SELECT id,name,role,active FROM users').all().filter(u=>u.active);}catch{return [];}}
function assigneeFor(store,deviceId){const access=require('./access.cjs'),users=team(store),tech=users.filter(u=>['network-technician','technician'].includes(u.role));
 let br=[];try{br=access.branches(store).filter(b=>(b.routerIds||[]).includes(deviceId)).map(b=>b.id);}catch{}
 const inBranch=tech.filter(u=>{try{return access.get(store,u.id).branchIds.some(b=>br.includes(b))||access.get(store,u.id).routerIds.includes(deviceId);}catch{return false;}});
 const pool=inBranch.length?inBranch:tech;if(!pool.length)return '';
 // the one with the fewest open tickets
 const open=new Map();for(const t of store.list('tickets'))if(!['Resolved','Closed'].includes(t.status)&&t.assigneeId)open.set(t.assigneeId,(open.get(t.assigneeId)||0)+1);
 return pool.sort((a,b)=>(open.get(a.id)||0)-(open.get(b.id)||0))[0].id;}
const sig=(store,id)=>crypto.createHmac('sha256',require('./selfservice.cjs').key(store)).update('rate|'+id).digest('base64url').slice(0,16);
function rateLink(store,origin,t){return origin?`${origin}/portal/rate.html?t=${encodeURIComponent(t.id+'.'+sig(store,t.id))}`:'';}
function rate(store,token,score,now=Date.now()){const [id,s]=String(token||'').split('.');const t=id&&store.get('tickets',id);
 if(!t||!s||s!==sig(store,id))throw Object.assign(new Error('This link is not valid'),{status:404});const n=Math.round(Number(score));if(!(n>=1&&n<=5))throw Object.assign(new Error('Choose 1 to 5'),{status:400});
 store.put('tickets',{...t,rating:n,ratedAt:now},t);store.put('ticketMessages',{ticketId:id,kind:'event',text:`Customer rated the support ${n}/5`,author:'Customer',time:now});return {ok:true,title:t.title};}
async function tickets(store,origin,now=Date.now()){const cfg=settings(store),from=since(store,now);let n=0;
 if(cfg.ticketAuto){for(const a of store.list('alerts').filter(x=>x.status!=='Resolved'&&x.severity==='critical'&&x.deviceId&&now-(x.created||now)>=15*MIN&&(x.created||0)>=from)){
   if(store.list('tickets').some(t=>t.alertId===a.id))continue;const dev=store.get('devices',a.deviceId);
   const t=store.put('tickets',{title:a.title,category:dev?.type==='olt'?'OLT':'MikroTik',details:(a.details||'')+'\n\nOpened automatically from an alert.',priority:'High',status:'Open',assigneeId:assigneeFor(store,a.deviceId),alertId:a.id,source:'autopilot'});
   log(store,'ticket',`Ticket for alert "${a.title}"${t.assigneeId?' assigned':''}`,now);n++;}
  // close the ticket when its alert is resolved
  for(const t of store.list('tickets').filter(x=>x.alertId&&!['Resolved','Closed'].includes(x.status))){const a=store.get('alerts',t.alertId);if(a&&a.status==='Resolved'){store.put('tickets',{...t,status:'Resolved'},t);store.put('ticketMessages',{ticketId:t.id,kind:'event',text:'Status: '+t.status+' → Resolved (the alert cleared)',author:'Autopilot',time:now});}}}
 if(cfg.ticketSms){for(const t of store.list('tickets').filter(x=>x.subscriberId&&(x.created||0)>=from)){const s=store.get('subscribers',t.subscriberId);if(!s||!billing.phone(s.phone))continue;const ref='#'+String(t.id).slice(0,6).toUpperCase();
   if(!t.smsOpenAt){await billing.sendSms(store,s.phone,`Hi ${first(s)}, we have received your request (${ref}). Our team will get back to you shortly.`,'ticket');const c=store.get('tickets',t.id);store.put('tickets',{...c,smsOpenAt:now},c);n++;}
   else if(['Resolved','Closed'].includes(t.status)&&!t.smsDoneAt){const link=cfg.ticketRating?rateLink(store,origin,t):'';await billing.sendSms(store,s.phone,`Hi ${first(s)}, your request ${ref} has been resolved.`+(link?` How did we do? Rate us 1-5: ${link}`:''),'ticket');const c=store.get('tickets',t.id);store.put('tickets',{...c,smsDoneAt:now},c);n++;}}}
 // overdue: no change for the deadline → priority up once, noted in the thread, and an alert for managers
 for(const t of store.list('tickets').filter(x=>!['Resolved','Closed'].includes(x.status)&&!x.overdueAt&&now-(x.updated||x.created)>=cfg.ticketSlaHours*HOUR&&(x.created||0)>=from)){
  store.put('tickets',{...t,priority:t.priority==='Urgent'?'Urgent':'High',overdueAt:now},t);store.put('ticketMessages',{ticketId:t.id,kind:'event',text:`Overdue: no update for ${cfg.ticketSlaHours} h. Priority raised.`,author:'Autopilot',time:now});
  store.put('alerts',{title:'Ticket overdue: '+t.title,details:`No update for ${cfg.ticketSlaHours} hours.`,severity:'warning',status:'Open',source:'autopilot',logKey:'ticket:'+t.id});log(store,'ticket',`Overdue ticket escalated: ${t.title}`,now);n++;}
 return n;}
// ---------- new customers ----------
async function welcome(store,origin,now=Date.now()){const cfg=settings(store),from=since(store,now);let n=0;const c=(()=>{try{return require('./mpesa.cjs').config(store);}catch{return null;}})();
 for(const o of store.list('onboarding').filter(x=>x.subscriberId&&['installed','completed'].includes(x.stage))){const s=store.get('subscribers',o.subscriberId);if(!s)continue;
  const reached=(o.history||[]).filter(h=>['installed','completed'].includes(h.stage)).map(h=>h.at)[0]||o.updated;if(reached<from)continue;
  if(cfg.welcome&&!o.welcomeAt&&billing.phone(s.phone)){const link=origin?origin+'/portal/account.html?t='+require('./selfservice.cjs').token(store,s,now):'';const pay=c?.shortcode?` Pay with M-Pesa Paybill ${c.shortcode}, account ${s.username}.`:'';
   await billing.sendSms(store,s.phone,`Welcome to Kade Networks, ${first(s)}! Your account is ${s.username}.${pay} See your package, usage and pay here: ${link}`,'welcome');const cur=store.get('onboarding',o.id);store.put('onboarding',{...cur,welcomeAt:now},cur);log(store,'welcome','Welcome SMS to '+s.username,now);n++;continue;}
  if(cfg.followUp&&o.welcomeAt&&!o.followUpAt&&now-o.welcomeAt>=3*DAY){let used=0;try{const u=require('./usage.cjs').summary(store,s,now);used=u.all.down+u.all.up;}catch{}const cur=store.get('onboarding',o.id);store.put('onboarding',{...cur,followUpAt:now},cur);
   if(used<50e6){store.put('tickets',{title:'New customer not using the line: '+s.name,category:'Account & login',details:`${s.username} was installed ${Math.round((now-reached)/DAY)} days ago and has used ${Math.round(used/1e6)} MB. Call them to check the setup.`,priority:'Normal',status:'Open',customer:s.name,subscriberId:s.id,assigneeId:o.assigneeId||'',source:'autopilot',smsOpenAt:now});log(store,'welcome','3-day check: '+s.username+' has not used the line, ticket opened',now);n++;}}}
 return n;}
// ---------- checks ----------
async function smsCredit(store,fetchImpl=fetch,now=Date.now()){if(!settings(store).smsCredit)return null;const c=store.secret('sms:config');if(!c)return null;
 const fake={id:'sms-provider'},log_=(store.setting('smsLog')?.items||[]).slice(0,10),creditFails=log_.filter(x=>x.status==='failed'&&/credit|insufficient|balance|1009/i.test(x.detail||'')).length;
 let bal=null;if(c.provider==='africastalking'&&!c.sandbox){try{const r=await fetchImpl('https://api.africastalking.com/version1/user?username='+encodeURIComponent(c.username),{headers:{apiKey:c.apiKey,Accept:'application/json'},signal:AbortSignal.timeout(15000)});const j=await r.json();const m=/([\d.,]+)/.exec(String(j?.UserData?.balance||''));if(m)bal=Number(m[1].replace(/,/g,''));}catch{}}
 const low=(bal!=null&&bal<200)||creditFails>=2;
 health.raise(store,fake,'sms-credit',low,'critical','SMS credit is running out',bal!=null?`Balance KES ${bal}. Reminders, receipts and alerts stop when it reaches zero. Top up now.`:'Recent messages failed for lack of credit. Top up your SMS account.');
 store.setting('smsCredit',{checkedAt:now,balance:bal,low});return {balance:bal,low};}
function certExpiry(origin,now=Date.now()){return new Promise(res=>{let u;try{u=new URL(origin);}catch{return res(null);}if(u.protocol!=='https:')return res(null);
 const s=require('node:tls').connect({host:u.hostname,port:Number(u.port)||443,servername:u.hostname,timeout:10000},()=>{const c=s.getPeerCertificate();s.end();const t=Date.parse(c?.valid_to);res(Number.isFinite(t)?t:null);});s.on('error',()=>res(null));s.on('timeout',()=>{s.destroy();res(null);});});}
async function certCheck(store,origin,now=Date.now()){if(!settings(store).certCheck||!origin)return null;const t=await certExpiry(origin,now);if(t==null)return null;const days=Math.floor((t-now)/DAY);
 health.raise(store,{id:'site-certificate'},'certificate',days<14,days<5?'critical':'warning','Website certificate expires in '+days+' days',`The HTTPS certificate for ${new URL(origin).hostname} expires on ${new Date(t).toISOString().slice(0,10)}. If it is not renewed, the admin site and the customer pages stop opening.`);
 store.setting('certCheck',{checkedAt:now,expires:t,days});return {days};}
function stock(store,now=Date.now()){if(!settings(store).stockAlert)return 0;let n=0;const sr=require('./stockreq.cjs');
 for(const item of store.list('stock')){const min=Number(item.minimum)||0;if(!min)continue;let have=0;try{have=sr.onHand(store,item.id);}catch{continue;}const low=have<min;
  health.raise(store,{id:item.id},'stock-low',low,'warning',`Low stock: ${item.name}`,`${have} ${item.unit||''} left, minimum ${min}. Order more.`.replace(/\s+/g,' '));if(low)n++;}
 return n;}

// ---------- address pools: days until full ----------
// One reading per pool per day (from the router's health report); the growth over up to 14 days says when it fills.
function poolForecast(store,now=Date.now()){if(!settings(store).poolForecast)return [];const out=[],hp=health.poolSize;
 for(const r of store.list('devices').filter(d=>d.type==='router')){const h=store.setting('routerHealth:'+r.id);if(!h?.pools?.length||now-(h.time||0)>2*DAY)continue;
  const key='poolTrend:'+r.id,tr=store.setting(key)||{};const day=new Date(now+3*36e5).toISOString().slice(0,10);
  for(const p of h.pools){const size=hp(p.ranges);if(!size)continue;const pts=(tr[p.name]||[]).filter(x=>x.day!==day&&x.t>now-30*DAY);pts.push({day,t:now,used:p.used});tr[p.name]=pts.slice(-30);
   const old=pts.find(x=>x.t>=now-14*DAY)||pts[0],days=(now-old.t)/DAY,rate=days>=3?(p.used-old.used)/days:0,left=size-p.used,eta=rate>0?Math.floor(left/rate):null;
   const soon=eta!=null&&eta<=14&&p.used/size<0.9;// at 90% the existing "nearly full" alert already speaks
   const add_=Math.max(Math.ceil(rate*60),Math.ceil(size*0.5));
   health.raise(store,r,'pool-forecast:'+p.name,soon,'warning',`${r.name} pool ${p.name} will be full in about ${eta} days`,`${p.used} of ${size} addresses used, growing by about ${Math.round(rate*10)/10} a day. Add about ${add_} more addresses (for example a second range in /ip pool ${p.name}) before it runs out.`);
   out.push({router:r.name,pool:p.name,used:p.used,size,perDay:Math.round(rate*10)/10,daysLeft:eta});}
  store.setting(key,tr);}
 return out;}
// ---------- onboarding: installed + paid → completed ----------
function activate(store,now=Date.now()){if(!settings(store).autoActivate)return 0;const ob=require('./onboarding.cjs');let n=0;
 for(const o of store.list('onboarding').filter(x=>x.stage==='installed'&&x.subscriberId)){const s=store.get('subscribers',o.subscriberId);if(!s)continue;
  const paid=s.paidEver===true||store.list('subscriberPayments').some(p=>p.subscriberId===s.id&&!p.reversedAt);if(!paid||s.status!=='active')continue;
  try{ob.update(store,o.id,{stage:'completed'},{email:'autopilot'},now);n++;log(store,'welcome',`${s.username} paid after installation: onboarding marked completed`,now);}catch{}}
 return n;}
// ---------- domain expiry (RDAP; registries that do not publish it are skipped) ----------
async function domainCheck(store,origin,fetchImpl=fetch,now=Date.now()){if(!settings(store).domainCheck||!origin)return null;let host;try{host=new URL(origin).hostname;}catch{return null;}
 const parts=host.split('.');if(parts.length<2||/^\d+$/.test(parts.at(-1)))return null;
 // the registered name: last two labels, or three for second-level suffixes such as .co.ke
 const sl=['co','or','ac','go','ne','me','sc','info','com','org','net'];const dom=(parts.length>=3&&sl.includes(parts.at(-2))?parts.slice(-3):parts.slice(-2)).join('.');
 let exp=null;try{const r=await fetchImpl('https://rdap.org/domain/'+dom,{headers:{Accept:'application/rdap+json'},signal:AbortSignal.timeout(15000)});if(r.ok){const j=await r.json();const e=(j.events||[]).find(x=>/expir/i.test(x.eventAction));if(e)exp=Date.parse(e.eventDate);}}catch{}
 if(!Number.isFinite(exp)){store.setting('domainCheck',{checkedAt:now,domain:dom,expires:null});return null;}
 const days=Math.floor((exp-now)/DAY);health.raise(store,{id:'site-domain'},'domain',days<30,days<7?'critical':'warning',`Domain ${dom} expires in ${days} days`,`Renew ${dom} with your registrar before ${new Date(exp).toISOString().slice(0,10)}, or the admin site, customer pages and links in SMS stop working.`);
 store.setting('domainCheck',{checkedAt:now,domain:dom,expires:exp,days});return {days};}
// ---------- stock: a reorder ticket with the quantity to buy ----------
function reorder(store,now=Date.now()){if(!settings(store).stockReorder)return 0;const sr=require('./stockreq.cjs');let n=0;
 for(const item of store.list('stock')){const min=Number(item.minimum)||0;if(!min)continue;let have=0;try{have=sr.onHand(store,item.id);}catch{continue;}
  const open=store.list('tickets').find(t=>t.stockId===item.id&&!['Resolved','Closed'].includes(t.status));
  if(have<min&&!open){// enough to cover what was issued in the last 30 days, and at least back to twice the minimum
   const used=store.list('stockMoves').filter(m=>m.stockId===item.id&&Number(m.quantity)<0&&(m.created||0)>now-30*DAY).reduce((a,m)=>a-Number(m.quantity),0),buy=Math.max(min*2-have,used);
   store.put('tickets',{title:`Reorder: ${item.name} (buy ${buy}${item.unit?' '+item.unit:''})`,category:'Something else',details:`${have} left, minimum ${min}. ${used} issued in the last 30 days.${item.unitCost?` About KES ${Math.round(buy*item.unitCost)} at the last price.`:''}\n\nClose this ticket after receiving the new stock (Stock → Receive).`,priority:'Normal',status:'Open',stockId:item.id,source:'autopilot'});
   log(store,'stock',`Reorder ticket: ${item.name}, buy ${buy}`,now);n++;}
  else if(have>=min&&open){store.put('tickets',{...open,status:'Resolved'},open);store.put('ticketMessages',{ticketId:open.id,kind:'event',text:`Restocked (${have} in stock): closed automatically`,author:'Autopilot',time:now});}}
 return n;}
// Every minute: outages, payments, self-healing, tickets, welcomes. Daily: credit, certificate. Hourly: stock.
let busy=false;
async function tick(store,origin,now=Date.now()){if(busy||process.env.NETWORK_PASSIVE==='1')return;busy=true;try{
 since(store,now);
 try{await outages(store,now);}catch(e){log(store,'error','Outages: '+e.message,now);}
 try{payments(store,now);}catch(e){log(store,'error','Payments: '+e.message,now);}
 try{selfHeal(store,now);}catch{}
 try{await tickets(store,origin,now);}catch(e){log(store,'error','Tickets: '+e.message,now);}
 try{await welcome(store,origin,now);}catch(e){log(store,'error','Welcome: '+e.message,now);}
 try{activate(store,now);}catch{}
 const st=store.setting('autopilotRun')||{};
 if(!st.hourly||now-st.hourly>=HOUR){try{stock(store,now);reorder(store,now);}catch{}try{poolForecast(store,now);}catch{}store.setting('autopilotRun',{...st,hourly:now});}
 const st2=store.setting('autopilotRun')||{};
 if(!st2.daily||now-st2.daily>=DAY){store.setting('autopilotRun',{...st2,daily:now});try{await smsCredit(store);}catch{}try{await certCheck(store,origin,now);}catch{}try{await domainCheck(store,origin);}catch{}}
}finally{busy=false;}}
module.exports={poolForecast,activate,domainCheck,reorder,settings,save,tick,outages,affected,payments,suggest,sure,selfHeal,tickets,rate,rateLink,welcome,smsCredit,certCheck,stock,log,DEFAULTS};
