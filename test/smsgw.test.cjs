'use strict';
// Android SMS gateway: pairing, queue, claims, outcomes, routing, limits, bundles and HTTP permissions.
// All simulated: no phone and no carrier are involved here.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),G=require('../lib/smsgw.cjs'),billing=require('../lib/billing.cjs');
const withStore=fn=>async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smsgw-')),store=new Store(dir);try{await fn(store);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}};
const paired=(store,now=Date.now(),name='Phone A')=>{const {code,device}=G.addDevice(store,{name},now);const r=G.pair(store,{code,info:{model:'Pixel',battery:80}},now);return {...r,dev:store.get('smsDevices',r.deviceId),devId:device.id};};
const auth=t=>'Bearer '+t;

test('segments: GSM-7 and UCS-2 parts',()=>{assert.equal(G.segments('a'.repeat(160)).parts,1);assert.equal(G.segments('a'.repeat(161)).parts,2);assert.equal(G.segments('a'.repeat(306)).parts,2);assert.equal(G.segments('a'.repeat(307)).parts,3);
 assert.equal(G.segments('€'.repeat(80)).parts,1);assert.equal(G.segments('€'.repeat(81)).parts,2);assert.equal(G.segments('Hi 😀').encoding,'UCS-2');assert.equal(G.segments('x'.repeat(70)+'–').parts,2);});

test('pairing: code works once, expires after 10 minutes, token is checked and only its hash is stored',withStore(async store=>{
 const now=Date.now(),{code}=G.addDevice(store,{name:'Nairobi phone'},now);
 assert.throws(()=>G.pair(store,{code},now+11*60000),/expired/);
 const {code:c2}=G.repair(store,store.list('smsDevices')[0].id,now);const r=G.pair(store,{code:c2,info:{model:'A15'}},now);assert.match(r.token,/^kd1\./);
 assert.throws(()=>G.pair(store,{code:c2},now),/wrong or expired/,'single use');
 const d=store.get('smsDevices',r.deviceId);assert.equal(d.status,'active');assert.ok(!JSON.stringify(d).includes(r.token.split('.')[2]),'secret not stored');
 assert.equal(G.authDevice(store,auth(r.token)).id,r.deviceId);assert.throws(()=>G.authDevice(store,auth(r.token.slice(0,-2)+'xx')),/not valid/);
 const rot=G.rotate(store,d);assert.throws(()=>G.authDevice(store,auth(r.token)),/not valid/,'old token dies on rotation');assert.equal(G.authDevice(store,auth(rot.token)).id,d.id);
 G.revoke(store,d.id);assert.throws(()=>G.authDevice(store,auth(rot.token)),e=>e.revoked===true);}));

test('queue: a job is claimed once, outcomes are idempotent, silent claims become unknown and are never retried',withStore(async store=>{
 const now=Date.now(),{dev}=paired(store,now);G.setConfig(store,{mode:'test',testNumbers:['0712345678']});
 const {job}=G.enqueue(store,{to:'0712345678',message:'Hello',kind:'manual'},now);
 const a=G.claim(store,dev,5,now),b=G.claim(store,dev,5,now);assert.equal(a.length,1);assert.equal(b.length,0,'not handed out twice');
 G.report(store,dev,[{id:job.id,status:'sent'}],now);G.report(store,dev,[{id:job.id,status:'sent'}],now);
 assert.equal(store.get('smsJobs',job.id).status,'sent');assert.equal((store.setting('smsLog').items||[]).filter(x=>x.channel==='android').length,1,'logged once');
 G.report(store,dev,[{id:job.id,status:'delivered'}],now+1000);assert.equal(store.get('smsJobs',job.id).status,'delivered');
 const {job:j2}=G.enqueue(store,{to:'0712345678',message:'Second',kind:'manual'},now);G.claim(store,dev,5,now);
 await G.tick(store,now+11*60000,async()=>{throw new Error('no provider calls');});const u=store.get('smsJobs',j2.id);assert.equal(u.status,'unknown');
 await G.tick(store,now+60*60000,async()=>{throw new Error('no provider calls');});assert.equal(store.get('smsJobs',j2.id).status,'unknown','still unknown: never retried');
 assert.throws(()=>G.resend(store,j2.id,{},null),/may already have been delivered/);assert.ok(G.resend(store,j2.id,{confirm:true},null).job,'manual resend after confirmation');}));

