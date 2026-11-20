'use strict';
// WhatsApp gateway. Customer messages chosen in the routing switches go to WhatsApp first; if WhatsApp fails the same
// message is sent by SMS (billing.sendSms does the fallback). Credentials are stored encrypted.
//   Official:  Meta WhatsApp Cloud API, Twilio, Infobip.
//   Free, self-hosted (unofficial, WhatsApp Web session, risk of the number being banned): WAHA, Evolution API.
//   Any other HTTP gateway (Apiwap, Notiva…): Custom HTTP, with the request shape from that provider's documents.
// Business-started messages on the official APIs normally need an approved template; set one per message type.
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const KINDS=['payment','reminder','expired','welcome','voucher','usage','manual'];
const PROVIDERS={
 meta:{label:'Meta WhatsApp Cloud API',kind:'official',fields:['phoneNumberId','accessToken'],secrets:['accessToken']},
 twilio:{label:'Twilio',kind:'official',fields:['accountSid','authToken','from'],secrets:['authToken']},
 infobip:{label:'Infobip',kind:'official',fields:['baseUrl','apiKey','sender'],secrets:['apiKey']},
 waha:{label:'WAHA (self-hosted, free)',kind:'free',fields:['baseUrl','apiKey','session'],secrets:['apiKey'],optional:['apiKey','session']},
 evolution:{label:'Evolution API (self-hosted, free)',kind:'free',fields:['baseUrl','apiKey','instance'],secrets:['apiKey']},
 custom:{label:'Custom HTTP (Apiwap, Notiva, others)',kind:'gateway',fields:['url','format','phoneField','messageField','phoneFormat','authHeader','authValue','extra'],secrets:['authValue'],optional:['authHeader','authValue','extra']}
};
function base(value,{path=false}={}){let u;try{u=new URL(String(value||'').trim());}catch{fail('Enter the full address, starting with https://');}
 const trusted=String(process.env.NETWORK_TRUSTED_HTTP_HOSTS||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
 const local=['127.0.0.1','localhost','[::1]'].includes(u.hostname)||trusted.includes(u.hostname.toLowerCase());
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local))fail('Use https:// (plain http only for a self-hosted gateway on this server, listed in NETWORK_TRUSTED_HTTP_HOSTS)');
 if(u.username||u.password||u.hash)fail('Do not put passwords in the address');if(!path&&u.search)fail('No query string in the base address');
 return path?u.href:u.origin+u.pathname.replace(/\/+$/,'');}
const text=(v,max=200)=>String(v??'').trim().slice(0,max);
function config(store){return store.secret('whatsapp:config');}
function routing(store){const r=store.setting('whatsappRouting')||{};return {all:r.all===true,kinds:Object.fromEntries(KINDS.map(k=>[k,r.kinds?.[k]===true])),templates:r.templates||{}};}
function publicConfig(store){const c=config(store);const out={providers:Object.entries(PROVIDERS).map(([id,p])=>({id,label:p.label,kind:p.kind})),routing:routing(store),kinds:KINDS};
 if(!c)return {...out,configured:false};const p=PROVIDERS[c.provider],shown={};for(const f of p.fields)shown[f]=p.secrets.includes(f)?(c[f]?'saved':''):c[f]??'';
 return {...out,configured:true,provider:c.provider,settings:shown,lastTest:c.lastTest||null};}
