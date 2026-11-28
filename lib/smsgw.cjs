'use strict';
// Android SMS gateway: Kade SMS Bridge phones (Safaricom SIM) send SMS for Kade Cloud.
// - A phone pairs once with a short-lived code (QR). It then holds a device token; only its SHA-256 is stored here.
// - Messages are jobs in a persistent queue (records kind 'smsJobs'). A phone claims jobs over HTTPS (long poll),
//   sends them with the SIM and reports each outcome. A claimed job is never handed out again: if the phone goes
//   silent, the job becomes "unknown" and is NOT retried automatically (it may already have been sent).
// - Unclaimed jobs are safe to move: after the fail-over delay they go to the commercial provider if allowed.
// - Off by default (mode 'off'). 'test' sends only to the listed test numbers. 'on' routes the chosen message types.
//   OTP/PIN, sign-in and staff alerts always stay on the commercial provider.
const crypto=require('node:crypto');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const MIN=60000,DAY=864e5,TZ=3*36e5;// Nairobi is UTC+3, no daylight saving
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const CATS={
 notices:{label:'Customer notices',kinds:['reminder','expired','usage','payment','welcome','voucher','renewal','manual','ticket','outage','maintenance','installation','onboarding','summary']},
 promotional:{label:'Promotions (opt-out respected)',kinds:['campaign','upsell','win-back','retention','promotion']}};
const CRITICAL=new Set(['pin','otp','recovery','signin','self-service','alert','test']);
const PROMO=new Set(CATS.promotional.kinds);
const DEFAULTS={mode:'off',disabled:false,routes:{notices:false,promotional:false},testNumbers:[],failover:true,failoverMinutes:15,lowBalance:100,optOutText:' Reply STOP to opt out.'};
const DEVICE_LIMITS={perMinute:6,daily:300,monthly:5000};
function config(store){const c=store.setting('smsGateway')||{};return {...DEFAULTS,...c,routes:{...DEFAULTS.routes,...(c.routes||{})}};}
function phone(v){return require('./billing.cjs').phone(v);}
function setConfig(store,input){const c=config(store),next={...c};
 if(input.mode!==undefined){if(!['off','test','on'].includes(input.mode))fail('Mode is off, test or on');next.mode=input.mode;}
 if(input.disabled!==undefined)next.disabled=input.disabled===true;
 if(input.routes)for(const k of Object.keys(CATS))if(input.routes[k]!==undefined)next.routes[k]=input.routes[k]===true;
 if(input.testNumbers!==undefined){const list=(Array.isArray(input.testNumbers)?input.testNumbers:String(input.testNumbers).split(/[\s,;]+/)).filter(Boolean);const out=[];for(const n of list){const p=phone(n);if(!p)fail('Not a Kenyan mobile number: '+String(n).slice(0,20));if(!out.includes(p))out.push(p);}if(out.length>20)fail('At most 20 test numbers');next.testNumbers=out;}
 if(input.failover!==undefined)next.failover=input.failover===true;
 if(input.failoverMinutes!==undefined){const v=Number(input.failoverMinutes);if(!(v>=2&&v<=1440))fail('Fail-over after 2 to 1440 minutes');next.failoverMinutes=Math.round(v);}
 if(input.lowBalance!==undefined){const v=Number(input.lowBalance);if(!(v>=0&&v<=100000))fail('Low-balance warning must be 0 to 100000');next.lowBalance=Math.round(v);}
 if(next.mode==='on'&&!next.disabled&&!devices(store).some(d=>d.status==='active'))fail('Pair a phone before switching the gateway on');
 store.setting('smsGateway',next);return next;}
// ---- Message size: GSM-7 (160 / 153 per part) or UCS-2 (70 / 67 per part) ----
const GSM='@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',EXT='^{}\\[~]|€\f';
function segments(text){const t=String(text||'');let units=0,gsm=true;for(const ch of t){if(GSM.includes(ch))units++;else if(EXT.includes(ch))units+=2;else{gsm=false;break;}}
 if(gsm)return {encoding:'GSM-7',units,parts:units<=160?(units?1:0):Math.ceil(units/153)};const n=[...t].length;return {encoding:'UCS-2',units:n,parts:n<=70?(n?1:0):Math.ceil(n/67)};}
