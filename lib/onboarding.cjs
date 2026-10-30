'use strict';
// New-customer pipeline: Lead → Site survey → Installation scheduled → Installed → Completed (or Lost).
// Scheduling creates an installation work order; completing needs a real customer account, created from the lead.
const crypto=require('node:crypto'),radius=require('./radius.cjs'),billing=require('./billing.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const STAGES=['lead','survey','scheduled','installed','completed','lost'];
const LABELS={lead:'Leads',survey:'Site survey',scheduled:'Installation scheduled',installed:'Installed',completed:'Completed',lost:'Lost'};
const txt=(v,max=200)=>String(v??'').trim().slice(0,max);
function clean(store,v,existing={}){const name=txt(v.name??existing.name,120);if(!name)fail('Enter the name');
 const phone=txt(v.phone??existing.phone,30);if(phone&&!billing.phone(phone))fail('Enter a valid phone number');
 const service=['pppoe','static','hotspot'].includes(v.service??existing.service)?(v.service??existing.service):'pppoe';
 const planId=txt(v.planId??existing.planId,64);if(planId&&!store.get('plans',planId))fail('Package not found');
 const date=k=>{const x=v[k]===undefined?existing[k]:v[k];if(x===''||x==null)return null;const t=typeof x==='number'?x:Date.parse(x);if(!Number.isFinite(t))fail('Invalid '+k);return t;};
 const lat=v.latitude??existing.latitude,lng=v.longitude??existing.longitude;
 return {name,phone,email:txt(v.email??existing.email,120),location:txt(v.location??existing.location,200),latitude:lat===''||lat==null?null:Number(lat),longitude:lng===''||lng==null?null:Number(lng),service,planId,routerId:txt(v.routerId??existing.routerId,64),
  source:txt(v.source??existing.source,60),notes:txt(v.notes??existing.notes,2000),assigneeId:txt(v.assigneeId??existing.assigneeId,64),surveyAt:date('surveyAt'),installAt:date('installAt'),installFee:v.installFee===undefined?existing.installFee??null:(v.installFee===''?null:Number(v.installFee))};}
function create(store,v,user,now=Date.now()){const c=clean(store,v);return store.put('onboarding',{...c,stage:'lead',history:[{at:now,by:user?.email||null,stage:'lead'}],createdBy:user?.email||null});}
function update(store,id,v,user,now=Date.now()){return store.transaction(()=>{const x=store.get('onboarding',id);if(!x)fail('Not found',404);if(v.version!==undefined&&v.version!==x.version)fail('This card changed. Reload before saving',409);
 const next=v.stage&&v.stage!==x.stage?v.stage:null;let out={...x,...clean(store,v,x)};
 if(next){if(!STAGES.includes(next))fail('Unknown stage');
  if(next==='scheduled'&&!out.installAt)fail('Set the installation date first');
  if(next==='completed'&&!out.subscriberId)fail('Create the customer account first');
  if(next==='lost'){const why=txt(v.lostReason,160);if(why.length<3)fail('Say why the lead was lost');out.lostReason=why;}
  if(next==='scheduled'&&!out.jobId){const job=store.put('jobs',{title:'Installation: '+out.name,type:'Installation',priority:'Normal',customer:out.name,phone:out.phone,address:out.location,details:out.notes,assigneeId:out.assigneeId,due:new Date(out.installAt+3*36e5).toISOString().slice(0,10),status:'Open'});out.jobId=job.id;}
  out.stage=next;out.history=[...(x.history||[]),{at:now,by:user?.email||null,stage:next}].slice(-30);}
 return store.put('onboarding',out,x);});}
// Make the real customer account from the lead. Returns the one-time PPPoE password.
function convert(store,id,v,user){return store.transaction(()=>{const x=store.get('onboarding',id);if(!x)fail('Not found',404);if(x.subscriberId&&store.get('subscribers',x.subscriberId))fail('Already a customer',409);
 if(!x.planId)fail('Choose the package first');const username=txt(v.username,64).toLowerCase()||x.name.toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,12)+crypto.randomInt(100,999);
 const input={name:x.name,username,phone:x.phone,email:x.email,service:x.service,planId:x.planId,routerId:x.routerId,expiresAt:Date.now(),paidEver:false,staticIp:v.staticIp,mac:v.mac,installFee:x.installFee==null?'':x.installFee};
 const s=store.put('subscribers',{...radius.subscriber(store,input),paidEver:false,onboardingId:x.id,location:x.location,latitude:x.latitude,longitude:x.longitude});
 const password=x.service==='static'?null:radius.setPassword(store,s.id,v.password||undefined);
 store.put('onboarding',{...x,subscriberId:s.id,history:[...(x.history||[]),{at:Date.now(),by:user?.email||null,stage:x.stage,note:'Customer account '+s.username}]},x);return {subscriber:s,password};});}
function board(store){const items=store.list('onboarding').sort((a,b)=>(a.installAt||a.created)-(b.installAt||b.created));return {stages:STAGES.map(k=>({key:k,label:LABELS[k],items:items.filter(i=>i.stage===k)}))};}
module.exports={STAGES,LABELS,create,update,convert,board};
