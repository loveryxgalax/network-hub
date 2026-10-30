'use strict';
// Network assistant: answers staff questions about the network from a snapshot of netops data, using Claude through
// the owner's own Anthropic API key. It only reads; it cannot change anything. Customer phone numbers, emails,
// passwords and payment references are never included in the snapshot.
const Anthropic=require('@anthropic-ai/sdk').default||require('@anthropic-ai/sdk');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const MODEL='claude-opus-5-5',EFFORTS=['low','medium','high'];
function config(store){return store.secret('assistant:config');}
function publicConfig(store){const c=config(store);return c?{configured:true,model:MODEL,effort:c.effort}:{configured:false,model:MODEL};}
function setConfig(store,input){const prior=config(store)||{},apiKey=String(input.apiKey||'').trim()||prior.apiKey;if(!apiKey||!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey))fail('Paste an Anthropic API key (starts with sk-ant-)');
 store.secret('assistant:config',{apiKey,effort:EFFORTS.includes(input.effort)?input.effort:prior.effort||'medium'});return publicConfig(store);}
// What the assistant knows: equipment state, open alerts, account counts, packages, recent jobs. No personal contact data.
function snapshot(store,stateOf,now=Date.now()){
 const devices=store.list('devices').map(d=>({name:d.name,type:d.type,status:d.status,lastSeen:d.lastSeen?new Date(d.lastSeen).toISOString():null,error:d.lastError||undefined,model:d.metrics?.model||undefined,cpu:d.metrics?.cpu??undefined,power:d.type==='onu'?d.metrics?.power:undefined})).slice(0,300);
 const alerts=store.list('alerts').filter(a=>a.status!=='Resolved').slice(0,50).map(a=>({title:a.title,severity:a.severity,status:a.status,since:new Date(a.created).toISOString(),details:String(a.details||'').slice(0,200)}));
 const subs=store.list('subscribers'),counts={};for(const s of subs){const k=s.service+':'+stateOf(s,now);counts[k]=(counts[k]||0)+1;}
 const sessions=store.sessionsSince(now-15*60000).filter(x=>!x.stoppedAt&&now-x.updatedAt<15*60000),byNas={};for(const x of sessions){const k=x.nasName||x.nas;byNas[k]=(byNas[k]||0)+1;}
 const plans=store.list('plans').map(p=>({name:p.name,service:p.service,price:p.price,downMbps:p.downloadMbps,upMbps:p.uploadMbps,customers:subs.filter(s=>s.planId===p.id).length}));
 const jobs=store.list('jobs').filter(j=>j.status!=='Done').slice(0,30).map(j=>({title:j.title,type:j.type,priority:j.priority,status:j.status,due:j.due}));
 const day=864e5,pays=store.list('subscriberPayments').filter(p=>!p.reversedAt&&now-(p.time||p.created)<30*day),revenue={last24h:0,last7d:0,last30d:0};for(const p of pays){const age=now-(p.time||p.created);revenue.last30d+=p.amount;if(age<7*day)revenue.last7d+=p.amount;if(age<day)revenue.last24h+=p.amount;}
 return {generatedAt:new Date(now).toISOString(),timezone:'Africa/Nairobi',devices,openAlerts:alerts,customersByServiceAndState:counts,onlineSessionsByRouter:byNas,packages:plans,openWorkOrders:jobs,revenueKES:revenue};}
const SYSTEM=`You are the network operations assistant inside Kade Networks netops, an ISP management system for a Kenyan internet provider (MikroTik routers, OLTs/ONUs, PPPoE and hotspot customers, M-Pesa payments).
Answer staff questions using only the JSON snapshot in the first user message; it is the current state of their network. If the snapshot does not contain what is needed, say what is missing and where in netops to look (for example the Monitor view of a device, Reports, or the customer profile).
You cannot change anything and must not claim to have done so. When you suggest an action, say which netops page or MikroTik/OLT step does it, and point out anything that would disconnect customers or reboot equipment so a person can decide.
Be concise and practical: short paragraphs or a short list, figures with units, KES for money. Do not invent device names, numbers or customer details.`;
// history: [{role:'user'|'assistant', text}] from the page, newest last; the last entry is the new question.
async function ask(store,stateOf,history,{client}={}){const c=config(store);if(!c)fail('Add an Anthropic API key under Assistant settings first',409);
 const turns=(Array.isArray(history)?history:[]).filter(t=>t&&['user','assistant'].includes(t.role)&&typeof t.text==='string'&&t.text.trim()).slice(-12).map(t=>({role:t.role,content:t.text.slice(0,4000)}));
 if(!turns.length||turns.at(-1).role!=='user')fail('Ask a question');while(turns.length&&turns[0].role!=='user')turns.shift();
 const messages=[{role:'user',content:'Network snapshot (JSON):\n'+JSON.stringify(snapshot(store,stateOf))},{role:'assistant',content:'I have the snapshot. What would you like to know?'},...turns];
 const api=client||new Anthropic({apiKey:c.apiKey,maxRetries:2,timeout:120000});
 let response;try{response=await api.beta.messages.create({model:MODEL,max_tokens:16000,system:SYSTEM,output_config:{effort:c.effort||'medium'},betas:['server-side-fallback-2026-07-01'],fallbacks:'default',messages});}
 catch(e){if(e instanceof Anthropic.AuthenticationError)fail('The Anthropic API key was rejected. Check it under Assistant settings.',502);if(e instanceof Anthropic.RateLimitError)fail('The assistant is busy (rate limited). Try again in a minute.',503);if(e instanceof Anthropic.BadRequestError)fail('The assistant could not take this request: '+e.message,502);if(e instanceof Anthropic.APIError)fail('The assistant is unavailable right now ('+e.status+').',502);fail('Could not reach the assistant: '+e.message,502);}
 if(response.stop_reason==='refusal')return {text:'The assistant declined to answer this question.',refused:true,model:response.model};
 const text=response.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
 return {text:text||'(No answer was returned.)',truncated:response.stop_reason==='max_tokens',model:response.model,usage:{input:response.usage?.input_tokens||0,output:response.usage?.output_tokens||0}};}
module.exports={MODEL,config,publicConfig,setConfig,snapshot,ask};
