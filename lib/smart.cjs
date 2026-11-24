'use strict';
// Smart automation: eight helpers that watch the business and act or warn.
//  1 chat help     "I paid but I'm not connected": the chat checks the M-Pesa code or the phone's latest payment.
//  2 diagnosis     "My internet is slow": account, data cap, session, router and access point checked in one go.
//  3 recovery      A payment that failed for lack of balance gets one SMS later offering a cheaper package.
//  4 revenue drop  A router's sales far below the same hours on the previous 7 days, or no payments at all: alert.
//  5 busy hours    When each router is quiet or full, with an off-peak package suggestion (report only).
//  6 fraud watch   Receipts used twice, one account on many devices, sudden usage spikes.
//  7 capacity      Days until a router's CPU, its user count or an AP's clients reach their limit.
//  8 owner summary The daily summary (Comms) gains these findings and can go out by WhatsApp.
// Every finding is evidence-based (payments, sessions, check-ins); nothing is guessed, and nothing touches a router.
const billing=require('./billing.cjs');
const MIN=6e4,HOUR=36e5,DAY=864e5,NAIROBI=3*HOUR;
const DEFAULTS={chatHelp:true,diagnosis:true,recovery:false,recoveryAfterMin:60,revenueDrop:true,dropPercent:40,dropMinBaseline:200,fraud:true,capacity:true,capacityDays:14};
function settings(store){return {...DEFAULTS,...(store.setting('smartSettings')||{})};}
function save(store,input){const cur=settings(store),out={...cur};
 for(const k of ['chatHelp','diagnosis','recovery','revenueDrop','fraud','capacity'])if(input[k]!==undefined)out[k]=input[k]===true;
 const num=(k,lo,hi)=>{if(input[k]===undefined)return;const v=Math.round(Number(input[k]));if(!(v>=lo&&v<=hi))throw Object.assign(new Error(`${k} must be ${lo}–${hi}`),{status:400});out[k]=v;};
 num('recoveryAfterMin',15,720);num('dropPercent',10,90);num('dropMinBaseline',50,100000);num('capacityDays',3,90);
 store.setting('smartSettings',out);return out;}
const hourOf=t=>new Date(t+NAIROBI).getUTCHours(),dowOf=t=>new Date(t+NAIROBI).getUTCDay();
const money=n=>'KSh '+Math.round(Number(n)||0).toLocaleString('en-KE');
const when=t=>new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Africa/Nairobi'});
const routerMap=store=>{let m=new Map();try{m=require('./compensation.cjs').routerOf(store);}catch{}return m;};
const routerOfSub=(store,s,rm)=>s?.routerId||rm.get(s?.username)||null;
// ---------- 1. payment lookup for the chat ----------
const CODE=/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/;
function findPayment(store,code){code=String(code||'').toUpperCase();if(!code)return null;
 const p=store.list('subscriberPayments').find(x=>String(x.reference||'').toUpperCase()===code);
 if(p){const s=store.get('subscribers',p.subscriberId);return {state:p.reversedAt?'reversed':'credited',payment:p,subscriber:s};}
 const c=store.list('c2bPayments').find(x=>String(x.transId||x.reference||x.receipt||'').toUpperCase()===code);if(c)return {state:c.status==='credited'?'credited':'unmatched',c2b:c,subscriber:c.subscriberId?store.get('subscribers',c.subscriberId):null};
 const pp=store.list('portalPayments').find(x=>String(x.receipt||'').toUpperCase()===code);if(pp)return {state:pp.status==='paid'?'credited':pp.status,portal:pp,subscriber:pp.subscriberId?store.get('subscribers',pp.subscriberId):null};
 return null;}
