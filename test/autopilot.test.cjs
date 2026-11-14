'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),ap=require('../lib/autopilot.cjs'),billing=require('../lib/billing.cjs');
const MIN=6e4,DAY=864e5,mk=()=>{const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'ap-')));st.secret('sms:config',{provider:'custom',url:'https://sms.example.test/send',apiKey:'k',senderId:'KADE',format:'json',phoneFormat:'254'});return st;};
// Capture SMS instead of sending: the custom provider posts to fetch.
let sent=[];const realFetch=global.fetch;test.beforeEach(()=>{sent=[];global.fetch=async(url,opt)=>{sent.push(JSON.parse(opt.body));return new Response('{"status":"ok"}',{status:200});};});test.afterEach(()=>{global.fetch=realFetch;});
const plan=st=>st.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
test('outage: customers on a router down 15+ min get one SMS, and one more when it is back; not when most routers are down',async()=>{
 const st=mk(),now=Date.now(),p=plan(st);const r=st.put('devices',{name:'Core',type:'router',status:'offline',lastSeen:now-20*MIN});st.put('devices',{name:'B',type:'router',status:'online'});st.put('devices',{name:'C',type:'router',status:'online'});
 st.put('subscribers',radius.subscriber(st,{name:'Jane Doe',username:'jane',phone:'0712345678',service:'pppoe',planId:p.id,routerId:r.id,expiresAt:now+DAY}));
 await ap.outages(st,now);assert.equal(sent.length,1);assert.match(sent[0].message,/outage/);
 await ap.outages(st,now+MIN);assert.equal(sent.length,1,'only once');
 st.put('devices',{...st.get('devices',r.id),status:'online',lastSeen:now+2*MIN},st.get('devices',r.id));await ap.outages(st,now+2*MIN);assert.equal(sent.length,2);assert.match(sent[1].message,/back/);
 for(const d of st.list('devices'))st.put('devices',{...d,status:'offline',lastSeen:now-20*MIN},d);sent=[];await ap.outages(st,now+3*MIN);assert.equal(sent.length,0,'network-wide = netops lost contact, stay quiet');});
test('payments: a one-letter typo with the payer name is credited; unclear ones are only suggested',()=>{
 const st=mk(),p=plan(st);const jane=st.put('subscribers',radius.subscriber(st,{name:'Jane Wanjiku',username:'jane12',service:'pppoe',planId:p.id}));st.put('subscribers',radius.subscriber(st,{name:'Jean Otieno',username:'jean12',service:'pppoe',planId:p.id}));
 st.secret('mpesa:config',{shortcode:'123456'});
 const a=st.put('c2bPayments',{transId:'UK1AAA',amount:2000,account:'jane21',payer:'JANE',status:'unallocated',paidAt:Date.now()});
 const b=st.put('c2bPayments',{transId:'UK2BBB',amount:500,account:'jxne12',payer:'PETER',status:'unallocated',paidAt:Date.now()});
 const sa=ap.suggest(st,st.get('c2bPayments',a.id));assert.equal(sa[0].username,'jane12');
 ap.payments(st);assert.equal(st.get('c2bPayments',a.id).status,'credited');assert.equal(st.get('c2bPayments',a.id).username,'jane12');
 assert.equal(st.get('c2bPayments',b.id).status,'unallocated','close username but neither name nor amount agrees: only suggested');assert.equal(ap.suggest(st,st.get('c2bPayments',b.id))[0].username,'jane12');
 const c=st.put('c2bPayments',{transId:'UK3CCC',amount:2000,account:'jeane12',payer:'JANE',status:'unallocated',paidAt:Date.now()});ap.payments(st);assert.equal(st.get('c2bPayments',c.id).status,'unallocated','one letter from two customers: never guessed');});
