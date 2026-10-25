'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),mpesa=require('../lib/mpesa.cjs'),portal=require('../lib/portal.cjs');
const {createApp}=require('../server.cjs');
// A fake Daraja: records STK pushes and answers queries from a table the test controls.
function daraja(){const pushes=[],answers=new Map();let n=0;
 const fetchImpl=async(url,options={})=>{const json=v=>({ok:true,status:200,text:async()=>JSON.stringify(v)});
  if(url.includes('/oauth/'))return json({access_token:'tok',expires_in:'3599'});
  const body=JSON.parse(options.body);
  if(url.endsWith('/processrequest')){const id='ws_CO_'+(++n);pushes.push({...body,id});return json({MerchantRequestID:'m'+n,CheckoutRequestID:id,ResponseCode:'0',CustomerMessage:'Success. Request accepted for processing'});}
  if(url.endsWith('/query')){const a=answers.get(body.CheckoutRequestID);return a?json({ResultCode:a,ResultDesc:a==='0'?'The service request is processed successfully.':'Request cancelled by user'}):{ok:false,status:500,text:async()=>JSON.stringify({errorCode:'500.001.1001',errorMessage:'The transaction is being processed'})};}
  throw new Error('unexpected '+url);};
 return {pushes,answers,fetchImpl};}
const callbackBody=(id,code,receipt='TJK1ABC2DE',amount=50)=>({Body:{stkCallback:{MerchantRequestID:'m',CheckoutRequestID:id,ResultCode:code,ResultDesc:code===0?'The service request is processed successfully.':'Request cancelled by user',...(code===0?{CallbackMetadata:{Item:[{Name:'Amount',Value:amount},{Name:'MpesaReceiptNumber',Value:receipt},{Name:'TransactionDate',Value:20261025120000},{Name:'PhoneNumber',Value:254712345678}]}}:{})}}});
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'network-portal-')),store=new Store(dir);mpesa._reset();
 mpesa.setConfig(store,{env:'production',type:'paybill',shortcode:'174379',consumerKey:'ck',consumerSecret:'cs',passkey:'pk'});
 const daily=store.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}));
 const home=store.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2500,durationValue:30,durationUnit:'days'}));
 return {store,daily,home,secret:mpesa.config(store).callbackSecret,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};}
