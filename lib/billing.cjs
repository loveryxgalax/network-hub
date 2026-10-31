'use strict';
// Subscriber billing that runs on the server: payments credit a subscriber and renew whole plan periods (leftover
// stays as credit), each payment reference counts once, and SMS reminders/receipts go out from the collector loop.
const radius=require('./radius.cjs'),ledger=require('./ledger.cjs');
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
function loyalty(store){const l=store.setting('loyalty')||{};return {enabled:l.enabled===true,pointsPer100:Number(l.pointsPer100)>0?Number(l.pointsPer100):1,pointValue:Number(l.pointValue)>0?Number(l.pointValue):10,referralPoints:Number(l.referralPoints)>0?Number(l.referralPoints):0,visitPoints:Number(l.visitPoints)>0?Number(l.visitPoints):0};}
// Extra points (referrals, daily visits), kept in a log so the profile can show where points came from.
function addPoints(store,subscriberId,points,reason,now=Date.now()){const s=store.get('subscribers',subscriberId);if(!s||!(points>0))return null;const saved=store.put('subscribers',{...s,points:(s.points||0)+points},s);const l=store.setting('pointsLog')||{items:[]};l.items=[{time:now,subscriberId,points,reason:String(reason).slice(0,120)},...l.items].slice(0,5000);store.setting('pointsLog',l);return saved;}
function setLoyalty(store,input){const pp=Number(input.pointsPer100),pv=Number(input.pointValue),rp=Math.round(Number(input.referralPoints||0)),vp=Math.round(Number(input.visitPoints||0));if(!(pp>0&&pp<=100)||!(pv>0&&pv<=10000))fail('Enter points per KSh 100 (1–100) and a point value in KSh');if(!(rp>=0&&rp<=10000)||!(vp>=0&&vp<=100))fail('Referral points 0–10000, daily visit points 0–100');return store.setting('loyalty',{enabled:input.enabled===true,pointsPer100:pp,pointValue:pv,referralPoints:rp,visitPoints:vp});}
function redeemPoints(store,subscriberId,points){const lo=loyalty(store),n=Math.floor(Number(points));if(!lo.enabled)fail('Loyalty points are switched off');
 return store.transaction(()=>{const s=store.get('subscribers',subscriberId);if(!s)fail('Subscriber not found',404);if(!(n>0)||n>(s.points||0))fail('Not enough points');const value=money(n*lo.pointValue);const saved=store.put('subscribers',{...s,points:(s.points||0)-n,balance:money((s.balance||0)+value)},s);ledger.post(store,{subscriberId,type:'points',walletMinor:ledger.minor(value),ref:'PTS',note:n+' points redeemed'});return saved;});}