// ---- Devices ----
function devices(store){return store.list('smsDevices');}
const online=(d,now=Date.now())=>d.status==='active'&&d.lastSeen&&now-d.lastSeen<3*MIN;
function publicDevice(d,now=Date.now()){const {tokenHash,pairHash,...rest}=d;return {...rest,limits:{...DEVICE_LIMITS,...(d.limits||{})},online:online(d,now),pairing:d.status==='pending'&&d.pairExpires>now};}
function newPairCode(store,dev,now=Date.now()){const code=Array.from(crypto.randomBytes(8),b=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b%32]).join('');
 const saved=store.put('smsDevices',{...dev,pairHash:sha(code),pairExpires:now+10*MIN},dev.id?dev:undefined);return {device:publicDevice(saved,now),code,expiresAt:saved.pairExpires};}
function addDevice(store,input,now=Date.now()){const name=String(input.name||'').trim().slice(0,40)||'Android phone '+(devices(store).length+1);if(devices(store).filter(d=>d.status!=='revoked').length>=10)fail('At most 10 phones');
 return newPairCode(store,{name,status:'pending',createdAt:now,limits:{...DEVICE_LIMITS},isDefault:!devices(store).some(d=>d.isDefault&&d.status==='active')},now);}
function repair(store,id,now=Date.now()){const d=store.get('smsDevices',id);if(!d)fail('Phone not found',404);if(d.status==='revoked')fail('This phone was revoked. Add it again as a new phone.');return newPairCode(store,d,now);}
const INFO={model:60,manufacturer:40,android:20,appVersion:20,battery:5,charging:5,network:20,signal:10,simState:30,operator:40,smsPermission:10,simSlot:5,pending:6,lastError:200};
function cleanInfo(i={}){const o={};for(const [k,n] of Object.entries(INFO))if(i[k]!==undefined&&i[k]!==null)o[k]=typeof i[k]==='number'||typeof i[k]==='boolean'?i[k]:String(i[k]).slice(0,n);return o;}
// Pairing from the phone: the code is single use and valid 10 minutes. Returns the device token once.
function pair(store,input,now=Date.now()){const code=String(input.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'');if(code.length!==8)fail('Enter the 8-character pairing code');
 const d=devices(store).find(x=>x.pairHash&&x.pairHash===sha(code));if(!d||d.pairExpires<now)fail('This pairing code is wrong or expired. Make a new one in Kade Cloud → SMS → Android gateway.',401);
 const secret=crypto.randomBytes(32).toString('base64url');const saved=store.put('smsDevices',{...d,status:'active',tokenHash:sha(secret),pairHash:null,pairExpires:null,pairedAt:now,lastSeen:now,info:cleanInfo(input.info),tokenIssuedAt:now},d);
 return {deviceId:saved.id,token:'kd1.'+saved.id+'.'+secret,name:saved.name};}
function authDevice(store,header){const m=/^Bearer kd1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/.exec(String(header||''));if(!m)fail('Device token missing',401);
 const d=store.get('smsDevices',m[1]);if(d?.status==='revoked')throw Object.assign(new Error('This phone was revoked in Kade Cloud'),{status:401,revoked:true});if(!d||!d.tokenHash)fail('Unknown device',401);
 const a=Buffer.from(sha(m[2]),'hex'),b=Buffer.from(d.tokenHash,'hex');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))fail('Device token is not valid',401);return d;}