test('tickets: critical alert → assigned ticket, closed with the alert; customer SMS on open and resolve with a rating link that works',async()=>{
 const st=mk(),now=Date.now(),p=plan(st);ap.save(st,{});const since=st.setting('autopilot').since;
 st.db.prepare("INSERT INTO users(id,email,name,role,password,created) VALUES('t1','t@x.test','Tech One','network-technician','x',?)").run(now);
 const r=st.put('devices',{name:'Core',type:'router'});const al=st.put('alerts',{title:'Core offline',severity:'critical',status:'Open',deviceId:r.id,source:'router-health',logKey:'x'});
 st.db.prepare("UPDATE records SET created=? WHERE kind='alerts' AND id=?").run(since+1,al.id);
 await ap.tickets(st,'https://netops.example.test',since+20*MIN);let t=st.list('tickets').find(x=>x.alertId===al.id);assert.ok(t);assert.equal(t.assigneeId,'t1');
 st.put('alerts',{...st.get('alerts',al.id),status:'Resolved'},st.get('alerts',al.id));await ap.tickets(st,'',since+21*MIN);assert.equal(st.get('tickets',t.id).status,'Resolved');
 const s=st.put('subscribers',radius.subscriber(st,{name:'Ann',username:'ann',phone:'0712345678',service:'pppoe',planId:p.id}));const ct=st.put('tickets',{title:'No internet',status:'Open',subscriberId:s.id});
 await ap.tickets(st,'https://netops.example.test',now);assert.match(sent.at(-1).message,/received your request/);
 st.put('tickets',{...st.get('tickets',ct.id),status:'Resolved'},st.get('tickets',ct.id));await ap.tickets(st,'https://netops.example.test',now);
 const m=/rate\.html\?t=([^ ]+)/.exec(sent.at(-1).message)||/\/s\/[A-Za-z0-9]{7}/.exec(sent.at(-1).message);assert.ok(m,'rating link in the SMS: '+sent.at(-1).message);
 const tok=ct.id+'.'+'bad';assert.throws(()=>ap.rate(st,tok,5),/not valid/);
 const good=ap.rateLink(st,'https://x',st.get('tickets',ct.id)).split('t=')[1];ap.rate(st,decodeURIComponent(good),4);assert.equal(st.get('tickets',ct.id).rating,4);});
test('overdue tickets are escalated once',async()=>{const st=mk(),now=Date.now();ap.save(st,{ticketSlaHours:2});const since=st.setting('autopilot').since;
 const t=st.put('tickets',{title:'Slow',status:'Open',priority:'Normal'});st.db.prepare("UPDATE records SET created=?,updated=? WHERE kind='tickets' AND id=?").run(since+1,since+1,t.id);
 await ap.tickets(st,'',since+3*36e5);assert.equal(st.get('tickets',t.id).priority,'High');assert.ok(st.list('alerts').some(a=>a.logKey==='ticket:'+t.id));});
test('welcome SMS after installation, then a ticket if the line is unused after 3 days',async()=>{
 const st=mk(),now=Date.now(),p=plan(st);ap.save(st,{});const since=st.setting('autopilot').since;
 const s=st.put('subscribers',radius.subscriber(st,{name:'Neo Kim',username:'neo',phone:'0712345678',service:'pppoe',planId:p.id}));
 st.put('onboarding',{name:'Neo Kim',stage:'installed',subscriberId:s.id,history:[{at:since+1,stage:'installed'}]});
 await ap.welcome(st,'https://netops.example.test',since+MIN);assert.match(sent[0].message,/Welcome to Kade Networks, Neo/);
 await ap.welcome(st,'',since+2*MIN);assert.equal(sent.length,1,'once');
 await ap.welcome(st,'',since+4*DAY);assert.ok(st.list('tickets').some(t=>/not using the line/.test(t.title)));});
test('stock below minimum opens an alert and clears when restocked; SMS credit failures raise an alert',async()=>{
 const st=mk(),sr=require('../lib/stockreq.cjs');const it=st.put('stock',{name:'ONT',unit:'pcs',minimum:5});
 ap.stock(st);assert.ok(st.list('alerts').some(a=>a.logKey==='stock-low'&&a.status==='Open'));
 sr.receive(st,{stockId:it.id,quantity:10,unitCost:1000,reason:'buy'},{name:'x'});ap.stock(st);assert.ok(!st.list('alerts').some(a=>a.logKey==='stock-low'&&a.status==='Open'));
 st.setting('smsLog',{items:[{status:'failed',detail:'1009 insufficient credit'},{status:'failed',detail:'insufficient credit'}]});await ap.smsCredit(st);assert.ok(st.list('alerts').some(a=>a.logKey==='sms-credit'&&a.status==='Open'));});
