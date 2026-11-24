'use strict';
// Smart assistant: chat help, diagnosis, recovery SMS, sales watch, busy hours, fraud flags, capacity, summary.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),SM=require('../lib/smart.cjs'),TK=require('../lib/tickets.cjs');
const H=36e5,D=864e5;
const withStore=fn=>async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smart-')),store=new Store(dir);try{await fn(store);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}};
const sms=store=>store.secret('sms:config',{provider:'custom',url:'https://sms.example.test/send',apiKey:'k',senderId:'',format:'json',phoneFormat:'254',fields:{apiKey:'api_key',senderId:'sender_id',phone:'phone',message:'message'}});
const lastReply=(store,tid)=>store.list('ticketMessages').filter(m=>m.ticketId===tid&&m.from==='team').sort((a,b)=>b.time-a.time)[0]?.text||'';

test('1. chat: a known M-Pesa code is confirmed with the expiry; an unknown one goes to the team as High priority',withStore(async store=>{
 const now=Date.now(),s=store.put('subscribers',{name:'Jane',username:'kne-aa11bb',service:'hotspot',phone:'+254712345678',status:'active',expiresAt:now+5*H});
 store.put('subscriberPayments',{subscriberId:s.id,amount:20,reference:'UKO384IH3P',time:now-60000});
 const a=TK.chatStart(store,{who:'Jane',phone:'+254712345678',text:'I paid UKO384IH3P but no internet',subscriberId:s.id,customer:'Jane'});
 await SM.chatHelp(store,a.ticket,'I paid UKO384IH3P but no internet',now);const r=lastReply(store,a.ticket.id);
 assert.match(r,/We found your payment of KSh 20 \(UKO384IH3P\) on account KNE-AA11BB/);assert.match(r,/active until/);
 assert.ok(TK.chatView(store,a.token).messages.some(m=>m.from==='team'),'customer sees the reply');
 const b=TK.chatStart(store,{who:'X',phone:'+254700000001',text:'paid ZZZ1234567'});await SM.chatHelp(store,b.ticket,'paid ZZZ1234567',now);
 assert.match(lastReply(store,b.ticket.id),/cannot see the M-Pesa code ZZZ1234567/);assert.equal(store.get('tickets',b.ticket.id).priority,'High');}));

test('1b. chat without a code: the last failed request is explained; asked again only once',withStore(async store=>{
 const now=Date.now();store.put('portalPayments',{kind:'hotspot',phone:'+254711111111',amount:50,status:'failed',reason:'The balance is insufficient for the transaction.',createdAt:now-20*60000});
 const a=TK.chatStart(store,{who:'X',phone:'+254711111111',text:'I paid but not connected'});await SM.chatHelp(store,a.ticket,'I paid but not connected',now);
 assert.match(lastReply(store,a.ticket.id),/did not go through: The balance is insufficient.*No money was taken.*cheaper package/s);
 const n=store.list('ticketMessages').filter(m=>m.from==='team').length;await SM.chatHelp(store,store.get('tickets',a.ticket.id),'paid paid',now+1000);
 assert.equal(store.list('ticketMessages').filter(m=>m.from==='team').length,n,'no repeated answer');}));

test('2. diagnosis: expired package and an offline router are named; a healthy account says so',withStore(async store=>{
 const now=Date.now(),r=store.put('devices',{name:'CCR2004',type:'router',status:'offline'});
 const s=store.put('subscribers',{name:'A',username:'kne-x1',service:'pppoe',status:'active',expiresAt:now-H,routerId:r.id});
 const d=SM.diagnose(store,s,now);assert.equal(d.level,'bad');assert.ok(d.findings.some(f=>/expired/.test(f.text)));assert.ok(d.findings.some(f=>/CCR2004.*offline/.test(f.text)));
 const r2=store.put('devices',{name:'LAB-HEX',type:'router',status:'online',metrics:{cpu:12}}),ok=store.put('subscribers',{name:'B',username:'kne-x2',service:'pppoe',status:'active',expiresAt:now+D,routerId:r2.id});
 store.put('radiusSessions',{username:'kne-x2',mac:'AA:BB:CC:00:00:01',updatedAt:now,startedAt:now-H});
 const d2=SM.diagnose(store,ok,now);assert.equal(d2.level,'ok');assert.match(d2.customer,/no problem on our network/);}));