function rotate(store,d,now=Date.now()){const secret=crypto.randomBytes(32).toString('base64url');store.put('smsDevices',{...store.get('smsDevices',d.id),tokenHash:sha(secret),tokenIssuedAt:now},store.get('smsDevices',d.id));return {token:'kd1.'+d.id+'.'+secret};}
function updateDevice(store,id,input){const d=store.get('smsDevices',id);if(!d)fail('Phone not found',404);const next={...d};
 if(input.name!==undefined){const n=String(input.name).trim().slice(0,40);if(!n)fail('Enter a name');next.name=n;}
 if(input.limits){const l={...DEVICE_LIMITS,...(d.limits||{})};for(const [k,max] of [['perMinute',30],['daily',5000],['monthly',100000]])if(input.limits[k]!==undefined){const v=Number(input.limits[k]);if(!(v>=1&&v<=max))fail(`${k} must be 1 to ${max}`);l[k]=Math.round(v);}next.limits=l;}
 if(input.paused!==undefined)next.paused=input.paused===true;
 if(input.isDefault===true){if(d.status!=='active')fail('Only a paired phone can be the default');for(const o of devices(store))if(o.isDefault&&o.id!==id)store.put('smsDevices',{...o,isDefault:false},o);next.isDefault=true;}
 return publicDevice(store.put('smsDevices',next,d));}
function revoke(store,id,now=Date.now()){const d=store.get('smsDevices',id);if(!d)fail('Phone not found',404);
 const saved=store.put('smsDevices',{...d,status:'revoked',tokenHash:null,pairHash:null,isDefault:false,revokedAt:now},d);
 // Its unsent jobs go back to the queue (they were never claimed); claimed ones keep their state.
 for(const j of jobsWhere(store,"json_extract(body,'$.deviceId')=? AND json_extract(body,'$.status') IN ('queued','scheduled')",[id]))store.put('smsJobs',{...j,deviceId:null},j);
 return publicDevice(saved);}
function heartbeat(store,d,info,now=Date.now()){const cur=store.get('smsDevices',d.id),c=config(store);store.put('smsDevices',{...cur,lastSeen:now,info:{...(cur.info||{}),...cleanInfo(info)}},cur);
 return {enabled:c.mode!=='off'&&!c.disabled&&!cur.paused,pollSeconds:20,serverTime:now,name:cur.name,rotateAfter:(cur.tokenIssuedAt||now)+30*DAY};}
// ---- Queue ----
function jobsWhere(store,where,args=[],limit=5000){return store.db.prepare(`SELECT * FROM records WHERE kind='smsJobs' AND ${where} ORDER BY created LIMIT ${Number(limit)}`).all(...args).map(r=>store.unpack(r));}
function optOuts(store){return store.setting('smsOptOut')||{phones:{}};}
function isOptedOut(store,number){return !!optOuts(store).phones[number];}
function setOptOut(store,number,out,source='admin',now=Date.now()){const p=phone(number);if(!p)fail('Not a Kenyan mobile number');const o=optOuts(store);if(out)o.phones[p]={time:now,source};else delete o.phones[p];store.setting('smsOptOut',o);return {phone:p,optedOut:!!out};}
// One message into the queue. channel 'android' or 'commercial'. Duplicate guard: same number and text within 10 minutes.
function enqueue(store,{to,message,kind='manual',channel='android',sendAt=null,deviceId=null,by=null,test=false,allowDuplicate=false,batch=null,subscriberId=null},now=Date.now()){
 const number=phone(to);if(!number)fail('Not a Kenyan mobile number: '+String(to||'').slice(0,20));const text=String(message||'').trim();if(!text)fail('Write a message');if(text.length>918)fail('A message is at most 918 characters (6 parts)');
 if(PROMO.has(kind)&&isOptedOut(store,number))return {skipped:'opted out',to:number};
 if(!allowDuplicate){const dup=store.db.prepare(`SELECT id FROM records WHERE kind='smsJobs' AND json_extract(body,'$.to')=? AND json_extract(body,'$.message')=? AND created>=? AND json_extract(body,'$.status') NOT IN ('failed','cancelled') LIMIT 1`).get(number,text,now-10*MIN);if(dup)return {skipped:'duplicate',to:number,duplicateOf:dup.id};}
 const seg=segments(text),at=sendAt&&sendAt>now?Number(sendAt):null;
 const job=store.put('smsJobs',{to:number,message:text,kind,channel,status:at?'scheduled':'queued',sendAt:at||now,deviceId,parts:seg.parts,encoding:seg.encoding,createdAt:now,by,test:!!test,batch,subscriberId});
 return {job};}