function setConfig(store,input){const provider=String(input.provider||'');const p=PROVIDERS[provider];if(!p)fail('Choose a WhatsApp provider');
 const prior=config(store)?.provider===provider?config(store):{},c={provider};
 for(const f of p.fields){const raw=input[f];const keep=p.secrets.includes(f)&&(raw===undefined||raw===''||raw==='saved');c[f]=keep?prior[f]:text(raw,f==='extra'?1000:300);}
 if(provider==='meta'){if(!/^\d{6,20}$/.test(c.phoneNumberId||''))fail('Phone number ID: the number ID from Meta (digits), not the phone number');if(!c.accessToken)fail('Enter the access token');}
 if(provider==='twilio'){if(!/^AC[0-9a-f]{32}$/i.test(c.accountSid||''))fail('Account SID starts with AC');if(!c.authToken)fail('Enter the auth token');if(!/^\+\d{8,15}$/.test(c.from||''))fail('From: your WhatsApp sender number, like +2547…');}
 if(provider==='infobip'){c.baseUrl=base(c.baseUrl);if(!c.apiKey)fail('Enter the API key');if(!/^\d{8,15}$/.test(String(c.sender||'').replace(/^\+/,'')))fail('Sender: your WhatsApp number, digits only');c.sender=String(c.sender).replace(/^\+/,'');}
 if(provider==='waha'){c.baseUrl=base(c.baseUrl);c.session=c.session||'default';if(!/^[A-Za-z0-9_-]{1,40}$/.test(c.session))fail('Session: letters, numbers, dash');}
 if(provider==='evolution'){c.baseUrl=base(c.baseUrl);if(!c.apiKey)fail('Enter the API key');if(!/^[A-Za-z0-9_.-]{1,60}$/.test(c.instance||''))fail('Enter the instance name');}
 if(provider==='custom'){c.url=base(c.url,{path:true});c.format=c.format==='form'?'form':'json';if(!/^[A-Za-z0-9_.-]{1,40}$/.test(c.phoneField||''))fail('Phone field name');if(!/^[A-Za-z0-9_.-]{1,40}$/.test(c.messageField||''))fail('Message field name');
  c.phoneFormat=['254','+254','07'].includes(c.phoneFormat)?c.phoneFormat:'254';if(c.authHeader&&!/^[A-Za-z0-9-]{1,40}$/.test(c.authHeader))fail('Header name: letters, numbers, dash');
  if(c.extra){let x;try{x=JSON.parse(c.extra);}catch{fail('Extra fields must be JSON, like {"instance_id":"123"}');}if(!x||typeof x!=='object'||Array.isArray(x))fail('Extra fields must be a JSON object');}}
 store.secret('whatsapp:config',c);return publicConfig(store);}
function setRouting(store,input){const cur=routing(store),kinds={};for(const k of KINDS)kinds[k]=input.kinds?.[k]===undefined?cur.kinds[k]:input.kinds[k]===true;
 const templates={};for(const k of KINDS){const t=input.templates?.[k]??cur.templates[k];if(!t)continue;const name=text(t.name,120),lang=text(t.lang||'en',10);if(name&&!/^[A-Za-z0-9_.-]{1,120}$/.test(name))fail('Template names: letters, numbers, underscore (or a Twilio content SID HX…)');if(name)templates[k]={name,lang};}
 return store.setting('whatsappRouting',{all:input.all===undefined?cur.all:input.all===true,kinds,templates});}
