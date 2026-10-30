'use strict';
// System logs: one place for things that went wrong (router changes that failed, payments that did not go through,
// SMS and email that were not delivered, payouts that failed), each with what it was about and an Acknowledge button.
// Entries are built from the records netops already keeps; acknowledging only stores who and when.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const DAY=864e5,KEEP=30*DAY,CATS=['STATICS','HOTSPOT','PPPOE','ROUTER','PAYMENTS','PAYOUTS','SMS','EMAIL'];
const mask=p=>{const s=String(p||'');return s.length>6?s.slice(0,4)+'•••'+s.slice(-3):s;};
const JOB={'static-apply':p=>({cat:'STATICS',title:p.enabled==='no'?'Static Disconnected Failed':'Static Connected Failed',what:(p.enabled==='no'?'disconnect':'connect')+' static client '+p.ip,action:p.enabled==='no'?'disconnected':'connected',key:{ip:p.ip}}),
 'static-remove':p=>({cat:'STATICS',title:'Static Remove Failed',what:'remove static client '+p.ip,action:'removed',key:{ip:p.ip}}),
 connect:p=>({cat:'HOTSPOT',title:'Hotspot Connect Failed',what:'connect hotspot device '+p.mac,action:'connected',key:{mac:p.mac}}),
 'reset-device':p=>({cat:'HOTSPOT',title:'Hotspot Reset Failed',what:'reset hotspot device '+p.mac,action:'reset',key:{mac:p.mac}}),
 disconnect:p=>({cat:'PPPOE',title:'Disconnect Failed',what:'disconnect '+p.username,action:'disconnected',key:{username:p.username}}),
 'set-speed':p=>({cat:'PPPOE',title:'Speed Change Failed',what:'change the speed of '+p.username,action:'set-speed',key:{username:p.username,rate:p.rate}})};
function entries(store,now=Date.now()){const out=[],subs=new Map(store.list('subscribers').map(s=>[s.id,s])),routers=new Map(store.list('devices').map(d=>[d.id,d.name]));
 for(const j of store.list('routerJobs')){const t=j.finishedAt||j.updatedAt||j.createdAt;if(now-t>KEEP)continue;const failed=j.status==='failed',retrying=j.status==='queued'&&j.attempts>0&&j.error;if(!failed&&!retrying)continue;
  const m=JOB[j.type]?.(j.params||{})||{cat:'ROUTER',title:(j.type||'Router job').replace(/(^|-)\w/g,x=>x.replace('-',' ').toUpperCase())+' Failed',what:'run "'+j.type+'"',action:j.type,key:{}},s=j.subscriberId&&subs.get(j.subscriberId),router=routers.get(j.routerId)||j.routerName||'the router';
  out.push({id:'job:'+j.id+':'+j.status,time:t,level:failed?'error':'warning',category:m.cat,title:retrying?m.title.replace(' Failed',' Retrying'):m.title,message:`Failed to ${m.what} on ${router}${j.error?': '+String(j.error).slice(0,200):''}${retrying?` (attempt ${j.attempts} of ${j.maxAttempts}; trying again)`:''}`,
   principal:s?{type:'Customer',id:s.id,name:s.name}:{type:'Router',id:j.routerId,name:router},details:{action:m.action,...m.key,router,attempts:j.attempts},link:'#router-jobs'});}
 for(const p of store.list('portalPayments')){if(p.status!=='failed')continue;const t=p.updatedAt||p.createdAt;if(now-t>KEEP)continue;
  out.push({id:'pay:'+p.id,time:t,level:/cancel/i.test(p.reason||'')?'info':'warning',category:'PAYMENTS',title:'Payment Not Completed',message:`KSh ${p.amount} from ${mask(p.phone)}: ${p.reason||'failed'}`,principal:{type:'Payment',id:p.id,name:mask(p.phone)},details:{amount:p.amount,method:p.paystackRef?'card':'mpesa',plan:p.planName||p.planId||''},link:'#hs-requests'});}
 for(const x of store.list('payouts')){if(x.status!=='failed'||x.error==='Cancelled')continue;const t=x.history?.at(-1)?.at||x.requestedAt;if(now-t>KEEP)continue;
  out.push({id:'payout:'+x.id,time:t,level:'error',category:'PAYOUTS',title:'Payout Failed',message:`KSh ${(x.amountMinor||0)/100} to ${mask(x.to)}: ${x.error||'failed'}`,principal:{type:'Payout',id:x.id,name:x.reason||x.kind||''},details:{amount:(x.amountMinor||0)/100,method:x.method},link:'#pay-payouts'});}
 for(const [i,e] of (store.setting('smsLog')?.items||[]).entries()){if(e.status!=='failed'||now-e.time>KEEP)continue;out.push({id:'sms:'+e.time+':'+i%1000+':'+String(e.to).slice(-4),time:e.time,level:'warning',category:'SMS',title:'SMS Not Sent',message:`${e.kind||'SMS'} to ${mask(e.to)}: ${e.detail||'failed'}`,principal:{type:'Phone',id:'',name:mask(e.to)},details:{kind:e.kind},link:'#comms-sms'});}
 for(const [i,e] of (store.setting('emailLog')?.items||[]).entries()){if(e.status!=='failed'||now-e.time>KEEP)continue;out.push({id:'mail:'+e.time+':'+i%1000,time:e.time,level:'warning',category:'EMAIL',title:'Email Not Sent',message:`${e.subject||'Email'} to ${e.to}: ${e.error||'failed'}`,principal:{type:'Email',id:'',name:e.to},details:{kind:e.kind},link:'#comms-email'});}
 const ack=store.setting('syslogAck')||{};for(const e of out)e.ack=ack[e.id]||null;
 return out.sort((a,b)=>b.time-a.time);}
function list(store,q={},now=Date.now()){let items=entries(store,now);const unacked=items.filter(e=>!e.ack&&e.level!=='info').length;
 if(q.level)items=items.filter(e=>e.level===q.level);if(q.category)items=items.filter(e=>e.category===q.category);if(q.status==='open')items=items.filter(e=>!e.ack);if(q.status==='acknowledged')items=items.filter(e=>e.ack);
 if(q.q){const t=String(q.q).toLowerCase();items=items.filter(e=>(e.title+' '+e.message+' '+(e.principal?.name||'')+' '+JSON.stringify(e.details)).toLowerCase().includes(t));}
 return {items:items.slice(0,500),total:items.length,unacknowledged:unacked,categories:CATS};}
function acknowledge(store,ids,user,now=Date.now()){const list=(Array.isArray(ids)?ids:[ids]).map(String).filter(x=>/^[\w:.-]{3,120}$/.test(x)).slice(0,1000);if(!list.length)fail('Nothing to acknowledge');
 const ack=store.setting('syslogAck')||{};for(const id of list)ack[id]={at:now,by:user?.email||'system'};
 // Keep the newest 5000 acknowledgements; older entries have aged out of the log anyway.
 const keep=Object.entries(ack).sort((a,b)=>b[1].at-a[1].at).slice(0,5000);store.setting('syslogAck',Object.fromEntries(keep));return {acknowledged:list.length};}
module.exports={entries,list,acknowledge,CATS};
