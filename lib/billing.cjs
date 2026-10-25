'use strict';
// Subscriber billing that runs on the server: payments credit a subscriber and renew whole plan periods (leftover
// stays as credit), each payment reference counts once, and SMS reminders/receipts go out from the collector loop.
const radius=require('./radius.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const DAY=86400000,LOG=1000;
const TEMPLATES={
 reminder:'Hi {name}, your {plan} internet expires on {expiry}. Pay KSh {price} to stay online. Account: {username}. Kade Networks',
 expired:'Hi {name}, your {plan} internet has expired. Pay KSh {price} to reconnect. Account: {username}. Kade Networks',
 payment:'Hi {name}, we received KSh {amount} ({reference}). Your internet is active until {expiry}. Thank you. Kade Networks'
};
function settings(store){const s=store.setting('billingSettings')||{};return {reminderDays:Array.isArray(s.reminderDays)?s.reminderDays:[3,1],sendFrom:s.sendFrom??8,sendUntil:s.sendUntil??20,templates:{...TEMPLATES,...(s.templates||{})},enabled:{reminder:true,expired:true,payment:true,...(s.enabled||{})}};}
function updateSettings(store,input){const cur=settings(store),days=(Array.isArray(input.reminderDays)?input.reminderDays:String(input.reminderDays??cur.reminderDays.join(',')).split(',')).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=30);
 const templates={};for(const k of Object.keys(TEMPLATES)){const t=String(input.templates?.[k]??cur.templates[k]).trim();if(!t||t.length>459)fail('Each message must be 1–459 characters');templates[k]=t;}
 const enabled={};for(const k of Object.keys(TEMPLATES))enabled[k]=input.enabled?.[k]===undefined?cur.enabled[k]:input.enabled[k]===true||input.enabled[k]==='true'||input.enabled[k]==='on';
 return store.setting('billingSettings',{reminderDays:[...new Set(days)].sort((a,b)=>b-a).slice(0,5),sendFrom:cur.sendFrom,sendUntil:cur.sendUntil,templates,enabled});}