test('3. recovery SMS: off by default; when on, one cheaper offer per phone per day',withStore(async store=>{
 const now=Date.UTC(2026,10,24,9,0)-3*H+3*H;// 12:00 Nairobi
 sms(store);store.put('plans',{name:'BEST DEAL',price:20,service:'hotspot'});store.put('plans',{name:'DAY',price:50,service:'hotspot'});
 store.put('portalPayments',{kind:'hotspot',phone:'+254722222222',amount:50,status:'failed',reason:'The balance is insufficient for the transaction.',createdAt:now-2*H});
 const sent=[];const fake=async(u,o)=>{sent.push(JSON.parse(o.body));return new Response('{"status":"ok"}',{status:200});};
 assert.equal(await SM.recovery(store,now,fake),0,'off by default');SM.save(store,{recovery:true});
 assert.equal(await SM.recovery(store,now,fake),1);assert.match(sent[0].message,/BEST DEAL for just KSh 20/);assert.equal(await SM.recovery(store,now+H,fake),0,'once per day');}));

test('4. sales watch: a router far below its usual takes opens an alert, recovery closes it',withStore(async store=>{
 const now=Date.now(),r=store.put('devices',{name:'CCR2004',type:'router',status:'online'}),s=store.put('subscribers',{name:'A',username:'kne-s1',service:'hotspot',routerId:r.id});
 for(let d=1;d<=7;d++)store.put('subscriberPayments',{subscriberId:s.id,amount:500,reference:'R'+d,time:now-d*D-H});
 const f=SM.revenueDrop(store,now);assert.equal(f[0].low,true);assert.equal(f[0].usual,500);
 assert.ok(store.list('alerts').some(a=>a.smartKey==='revenue-drop:'+r.id&&a.status==='Open'));assert.ok(store.list('alerts').some(a=>a.smartKey==='payments-stopped'&&a.severity==='critical'));
 store.put('subscriberPayments',{subscriberId:s.id,amount:450,reference:'NOW',time:now-60000});SM.revenueDrop(store,now);
 assert.ok(!store.list('alerts').some(a=>a.smartKey?.startsWith('revenue-drop')&&a.status==='Open'));assert.ok(!store.list('alerts').some(a=>a.smartKey==='payments-stopped'&&a.status==='Open'));}));

test('5. busy hours: quiet hours found from the user counts',withStore(async store=>{
 const now=Date.now(),r=store.put('devices',{name:'R1',type:'router'}),pts=[];
 for(let d=1;d<=7;d++)for(let h=0;h<24;h++){const t=Math.floor((now-d*D)/D)*D+h*H-3*H;pts.push([t,0,h>=18&&h<=22?20:h<6?1:8]);}
 store.setting('onlineSeries:'+r.id,{points:pts});const b=SM.busyHours(store,now)[0];assert.equal(b.peakUsers,20);assert.match(b.quiet,/00:00–06:00/);assert.match(b.suggestion,/off-peak/);}));

test('6. fraud: receipt on two accounts, many devices on one account, usage spike; dismiss works',withStore(async store=>{
 const now=Date.now(),a=store.put('subscribers',{username:'kne-f1',service:'hotspot'}),b=store.put('subscribers',{username:'kne-f2',service:'hotspot'});
 store.put('subscriberPayments',{subscriberId:a.id,amount:20,reference:'UKDUP00001',time:now});store.put('subscriberPayments',{subscriberId:b.id,amount:20,reference:'UKDUP00001',time:now});
 for(let i=0;i<6;i++)store.put('radiusSessions',{username:'kne-f1',mac:'AA:00:00:00:00:0'+i,updatedAt:now,startedAt:now-H});
 const GB=1073741824;for(let d=1;d<=10;d++)store.put('radiusSessions',{username:'kne-f2',mac:'BB:00:00:00:00:01',updatedAt:now-d*D,downloadBytes:0.3*GB});
 store.put('radiusSessions',{username:'kne-f2',mac:'BB:00:00:00:00:01',updatedAt:now,downloadBytes:4*GB});
 const fl=SM.fraud(store,now),types=fl.map(f=>f.type).sort();assert.deepEqual(types,['receipt','sharing','usage']);
 SM.dismissFlag(store,fl.find(f=>f.type==='receipt').key,{name:'Owner'});assert.equal(SM.fraud(store,now).find(f=>f.type==='receipt').status,'dismissed','stays dismissed');}));

