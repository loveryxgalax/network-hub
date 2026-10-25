'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'network-billing-')),store=new Store(dir);
 const plan=store.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2500,durationValue:30,durationUnit:'days'}));
 const s=store.put('subscribers',radius.subscriber(store,{name:'Jane Wanjiru',username:'jane',service:'pppoe',planId:plan.id,phone:'0712 345 678'}));
 return {store,plan,s,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};}
const gateway=calls=>async(url,options)=>{calls.push({url,headers:options.headers,body:Object.fromEntries(options.body)});return {ok:true,status:201,text:async()=>JSON.stringify({SMSMessageData:{Message:'Sent to 1/1',Recipients:[{status:'Success',cost:'KES 0.8000',number:'+254712345678'}]}})};};
test('Kenyan phone numbers normalize to +254',()=>{
 for(const v of ['0712345678','0712 345 678','712345678','254712345678','+254712345678'])assert.equal(billing.phone(v),'+254712345678');
 assert.equal(billing.phone('0112345678'),'+254112345678');assert.equal(billing.phone('0212345678'),null);assert.equal(billing.phone(''),null);
});
test('payments renew whole periods, keep leftover credit and never count a reference twice',()=>{
 const {store,plan,s,done}=fixture();try{
  const now=Date.now();
  assert.ok(store.get('subscribers',s.id).expiresAt<=Date.now(),'new subscribers start expired');
  let r=billing.pay(store,s.id,{amount:3000,reference:'tjk1abc2de',method:'mpesa'},now);
  assert.equal(r.periods,1);assert.equal(r.balance,500);assert.equal(r.subscriber.expiresAt,now+30*86400000);assert.equal(r.payment.reference,'TJK1ABC2DE');
  assert.throws(()=>billing.pay(store,s.id,{amount:3000,reference:'TJK1ABC2DE'},now),/already recorded/);
  r=billing.pay(store,s.id,{amount:2000,reference:'TJK1ABC2DF',method:'mpesa'},now+DAYS(1));
  assert.equal(r.periods,1,'credit 500 + 2000 covers one more period');assert.equal(r.balance,0);assert.equal(r.subscriber.expiresAt,now+60*86400000,'early renewal extends from the current expiry');
  r=billing.pay(store,s.id,{amount:100,reference:'SMALL0001',method:'cash'},now);assert.equal(r.periods,0);assert.equal(r.balance,100);
  const edited=store.put('subscribers',radius.subscriber(store,{notes:'gate 4'},store.get('subscribers',s.id)),store.get('subscribers',s.id));assert.equal(edited.balance,100,'editing keeps the credit');
  assert.throws(()=>billing.pay(store,s.id,{amount:0,reference:'X1234'}),/amount/);assert.throws(()=>billing.pay(store,s.id,{amount:10,reference:'no'}),/reference/);
  assert.equal(store.list('subscriberPayments').length,3);void plan;
 }finally{done();}
});
const DAYS=n=>n*86400000;
test('reminders go out once per expiry from the server, respecting quiet hours',async()=>{
 const {store,s,done}=fixture();try{
  const calls=[],send=gateway(calls),noon=Date.parse('2026-10-25T09:00:00Z');// 12:00 in Nairobi
  assert.deepEqual(await billing.runReminders(store,noon,send),{sent:0,skipped:'not configured'});
  billing.setSmsConfig(store,{username:'kade',apiKey:'atsk_test_key',senderId:'KADENET'});
  store.put('subscribers',{...store.get('subscribers',s.id),expiresAt:noon+DAYS(2.5)},store.get('subscribers',s.id));
  assert.equal((await billing.runReminders(store,noon,send)).sent,1);assert.equal((await billing.runReminders(store,noon+60000,send)).sent,0,'not repeated');
  assert.equal(calls[0].url,'https://api.africastalking.com/version1/messaging');assert.equal(calls[0].headers.apiKey,'atsk_test_key');assert.equal(calls[0].body.to,'+254712345678');assert.equal(calls[0].body.from,'KADENET');assert.match(calls[0].body.message,/^Hi Jane, your Home 10 internet expires on/);
  assert.equal((await billing.runReminders(store,noon+DAYS(2),send)).sent,1,'the 1-day reminder is separate');
  const night=Date.parse('2026-10-27T20:00:00Z');// 23:00 in Nairobi
  assert.equal((await billing.runReminders(store,night+DAYS(1),send)).skipped,'quiet hours');
  assert.equal((await billing.runReminders(store,noon+DAYS(3),send)).sent,1,'expired notice');assert.match(calls.at(-1).body.message,/has expired/);
  const log=billing.overview(store).sms.log;assert.equal(log.length,3);assert.ok(log.every(l=>l.status==='sent'));
  assert.equal(billing.overview(store).sms.config.apiKey,undefined,'the API key is never returned');
  const failed=await billing.sendSms(store,'0712345678','x','test',async()=>{throw new Error('network down');});assert.equal(failed.status,'failed');assert.match(failed.detail,/network down/);
 }finally{done();}
});
test('custom SMS gateways (e.g. BlessedTexts) get JSON with adjustable field names and an honest result',async()=>{
 const {store,done}=fixture();try{
  assert.throws(()=>billing.setSmsConfig(store,{provider:'custom',url:'http://sms.example/api',apiKey:'k'}),/https/);
  const cfg=billing.setSmsConfig(store,{provider:'custom',url:'https://sms.blessedtexts.com/api/sms/v1/sendsms',apiKey:'secret-key',senderId:'KADENET'});
  assert.equal(cfg.provider,'custom');assert.equal(cfg.apiKey,undefined,'the key is never returned');
  const calls=[];let reply={status:201,body:'[{"status_code":"1000","status_desc":"Success","message_id":"m1"}]'};
  const gw=async(url,o)=>{calls.push({url,o});return {ok:reply.status<300,status:reply.status,text:async()=>reply.body};};
  let r=await billing.sendSms(store,'0712345678','Hello','test',gw);
  assert.equal(r.status,'sent');assert.equal(calls[0].url,'https://sms.blessedtexts.com/api/sms/v1/sendsms');
  assert.deepEqual(JSON.parse(calls[0].o.body),{api_key:'secret-key',sender_id:'KADENET',phone:'254712345678',message:'Hello'});assert.match(r.detail,/Success/);
  for(const code of ['1002','1004','1008','1009']){reply={status:200,body:`[{"status_code":"${code}","status_desc":"Insufficient units"}]`};r=await billing.sendSms(store,'0712345678','Hello','test',gw);assert.equal(r.status,'failed',code+' inside an HTTP 200 is a failure');assert.match(r.detail,new RegExp(code));}
  reply={status:200,body:'{"status":"error","message":"Invalid API key"}'};r=await billing.sendSms(store,'0712345678','Hello','test',gw);assert.equal(r.status,'failed');assert.match(r.detail,/Invalid API key/);
  reply={status:401,body:'Unauthorized'};assert.equal((await billing.sendSms(store,'0712345678','x','test',gw)).status,'failed');
  billing.setSmsConfig(store,{provider:'custom',url:'https://sms.blessedtexts.com/api/sms/v1/sendsms',senderId:'KADENET',format:'form',phoneFormat:'07',field_phone:'mobile',field_apiKey:'apikey'});
  reply={status:200,body:'{"success":true}'};r=await billing.sendSms(store,'+254712345678','Hi','test',gw);assert.equal(r.status,'sent');
  assert.deepEqual(Object.fromEntries(calls.at(-1).o.body),{apikey:'secret-key',sender_id:'KADENET',mobile:'0712345678',message:'Hi'},'the saved key is kept when left empty');
 }finally{done();}
});
