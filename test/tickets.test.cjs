'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('support tickets: replies, internal notes, status/priority/assignment history; viewers cannot change them',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tk-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 const as=s=>async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json()};};
 const login=async(email,password)=>{const r=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};};
 try{const o=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'own@example.test',password:'fixture-owner-password-123'})});
  const owner=as({cookie:o.headers.get('set-cookie').split(';')[0],csrf:(await o.json()).csrf});
  const t=(await owner('records/tickets','POST',{title:'No internet',category:'Something else',priority:'High',status:'Open'})).body;assert.equal(t.priority,'High');
  const mate=(await owner('team','POST',{name:'Agent',email:'agent@example.test',role:'support',password:'agent-password-12345'})).body;
  assert.equal((await owner('tickets/'+t.id+'/messages','POST',{text:'We are checking the line'})).status,201);
  assert.equal((await owner('tickets/'+t.id+'/messages','POST',{text:'Fibre cut near the market',internal:true})).status,201);
  assert.equal((await owner('tickets/'+t.id+'/messages','POST',{text:'  '})).status,400);
  assert.equal((await owner('tickets/'+t.id+'/update','POST',{status:'Pending',assigneeId:mate.id})).status,200);
  assert.equal((await owner('tickets/'+t.id+'/update','POST',{assigneeId:'not-a-member'})).status,400);
  const d=(await owner('tickets/'+t.id)).body;assert.equal(d.ticket.status,'Pending');assert.equal(d.ticket.assigneeId,mate.id);
  assert.deepEqual(d.replies.map(m=>m.text),['We are checking the line']);assert.deepEqual(d.notes.map(m=>m.text),['Fibre cut near the market']);
  assert.deepEqual(d.events.map(m=>m.text),['Status: Open → Pending','Assigned to Agent']);
  await owner('team','POST',{name:'Look',email:'look@example.test',role:'viewer',password:'viewer-password-12345'});const viewer=as(await login('look@example.test','viewer-password-12345'));
  const vr=await viewer('tickets/'+t.id+'/update','POST',{status:'Closed'});assert.ok([403].includes(vr.status),'viewer cannot change tickets: '+vr.status);
 }finally{await app.close();}
});
test('campaigns: many prefixed codes, one use counted per payment, edits apply to future uses',()=>{
 const {Store}=require('../lib/store.cjs'),promos=require('../lib/promos.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-')),store=new Store(dir);
 try{assert.throws(()=>promos.createCampaign(store,{title:'X',discount:150,count:5}),/1–100/);assert.throws(()=>promos.createCampaign(store,{title:'X',discount:50,count:5,prefix:'TOOLONGPREFIX'}),/Prefix/);
  const r=promos.createCampaign(store,{title:'Refer a friend',discount:50,prefix:'refer',count:25,maxActivations:1,scope:'hotspot'});
  assert.equal(r.codes.length,25);assert.equal(new Set(r.codes).size,25);assert.ok(r.codes.every(c=>/^REFER[A-Z2-9]{6}$/.test(c)));
  const plan={id:'p1',name:'Day'},code=r.codes[0];assert.equal(promos.apply(store,code,{plan,kind:'hotspot',price:100}).amount,50);
  assert.throws(()=>promos.apply(store,code,{plan,kind:'account',price:100}),/does not apply/);
  promos.redeemed(store,code,{username:'amina',amount:50,discount:50,reference:'QX1'});promos.redeemed(store,code,{username:'amina',amount:50,discount:50,reference:'QX1'});
  let d=promos.campaign(store,r.campaign.id);assert.equal(d.campaign.used,1,'a repeated callback is not counted twice');assert.equal(d.activations.length,1);assert.equal(d.campaign.available,24);
  assert.throws(()=>promos.apply(store,code,{plan,kind:'hotspot',price:100}),/fully used/);
  promos.updateCampaign(store,r.campaign.id,{discount:100,maxActivations:2});assert.equal(promos.apply(store,code,{plan,kind:'hotspot',price:100}).amount,1,'100% off leaves the 1-shilling minimum');
  d=promos.campaign(store,r.campaign.id);assert.equal(d.activations[0].discount,50,'past activations unchanged');
  promos.updateCampaign(store,r.campaign.id,{active:false});assert.throws(()=>promos.apply(store,r.codes[1],{plan,kind:'hotspot',price:100}),/not valid/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('vouchers: import existing codes with a check, one voucher per phone, printable cards',()=>{
 const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),vouchers=require('../lib/vouchers.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vc-')),store=new Store(dir);
 try{const hp=store.put('plans',radius.plan({name:'1 Hour',service:'hotspot',downloadMbps:5,uploadMbps:2,price:20,durationValue:1,durationUnit:'hours'}));store.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}));
  const now=Date.UTC(2026,10,1);const csv='code,expiry_date\nKNE4X7PQ,2026-12-31\nkne9mz2t\nKNE4X7PQ\nshort\nKNEOLD01,2026-01-01\nKNEBAD02,31/12/2026';
  const dry=vouchers.importCodes(store,{planId:hp.id,csv},null,false,now);assert.equal(dry.ready,2);assert.equal(dry.rejected,4);assert.equal(store.list('vouchers').length,0,'a check saves nothing');
  assert.deepEqual(dry.preview.map(r=>r.errors[0]||'ok'),['ok','ok','repeated in this file','code must be 6–12 letters or numbers','already expired','expiry must be YYYY-MM-DD']);
  const done=vouchers.importCodes(store,{planId:hp.id,csv},null,true,now);assert.equal(done.imported,2);
  assert.ok(vouchers.peek(store,'KNE9MZ2T'),'imported code is usable');assert.equal(vouchers.importCodes(store,{planId:hp.id,csv:'KNE9MZ2T'},null,false,now).preview[0].errors[0],'already exists');
  assert.equal(vouchers.redeem(store,'KNE4X7PQ',Date.UTC(2027,0,5)),null,'a code past its own last day does not work');
  const ph=vouchers.phoneBatch(store,{csv:'phone_number,package\n0712345678\n0722000111,Day\n12345\n0733000222,Nope',planId:hp.id},null,true,now);
  assert.equal(ph.made.length,2);assert.equal(ph.rejected,2);assert.deepEqual(ph.made.map(m=>m.planName),['1 Hour','Day']);assert.equal(ph.made[0].phone,'+254712345678');
  const html=vouchers.printPage(store,done.batch.id,{layout:'compact',perPage:18,fields:'name,package,price'});assert.match(html,/KNE9MZ2T/);assert.match(html,/KSh 20/);assert.doesNotMatch(html,/Connect to the WiFi/);
  assert.match(vouchers.printPage(store,done.batch.id,{}),/grid-template-columns:repeat\(3,1fr\)/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('bulk email: audiences are "any of", one email per address, fields filled, every result kept',async()=>{
 const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),mo=require('../lib/mailout.cjs'),email=require('../lib/email.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mo-')),store=new Store(dir);
 try{const now=Date.now(),pp=store.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'})),hp=store.put('plans',radius.plan({name:'1 Hour',service:'hotspot',downloadMbps:5,uploadMbps:2,price:20,durationValue:1,durationUnit:'hours'}));
  const add=(name,u,service,emailAddr,exp)=>store.put('subscribers',radius.subscriber(store,{name,username:u,service,planId:service==='pppoe'?pp.id:hp.id,email:emailAddr,expiresAt:exp}));
  add('Amina Otieno','amina','pppoe','amina@x.co',now+864e5);add('Brian','brian','pppoe','',now+864e5);add('Cate','cate','hotspot','CATE@x.co',now-864e5);add('Cate Two','cate2','pppoe','cate@x.co',now-864e5);
  assert.throws(()=>mo.preview(store,{audiences:['pppoe'],subject:'Hi',body:'Hello {NAME}'}),/Unknown field/);
  let p=mo.preview(store,{audiences:['active-pppoe'],subject:'Your {PACKAGE_NAME}',body:'Hi {CUSTOMER_NAME}, {PACKAGE_SPEED_DOWN} for {PACKAGE_PRICE}. {ISP_NAME}'});
  assert.equal(p.count,1);assert.equal(p.noEmail,1);assert.equal(p.sample[0].subject,'Your Home 10');assert.match(p.sample[0].text,/^Hi Amina Otieno, 10 Mbps for KSh 2,000\. Kade Networks$/);
  p=mo.preview(store,{audiences:['inactive','hotspot'],subject:'S',body:'B'});assert.equal(p.count,1,'same address once');assert.equal(p.duplicates,1);
  assert.throws(()=>mo.start(store,{audiences:['pppoe'],subject:'S',body:'B',confirm:2}),/email provider/);
  email.setConfig(store,{provider:'sendgrid',apiKey:'SG.'+'c'.repeat(30),from:'noc@k.co'});
  assert.throws(()=>mo.start(store,{audiences:['pppoe'],subject:'S',body:'B',confirm:5}),/changed/);
  const job=mo.start(store,{audiences:['pppoe'],subject:'Hello {CUSTOMER_NAME}',body:'B',confirm:2});let n=0;
  await mo.deliver(store,job.id,async()=>{n++;return new Response('',{status:n===1?202:500});});
  const done=store.get('mailouts',job.id);assert.equal(done.status,'done');assert.equal(done.sent,1);assert.equal(done.failed,1);assert.deepEqual(done.recipients.map(r=>r.status).sort(),['failed','sent']);
  await mo.deliver(store,job.id,async()=>{throw new Error('should not resend');});assert.equal(store.get('mailouts',job.id).sent,1,'finished sends are not repeated');
  const t=mo.saveTemplate(store,{name:'Welcome',subject:'Welcome {CUSTOMER_NAME}',body:'Hi'});assert.equal(mo.templates(store).length,1);mo.deleteTemplate(store,t.id);assert.equal(mo.templates(store).length,0);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('advert sales: order from the WiFi page, payment and review are separate, approved advert follows the plan schedule',()=>{
 const {Store}=require('../lib/store.cjs'),ads=require('../lib/adsales.cjs'),engage=require('../lib/engage.cjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ad-')),store=new Store(dir);
 try{assert.throws(()=>ads.savePlan(store,{name:'X',price:0,days:7}),/price/);
  const plan=ads.savePlan(store,{name:'Week, daytime',price:1500,days:7,weekdays:['1','2','3','4','5'],fromHour:8,toHour:18,offered:true});ads.savePlan(store,{name:'Hidden',price:9,days:1,offered:false});
  assert.deepEqual(ads.offered(store).map(p=>p.name),['Week, daytime']);
  assert.throws(()=>ads.order(store,{planId:plan.id,business:'Mama Mboga',phone:'nope'}),/phone/);assert.throws(()=>ads.order(store,{planId:plan.id,business:'Shop',phone:'0712345678',imageUrl:'http://x.co/a.png'}),/https/);
  let o=ads.order(store,{planId:plan.id,business:'Mama Mboga',phone:'0712345678'});assert.equal(o.status,'awaiting-payment');assert.equal(o.ref,'AD0001');
  ads.savePlan(store,{...plan,price:9999},store.get('adPlans',plan.id));assert.equal(store.get('adOrders',o.id).plan.price,1500,'order keeps the price it was bought at');
  assert.throws(()=>ads.step(store,o.id,'approve',{}),/paid order/);
  o=ads.step(store,o.id,'paid',{reference:'QK12ABC'});assert.equal(o.status,'paid-no-artwork','paid but no advert yet');
  o=ads.step(store,o.id,'artwork',{title:'Fresh veg',text:'Delivered daily'});assert.equal(o.status,'review');
  const mon10=Date.UTC(2026,10,2,7,0,0);// Monday 10:00 Nairobi
  o=ads.step(store,o.id,'approve',{startsAt:new Date(mon10).toISOString()});assert.equal(o.status,'running');
  assert.equal(engage.forPortal(store,mon10+60000).ads?.length??engage.forPortal(store,mon10+60000).length,1,'shows on a weekday in hours');
  const sunNoon=Date.UTC(2026,10,8,9,0,0),monNight=Date.UTC(2026,10,2,19,0,0);const n=x=>{const r=engage.forPortal(store,x);return (r.ads||r).length;};
  assert.equal(n(sunNoon),0,'not on Sunday');assert.equal(n(monNight),0,'not after 18:00');
  ads.sweep(store,mon10+8*864e5);assert.equal(store.get('adOrders',o.id).status,'finished');
  const o2=ads.order(store,{planId:plan.id,business:'B',phone:'0712345678'});const dec=ads.step(store,o2.id,'decline',{reason:'Not allowed content'});assert.equal(dec.status,'declined');assert.throws(()=>ads.step(store,o2.id,'paid',{reference:'X'}),/awaiting payment/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
