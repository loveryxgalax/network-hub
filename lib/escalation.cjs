'use strict';
// Alert escalation: an alert that is still Open (not acknowledged or resolved) after a delay is sent to the people
// on that level by SMS and/or email. Up to three levels with growing delays; each level fires once per alert.
const billing=require('./billing.cjs'),email=require('./email.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const SEV=['info','warning','critical'];
function settings(store){const s=store.setting('alertEscalation')||{};return {enabled:s.enabled===true,levels:Array.isArray(s.levels)?s.levels:[]};}
function save(store,input){const levels=(Array.isArray(input.levels)?input.levels:[]).filter(l=>l&&(l.sms||l.email)).slice(0,3).map((l,i)=>{
  const after=Math.round(Number(l.afterMinutes));if(!(after>=1&&after<=1440))fail(`Level ${i+1}: delay must be 1–1440 minutes`);
  const list=v=>(Array.isArray(v)?v:String(v||'').split(/[,\s]+/)).map(x=>String(x).trim()).filter(Boolean);
  const sms=list(l.sms).map(p=>billing.phone(p)||fail(`Level ${i+1}: ${p} is not a phone number`)),mails=list(l.email).map(e=>email.EMAIL.test(e)?e.toLowerCase():fail(`Level ${i+1}: ${e} is not an email address`));
  const minSeverity=SEV.includes(l.minSeverity)?l.minSeverity:'warning';if(!sms.length&&!mails.length)fail(`Level ${i+1}: add a phone or an email`);return {afterMinutes:after,minSeverity,sms:sms.slice(0,5),email:mails.slice(0,5)};});
 for(let i=1;i<levels.length;i++)if(levels[i].afterMinutes<=levels[i-1].afterMinutes)fail('Each level must wait longer than the one before');
 return store.setting('alertEscalation',{enabled:input.enabled===true||input.enabled==='on',levels});}
async function run(store,now=Date.now(),fetchImpl=fetch){const cfg=settings(store);if(!cfg.enabled||!cfg.levels.length)return {sent:0};let sent=0;
 const mt=require('./maintenance.cjs');
 for(const a of store.list('alerts')){if(a.status!=='Open')continue;if(a.deviceId&&mt.quiet(store,a.deviceId,now))continue;const age=now-(a.created||now),done={...(a.escalations||{})};
  for(const [i,l] of cfg.levels.entries()){if(done[i]||age<l.afterMinutes*60000||SEV.indexOf(a.severity||'warning')<SEV.indexOf(l.minSeverity))continue;
   done[i]=now;const mins=Math.round(age/60000),text=`[${String(a.severity||'warning').toUpperCase()}] ${a.title} — open for ${mins} min and not acknowledged.${a.details?' '+String(a.details).slice(0,200):''} Kade Networks netops`;
   // Mark first so a slow provider never causes a repeat.
   const cur=store.get('alerts',a.id);if(!cur)break;store.put('alerts',{...cur,escalations:done},cur);
   for(const p of l.sms){try{await billing.sendSms(store,p,text.slice(0,459),'alert',fetchImpl,now);sent++;}catch{}}
   for(const e of l.email){try{if((await email.send(store,e,'Alert not acknowledged: '+a.title,text,'alert',fetchImpl,now)).ok)sent++;}catch{}}}}
 // People who were told about an alert are told once when it is resolved (ISPman's "back online" message).
 for(const a of store.list('alerts')){if(a.status!=='Resolved'||!a.escalations||a.resolvedNotified)continue;const cur=store.get('alerts',a.id);if(!cur)continue;store.put('alerts',{...cur,resolvedNotified:now},cur);
  if(now-(a.updated||now)>6*36e5)continue;const mins=Math.round((now-(a.created||now))/60000),text=`[RESOLVED] ${a.title} — back to normal after about ${mins} min. Kade Networks netops`;
  for(const i of Object.keys(a.escalations)){const l=cfg.levels[i];if(!l)continue;for(const p of l.sms){try{await billing.sendSms(store,p,text,'alert',fetchImpl,now);sent++;}catch{}}for(const e of l.email){try{if((await email.send(store,e,'Resolved: '+a.title,text,'alert',fetchImpl,now)).ok)sent++;}catch{}}}}
 return {sent};}
module.exports={settings,save,run};