// Routing for the automatic messages (billing.sendSms calls this). Returns a log entry when the gateway takes the
// message, or null to let the commercial provider send it now.
function route(store,kind,number,message,now=Date.now()){const c=config(store);if(c.mode==='off'||c.disabled||CRITICAL.has(kind))return null;
 if(c.mode==='test'&&!c.testNumbers.includes(number))return null;
 if(c.mode==='on'){const cat=Object.entries(CATS).find(([,v])=>v.kinds.includes(kind))?.[0]||'notices';if(!c.routes[cat])return null;}
 const live=devices(store).filter(d=>online(d,now)&&!d.paused);if(!live.length)return null;// no phone online: commercial now, nothing waits
 const r=enqueue(store,{to:number,message,kind,channel:'android',test:c.mode==='test'},now);
 if(r.skipped==='duplicate')return {time:now,to:number,kind,message:String(message).slice(0,459),status:'skipped',channel:'android',detail:'Duplicate within 10 minutes, not sent again'};
 if(r.skipped)return {time:now,to:number,kind,message:String(message).slice(0,459),status:'skipped',channel:'android',detail:'Customer opted out of promotions'};
 return {time:now,to:number,kind,message:String(message).slice(0,459),status:'queued',channel:'android',detail:'Queued for the Android gateway',jobId:r.job.id};}
// Usage of a device in a window, in SMS parts (what the bundle and Safaricom count).
function used(store,deviceId,since){return store.db.prepare(`SELECT COALESCE(SUM(json_extract(body,'$.parts')),0) n FROM records WHERE kind='smsJobs' AND json_extract(body,'$.deviceId')=? AND json_extract(body,'$.claimedAt')>=?`).get(deviceId,since).n;}
const dayStart=now=>Math.floor((now+TZ)/DAY)*DAY-TZ,monthStart=now=>{const d=new Date(now+TZ);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)-TZ;};
function allowance(store,d,now=Date.now()){const l={...DEVICE_LIMITS,...(d.limits||{})};return Math.max(0,Math.min(l.perMinute-used(store,d.id,now-MIN),l.daily-used(store,d.id,dayStart(now)),l.monthly-used(store,d.id,monthStart(now))));}
// The phone asks for work. Each job is handed out once (status → sending) inside a transaction.
function claim(store,d,max=5,now=Date.now()){const c=config(store),cur=store.get('smsDevices',d.id);if(c.mode==='off'||c.disabled||cur.paused)return [];
 let room=allowance(store,cur,now);if(room<=0)return [];
 return store.transaction(()=>{const out=[];
  const rows=jobsWhere(store,"json_extract(body,'$.channel')='android' AND json_extract(body,'$.status') IN ('queued','scheduled') AND json_extract(body,'$.sendAt')<=? AND (json_extract(body,'$.deviceId') IS NULL OR json_extract(body,'$.deviceId')=?)",[now,d.id],50);
  // Jobs for "any phone" go to the default phone first; another phone takes them after a minute.
  const isDef=!!cur.isDefault,defOnline=devices(store).some(x=>x.isDefault&&online(x,now)&&!x.paused);
  for(const j of rows){if(out.length>=Math.min(10,max))break;if(c.mode==='test'&&!c.testNumbers.includes(j.to))continue;
   if(!j.deviceId&&!isDef&&defOnline&&now-j.createdAt<MIN)continue;if(j.parts>room)break;room-=j.parts;
   const s=store.put('smsJobs',{...j,status:'sending',deviceId:d.id,claimedAt:now,attempt:(j.attempt||0)+1},j);out.push({id:s.id,to:s.to,message:s.message,parts:s.parts});}
  return out;});}
