'use strict';
// Email through an HTTP provider (Resend, Brevo or SendGrid). Used for copies of customer receipts and reminders
// (when the customer has an email address) and for alert escalation to staff. Every send is logged.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const PROVIDERS={resend:'Resend',brevo:'Brevo',sendgrid:'SendGrid'};
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/;
function config(store){return store.secret('email:config');}
function publicConfig(store){const c=config(store);return c?{configured:true,provider:c.provider,from:c.from,fromName:c.fromName,copyCustomers:c.copyCustomers!==false}:{configured:false};}
function setConfig(store,input){const prior=config(store)||{},provider=PROVIDERS[input.provider]?input.provider:fail('Choose the email provider');
 const apiKey=String(input.apiKey||'').trim()||(prior.provider===provider?prior.apiKey:'');if(apiKey.length<16)fail('Enter the API key from your email provider');
 const from=String(input.from||'').trim().toLowerCase();if(!EMAIL.test(from))fail('Enter the sender address (on a domain verified with the provider)');
 store.secret('email:config',{provider,apiKey,from,fromName:String(input.fromName||'Kade Networks').trim().slice(0,60),copyCustomers:input.copyCustomers!==false&&input.copyCustomers!=='false'});return publicConfig(store);}
function log(store,entry){const l=store.setting('emailLog')||{items:[]};l.items=[entry,...l.items].slice(0,500);store.setting('emailLog',l);}
function request(c,to,subject,text){const html='<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">'+text.replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))+'</div>';
 if(c.provider==='resend')return ['https://api.resend.com/emails',{Authorization:'Bearer '+c.apiKey},{from:`${c.fromName} <${c.from}>`,to:[to],subject,text,html}];
 if(c.provider==='brevo')return ['https://api.brevo.com/v3/smtp/email',{'api-key':c.apiKey},{sender:{email:c.from,name:c.fromName},to:[{email:to}],subject,textContent:text,htmlContent:html}];
 return ['https://api.sendgrid.com/v3/mail/send',{Authorization:'Bearer '+c.apiKey},{personalizations:[{to:[{email:to}]}],from:{email:c.from,name:c.fromName},subject,content:[{type:'text/plain',value:text},{type:'text/html',value:html}]}];}
async function send(store,to,subject,text,kind='manual',fetchImpl=fetch,now=Date.now()){const c=config(store);if(!c)fail('Email is not set up',503);to=String(to||'').trim().toLowerCase();if(!EMAIL.test(to))fail('Invalid email address');
 subject=String(subject||'').slice(0,160);text=String(text||'').slice(0,20000);const [url,headers,body]=request(c,to,subject,text);
 try{const r=await fetchImpl(url,{method:'POST',headers:{...headers,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const t=await r.text();
  if(!r.ok){let m=t;try{const j=JSON.parse(t);m=j.message||j.errors?.[0]?.message||j.error||t;}catch{}throw new Error(String(m).slice(0,160)||'HTTP '+r.status);}
  log(store,{time:now,to,subject,kind,status:'sent'});return {ok:true};}
 catch(e){log(store,{time:now,to,subject,kind,status:'failed',error:String(e.message).slice(0,160)});return {ok:false,error:e.message};}}
// Customer copy of an SMS, only when switched on and the customer has an email address.
async function copy(store,subscriber,subject,text,kind,fetchImpl=fetch){const c=config(store);if(!c||c.copyCustomers===false||!EMAIL.test(String(subscriber?.email||'')))return null;return send(store,subscriber.email,subject,text,kind,fetchImpl);}
module.exports={PROVIDERS,EMAIL,config,publicConfig,setConfig,send,copy,log:store=>(store.setting('emailLog')?.items||[])};