function routed(store,kind){if(!config(store)||!KINDS.includes(kind))return false;const r=routing(store);return r.all||r.kinds[kind]===true;}
const digits=n=>String(n).replace(/\D/g,'');
async function send(store,number,message,kind='manual',fetchImpl=fetch){
 const c=config(store);if(!c)throw new Error('WhatsApp is not set up');const to=digits(number),tpl=routing(store).templates[kind],T=AbortSignal.timeout(15000);
 const json=async r=>{const t=await r.text();try{return JSON.parse(t);}catch{return {raw:t.slice(0,200)};}};
 const check=(r,d,ok)=>{if(!r.ok||!ok)throw new Error(String(d?.error?.message||d?.message||d?.requestError?.serviceException?.text||d?.raw||('HTTP '+r.status)).slice(0,200));};
 if(c.provider==='meta'){const body=tpl?{messaging_product:'whatsapp',to,type:'template',template:{name:tpl.name,language:{code:tpl.lang||'en'},components:[{type:'body',parameters:[{type:'text',text:message}]}]}}:{messaging_product:'whatsapp',to,type:'text',text:{body:message}};
  const r=await fetchImpl(`https://graph.facebook.com/v21.0/${c.phoneNumberId}/messages`,{method:'POST',headers:{Authorization:'Bearer '+c.accessToken,'Content-Type':'application/json'},body:JSON.stringify(body),signal:T}),d=await json(r);check(r,d,d?.messages?.[0]?.id);return 'Meta '+d.messages[0].id.slice(-12)+(tpl?' · template '+tpl.name:'');}
 if(c.provider==='twilio'){const f=new URLSearchParams({To:'whatsapp:+'+to,From:'whatsapp:'+c.from});if(tpl&&/^HX/i.test(tpl.name)){f.set('ContentSid',tpl.name);f.set('ContentVariables',JSON.stringify({1:message}));}else f.set('Body',message);
  const r=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(c.accountSid+':'+c.authToken).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:f,signal:T}),d=await json(r);check(r,d,d?.sid);return 'Twilio '+d.sid.slice(-10)+' · '+(d.status||'queued');}
 if(c.provider==='infobip'){const path=tpl?'/whatsapp/1/message/template':'/whatsapp/1/message/text',body=tpl?{messages:[{from:c.sender,to,content:{templateName:tpl.name,templateData:{body:{placeholders:[message]}},language:tpl.lang||'en'}}]}:{from:c.sender,to,content:{text:message}};
  const r=await fetchImpl(c.baseUrl+path,{method:'POST',headers:{Authorization:'App '+c.apiKey,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:T}),d=await json(r);const m=d?.messages?.[0]||d;check(r,d,m?.messageId||m?.status);return 'Infobip '+(m.status?.name||'sent');}
 if(c.provider==='waha'){const r=await fetchImpl(c.baseUrl+'/api/sendText',{method:'POST',headers:{'Content-Type':'application/json',...(c.apiKey?{'X-Api-Key':c.apiKey}:{})},body:JSON.stringify({session:c.session||'default',chatId:to+'@c.us',text:message}),signal:T}),d=await json(r);check(r,d,true);return 'WAHA sent';}
 if(c.provider==='evolution'){const r=await fetchImpl(c.baseUrl+'/message/sendText/'+encodeURIComponent(c.instance),{method:'POST',headers:{'Content-Type':'application/json',apikey:c.apiKey},body:JSON.stringify({number:to,text:message}),signal:T}),d=await json(r);check(r,d,true);return 'Evolution sent';}
 if(c.provider==='custom'){const num=c.phoneFormat==='+254'?'+'+to:c.phoneFormat==='07'?'0'+to.slice(3):to,payload={...(c.extra?JSON.parse(c.extra):{}),[c.phoneField]:num,[c.messageField]:message};
  const r=await fetchImpl(c.url,{method:'POST',headers:{Accept:'application/json','Content-Type':c.format==='form'?'application/x-www-form-urlencoded':'application/json',...(c.authHeader&&c.authValue?{[c.authHeader]:c.authValue}:{})},body:c.format==='form'?new URLSearchParams(payload):JSON.stringify(payload),signal:T}),d=await json(r);
  check(r,d,!(d&&(d.success===false||d.status===false||/^(error|failed)$/i.test(String(d.status||'')))));return 'Gateway HTTP '+r.status;}
 throw new Error('Unknown WhatsApp provider');}
async function test(store,number,fetchImpl=fetch){const c=config(store);if(!c)fail('Set up a provider first');let detail,ok=false;try{detail=await send(store,number,'Test message from netops. WhatsApp is working.','manual',fetchImpl);ok=true;}catch(e){detail=String(e.message||e);}
 store.secret('whatsapp:config',{...c,lastTest:{time:Date.now(),ok,detail:detail.slice(0,200)}});return {ok,detail};}
function remove(store){store.secret('whatsapp:config',null);return publicConfig(store);}
module.exports={PROVIDERS,KINDS,publicConfig,setConfig,setRouting,routing,routed,send,test,remove,config};
