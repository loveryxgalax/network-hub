'use strict';
// Bulk email to customers (ISPman's E-Mails → Send): audiences combine as "any of" (union), each address gets one
// email, customers without a valid address are counted and skipped, and every recipient's result is kept.
const email=require('./email.cjs'),radius=require('./radius.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const AUDIENCES={all:'All customers',pppoe:'PPPoE customers',hotspot:'Hotspot customers',static:'Static IP customers',active:'Active customers','active-pppoe':'Active PPPoE customers','active-hotspot':'Active hotspot customers',inactive:'Inactive customers','inactive-pppoe':'Inactive PPPoE customers','inactive-hotspot':'Inactive hotspot customers'};
const VARS=['CUSTOMER_NAME','ISP_NAME','PACKAGE_NAME','PACKAGE_SPEED_UP','PACKAGE_SPEED_DOWN','PACKAGE_PRICE','PACKAGE_EXPIRY_DATE','ACCOUNT'];
function matches(key,s,now){const active=radius.stateOf(s,now)==='active',[a,b]=key.split('-');
 if(key==='all')return true;if(['pppoe','hotspot','static'].includes(key))return s.service===key;if(a==='active')return active&&(!b||s.service===b);if(a==='inactive')return !active&&(!b||s.service===b);return false;}
function values(store,s){const p=store.get('plans',s.planId),ws=store.setting('workspace')||{};return {CUSTOMER_NAME:String(s.name||'').trim(),ISP_NAME:ws.name||'Kade Networks',PACKAGE_NAME:p?.name||'',PACKAGE_SPEED_UP:p?p.uploadMbps+' Mbps':'',PACKAGE_SPEED_DOWN:p?p.downloadMbps+' Mbps':'',PACKAGE_PRICE:p?'KSh '+Number(p.price).toLocaleString('en-KE'):'',PACKAGE_EXPIRY_DATE:s.expiresAt?new Date(s.expiresAt).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Nairobi'}):'',ACCOUNT:s.username||''};}
const fill=(t,v)=>String(t).replace(/\{([A-Z_]+)\}/g,(m,k)=>k in v?v[k]:m);
function check(subject,body){subject=String(subject||'').trim();body=String(body||'').trim();if(!subject||subject.length>160)fail('Write a subject (up to 160 characters)');if(!body||body.length>20000)fail('Write the message');
 const unknown=[...new Set([...(subject+body).matchAll(/\{([A-Z_]+)\}/g)].map(m=>m[1]).filter(k=>!VARS.includes(k)))];if(unknown.length)fail('Unknown field: {'+unknown.join('}, {')+'}. Use: {'+VARS.join('}, {')+'}');return {subject,body};}
function recipients(store,{audiences=[],subscriberIds=[]},now=Date.now()){const keys=(Array.isArray(audiences)?audiences:[]).filter(k=>AUDIENCES[k]),ids=new Set(Array.isArray(subscriberIds)?subscriberIds.map(String):[]);
 if(!keys.length&&!ids.size)fail('Choose who gets it');const chosen=store.list('subscribers').filter(s=>!s.parentId&&(ids.has(s.id)||keys.some(k=>matches(k,s,now))));const seen=new Set(),out=[];let noEmail=0;
 for(const s of chosen){const e=String(s.email||'').trim().toLowerCase();if(!email.EMAIL.test(e)){noEmail++;continue;}if(seen.has(e))continue;seen.add(e);out.push({s,email:e});}
 return {list:out,chosen:chosen.length,noEmail,duplicates:chosen.length-noEmail-out.length};}
function preview(store,input){const m=check(input.subject,input.body),r=recipients(store,input);
 return {count:r.list.length,chosen:r.chosen,noEmail:r.noEmail,duplicates:r.duplicates,sample:r.list.slice(0,3).map(({s,email:e})=>{const v=values(store,s);return {name:s.name,email:e,subject:fill(m.subject,v),text:fill(m.body,v)};})};}
// Starts a send; the caller runs deliver() in the background. confirm must equal the previewed count.
function start(store,input,user,now=Date.now()){if(!email.config(store))fail('Set up the email provider first',409);const m=check(input.subject,input.body),r=recipients(store,input,now);
 if(!r.list.length)fail('Nobody chosen has an email address');if(r.list.length>2000)fail('Up to 2,000 recipients per send');if(Number(input.confirm)!==r.list.length)fail('The recipient list changed. Check it again.',409);
 return store.put('mailouts',{subject:m.subject,body:m.body,audiences:(input.audiences||[]).filter(k=>AUDIENCES[k]),subscriberCount:(input.subscriberIds||[]).length,status:'sending',createdAt:now,createdBy:user?.name||'',total:r.list.length,sent:0,failed:0,
  recipients:r.list.map(({s,email:e})=>({subscriberId:s.id,name:s.name,email:e,status:'pending'}))});}
async function deliver(store,id,fetchImpl=fetch){let job=store.get('mailouts',id);if(!job)return;
 for(let i=0;i<job.recipients.length;i++){const rc=job.recipients[i];if(rc.status!=='pending')continue;const s=store.get('subscribers',rc.subscriberId),v=s?values(store,s):{};
  const r=await email.send(store,rc.email,fill(job.subject,v),fill(job.body,v),'bulk',fetchImpl);job=store.get('mailouts',id);const recs=[...job.recipients];recs[i]={...rc,status:r.ok?'sent':'failed',error:r.ok?undefined:String(r.error||'').slice(0,160),time:Date.now()};
  job=store.put('mailouts',{...job,recipients:recs,sent:recs.filter(x=>x.status==='sent').length,failed:recs.filter(x=>x.status==='failed').length},job);}
 store.put('mailouts',{...job,status:'done',finishedAt:Date.now()},job);}
function list(store){return store.list('mailouts').slice(0,50).map(({recipients,body,...m})=>m);}
function templates(store){return store.setting('emailTemplates')?.items||[];}
function saveTemplate(store,input){const name=String(input.name||'').trim();if(!name||name.length>60)fail('Name the template (up to 60 characters)');const m=check(input.subject,input.body),items=templates(store).filter(t=>t.name.toLowerCase()!==name.toLowerCase());
 const t={id:require('node:crypto').randomUUID(),name,description:String(input.description||'').trim().slice(0,160),...m,updated:Date.now()};store.setting('emailTemplates',{items:[t,...items].slice(0,100)});return t;}
function deleteTemplate(store,id){const items=templates(store);if(!items.some(t=>t.id===id))fail('Template not found',404);store.setting('emailTemplates',{items:items.filter(t=>t.id!==id)});}
module.exports={AUDIENCES,VARS,preview,start,deliver,list,templates,saveTemplate,deleteTemplate,fill,values};
