'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs'),email=require('../lib/email.cjs'),escalation=require('../lib/escalation.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comms-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
test('email: provider request shapes, failures logged, customer copies only with an address',async()=>{
 const {store,done}=fx();try{assert.throws(()=>email.setConfig(store,{provider:'resend',apiKey:'short',from:'a@b.co'}),/API key/);
  email.setConfig(store,{provider:'brevo',apiKey:'xkeysib-'+'a'.repeat(30),from:'Billing@Kade.co.ke',fromName:'Kade'});
  const calls=[];const ok=async(url,o)=>{calls.push({url,headers:o.headers,body:JSON.parse(o.body)});return new Response('{"messageId":"1"}',{status:201});};
  assert.deepEqual(await email.send(store,'cust@x.co','Hi','Line 1 <b>',undefined,ok),{ok:true});
  assert.equal(calls[0].url,'https://api.brevo.com/v3/smtp/email');assert.equal(calls[0].body.sender.email,'billing@kade.co.ke');assert.match(calls[0].body.htmlContent,/&lt;b&gt;/);assert.ok(calls[0].headers['api-key']);
  const bad=await email.send(store,'cust@x.co','Hi','x','test',async()=>new Response('{"message":"Key not found"}',{status:401}));assert.equal(bad.ok,false);assert.equal(email.log(store)[0].error,'Key not found');
  email.setConfig(store,{provider:'resend',apiKey:'re_'+'b'.repeat(30),from:'a@b.co'});await email.send(store,'c@d.co','S','T','x',ok);assert.equal(calls[1].url,'https://api.resend.com/emails');assert.equal(calls[1].headers.Authorization,'Bearer re_'+'b'.repeat(30));
  assert.equal(await email.copy(store,{email:''},'S','T','x',ok),null);
  // Receipts copy to the customer's email even without SMS set up.
  const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1000,durationValue:30,durationUnit:'days'})),s=store.put('subscribers',radius.subscriber(store,{name:'Ann',username:'ann1',service:'pppoe',planId:p.id,email:'ann@x.co'}));
  const r=billing.pay(store,s.id,{amount:1000,reference:'EMAIL001',method:'cash'});await billing.receipt(store,r,ok);await new Promise(x=>setTimeout(x,20));
  assert.ok(calls.some(c=>c.body.to?.[0]==='ann@x.co'&&/Payment received/.test(c.body.subject)));
 }finally{done();}
});
test('alert escalation: levels fire once each after their delay, acknowledged alerts are skipped',async()=>{
 const {store,done}=fx();try{store.secret('sms:config',{provider:'africastalking',username:'u',apiKey:'k'.repeat(20),senderId:''});email.setConfig(store,{provider:'sendgrid',apiKey:'SG.'+'c'.repeat(30),from:'noc@k.co'});
  assert.throws(()=>escalation.save(store,{enabled:true,levels:[{afterMinutes:30,sms:'0712345678'},{afterMinutes:10,email:'boss@k.co'}]}),/longer/);
  assert.throws(()=>escalation.save(store,{enabled:true,levels:[{afterMinutes:5,sms:'12'}]}),/not a phone/);
  escalation.save(store,{enabled:true,levels:[{afterMinutes:5,minSeverity:'warning',sms:'0712345678'},{afterMinutes:30,minSeverity:'critical',email:'boss@k.co'}]});
  const t0=Date.now(),a=store.put('alerts',{title:'Core router down',severity:'critical',status:'Open'}),b=store.put('alerts',{title:'Info only',severity:'info',status:'Open'}),c=store.put('alerts',{title:'Seen',severity:'critical',status:'Acknowledged'});
  const sent=[];const f=async(url,o)=>{sent.push(url);return new Response(url.includes('sendgrid')?'':JSON.stringify({SMSMessageData:{Recipients:[{status:'Success',messageId:'m'}]}}),{status:url.includes('sendgrid')?202:201});};
  assert.equal((await escalation.run(store,t0+60000,f)).sent,0);
  await escalation.run(store,t0+6*60000,f);assert.equal(sent.length,1);assert.ok(sent[0].includes('africastalking'));
  await escalation.run(store,t0+7*60000,f);assert.equal(sent.length,1,'a level fires once');
  await escalation.run(store,t0+31*60000,f);assert.equal(sent.length,2);assert.ok(sent[1].includes('sendgrid'));
  assert.deepEqual(Object.keys(store.get('alerts',a.id).escalations),['0','1']);assert.equal(store.get('alerts',b.id).escalations,undefined);assert.equal(store.get('alerts',c.id).escalations,undefined);
  // Everyone who was told is told once that it is resolved.
  {const cur=store.get('alerts',a.id);store.put('alerts',{...cur,status:'Resolved'},cur);}
  await escalation.run(store,Date.now()+60000,f);assert.equal(sent.length,4);assert.ok(sent[2].includes('africastalking')&&sent[3].includes('sendgrid'));
  await escalation.run(store,Date.now()+120000,f);assert.equal(sent.length,4,'resolved message is sent once');
 }finally{done();}
});
test('SMS: per-service wording falls back to the general message; welcome is off by default; template library',async()=>{
 const {store,done}=fx();try{const billing=require('../lib/billing.cjs'),radius=require('../lib/radius.cjs');
  billing.updateSettings(store,{templates:{'hotspot.payment':'Asante {name}! KSh {amount} received.','pppoe.payment':''}});
  const c=billing.settings(store);assert.equal(billing.tpl(c,'payment','hotspot'),'Asante {name}! KSh {amount} received.');assert.equal(billing.tpl(c,'payment','pppoe'),c.templates.payment,'empty = general message');
  assert.throws(()=>billing.updateSettings(store,{templates:{'static.reminder':'x'.repeat(460)}}),/459/);
  const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1000,durationValue:30,durationUnit:'days'}));const s=store.put('subscribers',radius.subscriber(store,{name:'Ann Wanjiru',username:'ann',service:'pppoe',planId:p.id,phone:'0712345678'}));
  assert.equal(await billing.welcome(store,s,async()=>{throw new Error('must not send');}),null,'welcome is off unless switched on');
  store.secret('sms:config',{provider:'africastalking',username:'u',apiKey:'k'.repeat(20),senderId:''});billing.updateSettings(store,{enabled:{welcome:true}});let body='';
  await billing.welcome(store,s,async(url,o)=>{body=String(o.body);return new Response(JSON.stringify({SMSMessageData:{Recipients:[{status:'Success',messageId:'m'}]}}),{status:201});});assert.match(decodeURIComponent(body.replace(/\+/g,' ')),/Welcome to Kade Networks, Ann/);
  const t=billing.saveLibrary(store,{name:'WhatsApp group',content:'Join our WhatsApp group, {name}'});assert.equal(billing.library(store).length,1);
  billing.saveLibrary(store,{name:'WhatsApp group',content:'Updated',active:false},t.id);assert.equal(billing.library(store)[0].active,false);assert.throws(()=>billing.saveLibrary(store,{name:'',content:'x'}),/Name/);
  billing.deleteLibrary(store,t.id);assert.equal(billing.library(store).length,0);
 }finally{done();}
});