const FINAL=new Set(['sent','delivered','failed','undelivered','unknown','cancelled']);
// Outcomes from the phone. Idempotent: the same report twice changes nothing.
function report(store,d,results,now=Date.now()){const billing=require('./billing.cjs');let n=0;
 for(const r of (Array.isArray(results)?results:[]).slice(0,100)){const j=store.get('smsJobs',String(r.id||''));if(!j||j.deviceId!==d.id||j.channel!=='android')continue;
  const st=String(r.status||'');const err=r.error?String(r.error).slice(0,200):'';
  if(st==='sent'&&j.status==='sending'){store.put('smsJobs',{...j,status:'sent',sentAt:now,error:''},j);billing.logSms(store,{time:now,to:j.to,kind:j.kind,message:j.message.slice(0,459),status:'sent',channel:'android',detail:'Sent by '+d.name});n++;}
  else if(st==='delivered'&&['sending','sent'].includes(j.status)){if(j.status==='sending')billing.logSms(store,{time:now,to:j.to,kind:j.kind,message:j.message.slice(0,459),status:'sent',channel:'android',detail:'Sent by '+d.name});store.put('smsJobs',{...j,status:'delivered',sentAt:j.sentAt||now,deliveredAt:now},j);n++;}
  else if(st==='undelivered'&&['sending','sent'].includes(j.status)){store.put('smsJobs',{...j,status:'undelivered',error:err||'Carrier reported not delivered'},j);n++;}
  else if(st==='failed'&&j.status==='sending'){store.put('smsJobs',{...j,status:'failed',failedAt:now,error:err||'Phone could not send'},j);billing.logSms(store,{time:now,to:j.to,kind:j.kind,message:j.message.slice(0,459),status:'failed',channel:'android',detail:(d.name+': '+(err||'could not send')).slice(0,200)});n++;}
  else if(st==='unknown'&&j.status==='sending'){store.put('smsJobs',{...j,status:'unknown',error:err||'Phone restarted before it knew the result'},j);n++;}}
 return {accepted:n};}
// Inbound keywords only (STOP / START). The phone never forwards other messages.
function inbound(store,d,input,now=Date.now()){const kw=String(input.keyword||'').trim().toUpperCase(),from=phone(input.from);if(!from)return {ok:false};
 if(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(kw.replace(/\s/g,'')))setOptOut(store,from,true,'sms:'+d.name,now);else if(['START','UNSTOP','SUBSCRIBE'].includes(kw))setOptOut(store,from,false,'sms:'+d.name,now);else return {ok:false};return {ok:true};}
// ---- Worker (every 15 seconds): scheduled → due, silent claims → unknown, unclaimed → commercial, commercial jobs → provider ----
let busy=false;
async function tick(store,now=Date.now(),fetchImpl=fetch){if(busy)return;busy=true;try{const c=config(store),billing=require('./billing.cjs');
 for(const j of jobsWhere(store,"json_extract(body,'$.status')='sending' AND json_extract(body,'$.channel')='android' AND json_extract(body,'$.claimedAt')<?",[now-10*MIN],200))
  store.put('smsJobs',{...j,status:'unknown',error:'The phone took this message but did not report back within 10 minutes. It may or may not have been sent, so it is not retried automatically.'},j);
 for(const j of jobsWhere(store,"json_extract(body,'$.status')='sending' AND json_extract(body,'$.channel')='commercial' AND json_extract(body,'$.claimedAt')<?",[now-5*MIN],200))
  store.put('smsJobs',{...j,status:'unknown',error:'Server stopped while sending; not retried automatically.'},j);
 if(c.failover&&!c.disabled)for(const j of jobsWhere(store,"json_extract(body,'$.channel')='android' AND json_extract(body,'$.status') IN ('queued','scheduled') AND json_extract(body,'$.sendAt')<=? AND COALESCE(json_extract(body,'$.test'),0)=0",[now-c.failoverMinutes*MIN],100))
  if(store.secret('sms:config'))store.put('smsJobs',{...j,channel:'commercial',status:'queued',failover:true,note:'No phone took it within '+c.failoverMinutes+' minutes; sent by the commercial provider'},j);
 for(const j of jobsWhere(store,"json_extract(body,'$.channel')='commercial' AND json_extract(body,'$.status') IN ('queued','scheduled') AND json_extract(body,'$.sendAt')<=?",[now],20)){
  const cur=store.get('smsJobs',j.id);if(!['queued','scheduled'].includes(cur.status))continue;const s=store.put('smsJobs',{...cur,status:'sending',claimedAt:Date.now()},cur);
  const e=await billing.sendSms(store,s.to,s.message,s.kind,fetchImpl,Date.now(),{channel:'commercial'});const fin=store.get('smsJobs',s.id);
  store.put('smsJobs',{...fin,status:e.status==='sent'?'sent':'failed',sentAt:e.status==='sent'?Date.now():null,error:e.status==='sent'?'':e.detail},fin);}
}finally{busy=false;}}
// ---- Views ----
function cancel(store,id){const j=store.get('smsJobs',id);if(!j)fail('Message not found',404);if(!['queued','scheduled'].includes(j.status))fail('Only messages not yet handed to a phone can be cancelled');return store.put('smsJobs',{...j,status:'cancelled'},j);}
function resend(store,id,input,user,now=Date.now()){const j=store.get('smsJobs',id);if(!j)fail('Message not found',404);if(!['failed','unknown','undelivered','cancelled'].includes(j.status))fail('Only failed, unknown or cancelled messages can be sent again');
 if(j.status==='unknown'&&input.confirm!==true)fail('This message may already have been delivered. Confirm to send it again.',409);
 return enqueue(store,{to:j.to,message:j.message,kind:j.kind,channel:input.channel==='commercial'?'commercial':'android',by:user?.name,allowDuplicate:true,subscriberId:j.subscriberId},now);}