test('duplicates, schedule, test mode and per-minute limits',withStore(async store=>{
 const now=Date.now(),{dev}=paired(store,now);G.setConfig(store,{mode:'test',testNumbers:['0711111111']});
 assert.ok(G.enqueue(store,{to:'0711111111',message:'Same'},now).job);assert.equal(G.enqueue(store,{to:'0711111111',message:'Same'},now+1000).skipped,'duplicate');
 G.enqueue(store,{to:'0722222222',message:'Not a test number'},now);
 const {job:later}=G.enqueue(store,{to:'0711111111',message:'Later',sendAt:now+3600e3},now);assert.equal(later.status,'scheduled');
 const got=G.claim(store,dev,10,now);assert.deepEqual(got.map(j=>j.message),['Same'],'test mode: only test numbers; scheduled waits');
 assert.equal(G.claim(store,dev,10,now+3600e3+1000).map(j=>j.message).join(),'Later','scheduled job due');
 G.updateDevice(store,dev.id,{limits:{perMinute:2}});G.setConfig(store,{mode:'test',testNumbers:['0711111111','0733333333']});
 for(let i=0;i<4;i++)G.enqueue(store,{to:'0733333333',message:'m'+i},now+3700e3);
 assert.equal(G.claim(store,dev,10,now+3700e3).length,2,'up to the limit');assert.equal(G.claim(store,dev,10,now+3700e3+1000).length,0,'limit reached this minute');assert.equal(G.claim(store,dev,10,now+3800e3).length,2,'next minute');}));

test('routing: automatic messages go to the gateway only when on, a phone is online and the type is chosen; OTP stays commercial',withStore(async store=>{
 const now=Date.now(),{dev}=paired(store,now);store.secret('sms:config',{provider:'custom',url:'https://sms.example.test/send',apiKey:'k',senderId:'',format:'json',phoneFormat:'254',fields:{apiKey:'api_key',senderId:'sender_id',phone:'phone',message:'message'}});
 const calls=[];const fake=async(u,o)=>{calls.push(JSON.parse(o.body));return new Response('{"status":"ok"}',{status:200});};
 let r=await billing.sendSms(store,'0712345678','Your package expires soon','reminder',fake,now);assert.equal(r.status,'sent');assert.equal(calls.length,1,'mode off: commercial');
 G.setConfig(store,{mode:'on',routes:{notices:true}});
 r=await billing.sendSms(store,'0712345678','Payment received','payment',fake,now);assert.equal(r.status,'queued');assert.equal(r.channel,'android');assert.equal(calls.length,1);
 r=await billing.sendSms(store,'0712345678','Your PIN is 1234','pin',fake,now);assert.equal(r.status,'sent');assert.equal(calls.length,2,'PIN always commercial');
 r=await billing.sendSms(store,'0712345678','Promo','campaign',fake,now);assert.equal(r.status,'sent');assert.equal(calls.length,3,'promotions not routed unless chosen');
 store.put('smsDevices',{...store.get('smsDevices',dev.id),lastSeen:now-10*60000},store.get('smsDevices',dev.id));
 r=await billing.sendSms(store,'0712345678','Expired notice','expired',fake,now);assert.equal(r.status,'sent');assert.equal(calls.length,4,'phone offline: commercial now');
 G.setConfig(store,{disabled:true});store.put('smsDevices',{...store.get('smsDevices',dev.id),lastSeen:now},store.get('smsDevices',dev.id));
 r=await billing.sendSms(store,'0712345678','Welcome','welcome',fake,now);assert.equal(r.status,'sent','emergency off: commercial');assert.equal(G.claim(store,store.get('smsDevices',dev.id),5,now).length,0,'emergency off: phones get nothing');}));

