'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs'),overview=require('../lib/overview.cjs');
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'network-overview-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};}
const nic=(name,type,rx,tx)=>({name,type,running:true,disabled:false,rx,tx});
test('an empty workspace still produces a complete overview',()=>{
 const {store,done}=fixture();try{const o=overview.build(store,'24h');assert.deepEqual(o.routers,[]);assert.equal(o.customers.total,0);assert.equal(o.revenue.days.length,14);assert.equal(o.totals.series.length,0);assert.equal(o.alerts.open,0);assert.equal(overview.build(store,'bogus').range,'24h');}finally{done();}
});
test('throughput comes from the internet port only, with CPU, memory and customers online over time',()=>{
 const {store,done}=fixture();try{
  const now=Date.parse('2026-10-25T12:00:00Z'),router=store.put('devices',{name:'RB',type:'router',driver:'routeros-script',status:'online',lastSeen:now-10000,metrics:{cpu:30,memory:55,model:'RB951Ui',version:'7.25',uptime:'6h'}});
  const ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,1,?)');
  // Every 30 s for 20 minutes: ether1 (internet) moves 1 MB/s down and 250 kB/s up = 8 and 2 Mbps; the bridge carries more and must be ignored.
  for(let i=0;i<=40;i++){const t=now-20*60000+i*30000,sec=i*30;ins.run(router.id,t,JSON.stringify({cpu:20+i%5,memory:50,interfaces:[nic('ether1','ether',1e6*sec,250000*sec),nic('ether2','ether',3e5*sec,1e5*sec),nic('bridge','bridge',9e6*sec,9e6*sec)]}));}
  store.setting('customerDiscovery:'+router.id,{lastReport:now-60000,tables:{ppp:{count:12},hotspot:{count:40},dhcp:{count:60}},observations:[]});
  overview.recordOnline(store,router,{ppp:{rows:new Array(12)},hotspot:{rows:new Array(40)}},now-600000);overview.recordOnline(store,router,{ppp:{rows:new Array(13)},hotspot:{rows:new Array(41)}},now-1000);overview.recordOnline(store,router,{ppp:{rows:[]},hotspot:{rows:[]}},now-500);
  const o=overview.build(store,'1h',now),r=o.routers[0];
  assert.equal(r.wan,'ether1');assert.equal(r.status,'online');assert.equal(r.downMbps,8);assert.equal(r.upMbps,2);assert.ok(r.series.length>10&&r.series.every(p=>p[1]===8&&p[2]===2));assert.equal(r.cpu,30);assert.equal(r.memory,55);
  assert.equal(o.totals.downMbps,8);assert.ok(o.totals.series.length>5&&o.totals.series.every(p=>p[1]===8));
  assert.equal(r.customers.ppp,12);assert.equal(r.customers.hotspot,40);assert.deepEqual(r.onlineSeries.map(p=>p.slice(1)),[[12,40],[13,41]],'one point per five minutes');
  // A router that stopped reporting is offline and shows no live rate.
  store.put('devices',{...store.get('devices',router.id),lastSeen:now-600000},store.get('devices',router.id));const off=overview.build(store,'1h',now).routers[0];assert.equal(off.status,'offline');assert.equal(off.downMbps,null);
  assert.equal(overview.wanOf([{body:{interfaces:[nic('ether1','ether',0,0),nic('ether2','ether',0,0)]}},{body:{interfaces:[nic('ether1','ether',10,10),nic('ether2','ether',100,100)]}}]),'ether2');assert.equal(overview.wanOf([{body:{interfaces:[nic('ether1','ether',0,0),nic('ether2','ether',0,0)]}},{body:{interfaces:[nic('ether1','ether',10,10),nic('ether2','ether',100,100)]}}],'ether1'),'ether1','an override wins');
 }finally{done();}
});
test('revenue, expiries and customer states are counted in Nairobi days',()=>{
 const {store,done}=fixture();try{
  const now=Date.parse('2026-10-25T20:30:00Z'),// 23:30 Nairobi
   plan=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:100,durationValue:30,durationUnit:'days'}));
  const mk=(u,over={})=>store.put('subscribers',{...radius.subscriber(store,{name:u,username:u,service:'pppoe',planId:plan.id,expiresAt:now+86400000}),...over});
  mk('soon');mk('later',{expiresAt:now+20*86400000});mk('gone',{expiresAt:now-1000});mk('held',{status:'suspended'});
  store.put('subscriberPayments',{subscriberId:'a',username:'soon',name:'Soon',amount:100,reference:'P1',method:'mpesa',time:now-3600000});
  store.put('subscriberPayments',{subscriberId:'a',username:'soon',name:'Soon',amount:250,reference:'P2',method:'cash',time:Date.parse('2026-10-25T21:30:00Z')-86400000*3});
  const o=overview.build(store,'24h',now);
  assert.deepEqual([o.customers.total,o.customers.active,o.customers.expired,o.customers.suspended,o.customers.expiringSoon],[4,2,1,1,1]);
  assert.equal(o.revenue.today,100);assert.equal(o.revenue.week,350);assert.equal(o.revenue.month,350);assert.deepEqual(o.revenue.byMethod,{mpesa:100,cash:250});assert.equal(o.revenue.days.at(-1).day,'2026-10-25');assert.equal(o.revenue.days.at(-1).amount,100);
  assert.deepEqual(o.expiring.map(e=>e.username),['soon']);assert.equal(o.customers.plans[0].name,'Home');assert.equal(o.customers.plans[0].count,2);
 }finally{done();}
});
test('the dashboard page, chart kit and Kade logos are served, and the overview needs a login',async()=>{
 const {createApp}=require('../server.cjs'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-dash-')),app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;
 try{
  const html=await (await fetch(origin+'/')).text();assert.ok(html.indexOf('/workspace.js')<html.indexOf('/dashboard.js'),'dashboard.js loads after workspace.js so it replaces the old page');assert.ok(html.indexOf('/charts.js')<html.indexOf('/dashboard.js'));
  for(const [p,type] of [['/charts.js','javascript'],['/dashboard.js','javascript'],['/dashboard.css','css'],['/img/kade-logo.png','image/png'],['/img/kade-mark.png','image/png'],['/img/favicon.png','image/png']]){const r=await fetch(origin+p);assert.equal(r.status,200,p);assert.match(r.headers.get('content-type'),new RegExp(type),p);}
  assert.equal((await fetch(origin+'/api/overview')).status,401);
 }finally{await app.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('PPPoE customer status matches netops subscribers to what the routers report as connected',()=>{
 const {store,done}=fixture();try{
  const now=Date.parse('2026-10-25T12:00:00Z'),router=store.put('devices',{name:'CCR2004',type:'router',driver:'routeros-script',status:'online',lastSeen:now-1000,metrics:{}});
  const basic=store.put('plans',radius.plan({name:'Basic',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days'})),home=store.put('plans',radius.plan({name:'Standard Home',service:'pppoe',downloadMbps:10,uploadMbps:10,price:2500,durationValue:30,durationUnit:'days'}));
  const mk=(u,plan,over={})=>store.put('subscribers',{...radius.subscriber(store,{name:u,username:u,service:'pppoe',planId:plan.id,expiresAt:now+10*86400000}),...over});
  mk('on1',basic);mk('on2',basic);mk('on3',home);mk('off1',basic);mk('exp-on',home,{expiresAt:now-1000});mk('exp-off',home,{expiresAt:now-1000});mk('held',basic,{status:'suspended'});
  const ob=(name,connected=true)=>({snapshot:{present:true,connected,sessionType:connected?'ppp':null},evidence:{ppp:{name}}});
  store.setting('customerDiscovery:'+router.id,{lastReport:now,tables:{},observations:[ob('on1'),ob('ON2'),ob('on3'),ob('exp-on'),ob('stranger'),ob('off1',false)]});
  const p=overview.build(store,'24h',now).pppoe;
  assert.deepEqual([p.total,p.online,p.offline,p.onlineExpired,p.expired,p.deactivated,p.notInNetops,p.connectedTotal],[7,3,1,1,1,1,1,5]);
  assert.deepEqual(p.byDevice,[{name:'CCR2004',count:4}]);assert.deepEqual(p.byPackage,[{name:'Basic',count:2},{name:'Standard Home',count:2}]);
 }finally{done();}
});