function list(store,q={},now=Date.now()){const where=['1=1'],args=[];
 if(q.status){if(q.status==='pending'){where.push("json_extract(body,'$.status') IN ('queued','scheduled','sending')");}else{where.push("json_extract(body,'$.status')=?");args.push(String(q.status));}}
 if(q.channel){where.push("json_extract(body,'$.channel')=?");args.push(String(q.channel));}
 if(q.from){where.push('created>=?');args.push(Number(q.from));}if(q.to){where.push('created<=?');args.push(Number(q.to));}
 if(q.q){where.push("(json_extract(body,'$.to') LIKE ? OR json_extract(body,'$.message') LIKE ?)");const like='%'+String(q.q).replace(/[%_]/g,'').slice(0,60)+'%';args.push(like,like);}
 const total=store.db.prepare(`SELECT COUNT(*) n FROM records WHERE kind='smsJobs' AND ${where.join(' AND ')}`).get(...args).n,limit=Math.min(500,Number(q.limit)||100),offset=Math.max(0,Number(q.offset)||0);
 const rows=store.db.prepare(`SELECT * FROM records WHERE kind='smsJobs' AND ${where.join(' AND ')} ORDER BY created DESC LIMIT ? OFFSET ?`).all(...args,limit,offset).map(r=>store.unpack(r));
 const names=new Map(devices(store).map(d=>[d.id,d.name]));return {total,items:rows.map(j=>({...j,deviceName:names.get(j.deviceId)||''}))};}
function csv(items){const q=v=>{const s=v==null?'':String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;},t=x=>x?new Date(x).toISOString():'';
 return ['Created,Send at,Sent at,Delivered at,To,Type,Channel,Phone,Status,Parts,Error,Message',...items.map(j=>[t(j.createdAt),t(j.sendAt),t(j.sentAt),t(j.deliveredAt),j.to,j.kind,j.channel,j.deviceName,j.status,j.parts,j.error,j.message].map(q).join(','))].join('\n');}