test('fail-over: unclaimed jobs move to the commercial provider; claimed ones never do',withStore(async store=>{
 const now=Date.now(),{dev}=paired(store,now);G.setConfig(store,{mode:'on',routes:{notices:true},failoverMinutes:5});
 store.secret('sms:config',{provider:'custom',url:'https://sms.example.test/send',apiKey:'k',senderId:'',format:'json',phoneFormat:'254',fields:{apiKey:'api_key',senderId:'sender_id',phone:'phone',message:'message'}});
 const {job:a}=G.enqueue(store,{to:'0712345678',message:'A',kind:'payment'},now),{job:b}=G.enqueue(store,{to:'0712345679',message:'B',kind:'payment'},now);
 G.claim(store,dev,1,now);const calls=[];const fake=async(u,o)=>{calls.push(JSON.parse(o.body).message);return new Response('{"status":"ok"}',{status:200});};
 await G.tick(store,now+6*60000,fake);
 assert.equal(store.get('smsJobs',a.id).status,'sending','claimed one stays with the phone');assert.equal(store.get('smsJobs',b.id).status,'sent');assert.equal(store.get('smsJobs',b.id).channel,'commercial');assert.deepEqual(calls,['B']);}));

test('opt-out: STOP from the phone blocks promotions on every provider; START lifts it',withStore(async store=>{
 const now=Date.now(),{dev}=paired(store,now);assert.equal(G.inbound(store,dev,{from:'+254712345678',keyword:'stop'}).ok,true);
 const r=await billing.sendSms(store,'0712345678','Offer','upsell',async()=>{throw new Error('must not send');},now);assert.equal(r.status,'skipped');
 assert.equal(G.enqueue(store,{to:'0712345678',message:'Promo',kind:'promotion'},now).skipped,'opted out');
 assert.ok(G.enqueue(store,{to:'0712345678',message:'Your receipt',kind:'payment'},now).job,'service messages still go');
 G.inbound(store,dev,{from:'0712345678',keyword:'START'});assert.equal(G.isOptedOut(store,'254712345678'),false);
 assert.equal(G.inbound(store,dev,{from:'0712345678',keyword:'hello there'}).ok,false,'other texts ignored');}));

test('revoking a phone frees its unclaimed jobs; restart recovery marks stale commercial sends unknown',withStore(async store=>{
 const now=Date.now(),{dev}=paired(store,now);G.setConfig(store,{mode:'test',testNumbers:['0712345678']});
 const {job}=G.enqueue(store,{to:'0712345678',message:'Pinned',deviceId:dev.id},now);G.revoke(store,dev.id);assert.equal(store.get('smsJobs',job.id).deviceId,null);
 const c=store.put('smsJobs',{to:'254712345678',message:'x',kind:'manual',channel:'commercial',status:'sending',claimedAt:now-6*60000,sendAt:now,parts:1,createdAt:now});
 await G.tick(store,now,async()=>{throw new Error('no');});assert.equal(store.get('smsJobs',c.id).status,'unknown');}));

test('bundles: FIFO estimate in SMS parts, expiry and low-balance warning',withStore(async store=>{
 const now=Date.now(),{dev}=paired(store,now);G.setConfig(store,{mode:'test',testNumbers:['0712345678'],lowBalance:5});
 G.addBundle(store,{name:'Daily 200',quantity:3,price:10,purchasedAt:now-1000,expiresAt:now+86400e3});G.addBundle(store,{name:'Weekly',quantity:4,price:30,purchasedAt:now-500});
 const {job}=G.enqueue(store,{to:'0712345678',message:'x'.repeat(300)},now);G.claim(store,dev,5,now);G.report(store,dev,[{id:job.id,status:'sent'}],now);
 const {job:j2}=G.enqueue(store,{to:'0712345678',message:'y'.repeat(200)},now+1);G.claim(store,dev,5,now+61000);G.report(store,dev,[{id:j2.id,status:'failed',error:'Generic failure'}],now+61000);
 let b=G.bundles(store,now+62000);assert.equal(b.remaining,5,'7 bought − 2 parts sent; failed not counted');assert.equal(b.low,false);
 b=G.bundles(store,now+2*86400e3);assert.equal(b.remaining,4,'daily bundle expired');assert.equal(b.low,true);}));

