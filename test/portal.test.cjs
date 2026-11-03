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
  const page=await fetch(origin+'/portal/');assert.equal(page.status,200);const html=await page.text();assert.match(html,/id="hotspotPkgs"/);assert.match(html,/Kade Networks/);assert.ok(!/\son(error|click|load)=/i.test(html),"no inline handlers: the page security policy blocks them");
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
test('paybill (C2B) payments credit the matching username once, keep unmatched ones for a person, and are not forgeable without the secret',async()=>{
 const c2b=require('../lib/c2b.cjs'),billing=require('../lib/billing.cjs');
 const {store,home,done}=fixture();try{
  const jane=store.put('subscribers',radius.subscriber(store,{name:'Jane Wanjiru',username:'jane',service:'pppoe',planId:home.id,phone:'0712345678'}));radius.setPassword(store,jane.id,'pass1234');
  const note=(over={})=>({TransactionType:'Pay Bill',TransID:'UJPATBBZMU',TransTime:'20261025150000',TransAmount:'2500.00',BusinessShortCode:'174379',BillRefNumber:'Jane',InvoiceNumber:'',OrgAccountBalance:'',ThirdPartyTransID:'',MSISDN:'2ed4886eaccd40f3dfb06e0ec1db9da1',FirstName:'YVONNE',MiddleName:'',LastName:'',...over});
  const u=c2b.urls(store,'https://n');assert.match(u.confirmation,/^https:\/\/n\/portal\/api\/c2b\/[0-9a-f]{32}\/confirmation$/);assert.doesNotMatch(u.confirmation+u.validation,/mpesa|safaricom|sql|exec|cmd|query/i,'Safaricom rejects URLs containing these words');
  assert.equal(c2b.validate(store,note()).ResultCode,0);assert.equal(c2b.validate(store,note({BillRefNumber:'nobody'})).ResultCode,'C2B00012');
  const r=c2b.confirm(store,note());assert.equal(r.status,'credited');assert.equal(r.username,'jane');assert.ok(store.get('subscribers',jane.id).expiresAt>Date.now()+29*86400000);
  assert.equal(store.list('subscriberPayments')[0].reference,'UJPATBBZMU');assert.equal(c2b.confirm(store,note()).duplicate,true);assert.equal(store.list('subscriberPayments').length,1,'a repeated notification credits once');
  // Account typed with a realm, spaces or a phone number still matches; unknown accounts wait for a person.
  assert.equal(c2b.confirm(store,note({TransID:'UJPATBBZM2',BillRefNumber:' JANE@kade '})).status,'credited');
  assert.equal(c2b.confirm(store,note({TransID:'UJPATBBZM3',BillRefNumber:'0712 345 678'})).status,'credited');
  const lost=c2b.confirm(store,note({TransID:'UJPATBBZM4',BillRefNumber:'jnae',TransAmount:'1000'}));assert.equal(lost.status,'unallocated');assert.equal(store.list('subscriberPayments').length,3);
  assert.equal(c2b.confirm(store,note({TransID:'UJPATBBZM5',BusinessShortCode:'999999'})).ignored,true,'another shortcode is not ours');
  assert.throws(()=>c2b.confirm(store,note({TransID:'x'})),/Not a payment/);
  const assigned=c2b.assign(store,lost.id,jane.id);assert.equal(assigned.status,'credited');assert.equal(store.list('subscriberPayments').length,4);assert.throws(()=>c2b.assign(store,lost.id,jane.id),/already credited/);
  assert.equal(c2b.overview(store,'https://n').payments.length,4);
  // Registration sends both URLs and records the answer; Safaricom's refusal is shown, not hidden.
  const sent=[];const fetchImpl=async(url,o)=>{sent.push({url,body:o.body&&JSON.parse(o.body)});if(url.includes('/oauth/'))return {ok:true,status:200,text:async()=>JSON.stringify({access_token:'t',expires_in:'3599'})};return {ok:true,status:200,text:async()=>JSON.stringify({ResponseCode:'0',ResponseDescription:'Success'})};};
  mpesa._reset();let reg=await c2b.register(store,'https://n',fetchImpl);assert.equal(reg.ok,true);const call=sent.find(x=>x.url.endsWith('/c2b/v2/registerurl'));assert.equal(call.body.ShortCode,'174379');assert.equal(call.body.ResponseType,'Completed');assert.equal(call.body.ConfirmationURL,u.confirmation);
  const refuse=async(url,o)=>url.includes('/oauth/')?fetchImpl(url,o):{ok:false,status:400,text:async()=>JSON.stringify({errorCode:'500.003.1001',errorMessage:'Duplicate notification info'})};
  reg=await c2b.register(store,'https://n',refuse);assert.equal(reg.ok,false);assert.match(reg.message,/Duplicate notification info/);
 }finally{done();}
});
test('paybill endpoints are public only with the secret path',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-c2b-')),app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 try{mpesa.setConfig(app.store,{env:'production',type:'paybill',shortcode:'174379',consumerKey:'a',consumerSecret:'b',passkey:'c'});
  const secret=mpesa.config(app.store).c2bSecret,post=(p,b)=>fetch(origin+'/portal/api/c2b/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.equal((await post('0'.repeat(32)+'/confirmation',{})).status,404);
  const ok=await post(secret+'/confirmation',{TransID:'UJPATBBZMU',TransAmount:'10',BusinessShortCode:'174379',BillRefNumber:'nobody'});assert.equal(ok.status,200);assert.equal((await ok.json()).ResultCode,0);
  assert.equal(app.store.list('c2bPayments')[0].status,'unallocated');
  const v=await (await post(secret+'/validation',{BusinessShortCode:'174379',BillRefNumber:'nobody'})).json();assert.equal(v.ResultCode,'C2B00012');
 }finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('landing page settings are validated, admin-only to change, and public to read with the real packages',async()=>{
 const landing=require('../lib/landing.cjs');
 assert.throws(()=>landing.validate({...landing.DEFAULTS,theme:'neon'}),/one of the designs/);assert.throws(()=>landing.validate({...landing.DEFAULTS,brandColor:'red'}),/colour/);assert.throws(()=>landing.validate({...landing.DEFAULTS,intro:'<script>'}),/intro/);
 const ok=landing.validate({...landing.DEFAULTS,theme:'bento',brandColor:'#0A3CFF',phone:'+254 181 820 518x',accountPrefix:'kne!',show:{pppoe:false,hotspot:true}});assert.equal(ok.brandColor,'#0a3cff');assert.equal(ok.phone,'+254 181 820 518');assert.equal(ok.accountPrefix,'KNE');assert.equal(ok.show.pppoe,false);assert.equal(ok.show.contact,true,'unlisted sections default to shown');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-landing-')),app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 try{
  const store=app.store;mpesa.setConfig(store,{env:'production',type:'paybill',shortcode:'174379',consumerKey:'a',consumerSecret:'b',passkey:'c'});
  const hot=store.put('plans',radius.plan({name:'OFA MOTO',service:'hotspot',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'hours'})),home=store.put('plans',radius.plan({name:'Basic',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days'}));
  const wallet=store.put('subscribers',radius.subscriber(store,{name:'Wallet',username:'kne-a52mde',service:'hotspot',planId:hot.id,phone:'0712345678',expiresAt:Date.now()+3600000}));radius.setPassword(store,wallet.id,'123456');
  const jane=store.put('subscribers',radius.subscriber(store,{name:'Christine Mwikali',username:'Christine Mwikali',service:'pppoe',planId:home.id,phone:'0723632248',expiresAt:Date.now()-1000}));
  const cfg=await (await fetch(origin+'/portal/api/config')).json();assert.deepEqual(cfg.plans.map(p=>p.name),['OFA MOTO']);assert.deepEqual(cfg.pppoePlans.map(p=>p.name),['Basic']);assert.equal(cfg.config.theme,'midnight');assert.equal(cfg.mpesa,true);
  const post=(route,body)=>fetch(origin+'/portal/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
  // Lookups: account number inside a pasted message, a spaced PPPoE username, a phone number, unknown.
  let a=await post('account',{query:'Dear customer, you paid KES 10 for account KNE-A52MDE. Thank you'});assert.equal(a.found,true);assert.equal(a.account,'kne-a52mde');assert.equal(a.status,'active');assert.equal(a.plan,'OFA MOTO');assert.equal(a.phone,undefined,'no contact details are returned');assert.equal(a.name,undefined);
  a=await post('account',{query:'  christine   mwikali '});assert.equal(a.found,true);assert.equal(a.status,'expired');assert.equal(a.price,1500);
  assert.equal((await post('account',{query:'0723 632 248'})).account,'christine mwikali');assert.deepEqual(await post('account',{query:'nobody-here'}),{found:false});
  // Connection detection by the device the router reports.
  assert.deepEqual(await (await fetch(origin+'/portal/api/session?mac=AA:BB:CC:DD:EE:FF')).json(),{found:false});
  store.put('subscribers',{...store.get('subscribers',wallet.id),lastMac:'AA:BB:CC:DD:EE:FF'},store.get('subscribers',wallet.id));
  const found=await (await fetch(origin+'/portal/api/session?mac=aa-bb-cc-dd-ee-ff')).json();assert.equal(found.found,true);assert.equal(found.account,'kne-a52mde');assert.equal((await (await fetch(origin+'/portal/api/session?mac=bad')).json()).found,false);
  // Only an admin may change the design.
  assert.equal((await fetch(origin+'/api/portal/landing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(landing.DEFAULTS)})).status,401);
  const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'Kade',email:'o@example.test',password:'fixture-owner-password-123'})}),cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf;
  const put=(body,token=csrf)=>fetch(origin+'/api/portal/landing',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':token},body:JSON.stringify(body)});
  assert.equal((await put({...landing.DEFAULTS,theme:'christmas'},'wrong')).status,403);assert.equal((await put({...landing.DEFAULTS,theme:'christmas',brandName:'Kade Networks Wi-Fi'})).status,200);
  assert.equal((await (await fetch(origin+'/portal/api/config')).json()).config.theme,'christmas');assert.equal((await (await fetch(origin+'/portal/api/config')).json()).config.brandName,'Kade Networks Wi-Fi');
 }finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('promo codes: percent off, bonus days, limits, and the full package value still renews the customer',async()=>{
 const promos=require('../lib/promos.cjs');
 const {store,home,daily,secret,done}=fixture(),d=daraja();try{
  const sub=store.put('subscribers',radius.subscriber(store,{name:'Ann',username:'ann',service:'pppoe',planId:home.id,phone:'+254712345678',expiresAt:Date.now()-1000}));radius.setPassword(store,sub.id,'pw123456');
  store.put('promoCodes',promos.validate({code:'welcome20',type:'percent',value:20,maxUses:1}));store.put('promoCodes',promos.validate({code:'EXTRA7',type:'days',value:7}));
  await assert.rejects(portal.start(store,{kind:'account',username:'ann',phone:'0712345678',promo:'NOPE'},'https://netops.example',d.fetchImpl),/not valid/);
  const s=await portal.start(store,{kind:'account',username:'ann',phone:'0712345678',promo:'welcome-20'},'https://netops.example',d.fetchImpl);assert.equal(s.amount,2000,'20% off KSh 2,500');
  d.answers.set(d.pushes[0].id,'0');await portal.callback(store,secret,callbackBody(d.pushes[0].id,0,'TPROMO0001',2000),d.fetchImpl);
  const after=store.get('subscribers',sub.id);assert.ok(after.expiresAt>Date.now()+29*864e5,'the discounted payment still buys the whole month');assert.equal(after.balance,0);assert.equal(store.list('subscriberPayments')[0].amount,2000,'the cash received is what is recorded');
  assert.equal(promos.find(store,'WELCOME20').used,1);
  await assert.rejects(portal.start(store,{kind:'account',username:'ann',phone:'0712345678',promo:'WELCOME20'},'https://netops.example',d.fetchImpl,Date.now()+61000),/fully used/);
  const before=after.expiresAt,b=await portal.start(store,{kind:'account',username:'ann',phone:'0712345678',promo:'EXTRA7'},'https://netops.example',d.fetchImpl,Date.now()+120000);assert.equal(b.amount,2500);
  d.answers.set(d.pushes[1].id,'0');await portal.callback(store,secret,callbackBody(d.pushes[1].id,0,'TPROMO0002',2500),d.fetchImpl);
  assert.ok(store.get('subscribers',sub.id).expiresAt>=before+37*864e5,'one more month plus 7 bonus days');
 }finally{done();}
});
test('portal "Leave a message" is off by default and, when on, files an Open ticket linked by phone',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createApp}=require('../server.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'msg-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 const port=await new Promise(r=>app.server.listen(0,'127.0.0.1',()=>r(app.server.address().port))),url='http://127.0.0.1:'+port+'/portal/api/message';
 const send=b=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{
  assert.equal((await send({name:'Amina',phone:'0712345678',message:'No internet since morning'})).status,404);
  const landing=require('../lib/landing.cjs');app.store.setting('landingConfig',{...landing.get(app.store),show:{...landing.get(app.store).show,message:true}});
  assert.equal((await send({name:'Amina',phone:'not a phone',message:'hello'})).status,400);
  assert.equal((await send({name:'Amina',phone:'0712345678',message:'No internet since morning'})).status,200);
  const t=app.store.list('tickets').find(x=>x.source==='portal');assert.equal(t.status,'Open');assert.match(t.details,/No internet since morning/);assert.match(t.details,/254712345678/);
 }finally{await app.close();}
});
