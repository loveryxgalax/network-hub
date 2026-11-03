'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),wa=require('../lib/whatsapp.cjs'),billing=require('../lib/billing.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wa-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const fake=(status,body)=>{const calls=[];const f=async(url,opt)=>{calls.push({url,opt,body:opt.body instanceof URLSearchParams?Object.fromEntries(opt.body):JSON.parse(opt.body||'{}')});return {ok:status<300,status,text:async()=>JSON.stringify(typeof body==='function'?body(url):body)};};f.calls=calls;return f;};
test('each provider: validation and the request it sends',async()=>{
 const {store,done}=fx();try{const n='+254712345678';
  assert.throws(()=>wa.setConfig(store,{provider:'meta',phoneNumberId:'+2547',accessToken:'t'}),/number ID/);
  wa.setConfig(store,{provider:'meta',phoneNumberId:'123456789012',accessToken:'EAAtoken'});
  let f=fake(200,{messages:[{id:'wamid.ABCDEFGHIJKLMNOP'}]});assert.match(await wa.send(store,n,'Hi Mary','payment',f),/^Meta/);
  assert.equal(f.calls[0].url,'https://graph.facebook.com/v21.0/123456789012/messages');assert.deepEqual(f.calls[0].body,{messaging_product:'whatsapp',to:'254712345678',type:'text',text:{body:'Hi Mary'}});assert.equal(f.calls[0].opt.headers.Authorization,'Bearer EAAtoken');
  wa.setRouting(store,{templates:{payment:{name:'payment_receipt',lang:'en'}}});f=fake(200,{messages:[{id:'wamid.X1234567890123'}]});await wa.send(store,n,'Hi Mary','payment',f);
  assert.equal(f.calls[0].body.type,'template');assert.equal(f.calls[0].body.template.name,'payment_receipt');assert.equal(f.calls[0].body.template.components[0].parameters[0].text,'Hi Mary');
  await assert.rejects(wa.send(store,n,'x','manual',fake(400,{error:{message:'Re-engagement message required'}})),/Re-engagement/);
  wa.setConfig(store,{provider:'twilio',accountSid:'AC'+'a'.repeat(32),authToken:'tok',from:'+14155238886'});f=fake(201,{sid:'SM'+'1'.repeat(32),status:'queued'});await wa.send(store,n,'Hello','reminder',f);
  assert.match(f.calls[0].url,/Accounts\/ACa+\/Messages\.json$/);assert.deepEqual([f.calls[0].body.To,f.calls[0].body.From,f.calls[0].body.Body],['whatsapp:+254712345678','whatsapp:+14155238886','Hello']);
  assert.throws(()=>wa.setConfig(store,{provider:'infobip',baseUrl:'http://evil.example',apiKey:'k',sender:'254700000000'}),/https/);
  wa.setConfig(store,{provider:'infobip',baseUrl:'https://abc.api.infobip.com',apiKey:'k',sender:'+254700000000'});f=fake(200,{messageId:'m1',status:{name:'PENDING'}});await wa.send(store,n,'Yo','expired',f);
  assert.equal(f.calls[0].url,'https://abc.api.infobip.com/whatsapp/1/message/text');assert.equal(f.calls[0].opt.headers.Authorization,'App k');assert.equal(f.calls[0].body.from,'254700000000');
  process.env.NETWORK_TRUSTED_HTTP_HOSTS='waha';wa.setConfig(store,{provider:'waha',baseUrl:'http://waha:3000'});f=fake(201,{id:'x'});await wa.send(store,n,'Free!','manual',f);
  assert.equal(f.calls[0].url,'http://waha:3000/api/sendText');assert.deepEqual(f.calls[0].body,{session:'default',chatId:'254712345678@c.us',text:'Free!'});
  wa.setConfig(store,{provider:'evolution',baseUrl:'https://evo.example.test',apiKey:'ek',instance:'kade'});f=fake(201,{key:{id:'1'}});await wa.send(store,n,'Evo','manual',f);
  assert.equal(f.calls[0].url,'https://evo.example.test/message/sendText/kade');assert.equal(f.calls[0].opt.headers.apikey,'ek');
  wa.setConfig(store,{provider:'custom',url:'https://api.gateway.example/send?x=1',format:'json',phoneField:'phone',messageField:'message',phoneFormat:'07',authHeader:'Authorization',authValue:'Bearer s3cret',extra:'{"instance_id":"42"}'});
  f=fake(200,{success:true});await wa.send(store,n,'Custom','manual',f);assert.deepEqual(f.calls[0].body,{instance_id:'42',phone:'0712345678',message:'Custom'});assert.equal(f.calls[0].opt.headers.Authorization,'Bearer s3cret');
  await assert.rejects(wa.send(store,n,'x','manual',fake(200,{success:false,message:'Insufficient balance'})),/Insufficient/);
  // Secrets are never shown back.
  const pc=wa.publicConfig(store);assert.equal(pc.settings.authValue,'saved');assert.ok(!JSON.stringify(pc).includes('s3cret'));
  // Keeping a saved secret: leaving it empty keeps it.
  wa.setConfig(store,{provider:'custom',url:'https://api.gateway.example/send',format:'json',phoneField:'phone',messageField:'message',authHeader:'Authorization',authValue:''});assert.equal(wa.config(store).authValue,'Bearer s3cret');
 }finally{delete process.env.NETWORK_TRUSTED_HTTP_HOSTS;done();}
});
test('routing: chosen message types go to WhatsApp, failures fall back to SMS, PINs stay on SMS',async()=>{
 const {store,done}=fx();try{
  billing.setSmsConfig(store,{provider:'africastalking',username:'kade',apiKey:'ATkey',senderId:'KADE'});
  wa.setConfig(store,{provider:'meta',phoneNumberId:'123456789012',accessToken:'EAAtoken'});wa.setRouting(store,{kinds:{payment:true}});
  const net=fake(200,u=>/graph\.facebook/.test(u)?{messages:[{id:'wamid.ZZZZZZZZZZZZZZ'}]}:{SMSMessageData:{Recipients:[{status:'Success',cost:'KES 0.80'}]}});
  let r=await billing.sendSms(store,'0712345678','Receipt','payment',net);assert.equal(r.channel,'whatsapp');assert.equal(net.calls.length,1);
  r=await billing.sendSms(store,'0712345678','Reminder','reminder',net);assert.equal(r.channel,undefined,'not switched on: SMS');assert.match(net.calls[1].url,/africastalking/);
  const broken=fake(400,u=>/graph\.facebook/.test(u)?{error:{message:'Token expired'}}:{SMSMessageData:{Recipients:[{status:'Success'}]}});
  const callsBefore=broken.calls.length;r=await billing.sendSms(store,'0712345678','Receipt','payment',async(u,o)=>/graph/.test(u)?broken(u,o):{ok:true,status:200,text:async()=>JSON.stringify({SMSMessageData:{Recipients:[{status:'Success'}]}})});
  assert.equal(r.status,'sent');assert.match(r.detail,/WhatsApp failed \(Token expired\), sent by SMS/);void callsBefore;
  wa.setRouting(store,{all:true});assert.equal(wa.routed(store,'pin'),false,'PINs are never sent over WhatsApp');assert.equal(wa.routed(store,'reminder'),true);
  const log=store.setting('smsLog').items;assert.ok(log.some(l=>l.channel==='whatsapp'));
 }finally{done();}
});