test('HTTP: device calls need the token; only admins manage phones; operators can send',withStore(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smsgw-http-'));const {createApp}=require('../server.cjs'),app=createApp({dataDir:dir,collector:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;try{
  const s=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'gw@example.test',password:'fixture-owner-password-123'})});const ck=s.headers.get('set-cookie').split(';')[0],csrf=(await s.json()).csrf;
  const H={'Content-Type':'application/json',Cookie:ck,'X-CSRF-Token':csrf};
  const add=await (await fetch(o+'/api/smsgw/devices',{method:'POST',headers:H,body:JSON.stringify({name:'Kenya phone'})})).json();assert.match(add.code,/^[A-Z2-9]{8}$/);
  assert.equal((await fetch(o+'/api/smsgw/device/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const p=await (await fetch(o+'/api/smsgw/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:add.code,info:{model:'Test'}})})).json();assert.match(p.token,/^kd1\./);
  const hb=await (await fetch(o+'/api/smsgw/device/heartbeat',{method:'POST',headers:{Authorization:'Bearer '+p.token,'Content-Type':'application/json'},body:JSON.stringify({info:{battery:55,network:'4G'}})})).json();assert.equal(hb.enabled,false,'gateway off by default');
  const cfg=await fetch(o+'/api/smsgw/config',{method:'PUT',headers:H,body:JSON.stringify({mode:'test',testNumbers:'0712345678'})});assert.equal(cfg.status,200);
  const sent=await (await fetch(o+'/api/smsgw/send',{method:'POST',headers:H,body:JSON.stringify({to:'0712345678',message:'Hello from the test',idempotencyKey:'k1'})})).json();assert.equal(sent.queued,1);
  const again=await (await fetch(o+'/api/smsgw/send',{method:'POST',headers:H,body:JSON.stringify({to:'0712345678',message:'Hello from the test',idempotencyKey:'k1'})})).json();assert.equal(again.batch,sent.batch,'same idempotency key, same result');
  const t0=Date.now();const cl=await (await fetch(o+'/api/smsgw/device/claim',{method:'POST',headers:{Authorization:'Bearer '+p.token,'Content-Type':'application/json'},body:JSON.stringify({wait:5})})).json();assert.equal(cl.jobs.length,1);assert.ok(Date.now()-t0<3000,'returns at once when work is waiting');
  await fetch(o+'/api/smsgw/device/report',{method:'POST',headers:{Authorization:'Bearer '+p.token,'Content-Type':'application/json'},body:JSON.stringify({results:[{id:cl.jobs[0].id,status:'sent'}]})});
  const ov=await (await fetch(o+'/api/smsgw',{headers:H})).json();assert.equal(ov.stats.today.sent,1);assert.equal(ov.devices[0].online,true);assert.ok(!JSON.stringify(ov).includes('tokenHash'));
  const csv=await (await fetch(o+'/api/smsgw/jobs.csv',{headers:H})).text();assert.match(csv,/Hello from the test/);
  const store=app.store;const op={id:'op1',email:'op@example.test',name:'Op',role:'operator',active:true};
  assert.equal(require('../lib/access.cjs').can(store,op,'smsgw.manage'),false);assert.equal(require('../lib/access.cjs').can(store,op,'messages.send'),true);
 }finally{app.server.close();fs.rmSync(dir,{recursive:true,force:true});}}));