// Kenyan numbers to E.164: 07.. / 01.. / 7.. / 2547.. / +2547..
function phone(value){const d=String(value||'').replace(/[\s()-]/g,'');let m;if((m=/^\+?254([17]\d{8})$/.exec(d))||(m=/^0([17]\d{8})$/.exec(d))||(m=/^([17]\d{8})$/.exec(d)))return '+254'+m[1];return null;}
const money=n=>Math.round(Number(n)*100)/100;
// Credit a payment. Reference is unique across all subscriber payments (an M-Pesa code can never be applied twice).
function pay(store,subscriberId,input,now=Date.now()){
 const amount=money(input.amount),reference=String(input.reference||'').trim().toUpperCase(),method=['mpesa','cash','bank','other'].includes(input.method)?input.method:'other';
 if(!(amount>0&&amount<=1e7))fail('Enter the amount paid');if(!/^[A-Z0-9_-]{4,40}$/.test(reference))fail('Enter the payment reference (e.g. the M-Pesa code)');
 return store.transaction(()=>{
  if(store.list('subscriberPayments').some(p=>p.reference===reference))fail('Payment '+reference+' was already recorded',409);
  let s=store.get('subscribers',subscriberId);if(!s)fail('Subscriber not found',404);const plan=store.get('plans',s.planId);if(!plan)fail('Subscriber has no plan');
  let balance=money((s.balance||0)+amount),periods=0;
  if(plan.price>0)while(balance>=plan.price&&periods<24){balance=money(balance-plan.price);periods++;}else periods=1;
  if(periods){s=radius.renew(store,s.id,periods,now);}
  s=store.put('subscribers',{...s,balance},s);
  const payment=store.put('subscriberPayments',{subscriberId:s.id,username:s.username,name:s.name,amount,reference,method,phone:String(input.phone||'').slice(0,20),note:String(input.note||'').slice(0,200),periods,time:now,expiresAt:s.expiresAt});
  return {payment,subscriber:s,periods,balance};
 });
}
const fill=(template,values)=>template.replace(/\{(\w+)\}/g,(m,k)=>values[k]??m);
function values(store,s,extra={}){const p=store.get('plans',s.planId);return {name:String(s.name||'').split(' ')[0],plan:p?.name||'',price:p?Number(p.price).toLocaleString('en-KE'):'',username:s.username,expiry:s.expiresAt?new Date(s.expiresAt).toLocaleString('en-KE',{timeZone:'Africa/Nairobi',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'',...extra};}
function smsConfig(store){const c=store.secret('sms:config');return c?{provider:c.provider,username:c.username,senderId:c.senderId||'',sandbox:!!c.sandbox,configured:true}:{configured:false};}
function setSmsConfig(store,input){const username=String(input.username||'').trim(),apiKey=String(input.apiKey||'').trim(),senderId=String(input.senderId||'').trim(),prior=store.secret('sms:config');
 if(!/^[A-Za-z0-9_-]{2,60}$/.test(username))fail("Enter your Africa's Talking username");if(!apiKey&&!prior)fail("Enter your Africa's Talking API key");if(senderId&&!/^[A-Za-z0-9 ]{2,11}$/.test(senderId))fail('Sender ID is up to 11 letters or numbers');
 store.secret('sms:config',{provider:'africastalking',username,apiKey:apiKey||prior.apiKey,senderId,sandbox:input.sandbox===true||input.sandbox==='on'||username==='sandbox'});return smsConfig(store);}
function logSms(store,entry){const l=store.setting('smsLog')||{items:[]};l.items=[entry,...l.items].slice(0,LOG);store.setting('smsLog',l);}
// Send one SMS through Africa's Talking. Never throws for delivery problems; the result is logged.
async function sendSms(store,to,message,kind='manual',fetchImpl=fetch,now=Date.now()){
 const number=phone(to),c=store.secret('sms:config'),entry={time:now,to:number||String(to||'').slice(0,20),kind,message:message.slice(0,459),status:'failed',detail:''};
 try{
  if(!number)throw new Error('Not a Kenyan mobile number');if(!c)throw new Error('SMS is not set up');
  const body=new URLSearchParams({username:c.username,to:number,message:entry.message,...(c.senderId?{from:c.senderId}:{})});
  const r=await fetchImpl(c.sandbox?'https://api.sandbox.africastalking.com/version1/messaging':'https://api.africastalking.com/version1/messaging',{method:'POST',headers:{apiKey:c.apiKey,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw new Error('SMS provider returned HTTP '+r.status);}
  const rec=data?.SMSMessageData?.Recipients?.[0];if(!r.ok||!rec)throw new Error(data?.SMSMessageData?.Message||'SMS provider returned HTTP '+r.status);
  entry.status=/success|sent|queued/i.test(rec.status)?'sent':'failed';entry.detail=String(rec.status||'')+(rec.cost?' · '+rec.cost:'');
 }catch(error){entry.detail=String(error.message||error).slice(0,200);}
 logSms(store,entry);return entry;
}
// Collector job: reminders before expiry and an "expired" notice, once each per subscriber and expiry date.
async function runReminders(store,now=Date.now(),fetchImpl=fetch){
 const cfg=settings(store);if(!store.secret('sms:config'))return {sent:0,skipped:'not configured'};
 const hour=Number(new Date(now).toLocaleString('en-GB',{timeZone:'Africa/Nairobi',hour:'2-digit',hour12:false}));if(hour<cfg.sendFrom||hour>=cfg.sendUntil)return {sent:0,skipped:'quiet hours'};
 const done=store.setting('smsReminders')||{keys:[]},known=new Set(done.keys);let sent=0;
 for(const s of store.list('subscribers')){
  if(s.status!=='active'||s.expiresAt==null||!phone(s.phone))continue;const left=s.expiresAt-now;let kind=null,key=null;
  if(left<=0&&left>-2*DAY&&cfg.enabled.expired){kind='expired';key=`${s.id}:${s.expiresAt}:expired`;}
  else if(left>0&&cfg.enabled.reminder){const day=cfg.reminderDays.find(d=>left<=d*DAY&&left>(d-1)*DAY);if(day){kind='reminder';key=`${s.id}:${s.expiresAt}:${day}`;}}
  if(!kind||known.has(key))continue;
  // Mark before sending so a slow provider can never cause a duplicate on the next loop.
  known.add(key);done.keys=[...known].slice(-20000);store.setting('smsReminders',done);
  await sendSms(store,s.phone,fill(cfg.templates[kind],values(store,s)),kind,fetchImpl,now);sent++;
 }
 return {sent};
}
async function receipt(store,result,fetchImpl=fetch){const cfg=settings(store);if(!cfg.enabled.payment||!store.secret('sms:config')||!phone(result.subscriber.phone))return null;return sendSms(store,result.subscriber.phone,fill(cfg.templates.payment,values(store,result.subscriber,{amount:Number(result.payment.amount).toLocaleString('en-KE'),reference:result.payment.reference})),'payment',fetchImpl);}
function overview(store){return {payments:store.list('subscriberPayments').slice(0,500),sms:{config:smsConfig(store),log:(store.setting('smsLog')?.items||[]).slice(0,300)},settings:settings(store)};}
module.exports={pay,phone,sendSms,runReminders,receipt,overview,settings,updateSettings,smsConfig,setSmsConfig,fill,values,TEMPLATES};