// Bundles: what was bought (recorded by an admin) against SMS parts the phones sent. An estimate, not Safaricom's balance.
function bundles(store,now=Date.now()){const list=store.list('smsBundles').sort((a,b)=>a.purchasedAt-b.purchasedAt);if(!list.length)return {items:[],remaining:null,active:0};
 const start=list[0].purchasedAt;const sent=store.db.prepare(`SELECT json_extract(body,'$.sentAt') t,json_extract(body,'$.claimedAt') c,json_extract(body,'$.parts') p FROM records WHERE kind='smsJobs' AND json_extract(body,'$.channel')='android' AND json_extract(body,'$.status') IN ('sent','delivered','undelivered','unknown') AND json_extract(body,'$.claimedAt')>=?`).all(start).map(r=>({t:r.t||r.c,p:r.p||1})).sort((a,b)=>a.t-b.t);
 const items=list.map(b=>({...b,used:0,expired:!!(b.expiresAt&&b.expiresAt<now)}));
 for(const s of sent){const b=items.find(x=>x.purchasedAt<=s.t&&(!x.expiresAt||x.expiresAt>=s.t)&&x.used<x.quantity);if(b)b.used+=s.p;}
 for(const b of items)b.remaining=b.expired?0:Math.max(0,b.quantity-b.used);
 const remaining=items.reduce((a,b)=>a+b.remaining,0);return {items:items.reverse(),remaining,active:items.filter(b=>!b.expired&&b.remaining>0).length,low:remaining<config(store).lowBalance};}
function addBundle(store,input,now=Date.now()){const name=String(input.name||'').trim().slice(0,60);if(!name)fail('Enter the bundle name');const quantity=Math.round(Number(input.quantity));if(!(quantity>=1&&quantity<=1000000))fail('SMS quantity must be 1 to 1,000,000');
 const price=Number(input.price||0);if(!(price>=0&&price<=1e6))fail('Enter a valid price');const purchasedAt=input.purchasedAt?Number(new Date(input.purchasedAt)):now;if(!Number.isFinite(purchasedAt))fail('Enter the purchase date');
 const expiresAt=input.expiresAt?Number(new Date(input.expiresAt)):null;if(expiresAt!=null&&!(expiresAt>purchasedAt))fail('Expiry must be after the purchase date');
 return store.put('smsBundles',{name,quantity,price,purchasedAt,expiresAt,deviceId:input.deviceId?String(input.deviceId):null,note:String(input.note||'').slice(0,200)});}
function stats(store,now=Date.now()){const q=(where,args)=>store.db.prepare(`SELECT json_extract(body,'$.status') s,COUNT(*) n,COALESCE(SUM(json_extract(body,'$.parts')),0) p FROM records WHERE kind='smsJobs' AND json_extract(body,'$.channel')='android' AND ${where} GROUP BY s`).all(...args);
 const fold=rows=>{const o={sent:0,delivered:0,failed:0,unknown:0,pending:0,parts:0};for(const r of rows){if(['queued','scheduled','sending'].includes(r.s))o.pending+=r.n;else if(r.s in o)o[r.s]+=r.n;else if(r.s==='undelivered')o.failed+=r.n;if(['sent','delivered','undelivered','unknown'].includes(r.s))o.parts+=r.p;}return o;};
 const today=fold(q('created>=?',[dayStart(now)])),month=fold(q('created>=?',[monthStart(now)])),pending=store.db.prepare(`SELECT COUNT(*) n FROM records WHERE kind='smsJobs' AND json_extract(body,'$.status') IN ('queued','scheduled','sending')`).get().n;
 const errors=store.db.prepare(`SELECT * FROM records WHERE kind='smsJobs' AND json_extract(body,'$.status') IN ('failed','unknown','undelivered') ORDER BY updated DESC LIMIT 8`).all().map(r=>{const j=store.unpack(r);return {id:j.id,to:j.to,status:j.status,error:j.error,time:r.updated};});
 return {today,month,pending,errors};}