test('7. capacity: a rising CPU peak gives days left and opens an alert when close',withStore(async store=>{
 const now=Date.now(),r=store.put('devices',{name:'CCR2004',type:'router'}),ap=store.put('devices',{name:'AP1',type:'ap',apCapacity:30});
 const ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,?,?)');
 for(let d=10;d>=0;d--){ins.run(r.id,now-d*D,1,JSON.stringify({cpu:40+(10-d)*4}));ins.run(ap.id,now-d*D,1,JSON.stringify({clients:10+(10-d)}));}
 const c=SM.capacity(store,now),cpu=c.find(x=>x.metric.startsWith('CPU'));assert.equal(cpu.current,'80%');assert.ok(cpu.daysLeft>=0&&cpu.daysLeft<=3,'about 1 day at +4%/day');
 assert.ok(store.list('alerts').some(a=>a.source==='capacity-forecast'&&/CCR2004/.test(a.title)));const apc=c.find(x=>x.device==='AP1');assert.ok(apc.daysLeft>=8&&apc.daysLeft<=12);}));

test('8. owner summary includes the assistant findings; WhatsApp can carry the summary',withStore(async store=>{
 store.put('alerts',{title:'Sales at CCR2004 are down',source:'revenue-drop',status:'Open',severity:'warning'});
 const txt=require('../lib/summary.cjs').build(store,Date.now());assert.match(txt,/Sales alerts: CCR2004/);
 assert.ok(fs.readFileSync(path.join(__dirname,'../lib/whatsapp.cjs'),'utf8').includes("'summary'"));}));

test('2b. diagnosis ignores old and informational alerts: a customer who just logged in is not told RADIUS is down',withStore(async store=>{
 const now=Date.now(),r=store.put('devices',{name:'hEX S',type:'router',status:'online'});
 const s=store.put('subscribers',{name:'H',username:'kne-edtyfk',service:'hotspot',status:'active',expiresAt:now+H,routerId:r.id});
 store.put('alerts',{title:'hEX S now uses Kade Cloud RADIUS',deviceId:r.id,source:'router-automation',severity:'info',status:'Open'});
 const old=store.put('alerts',{title:'Kade Cloud RADIUS not responding: new customer logins fail',deviceId:r.id,severity:'critical',status:'Open'});
 store.db.prepare("UPDATE records SET updated=?,created=? WHERE kind='alerts' AND id=?").run(now-2*H,now-2*H,old.id);
 store.put('radiusSessions',{username:'kne-edtyfk',mac:'36:76:84:F5:96:82',startedAt:now-4*60000,updatedAt:now,nasName:'hEX S'});
 const d=SM.diagnose(store,s,now);assert.equal(d.level,'ok',JSON.stringify(d.findings));assert.ok(d.findings.some(f=>/Connected now on 1 device through hEX S/.test(f.text)));
 store.put('alerts',{title:'Kade Cloud RADIUS not responding: new customer logins fail',deviceId:r.id,severity:'critical',status:'Open'});
 store.put('radiusSessions',{username:'kne-edtyfk',mac:'36:76:84:F5:96:82',startedAt:now-4*60000,updatedAt:now,nasName:'hEX S',stoppedAt:now-1000});
 assert.equal(SM.diagnose(store,s,now+1000).level,'bad','a fresh RADIUS alert still shows when the customer is not connected');}));
