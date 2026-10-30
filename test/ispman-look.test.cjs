'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),jobs=require('../lib/jobs.cjs'),syslog=require('../lib/syslog.cjs'),presence=require('../lib/presence.cjs'),overview=require('../lib/overview.cjs'),radius=require('../lib/radius.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'il-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
test('system logs: a failed static connect shows as "Static Connected Failed" with the IP, and can be acknowledged',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'CCR2004',type:'router'}),now=Date.now(),u={name:'Owner',email:'o@x.test'};jobs.enroll(store,r.id);
  const s=store.put('subscribers',{name:'Ann',username:'ann',service:'static',status:'active'});
  const j=jobs.create(store,{routerId:r.id,type:'static-apply',params:{ip:'10.27.0.13',mac:'',iface:'bridge',name:'ann',rate:'5M/5M',enabled:'yes'},subscriberId:s.id,user:u},now);
  for(let i=0;i<j.maxAttempts;i++){const at=now+i*36e5,n=jobs.next(store,r.id,at);assert.ok(n,'attempt '+i);jobs.result(store,r.id,n.id,{ok:false,output:'no such item'},at+1000);}
  store.put('portalPayments',{phone:'254712345678',amount:50,status:'failed',reason:'Request cancelled by user',createdAt:now});
  const l=syslog.list(store,{},now+10*36e5),e=l.items.find(x=>x.category==='STATICS');
  assert.equal(e.title,'Static Connected Failed');assert.equal(e.level,'error');assert.match(e.message,/10\.27\.0\.13 on CCR2004: no such item/);assert.deepEqual([e.details.action,e.details.ip],['connected','10.27.0.13']);assert.equal(e.principal.name,'Ann');
  const pay=l.items.find(x=>x.category==='PAYMENTS');assert.equal(pay.level,'info','a customer cancelling is not an error');assert.doesNotMatch(pay.message,/712345/,'phone is masked');
  assert.equal(l.unacknowledged,1);assert.equal(syslog.list(store,{category:'PAYMENTS'},now).items.length,1);assert.equal(syslog.list(store,{q:'10.27.0.13'},now).items.length,1);
  syslog.acknowledge(store,[e.id],u,now);const after=syslog.list(store,{status:'open'},now);assert.equal(after.unacknowledged,0);assert.ok(!after.items.some(x=>x.id===e.id));
  assert.equal(syslog.list(store,{status:'acknowledged'},now).items[0].ack.by,'o@x.test');assert.throws(()=>syslog.acknowledge(store,['<script>'],u),/Nothing/);
 }finally{done();}
});
test('portal presence: counts visitors by service, page and router; drops them after 30 s; one entry per device',()=>{
 presence.reset();const t=1e12;presence.ping({mac:'aa:bb:cc:dd:ee:01',page:'Packages',nas:'HEX S (Ikutha)'},{},t);presence.ping({mac:'AA:BB:CC:DD:EE:01',page:'Purchase Package',nas:'HEX S (Ikutha)'},{},t+5000);
 presence.ping({page:'PPPoE Package',service:'pppoe',tab:'x'},{ip:'1.2.3.4',ua:'u'},t+6000);presence.ping({page:'<b>',nas:'<img>'},{ip:'1.2.3.5',ua:'u'},t+6000);
 let n=presence.now(t+7000);assert.deepEqual([n.total,n.hotspot,n.pppoe],[3,2,1]);assert.equal(n.pages['Purchase Package'],1);assert.equal(n.pages.Packages,1,'unknown page names fall back');assert.equal(n.devices['HEX S (Ikutha)'],1);assert.ok(!Object.keys(n.devices).some(k=>/[<>]/.test(k)));
 n=presence.now(t+6000+31000);assert.equal(n.total,0);
});
test('overview: hotspot and PPPoE status use RADIUS sessions too, with unpaid and a hotspot period',()=>{
 const {store,done}=fx();try{const now=Date.now(),D=864e5;const hp=store.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'})),pp=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
  const mk=(u,svc,exp,extra={})=>{const x=store.put('subscribers',{name:u,username:u,service:svc,planId:svc==='hotspot'?hp.id:pp.id,status:'active',expiresAt:exp,...extra});store.db.prepare("UPDATE records SET created=? WHERE kind='subscribers' AND id=?").run(now-40*D,x.id);};
  mk('h1','hotspot',now+36e5);mk('h2','hotspot',now+36e5);mk('h3','hotspot',now-1000,{paidEver:false});mk('hold','hotspot',now-20*D);
  mk('p1','pppoe',now+5*D);mk('p2','pppoe',now-D);mk('p3','pppoe',now+5*D,{status:'suspended'});
  const sess=(u,svc)=>store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(u,JSON.stringify({username:u,nas:'10.99.0.2',nasName:'CCR',service:svc,startedAt:now-6e4,updatedAt:now-6e4,stoppedAt:null}),now,now);
  sess('h1','hotspot');sess('p1','pppoe');sess('p2','pppoe');
  const o=overview.build(store,'24h',now);
  assert.deepEqual([o.hotspot.total,o.hotspot.online,o.hotspot.offline,o.hotspot.unpaid,o.hotspot.range],[3,1,1,1,'today'],'the old expired account is outside today');
  assert.equal(overview.build(store,'24h',now,{hotspotRange:'month'}).hotspot.total,4);
  assert.deepEqual([o.pppoe.online,o.pppoe.onlineExpired,o.pppoe.deactivated],[1,1,1]);assert.deepEqual(o.pppoe.byDevice,[{name:'CCR',count:2}]);assert.deepEqual(o.hotspot.byPackage,[{name:'Daily',count:1}]);
 }finally{done();}
});