function pay(store,subscriberId,input,now=Date.now()){
 const amount=money(input.amount),reference=String(input.reference||'').trim().toUpperCase(),method=['mpesa','card','cash','bank','other'].includes(input.method)?input.method:'other';
 if(!(amount>0&&amount<=1e7))fail('Enter the amount paid');if(!/^[A-Z0-9_-]{4,40}$/.test(reference))fail('Enter the payment reference (e.g. the M-Pesa code)');
 return store.transaction(()=>{
  if(store.list('subscriberPayments').some(p=>p.reference===reference))fail('Payment '+reference+' was already recorded',409);
  let s=store.get('subscribers',subscriberId);if(!s)fail('Subscriber not found',404);const plan=store.get('plans',s.planId);if(!plan)fail('Subscriber has no plan');
  const walletBefore=s.balance||0,expiresBefore=s.expiresAt??null,firstPayment=!store.list('subscriberPayments').some(p=>p.subscriberId===s.id&&!p.reversedAt);
  let credit=input.creditAmount!=null?money(input.creditAmount):amount,feePaid=0;
  // An unpaid installation fee is settled first; the rest goes to the package.
  if(s.installFeeDue>0){feePaid=Math.min(s.installFeeDue,credit);credit=money(credit-feePaid);s=store.put('subscribers',{...s,installFeeDue:money(s.installFeeDue-feePaid)},s);}
  let balance=money((s.balance||0)+credit),periods=0;
  if(plan.price>0)while(balance>=plan.price&&periods<24){balance=money(balance-plan.price);periods++;}else periods=1;
  if(periods){s=radius.renew(store,s.id,periods,now);}
  const lo=loyalty(store),earned=lo.enabled?Math.floor(amount/100*lo.pointsPer100):0;
  s=store.put('subscribers',{...s,balance,...(earned?{points:(s.points||0)+earned}:{})},s);
  const payment=store.put('subscriberPayments',{subscriberId:s.id,username:s.username,name:s.name,amount,reference,method,phone:String(input.phone||'').slice(0,20),note:(String(input.note||'')+(feePaid?` · installation fee KSh ${feePaid}`:'')).trim().replace(/^· /,'').slice(0,200),installFee:feePaid,planName:plan.name,planPrice:plan.price,planVersion:plan.version||1,periods,time:now,expiresAt:s.expiresAt,expiresBefore,walletBefore,walletAfter:balance,pointsEarned:earned});
  ledger.post(store,{subscriberId:s.id,type:'payment',amountMinor:ledger.minor(amount)-ledger.minor(feePaid),walletMinor:ledger.minor(balance)-ledger.minor(walletBefore),ref:reference,paymentId:payment.id,note:method+(periods?' · '+periods+' period(s) of '+plan.name:'')},now);
  // Referral: the customer who brought this one gets points when the new customer pays for the first time.
  if(firstPayment&&s.referredBy&&lo.enabled&&lo.referralPoints){const ref=store.list('subscribers').find(x=>x.username===s.referredBy&&x.id!==s.id);if(ref)addPoints(store,ref.id,lo.referralPoints,'Referred '+s.username,now);}
  if(feePaid)ledger.post(store,{subscriberId:s.id,type:'install-fee',amountMinor:ledger.minor(feePaid),ref:reference,paymentId:payment.id,note:'Installation fee'},now);
  return {payment,subscriber:s,periods,balance};
 });
}
const fill=(template,values)=>template.replace(/\{(\w+)\}/g,(m,k)=>values[k]??m);
function values(store,s,extra={}){const p=store.get('plans',s.planId);return {name:String(s.name||'').split(' ')[0],plan:p?.name||'',price:p?Number(p.price).toLocaleString('en-KE'):'',username:s.username,expiry:s.expiresAt?new Date(s.expiresAt).toLocaleString('en-KE',{timeZone:'Africa/Nairobi',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'',...extra};}
const FIELDS={apiKey:'api_key',senderId:'sender_id',phone:'phone',message:'message'};
function smsConfig(store){const c=store.secret('sms:config');if(!c)return {configured:false};
 return c.provider==='custom'?{provider:'custom',url:c.url,senderId:c.senderId||'',format:c.format,phoneFormat:c.phoneFormat,fields:c.fields,configured:true}:{provider:c.provider,username:c.username,senderId:c.senderId||'',sandbox:!!c.sandbox,configured:true};}
function setSmsConfig(store,input){const apiKey=String(input.apiKey||'').trim(),senderId=String(input.senderId||'').trim(),prior=store.secret('sms:config');
 if(senderId&&!/^[A-Za-z0-9 _-]{2,15}$/.test(senderId))fail('Sender ID is up to 15 letters or numbers');
 const keep=prior&&prior.provider===(input.provider==='custom'?'custom':'africastalking')?prior.apiKey:null;
 if(input.provider==='custom'){
  // Any HTTPS SMS gateway: URL, sender ID and API key as in ISPman's "Custom SMS API"; field names are adjustable.
  let url;try{url=new URL(String(input.url||'').trim());}catch{fail('Enter the SMS API URL');}if(url.protocol!=='https:'||url.username||url.password)fail('The SMS API URL must start with https://');
  if(!apiKey&&!keep)fail('Enter the SMS API key');
  const fields={};for(const [k,d] of Object.entries(FIELDS)){const v=String(input['field_'+k]??prior?.fields?.[k]??d).trim();if(!/^[A-Za-z0-9_.-]{1,40}$/.test(v))fail('Field names use letters, numbers, _ . -');fields[k]=v;}
  store.secret('sms:config',{provider:'custom',url:url.href,apiKey:apiKey||keep,senderId,format:input.format==='form'?'form':'json',phoneFormat:['254','+254','07'].includes(input.phoneFormat)?input.phoneFormat:'254',fields});return smsConfig(store);}
 const username=String(input.username||'').trim();
 if(!/^[A-Za-z0-9_-]{2,60}$/.test(username))fail("Enter your Africa's Talking username");if(!apiKey&&!keep)fail("Enter your Africa's Talking API key");
 store.secret('sms:config',{provider:'africastalking',username,apiKey:apiKey||keep,senderId,sandbox:input.sandbox===true||input.sandbox==='on'||username==='sandbox'});return smsConfig(store);}
function logSms(store,entry){const l=store.setting('smsLog')||{items:[]};l.items=[entry,...l.items].slice(0,LOG);store.setting('smsLog',l);}
const numberAs=(e164,format)=>format==='+254'?e164:format==='07'?'0'+e164.slice(4):e164.slice(1);
// Custom gateways answer in many shapes: HTTP 2xx without an explicit failure flag counts as sent; the reply is logged.
function customResult(r,text){let data=null;try{data=JSON.parse(text);}catch{}const flat=data&&typeof data==='object'?(Array.isArray(data)?data[0]||{}:Array.isArray(data.responses)?data.responses[0]:data):null;
 // BlessedTexts-style replies: status_code 1000 is the only success (1002 key, 1004 sender, 1007/1008 number, 1009 credit).
 if(flat&&flat.status_code!=null)return {status:r.ok&&String(flat.status_code)==='1000'?'sent':'failed',detail:('HTTP '+r.status+' · '+text.replace(/\s+/g,' ')).slice(0,200)};
 const failed=!r.ok||(flat&&(flat.success===false||flat.status===false||flat.error||/^(error|fail|failed|rejected)$/i.test(String(flat.status??''))||(flat['response-code']!=null&&String(flat['response-code'])!=='200')||(flat.code!=null&&/^[45]\d\d$/.test(String(flat.code)))))||(!flat&&/error|invalid|fail|insufficient/i.test(text));
 return {status:failed?'failed':'sent',detail:('HTTP '+r.status+' · '+text.replace(/\s+/g,' ')).slice(0,200)};}
// Send one SMS. Never throws for delivery problems; the result is logged.
async function sendSms(store,to,message,kind='manual',fetchImpl=fetch,now=Date.now()){
 const number=phone(to),c=store.secret('sms:config'),entry={time:now,to:number||String(to||'').slice(0,20),kind,message:message.slice(0,459),status:'failed',detail:''};
 try{
  if(!number)throw new Error('Not a Kenyan mobile number');if(!c)throw new Error('SMS is not set up');
  if(c.provider==='custom'){
   const f=c.fields||FIELDS,payload={[f.apiKey]:c.apiKey,[f.senderId]:c.senderId,[f.phone]:numberAs(number,c.phoneFormat),[f.message]:entry.message};
   const r=await fetchImpl(c.url,{method:'POST',headers:{Accept:'application/json','Content-Type':c.format==='form'?'application/x-www-form-urlencoded':'application/json'},body:c.format==='form'?new URLSearchParams(payload):JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   Object.assign(entry,customResult(r,await r.text()));
  }else{
   const body=new URLSearchParams({username:c.username,to:number,message:entry.message,...(c.senderId?{from:c.senderId}:{})});
   const r=await fetchImpl(c.sandbox?'https://api.sandbox.africastalking.com/version1/messaging':'https://api.africastalking.com/version1/messaging',{method:'POST',headers:{apiKey:c.apiKey,Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(15000)});
   const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw new Error('SMS provider returned HTTP '+r.status);}
   const rec=data?.SMSMessageData?.Recipients?.[0];if(!r.ok||!rec)throw new Error(data?.SMSMessageData?.Message||'SMS provider returned HTTP '+r.status);
   entry.status=/success|sent|queued/i.test(rec.status)?'sent':'failed';entry.detail=String(rec.status||'')+(rec.cost?' · '+rec.cost:'');
  }
 }catch(error){entry.detail=String(error.message||error).slice(0,200);}
 logSms(store,entry);return entry;
}
// Collector job: reminders before expiry and an "expired" notice, once each per subscriber and expiry date.
async function runReminders(store,now=Date.now(),fetchImpl=fetch){
 const cfg=settings(store);if(!store.secret('sms:config'))return {sent:0,skipped:'not configured'};
 const hour=Number(new Date(now).toLocaleString('en-GB',{timeZone:'Africa/Nairobi',hour:'2-digit',hour12:false})),quiet=hour<cfg.sendFrom||hour>=cfg.sendUntil;
 const plans=new Map(store.list('plans').map(p=>[p.id,p]));if(quiet&&![...plans.values()].some(p=>p.notices?.expired||p.notices?.before?.length||p.notices?.usage?.length))return {sent:0,skipped:'quiet hours'};
 const done=store.setting('smsReminders')||{keys:[]},known=new Set(done.keys);let sent=0;
 for(const s of store.list('subscribers')){
  if(s.status!=='active'||s.expiresAt==null||!phone(s.phone))continue;const left=s.expiresAt-now,pn=plans.get(s.planId)?.notices;let kind=null,key=null;
  // Packages with their own notices (minutes before expiry, on expiry) use them at any hour; the expiry is imminent.
  if(pn&&(pn.expired||pn.before?.length||pn.usage?.length)){
   if(left<=0&&left>-15*60000&&pn.expired){kind='expired';key=`${s.id}:${s.expiresAt}:expired`;}
   else if(left>0){const m=pn.before.find(x=>left<=x*60000);if(m){kind='reminder';key=`${s.id}:${s.expiresAt}:m${m}`;}}
  }
  else if(quiet)continue;
  else if(left<=0&&left>-2*DAY&&cfg.enabled.expired){kind='expired';key=`${s.id}:${s.expiresAt}:expired`;}
  else if(left>0&&cfg.enabled.reminder){const day=cfg.reminderDays.find(d=>left<=d*DAY&&left>(d-1)*DAY);if(day){kind='reminder';key=`${s.id}:${s.expiresAt}:${day}`;}}
  // Fair-usage progress (50/80/100% of the download cap), once per threshold per paid period.
  if(!kind&&pn?.usage?.length&&left>0){const p=plans.get(s.planId),st=require('./packages.cjs').fupState(store,s,p,require('./radius.cjs').planMs(p),now);if(st.percent!=null){const hit=[...pn.usage].reverse().find(x=>st.percent>=x);const periodKey=p.fup.period==='daily'?new Date(now+3*36e5).toISOString().slice(0,10):s.expiresAt;
   if(hit){const k=`${s.id}:${periodKey}:u${hit}`;if(!known.has(k)){known.add(k);done.keys=[...known].slice(-20000);store.setting('smsReminders',done);await sendSms(store,s.phone,`Hi ${String(s.name||'').split(' ')[0]}, you have used ${hit}% of your ${p.name} data${hit>=100?'; your speed is now reduced until your next period':''}. Kade Networks`,'usage',fetchImpl,now);sent++;}}}}
  if(!kind||known.has(key))continue;
  // Mark before sending so a slow provider can never cause a duplicate on the next loop.
  known.add(key);done.keys=[...known].slice(-20000);store.setting('smsReminders',done);
  const msg=fill(cfg.templates[kind],values(store,s));await sendSms(store,s.phone,msg,kind,fetchImpl,now);sent++;
  require('./email.cjs').copy(store,s,kind==='expired'?'Your internet has expired':'Your internet expires soon',msg,kind,fetchImpl).catch(()=>{});
 }
 return {sent};
}
async function receipt(store,result,fetchImpl=fetch){const cfg=settings(store);if(!cfg.enabled.payment)return null;const msg=fill(cfg.templates.payment,values(store,result.subscriber,{amount:Number(result.payment.amount).toLocaleString('en-KE'),reference:result.payment.reference}));
 require('./email.cjs').copy(store,result.subscriber,'Payment received: KSh '+Number(result.payment.amount).toLocaleString('en-KE'),msg+'\n\nReceipt reference: '+result.payment.reference,'payment',fetchImpl).catch(()=>{});
 if(!store.secret('sms:config')||!phone(result.subscriber.phone))return null;return sendSms(store,result.subscriber.phone,msg,'payment',fetchImpl);}
// Payments list, newest first, with what ISPman shows beside each: service, the customer's router and the channel.
function paymentRows(store){const subs=new Map(store.list('subscribers').map(x=>[x.id,x])),routers=new Map(store.list('devices').map(d=>[d.id,d.name])),rOf=require('./compensation.cjs').routerOf(store),m=require('./mpesa.cjs').publicConfig(store);
 const short=m.configured?(m.type==='till'?'Till '+(m.till||m.shortcode):'Paybill '+m.shortcode):'';
 return store.list('subscriberPayments').sort((a,b)=>(b.time||b.created)-(a.time||a.created)).slice(0,500).map(p=>{const s=subs.get(p.subscriberId),note=String(p.note||'');
  const provider=p.method==='card'?'Card (Paystack)':p.method==='mpesa'?(/^Paybill/.test(note)?(short||'M-Pesa paybill'):/^Portal/.test(note)?'M-Pesa prompt (WiFi page)'+(short?' · '+short:''):'M-Pesa'):p.method==='cash'?'Cash':p.method==='bank'?'Bank':p.method||'';
  return {...p,service:s?.service||'',router:routers.get(s?.routerId)||routers.get(rOf.get(p.username))||'',provider};});}
function overview(store){return {payments:paymentRows(store),sms:{config:smsConfig(store),log:(()=>{const byPhone=new Map();for(const x of store.list('subscribers')){const n=phone(x.phone);if(n&&!byPhone.has(n))byPhone.set(n,x);}return (store.setting('smsLog')?.items||[]).slice(0,300).map(l=>{const c=byPhone.get(phone(l.to));return c?{...l,customer:{id:c.id,name:c.name,username:c.username,service:c.service}}:l;});})()},settings:settings(store)};}
module.exports={addPoints,loyalty,setLoyalty,redeemPoints,pay,phone,sendSms,runReminders,receipt,overview,settings,updateSettings,smsConfig,setSmsConfig,fill,values,TEMPLATES};