const PAID=/\b(paid|pay|payment|nimelipa|nimetuma|lipa|mpesa|m-pesa|not connect|no internet|cannot connect|can't connect|cant connect|sijaunganishwa|haifanyi)\b/i,
 SLOW=/\b(slow|polepole|pole pole|speed|lag|buffer|not loading|keeps? disconnect|unstable|weak)\b/i,
 BUY=/\b(buy|package|packages|bundle|nunua|price|prices|how much|bei)\b/i;
function credited(r){const s=r.subscriber,p=r.payment||r.c2b||r.portal;
 return `✅ We found your payment of ${money(p.amount)}${p.reference||p.receipt?` (${String(p.reference||p.receipt||'').toUpperCase()})`:''}${s?` on account ${String(s.username).toUpperCase()}`:''}.${s?.expiresAt&&s.expiresAt>Date.now()?` Your internet is active until ${when(s.expiresAt)}.`:''}\nTo connect: turn WiFi off and on, open the WiFi page and tap Connect. If it still does not work, reply here and our team will connect you.`;}
// Reply to a customer chat message when it can help. Returns the reply text, or null.
async function chatHelp(store,ticket,text,now=Date.now(),fetchImpl=fetch){const cfg=settings(store);if(!cfg.chatHelp&&!cfg.diagnosis)return null;
 const t=String(text||''),code=(t.toUpperCase().match(CODE)||[])[0],done=ticket.assist||{},sub=ticket.subscriberId?store.get('subscribers',ticket.subscriberId):(ticket.phone?store.list('subscribers').find(s=>billing.phone(s.phone)===billing.phone(ticket.phone)):null);
 let reply=null,mark=null,urgent=false;
 if(cfg.chatHelp&&code&&!done['code:'+code]){const r=findPayment(store,code);mark='code:'+code;
  if(!r){reply=`We cannot see the M-Pesa code ${code} yet. If you paid in the last few minutes, give it a moment; our team has been told and will check it for you.`;urgent=true;}
  else if(r.state==='credited')reply=credited(r);
  else if(r.state==='reversed')reply=`The payment ${code} was reversed, so it no longer gives access. Our team will contact you about it.`;
  else if(r.state==='unmatched'){reply=`We received ${money(r.c2b.amount)} (${code}) but it is not linked to an account yet. Our team will attach it to your account shortly.`;urgent=true;}
  else{reply=`We found the payment request ${code} but it is "${r.state}". Our team will check it with Safaricom.`;urgent=true;}}
 else if(cfg.chatHelp&&PAID.test(t)&&!done.paid){mark='paid';const ph=billing.phone(ticket.phone||sub?.phone),since=now-6*HOUR;
  const pps=ph?store.list('portalPayments').filter(p=>p.phone===ph&&(p.createdAt||0)>=since).sort((a,b)=>b.createdAt-a.createdAt):[];const last=pps[0];
  if(last&&last.status==='pending'){try{await require('./portal.cjs').recheck(store,last.id,fetchImpl);}catch{}}
  const fresh=last?store.get('portalPayments',last.id):null;
  if(fresh?.status==='paid'){const s=fresh.subscriberId?store.get('subscribers',fresh.subscriberId):sub;reply=credited({payment:{amount:fresh.amount,reference:fresh.receipt},subscriber:s});}
  else if(fresh?.status==='failed'){const why=String(fresh.reason||'');reply=`Your last M-Pesa request (${money(fresh.amount)} at ${when(fresh.createdAt)}) did not go through: ${why||'it was not completed'}. No money was taken. You can try again on the WiFi page${/insufficient|balance/i.test(why)?', or pick a cheaper package':''}.`;}
  else if(fresh?.status==='pending')reply='Your M-Pesa request is still waiting for Safaricom. If you entered your PIN, it should finish within a minute. Our team is watching it.';
  else{const subPay=sub?store.list('subscriberPayments').filter(p=>p.subscriberId===sub.id&&!p.reversedAt&&(p.time||0)>=since).sort((a,b)=>b.time-a.time)[0]:null;
   reply=subPay?credited({payment:subPay,subscriber:sub}):'Please send the M-Pesa confirmation code from your SMS (10 letters and numbers, like UKO384IH3P) and we will check it straight away.';}}
 else if(cfg.diagnosis&&SLOW.test(t)&&!done.slow){mark='slow';if(sub){const d=diagnose(store,sub,now);reply=d.customer;urgent=d.level==='bad';}else reply='Sorry about that. Which phone number or account is the internet on? Send it here and we will check your connection.';}
 else if(cfg.chatHelp&&BUY.test(t)&&!done.buy){mark='buy';const plans=store.list('plans').filter(p=>p.active!==false&&(sub?.service?p.service===sub.service:p.service==='hotspot')&&Number(p.price)>0).sort((a,b)=>a.price-b.price).slice(0,6);
  reply=plans.length?`Our packages:\n${plans.map(p=>`• ${p.name}: ${money(p.price)}`).join('\n')}\nBuy on the WiFi page: connect to our WiFi and the page opens by itself. Pay with M-Pesa and you are online at once.`:null;}
 if(!reply)return null;
 store.transaction(()=>{const cur=store.get('tickets',ticket.id);store.put('tickets',{...cur,assist:{...(cur.assist||{}),[mark]:now},...(urgent&&cur.priority!=='High'?{priority:'High'}:{})},cur);
  store.put('ticketMessages',{ticketId:ticket.id,kind:'reply',from:'team',text:reply,author:'Kade Assistant',authorId:'assistant',time:now+1});});
 log(store,'chat','Answered a chat: '+mark,now);return reply;}
// ---------- 2. diagnosis ----------
function diagnose(store,s,now=Date.now()){const f=[],add=(level,text)=>f.push({level,text});const plan=s.planId?store.get('plans',s.planId):null;
 if(s.status!=='active')add('bad','The account is '+(s.status||'not active')+'.');
 if(s.expiresAt!=null&&s.expiresAt<=now)add('bad','The package expired '+when(s.expiresAt)+'.');
 if(plan?.fup?.enabled){try{const st=require('./packages.cjs').fupState(store,s,plan,require('./radius.cjs').planMs(plan),now);if(st.percent>=100)add('bad',`The data allowance is used up (${st.percent}%), so the speed is reduced${st.downMbps?' to '+st.downMbps+' Mbps':''} until the next period.`);else if(st.percent>=80)add('warn',`${st.percent}% of the data allowance is used.`);}catch{}}
 const ses=store.sessionsOf(s.username,now-DAY),live=ses.filter(x=>!x.stoppedAt&&now-(x.updatedAt||0)<15*MIN);
 if(!live.length&&!f.some(x=>x.level==='bad'))add('warn','No device is connected on this account right now.');
 if(live.length>1)add('info',live.length+' devices are using this account now; they share its speed.');
 const rm=routerMap(store),rid=routerOfSub(store,s,rm)||(live[0]?.nasId)||null,devs=store.list('devices'),r=rid?store.get('devices',rid):devs.find(d=>d.type==='router'&&(d.name===live[0]?.nasName||d.ip===live[0]?.nas));
 if(r){if(r.status&&r.status!=='online')add('bad',r.name+' (the router) is offline: there is an outage.');
  const cpu=Number(r.metrics?.cpu);if(cpu>=85)add('warn',`${r.name} is very busy (CPU ${cpu}%).`);
  // Only problems that are still happening: open, not informational, and seen in the last 30 minutes. An alert older than
  // this account's own live session (it logged in after the alert) is clearly not stopping it, so it is left out too.
  const since=live.length?Math.max(...live.map(x=>x.startedAt||x.updatedAt||0)):0;
  const al=store.list('alerts').filter(a=>a.status!=='Resolved'&&a.severity!=='info'&&a.source!=='router-automation'&&(a.deviceId===r.id||devs.some(d=>d.parentId===r.id&&d.id===a.deviceId))&&now-(a.updated||a.created||0)<30*MIN&&!(since&&(a.updated||a.created||0)<since));
  for(const a of al.slice(0,3))add(a.severity==='critical'?'bad':'warn',a.title+'.');}
 if(live.length)add('ok',`Connected now on ${live.length} device${live.length===1?'':'s'}${live[0].nasName?' through '+live[0].nasName:''} since ${when(live[0].startedAt||live[0].updatedAt)}.`);
 const level=f.some(x=>x.level==='bad')?'bad':f.some(x=>x.level==='warn')?'warn':'ok';
 const customer=level==='ok'?`We checked your account ${String(s.username).toUpperCase()}: it is active${s.expiresAt?' until '+when(s.expiresAt):''} and we see no problem on our network right now. Try turning WiFi off and on, and moving closer to the WiFi point. Our team has your message and will follow up.`
  :`We checked your account ${String(s.username).toUpperCase()}:\n${f.filter(x=>x.level==='bad'||x.level==='warn').map(x=>'• '+x.text).join('\n')}\nOur team has been told${level==='bad'?' and will help you shortly':''}.`;
 return {level,findings:f,router:r?.name||null,customer,account:s.username};}
// ---------- 3. recovery after a failed payment ----------
async function recovery(store,now=Date.now(),fetchImpl=fetch){const cfg=settings(store);if(!cfg.recovery)return 0;const h=hourOf(now);if(h<8||h>=20)return 0;
 const sent=store.setting('smartRecovery')||{};let n=0;const plans=store.list('plans').filter(p=>p.active!==false&&p.service==='hotspot'&&Number(p.price)>0);
 const site=require('./shortlink.cjs').site();
 for(const p of store.list('portalPayments').filter(x=>x.status==='failed'&&/insufficient|balance/i.test(x.reason||'')&&x.phone&&x.createdAt<=now-cfg.recoveryAfterMin*MIN&&x.createdAt>=now-DAY)){
  if(sent[p.phone]&&now-sent[p.phone]<DAY)continue;if(store.list('portalPayments').some(x=>x.phone===p.phone&&x.status==='paid'&&x.createdAt>p.createdAt))continue;
  const cheaper=plans.filter(x=>Number(x.price)<Number(p.amount)).sort((a,b)=>b.price-a.price)[0];if(!cheaper)continue;
  sent[p.phone]=now;store.setting('smartRecovery',sent);
  await billing.sendSms(store,p.phone,`Your M-Pesa payment of ${money(p.amount)} did not go through (not enough balance). You can get ${cheaper.name} for just ${money(cheaper.price)}: connect to our WiFi and pick it on the page.${site?' '+site+'/portal/':''}`,'payment-retry',fetchImpl,now);n++;
  log(store,'recovery',`Offered ${cheaper.name} to ${p.phone} after a failed ${money(p.amount)} payment`,now);}
 return n;}
// ---------- 4. revenue drop ----------
function revenueByRouter(store,from,to,rm){const subs=new Map(store.list('subscribers').map(s=>[s.id,s])),out=new Map();let total=0;
 for(const p of store.list('subscriberPayments')){const t=p.time||p.created||0;if(t<from||t>=to||p.reversedAt)continue;const a=Number(p.amount)||0;total+=a;const rid=routerOfSub(store,subs.get(p.subscriberId),rm)||'?';out.set(rid,(out.get(rid)||0)+a);}
 return {total,out};}
function revenueDrop(store,now=Date.now(),ro=false){const cfg=settings(store);if(!cfg.revenueDrop)return [];const rm=routerMap(store),W=3*HOUR,cur=revenueByRouter(store,now-W,now,rm),base=new Map();let baseTotal=0;
 for(let d=1;d<=7;d++){const r=revenueByRouter(store,now-d*DAY-W,now-d*DAY,rm);baseTotal+=r.total/7;for(const [k,v] of r.out)base.set(k,(base.get(k)||0)+v/7);}
 const found=[],routers=store.list('devices').filter(d=>d.type==='router');
 for(const r of routers){const b=base.get(r.id)||0,c=cur.out.get(r.id)||0;if(b<cfg.dropMinBaseline)continue;const pct=Math.round(c/b*100);const low=pct<cfg.dropPercent;
  found.push({router:r.name,routerId:r.id,now:Math.round(c),usual:Math.round(b),pct,low});
  if(!ro)openOrClose(store,'revenue-drop:'+r.id,low,{title:`Sales at ${r.name} are down`,deviceId:r.id,source:'revenue-drop',severity:'warning',details:`Last 3 hours ${money(c)} against a usual ${money(b)} at this time (${pct}%). Check the router, the hotspot page and M-Pesa.`},pct>=70);}
 const stopped=cur.total===0&&baseTotal>=cfg.dropMinBaseline*1.5;
 if(!ro)openOrClose(store,'payments-stopped',stopped,{title:'No payments in the last 3 hours',source:'revenue-drop',severity:'critical',details:`Usually about ${money(baseTotal)} comes in at this time. M-Pesa, the payment callback or the WiFi pages may be down.`},cur.total>0);
 return found;}
function openOrClose(store,key,bad,alert,recovered){const open=store.list('alerts').find(a=>a.smartKey===key&&a.status!=='Resolved');
 if(bad&&!open){store.put('alerts',{...alert,status:'Open',smartKey:key});log(store,'alert',alert.title);}
 else if(open&&recovered)store.put('alerts',{...open,status:'Resolved',resolvedAt:Date.now(),resolvedBy:null,details:(open.details||'')+' · Back to normal.'},open);}
// ---------- 5. busy hours ----------
function busyHours(store,now=Date.now()){const out=[],rm=routerMap(store),subs=new Map(store.list('subscribers').map(s=>[s.id,s])),pays=store.list('subscriberPayments').filter(p=>!p.reversedAt&&(p.time||0)>=now-28*DAY);
 for(const r of store.list('devices').filter(d=>d.type==='router')){const pts=(store.setting('onlineSeries:'+r.id)?.points||[]).filter(p=>p[0]>=now-28*DAY);
  const users=Array(24).fill(0),cnt=Array(24).fill(0),sales=Array(24).fill(0);for(const p of pts){const h=hourOf(p[0]);users[h]+=(p[1]||0)+(p[2]||0);cnt[h]++;}
  for(const p of pays)if(routerOfSub(store,subs.get(p.subscriberId),rm)===r.id)sales[hourOf(p.time)]+=Number(p.amount)||0;
  const avg=users.map((u,i)=>cnt[i]?Math.round(u/cnt[i]*10)/10:null);if(avg.every(v=>v==null)&&sales.every(v=>!v))continue;
  const peak=Math.max(...avg.map(v=>v||0)),peakH=avg.indexOf(peak),quiet=avg.map((v,i)=>v!=null&&peak>0&&v<peak*0.3?i:-1).filter(i=>i>=0);
  const ranges=[];for(const h of quiet){const l=ranges.at(-1);if(l&&l[1]===h-1)l[1]=h;else ranges.push([h,h]);}
  const fmt=h=>String(h).padStart(2,'0')+':00',txt=ranges.map(([a,b])=>fmt(a)+'–'+fmt((b+1)%24)).join(', ');
  out.push({router:r.name,routerId:r.id,hours:avg,sales:sales.map(Math.round),peakHour:peak?fmt(peakH):null,peakUsers:peak,quiet:txt,
   suggestion:ranges.length&&peak>=3?`Quiet ${txt} (under a third of the ${fmt(peakH)} peak of ${peak} users). An off-peak package valid only in those hours, at about half price, could fill them without slowing the busy hours.`:peak?'Usage is fairly even through the day; no clear quiet hours yet.':'Not enough data yet.'});}
 return out;}
// ---------- 6. fraud and abuse ----------
function fraud(store,now=Date.now()){const cfg=settings(store);if(!cfg.fraud)return [];const flags=[],subs=store.list('subscribers'),byId=new Map(subs.map(s=>[s.id,s]));
 const refs=new Map();for(const p of store.list('subscriberPayments')){const r=String(p.reference||'').toUpperCase();if(!r||p.reversedAt)continue;if(!refs.has(r))refs.set(r,new Set());refs.get(r).add(p.subscriberId);}
 for(const [r,set] of refs)if(set.size>1)flags.push({type:'receipt',key:'receipt:'+r,text:`M-Pesa code ${r} was credited to ${set.size} accounts: ${[...set].map(id=>String(byId.get(id)?.username||'?').toUpperCase()).join(', ')}`});
 for(const p of store.list('portalPayments').filter(x=>x.status==='review'&&(x.createdAt||0)>=now-7*DAY))flags.push({type:'receipt',key:'review:'+p.id,text:`Payment held for review (${p.phone||'?'}, ${money(p.amount)}): ${p.reason||''}`});
 const macs=new Map(),use=new Map();
 for(const x of store.sessionsOf?store.sessionFieldsSince(now-DAY):[]){const u=String(x.username||'').toLowerCase();if(!u)continue;if(x.mac){if(!macs.has(u))macs.set(u,new Set());macs.get(u).add(String(x.mac).toUpperCase());}}
 const byUser=new Map(subs.map(s=>[String(s.username).toLowerCase(),s]));
 for(const [u,set] of macs){const s=byUser.get(u);if(!s)continue;const plan=s.planId?store.get('plans',s.planId):null,allowed=Math.max(1,Number(plan?.maxSessions||s.maxSessions)||1),lim=Math.max(4,allowed*3);if(set.size>lim)flags.push({type:'sharing',key:'sharing:'+s.id+':'+Math.floor(now/DAY),subscriberId:s.id,text:`${String(s.username).toUpperCase()} was used from ${set.size} different devices in 24 hours (package allows ${allowed}).`});}
 // Usage spike: today against the account's own 14-day daily median.
 const days=new Map();for(const x of store.sessionFieldsSince(now-15*DAY)){const u=String(x.username||'').toLowerCase(),t=x.updatedAt||x.startedAt||0,d=Math.floor((t+NAIROBI)/DAY),b=(Number(x.downloadBytes)||0)+(Number(x.uploadBytes)||0);if(!u||!b)continue;if(!days.has(u))days.set(u,new Map());const m=days.get(u);m.set(d,(m.get(d)||0)+b);}
 const today=Math.floor((now+NAIROBI)/DAY),GB=1073741824;
 for(const [u,m] of days){const t=m.get(today)||0;if(t<2*GB)continue;const past=[...m].filter(([d])=>d<today).map(([,v])=>v).sort((a,b)=>a-b);if(past.length<5)continue;const med=past[Math.floor(past.length/2)];if(med>0&&t>5*med){const s=byUser.get(u);flags.push({type:'usage',key:'usage:'+u+':'+today,subscriberId:s?.id,text:`${u.toUpperCase()} used ${(t/GB).toFixed(1)} GB today, ${Math.round(t/med)}× their usual day.`});}}
 const st=store.setting('smartFlags')||{items:[]},known=new Map(st.items.map(f=>[f.key,f]));
 for(const f of flags)if(!known.has(f.key)){known.set(f.key,{...f,time:now,status:'open'});log(store,'fraud',f.text,now);}
 st.items=[...known.values()].sort((a,b)=>b.time-a.time).slice(0,300);store.setting('smartFlags',st);return st.items;}
function dismissFlag(store,key,user){const st=store.setting('smartFlags')||{items:[]};const f=st.items.find(x=>x.key===key);if(!f)throw Object.assign(new Error('Not found'),{status:404});f.status='dismissed';f.by=user?.name||'';f.at=Date.now();store.setting('smartFlags',st);return f;}
// ---------- 7. capacity forecast ----------
function trend(points){const n=points.length;if(n<5)return null;const mx=points.reduce((a,p)=>a+p[0],0)/n,my=points.reduce((a,p)=>a+p[1],0)/n;let num=0,den=0;for(const [x,y] of points){num+=(x-mx)*(y-my);den+=(x-mx)**2;}const slope=den?num/den:0;return {slope,intercept:my-slope*mx};}
function daysTo(points,limit,now){const t=trend(points);if(!t||t.slope<=0)return null;const today=Math.floor((now+NAIROBI)/DAY),at=(limit-t.intercept)/t.slope;return Math.max(0,Math.round(at-today));}
function capacity(store,now=Date.now(),ro=false){const cfg=settings(store);if(!cfg.capacity)return [];const out=[],since=now-28*DAY,day=t=>Math.floor((t+NAIROBI)/DAY);
 const peaks=(rows,val)=>{const m=new Map();for(const r of rows){const d=day(r.time??r[0]),v=val(r);if(v==null||!Number.isFinite(v))continue;m.set(d,Math.max(m.get(d)??-Infinity,v));}return [...m].sort((a,b)=>a[0]-b[0]);};
 for(const d of store.list('devices')){
  if(d.type==='router'){const cpu=peaks(store.history(d.id,since),r=>Number(r.cpu??r.metrics?.cpu));if(cpu.length>=5){const cur=cpu.at(-1)[1],dl=cur>=85?0:daysTo(cpu,85,now);out.push({device:d.name,deviceId:d.id,metric:'CPU at its busiest',current:cur+'%',limit:'85%',daysLeft:dl});}
   const lim=Number(d.maxUsers)||null;const us=peaks((store.setting('onlineSeries:'+d.id)?.points||[]).filter(p=>p[0]>=since),p=>(p[1]||0)+(p[2]||0));
   if(us.length>=5)out.push({device:d.name,deviceId:d.id,metric:'Users online at the busiest time',current:us.at(-1)[1],limit:lim||'not set',daysLeft:lim?(us.at(-1)[1]>=lim?0:daysTo(us,lim,now)):null,growthPerWeek:Math.round((trend(us)?.slope||0)*7*10)/10});}
  if(d.type==='ap'){const lim=Number(d.apCapacity)||50,cl=peaks(store.history(d.id,since),r=>Number(r.clients));if(cl.length>=5)out.push({device:d.name,deviceId:d.id,metric:'Wi-Fi clients at the busiest time',current:cl.at(-1)[1],limit:lim,daysLeft:cl.at(-1)[1]>=lim?0:daysTo(cl,lim,now)});}}
 if(!ro)for(const x of out)openOrClose(store,'capacity:'+x.deviceId+':'+x.metric,x.daysLeft!=null&&x.daysLeft<=cfg.capacityDays,{title:`${x.device}: ${x.metric.replace(/^(Users|Wi-Fi)/,m=>m.toLowerCase())} will reach its limit ${x.daysLeft===0?'now':'in about '+x.daysLeft+' day'+(x.daysLeft===1?'':'s')}`,deviceId:x.deviceId,source:'capacity-forecast',severity:'warning',details:`Now ${x.current}, limit ${x.limit}. Plan an upgrade or another device before customers notice.`},x.daysLeft==null||x.daysLeft>cfg.capacityDays*2);
 return out;}
// ---------- 8. summary lines ----------
function summaryLines(store,now=Date.now()){const l=[],al=store.list('alerts').filter(a=>a.status!=='Resolved');
 const drop=al.filter(a=>a.source==='revenue-drop');if(drop.length)l.push('Sales alerts: '+drop.map(a=>a.title.replace('Sales at ','').replace(' are down','')).slice(0,4).join(', '));
 const cap=al.filter(a=>a.source==='capacity-forecast');if(cap.length)l.push(`${cap.length} capacity warning${cap.length===1?'':'s'}`);
 const fl=(store.setting('smartFlags')?.items||[]).filter(f=>f.status==='open'&&now-f.time<DAY);if(fl.length)l.push(`${fl.length} fraud/abuse flag${fl.length===1?'':'s'} to review`);
 return l;}
function log(store,kind,text,now=Date.now()){const l=store.setting('smartLog')||{items:[]};l.items=[{time:now,kind,text:String(text).slice(0,240)},...l.items].slice(0,300);store.setting('smartLog',l);}
let busy=false;
async function tick(store,now=Date.now(),fetchImpl=fetch){if(busy)return;busy=true;try{const st=store.setting('smartRun')||{};
 if(!st.q||now-st.q>=15*MIN){store.setting('smartRun',{...st,q:now});try{revenueDrop(store,now);}catch(e){log(store,'error','Revenue: '+e.message,now);}try{await recovery(store,now,fetchImpl);}catch(e){log(store,'error','Recovery: '+e.message,now);}}
 const s2=store.setting('smartRun')||{};if(!s2.h||now-s2.h>=HOUR){store.setting('smartRun',{...s2,h:now});try{fraud(store,now);}catch(e){log(store,'error','Fraud: '+e.message,now);}try{capacity(store,now);}catch(e){log(store,'error','Capacity: '+e.message,now);}}
}finally{busy=false;}}
function overview(store,now=Date.now()){const safe=f=>{try{return f();}catch{return [];}};
 return {settings:settings(store),revenue:safe(()=>revenueDrop(store,now,true)),flags:(store.setting('smartFlags')?.items||[]).slice(0,100),capacity:safe(()=>capacity(store,now,true)),busy:safe(()=>busyHours(store,now)),
  log:(store.setting('smartLog')?.items||[]).slice(0,60),alerts:store.list('alerts').filter(a=>['revenue-drop','capacity-forecast'].includes(a.source)&&a.status!=='Resolved').map(a=>({title:a.title,details:a.details,severity:a.severity,created:a.created}))};}
module.exports={settings,save,findPayment,chatHelp,diagnose,recovery,revenueDrop,busyHours,fraud,dismissFlag,capacity,summaryLines,tick,overview,CODE};