test('Daraja timestamps are Kenyan time',()=>{assert.equal(mpesa.timestamp(Date.parse('2026-10-25T21:05:09Z')),'20261026000509');});
test('hotspot purchase: STK push, confirmed callback, one login, no double credit',async()=>{
 const {store,daily,secret,done}=fixture(),d=daraja();try{
  assert.deepEqual(portal.info(store).plans.map(p=>p.name),['Daily'],'PPPoE plans are not sold on the hotspot');
  await assert.rejects(portal.start(store,{kind:'hotspot',planId:daily.id,phone:'12345'},'https://netops.example',d.fetchImpl),/Safaricom number/);
  const started=await portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0712345678',mac:'aa:bb:cc:dd:ee:ff'},'https://netops.example',d.fetchImpl);
  const push=d.pushes[0];assert.equal(push.Amount,50);assert.equal(push.PartyA,'254712345678');assert.equal(push.BusinessShortCode,'174379');assert.equal(push.TransactionType,'CustomerPayBillOnline');assert.equal(push.CallBackURL,'https://netops.example/portal/api/mpesa/'+secret);assert.equal(Buffer.from(push.Password,'base64').toString(),'174379pk'+push.Timestamp);
  await assert.rejects(portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0712345678'},'https://netops.example',d.fetchImpl),/just sent/,'one prompt at a time per phone');
  await assert.rejects(portal.callback(store,'wrong-secret-wrong-secret',callbackBody(push.id,0),d.fetchImpl),/Not found/);
  // A forged "paid" callback is ignored when Safaricom does not confirm it.
  await portal.callback(store,secret,callbackBody(push.id,0),d.fetchImpl);assert.equal((await portal.status(store,started.id,started.token,d.fetchImpl)).status,'pending');assert.equal(store.list('subscriberPayments').length,0);
  d.answers.set(push.id,'0');await portal.callback(store,secret,callbackBody(push.id,0),d.fetchImpl);
  const s=await portal.status(store,started.id,started.token,d.fetchImpl);assert.equal(s.status,'paid');assert.match(s.username,/^w[a-z0-9]{6}$/);assert.match(s.password,/^\d{6}$/);assert.ok(s.expiresAt>Date.now()+23*3600000);
  await portal.callback(store,secret,callbackBody(push.id,0),d.fetchImpl);assert.equal(store.list('subscriberPayments').length,1,'duplicate callbacks credit once');
  await assert.rejects(portal.status(store,started.id,'not-the-token',d.fetchImpl),/not found/);
  // Same phone buys again later: same login, extended.
  const again=await portal.start(store,{kind:'hotspot',planId:daily.id,phone:'+254712345678'},'https://netops.example',d.fetchImpl,Date.now()+61000);d.answers.set(d.pushes[1].id,'0');
  await portal.callback(store,secret,callbackBody(d.pushes[1].id,0,'TJK1ABC2DF'),d.fetchImpl);const s2=await portal.status(store,again.id,again.token,d.fetchImpl);
  assert.equal(s2.username,s.username);assert.ok(s2.expiresAt>s.expiresAt+23*3600000);assert.equal(store.list('subscribers').length,1);
  // The login check and MikroTik CHAP answer.
  assert.throws(()=>portal.login(store,{username:s.username,password:'000000'}),/Wrong code/);
  const chap=portal.login(store,{username:s.username,password:s.password,chapId:'\u0005',chapChallenge:'û%\u0010'});
  assert.equal(chap.password,crypto.createHash('md5').update(Buffer.concat([Buffer.from([5]),Buffer.from(s.password),Buffer.from([0xfb,0x25,0x10])])).digest('hex'));assert.equal(chap.chap,true);
 }finally{done();}
});
test('cancelled prompts fail; PPPoE accounts renew; a lost callback is recovered by asking Safaricom',async()=>{
 const {store,home,secret,done}=fixture(),d=daraja();try{
  const sub=store.put('subscribers',radius.subscriber(store,{name:'Jane',username:'jane',service:'pppoe',planId:home.id,phone:'0712345678'}));radius.setPassword(store,sub.id,'pass1234');
  await assert.rejects(portal.start(store,{kind:'account',username:'nobody',phone:'0712345678'},'https://n',d.fetchImpl),/No account/);
  const a=await portal.start(store,{kind:'account',username:'Jane@kade',phone:'0722000000'},'https://n',d.fetchImpl);assert.equal(d.pushes[0].Amount,2500);assert.equal(d.pushes[0].AccountReference,'jane');
  await portal.callback(store,secret,callbackBody(d.pushes[0].id,1032),d.fetchImpl);let st=await portal.status(store,a.id,a.token,d.fetchImpl);assert.equal(st.status,'failed');assert.match(st.reason,/cancelled/);
  const b=await portal.start(store,{kind:'account',username:'jane',phone:'0722000000'},'https://n',d.fetchImpl,Date.now()+61000);d.answers.set(d.pushes[1].id,'0');
  st=await portal.status(store,b.id,b.token,d.fetchImpl,Date.now()+61000+65000);assert.equal(st.status,'paid','paid without a callback');assert.equal(st.password,undefined,'PPPoE passwords are never shown');
  assert.ok(store.get('subscribers',sub.id).expiresAt>Date.now()+29*86400000);
  await portal.callback(store,secret,callbackBody(d.pushes[1].id,0,'TJK9LATE01',2500),d.fetchImpl);assert.equal(store.list('subscriberPayments').length,1,'a late callback does not credit again');
 }finally{done();}
});
test('portal pages and API are public; M-Pesa settings are admin-only',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-portal-app-')),app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 try{
  const page=await fetch(origin+'/portal/');assert.equal(page.status,200);assert.match(await page.text(),/Buy Wi-Fi/);
  assert.equal((await fetch(origin+'/portal/../server.cjs')).status,404);
  const info=await (await fetch(origin+'/portal/api/info')).json();assert.equal(info.mpesa,false);assert.deepEqual(info.plans,[]);
  assert.equal((await fetch(origin+'/portal/api/mpesa/aaaaaaaaaaaaaaaaaaaaaaaa',{method:'POST',body:'{}'})).status,404);
  assert.equal((await fetch(origin+'/api/mpesa')).status,401);
  const login=await fetch(origin+'/portal/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'x',password:'y'})});assert.equal(login.status,401);
 }finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('the portal shows its own name and help contact, falling back to the workspace name',()=>{
 const {store,done}=fixture();try{
  assert.equal(portal.info(store).name,'Kade Networks');store.setting('workspace',{name:'network operations'});assert.equal(portal.info(store).name,'network operations');
  portal.updateSettings(store,{name:'Kade Networks Wi-Fi',support:'0712 345 678'});assert.deepEqual([portal.info(store).name,portal.info(store).support],['Kade Networks Wi-Fi','0712 345 678']);
  assert.throws(()=>portal.updateSettings(store,{name:'<script>'}),/Portal name/);assert.throws(()=>portal.updateSettings(store,{name:'x'.repeat(41)}),/40/);
 }finally{done();}
});
test('portal limits are per phone, payment and login name, so customers behind one hotspot IP are not blocked together',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-portal-limit-')),app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 const post=(route,body)=>fetch(origin+'/portal/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  // Ten different phones from one address are all handled (they fail on "not available", not on rate limiting).
  for(let i=0;i<10;i++)assert.notEqual((await post('pay',{kind:'hotspot',planId:'x',phone:'0712'+String(100000+i)})).status,429);
  // One phone is limited after five tries; one username after ten.
  const statuses=[];for(let i=0;i<7;i++)statuses.push((await post('pay',{kind:'hotspot',planId:'x',phone:'0722000000'})).status);assert.equal(statuses[5],429);assert.notEqual(statuses[0],429);
  const logins=[];for(let i=0;i<12;i++)logins.push((await post('login',{username:'wabc123',password:'000000'})).status);assert.equal(logins[0],401);assert.equal(logins[11],429);
  assert.equal((await post('login',{username:'someone-else',password:'x'})).status,401,'other customers are unaffected');
 }finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('"still under processing" (4999) keeps waiting; a wrongly failed payment is credited by the callback or an admin recheck',async()=>{
 const {store,daily,secret,done}=fixture(),d=daraja();
 const queryFetch=answers=>async(url,options)=>{if(url.endsWith('/query')){const id=JSON.parse(options.body).CheckoutRequestID,a=answers.get(id);if(a==='4999')return {ok:true,status:200,text:async()=>JSON.stringify({ResponseCode:'0',ResultCode:'4999',ResultDesc:'The transaction is still under processing'})};}return d.fetchImpl(url,options);};
 try{
  const answers=new Map(),f=queryFetch(answers),t0=Date.now();
  const a=await portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0712345678'},'https://n',f,t0);answers.set(d.pushes[0].id,'4999');
  let s=await portal.status(store,a.id,a.token,f,t0+35000);assert.equal(s.status,'pending','4999 is not a failure');
  s=await portal.status(store,a.id,a.token,f,t0+55000);assert.equal(s.status,'pending');
  // The customer pays; the callback arrives while the status query still says processing: the callback is confirmed by Safaricom first.
  answers.set(d.pushes[0].id,'0');d.answers.set(d.pushes[0].id,'0');await portal.callback(store,secret,callbackBody(d.pushes[0].id,0,'TJK5REAL01'),f);s=await portal.status(store,a.id,a.token,f);assert.equal(s.status,'paid');assert.equal(store.list('subscriberPayments').length,1);
  // A payment already marked failed by an older version is recovered by the admin recheck once Safaricom says it was paid.
  const b=await portal.start(store,{kind:'hotspot',planId:daily.id,phone:'0722000000'},'https://n',f,t0+120000);const rec=store.get('portalPayments',b.id);store.put('portalPayments',{...rec,status:'failed',reason:'The transaction is still under processing'},rec);
  answers.set(d.pushes[1].id,'4999');assert.equal((await portal.recheck(store,b.id,f)).status,'failed','still processing: nothing changes');
  answers.set(d.pushes[1].id,'0');d.answers.set(d.pushes[1].id,'0');const r=await portal.recheck(store,b.id,f);assert.equal(r.status,'paid');assert.equal(store.list('subscriberPayments').length,2);
  assert.equal((await portal.recheck(store,b.id,f)).message,'Already credited');
  // ...and a late real callback for a payment credited from a query only records the receipt.
  await portal.callback(store,secret,callbackBody(d.pushes[1].id,0,'TJK5REAL02'),f);assert.equal(store.get('portalPayments',b.id).mpesaReceipt,'TJK5REAL02');assert.equal(store.list('subscriberPayments').length,2);
 }finally{done();}
});