function overview(store,now=Date.now()){return {config:config(store),categories:Object.fromEntries(Object.entries(CATS).map(([k,v])=>[k,v])),critical:[...CRITICAL],devices:devices(store).filter(d=>d.status!=='revoked'||now-(d.revokedAt||0)<30*DAY).map(d=>({...publicDevice(d,now),allowance:d.status==='active'?allowance(store,d,now):0})),stats:stats(store,now),bundles:bundles(store,now),optOuts:Object.entries(optOuts(store).phones).map(([p,v])=>({phone:p,...v})).slice(0,500)};}
// Composer: one number, or customers (segment/ids). Personalised with the customer's fields.
function compose(store,input,user,now=Date.now()){const billing=require('./billing.cjs'),c=config(store);
 const text=String(input.message||'').trim();if(!text)fail('Write a message');const promo=input.promotional===true,kind=promo?'promotion':(input.kind&&CATS.notices.kinds.includes(input.kind)?input.kind:'manual');
 const channel=input.channel==='commercial'?'commercial':'android';if(channel==='android'&&!devices(store).some(d=>d.status==='active'))fail('Pair a phone first');
 if(channel==='commercial'&&!store.secret('sms:config'))fail('The commercial SMS provider is not set up');
 const sendAt=input.sendAt?Number(new Date(input.sendAt)):null;if(sendAt!=null&&(!Number.isFinite(sendAt)||sendAt>now+60*DAY))fail('Schedule within the next 60 days');
 const deviceId=input.deviceId?String(input.deviceId):null;if(deviceId&&store.get('smsDevices',deviceId)?.status!=='active')fail('Choose a paired phone');
 let targets;if(input.to){targets=String(input.to).split(/[\s,;]+/).filter(Boolean).slice(0,50).map(t=>({to:t}));}
 else targets=require('./campaigns.cjs').recipients(store,input.segment,input.planId,now,input.ids).map(r=>({to:r.to,subscriberId:r.id}));
 if(!targets.length)fail('Nobody to send to');if(targets.length>1&&input.confirm!==targets.length)fail('Confirm the number of recipients ('+targets.length+')',409);
 if(channel==='android'&&c.mode==='test'){const bad=targets.filter(t=>!c.testNumbers.includes(phone(t.to)));if(bad.length)fail('The gateway is in test mode: only the test numbers can receive messages ('+bad.slice(0,3).map(b=>b.to).join(', ')+(bad.length>3?'…':'')+')');}
 if(channel==='android'&&c.mode==='off'&&!input.to)fail('The Android gateway is off. Switch it to test or on first.');
 const idem=String(input.idempotencyKey||'').slice(0,80);if(idem){const seen=store.setting('smsIdem')||{};if(seen[idem]&&now-seen[idem].t<DAY)return seen[idem].result;}
 const batch=crypto.randomUUID(),out={batch,queued:0,skipped:{duplicate:0,'opted out':0,invalid:0},parts:0};
 for(const t of targets){const sub=t.subscriberId?store.get('subscribers',t.subscriberId):null;let msg=sub?billing.fill(text,billing.values(store,sub)):text;if(promo&&!/\bSTOP\b/i.test(msg))msg+=c.optOutText;
  try{const r=enqueue(store,{to:t.to,message:msg,kind,channel,sendAt,deviceId,by:user?.name||null,test:c.mode==='test',batch,subscriberId:t.subscriberId||null},now);if(r.skipped)out.skipped[r.skipped]++;else{out.queued++;out.parts+=r.job.parts;}}catch{out.skipped.invalid++;}}
 if(idem){const seen=store.setting('smsIdem')||{};for(const k of Object.keys(seen))if(now-seen[k].t>DAY)delete seen[k];seen[idem]={t:now,result:out};store.setting('smsIdem',seen);}
 return out;}
function progress(store,batch){const rows=store.db.prepare(`SELECT json_extract(body,'$.status') s,COUNT(*) n FROM records WHERE kind='smsJobs' AND json_extract(body,'$.batch')=? GROUP BY s`).all(String(batch));return Object.fromEntries(rows.map(r=>[r.s,r.n]));}
module.exports={config,setConfig,segments,devices,addDevice,repair,pair,authDevice,rotate,updateDevice,revoke,heartbeat,enqueue,route,claim,report,inbound,tick,cancel,resend,list,csv,bundles,addBundle,stats,overview,compose,progress,setOptOut,isOptedOut,allowance,CRITICAL,CATS,FINAL};