test('self-healing: a full DNS cache on a router with the job runner is flushed once; summary lists what needs attention',()=>{
 const st=mk(),jobs=require('../lib/jobs.cjs'),now=Date.now(),r=st.put('devices',{name:'Core',type:'router',status:'offline'});jobs.enroll(st,r.id);
 st.put('alerts',{title:'DNS cache is full',severity:'critical',status:'Open',deviceId:r.id,source:'router-log',logKey:'dns-cache-full'});
 ap.selfHeal(st,now);ap.selfHeal(st,now+MIN);const q=st.list('routerJobs').filter(j=>j.type==='dns-flush');assert.equal(q.length,1);assert.match(jobs.TYPES['dns-flush'].script({}),/\/ip dns cache flush/);
 st.put('c2bPayments',{transId:'UKX',amount:300,account:'nobody',status:'unallocated'});
 const txt=require('../lib/summary.cjs').build(st,now);assert.match(txt,/Down: Core/);assert.match(txt,/1 unmatched paybill payment/);});
test('pool forecast warns when an address pool will fill within two weeks',()=>{const st=mk(),r=st.put('devices',{name:'Core',type:'router'}),now=Date.now();
 for(let d=10;d>=0;d--){st.setting('routerHealth:'+r.id,{time:now-d*DAY,pools:[{name:'ppp',ranges:'10.0.0.2-10.0.0.201',used:100+(10-d)*6}]});ap.poolForecast(st,now-d*DAY);}
 const a=st.list('alerts').find(x=>x.logKey==='pool-forecast:ppp'&&x.status==='Open');assert.ok(a,'alert');assert.match(a.title,/full in about \d+ days/);assert.match(a.details,/Add about \d+ more addresses/);});
test('installed customer who pays moves to Completed; domain expiry from RDAP; low stock opens one reorder ticket, closed on restock',async()=>{
 const st=mk(),now=Date.now(),p=plan(st),s=st.put('subscribers',radius.subscriber(st,{name:'Neo',username:'neo',service:'pppoe',planId:p.id,expiresAt:now+DAY}));
 const o=st.put('onboarding',{name:'Neo',stage:'installed',subscriberId:s.id,history:[]});st.put('subscriberPayments',{subscriberId:s.id,amount:2000});
 ap.activate(st,now);assert.equal(st.get('onboarding',o.id).stage,'completed');
 const f=async()=>new Response(JSON.stringify({events:[{eventAction:'expiration',eventDate:new Date(now+10*DAY).toISOString()}]}),{status:200});
 const d=await ap.domainCheck(st,'https://netops.kadenetworks.com',f,now);assert.equal(d.days,10);assert.equal(st.setting('domainCheck').domain,'kadenetworks.com');assert.ok(st.list('alerts').some(a=>a.logKey==='domain'&&a.status==='Open'));
 const sr=require('../lib/stockreq.cjs'),it=st.put('stock',{name:'ONT',unit:'pcs',minimum:5,unitCost:2500});sr.receive(st,{stockId:it.id,quantity:2,unitCost:2500,reason:'start'},{name:'x'});
 ap.reorder(st,now);ap.reorder(st,now);const t=st.list('tickets').filter(x=>x.stockId===it.id);assert.equal(t.length,1);assert.match(t[0].title,/Reorder: ONT \(buy 8 pcs\)/);
 sr.receive(st,{stockId:it.id,quantity:10,unitCost:2500,reason:'bought'},{name:'x'});ap.reorder(st,now);assert.equal(st.get('tickets',t[0].id).status,'Resolved');});
test('morning summary reports yesterday',()=>{const st=mk(),now=Date.now();st.put('subscriberPayments',{subscriberId:'x',amount:700,time:now-DAY});
 const txt=require('../lib/summary.cjs').build(st,now,{yesterday:true});assert.match(txt,/yesterday/);assert.match(txt,/Revenue KSh 700/);});
