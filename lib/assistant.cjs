'use strict';
// Network assistant: answers staff questions about the network from a snapshot of netops data, using the owner's own
// API key with one of three providers: Claude (Anthropic), DeepSeek, or OpenRouter (which lists some models free of
// charge, with tight rate limits). It only reads; it cannot change anything. Customer phone numbers, emails,
// passwords and payment references are never included in the snapshot.
const Anthropic=require('@anthropic-ai/sdk').default||require('@anthropic-ai/sdk');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const MODEL='claude-opus-5-5',EFFORTS=['low','medium','high'];
// DeepSeek and OpenRouter both speak the OpenAI chat-completions format.
const PROVIDERS={
 anthropic:{label:'Claude (Anthropic)',key:/^sk-ant-[A-Za-z0-9_-]{20,}$/,keyHint:'an Anthropic API key (starts with sk-ant-)',model:MODEL},
 deepseek:{label:'DeepSeek',key:/^sk-[A-Za-z0-9]{20,}$/,keyHint:'a DeepSeek API key (starts with sk-)',model:'deepseek-chat',url:'https://api.deepseek.com/chat/completions'},
 openrouter:{label:'OpenRouter',key:/^sk-or-[A-Za-z0-9_-]{20,}$/,keyHint:'an OpenRouter API key (starts with sk-or-)',model:'deepseek/deepseek-chat-v3-0324:free',url:'https://openrouter.ai/api/v1/chat/completions'}};
function config(store){const c=store.secret('assistant:config');return c?{provider:'anthropic',...c}:null;}
const modelOf=c=>c.provider==='anthropic'?MODEL:(c.model||PROVIDERS[c.provider].model);
function publicConfig(store){const c=config(store);return c?{configured:true,provider:c.provider,model:modelOf(c),effort:c.effort}:{configured:false,provider:'anthropic',model:MODEL};}
function setConfig(store,input){const prior=config(store)||{},provider=PROVIDERS[input.provider]?input.provider:prior.provider||'anthropic',P=PROVIDERS[provider];
 // A blank key keeps the saved one only while the provider stays the same.
 const apiKey=String(input.apiKey||'').trim()||(prior.provider===provider?prior.apiKey:'');if(!apiKey||!P.key.test(apiKey))fail('Paste '+P.keyHint);
 const model=provider==='anthropic'?undefined:(String(input.model||'').trim()||P.model);if(model&&!/^[A-Za-z0-9._:\/-]{2,100}$/.test(model))fail('Invalid model name');
 store.secret('assistant:config',{provider,apiKey,model,effort:EFFORTS.includes(input.effort)?input.effort:prior.effort||'medium'});return publicConfig(store);}
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
async function ask(store,stateOf,history,{client,fetchImpl=fetch}={}){const c=config(store);if(!c)fail('Add an API key under Assistant settings first',409);
 const turns=(Array.isArray(history)?history:[]).filter(t=>t&&['user','assistant'].includes(t.role)&&typeof t.text==='string'&&t.text.trim()).slice(-12).map(t=>({role:t.role,content:t.text.slice(0,4000)}));
 if(!turns.length||turns.at(-1).role!=='user')fail('Ask a question');while(turns.length&&turns[0].role!=='user')turns.shift();
 const messages=[{role:'user',content:'Network snapshot (JSON):\n'+JSON.stringify(snapshot(store,stateOf))},{role:'assistant',content:'I have the snapshot. What would you like to know?'},...turns];
 if(c.provider!=='anthropic')return chat(c,messages,fetchImpl);
 const api=client||new Anthropic({apiKey:c.apiKey,maxRetries:2,timeout:120000});
 let response;try{response=await api.beta.messages.create({model:MODEL,max_tokens:16000,system:SYSTEM,output_config:{effort:c.effort||'medium'},betas:['server-side-fallback-2026-07-01'],fallbacks:'default',messages});}
 catch(e){if(e instanceof Anthropic.AuthenticationError)fail('The Anthropic API key was rejected. Check it under Assistant settings.',502);if(e instanceof Anthropic.RateLimitError)fail('The assistant is busy (rate limited). Try again in a minute.',503);if(e instanceof Anthropic.BadRequestError)fail('The assistant could not take this request: '+e.message,502);if(e instanceof Anthropic.APIError)fail('The assistant is unavailable right now ('+e.status+').',502);fail('Could not reach the assistant: '+e.message,502);}
 if(response.stop_reason==='refusal')return {text:'The assistant declined to answer this question.',refused:true,model:response.model};
 const text=response.content.filter(b=>b.type==='text').map(b=>b.text).join('\n').trim();
 return {text:text||'(No answer was returned.)',truncated:response.stop_reason==='max_tokens',model:response.model,usage:{input:response.usage?.input_tokens||0,output:response.usage?.output_tokens||0}};}
// OpenAI-style providers (DeepSeek, OpenRouter).
async function chat(c,messages,fetchImpl){const P=PROVIDERS[c.provider],model=modelOf(c);let r,j;
 try{r=await fetchImpl(P.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.apiKey,...(c.provider==='openrouter'?{'X-Title':'Kade Networks netops'}:{})},
  body:JSON.stringify({model,max_tokens:4000,temperature:0.3,messages:[{role:'system',content:SYSTEM},...messages]}),signal:AbortSignal.timeout(120000)});j=await r.json().catch(()=>({}));}
 catch(e){fail('Could not reach '+P.label+': '+e.message,502);}
 if(r.status===401||r.status===403)fail('The '+P.label+' API key was rejected. Check it under Assistant settings.',502);
 if(r.status===402)fail(P.label+' says the account has no credit left. Top it up, or choose a free model.',502);
 if(r.status===429)fail('The assistant is busy (rate limited by '+P.label+'). Try again in a minute.',503);
 if(!r.ok)fail(P.label+' is unavailable right now ('+r.status+(j?.error?.message?': '+String(j.error.message).slice(0,160):'')+').',502);
 const choice=j.choices?.[0],text=String(choice?.message?.content||'').trim();
 return {text:text||'(No answer was returned.)',truncated:choice?.finish_reason==='length',model:j.model||model,usage:{input:j.usage?.prompt_tokens||0,output:j.usage?.completion_tokens||0}};}
module.exports={MODEL,PROVIDERS,config,publicConfig,setConfig,snapshot,ask};
