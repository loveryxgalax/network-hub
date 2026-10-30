'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),speed=require('../lib/speed.cjs'),packages=require('../lib/packages.cjs'),portal=require('../lib/portal.cjs'),billing=require('../lib/billing.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sp-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const rest=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,{type:'string',value:[x]}]));
const base={name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days'};
const login=(store,u,nas='CCR')=>radius.authorize(store,rest({'User-Name':u,'Service-Type':'Framed-User','Framed-Protocol':'PPP','NAS-Identifier':nas}));
test('speed rules: raise, cut and exact by scope; the most specific wins; schedules and end times',()=>{
 const {store,done}=fx();try{const now=Date.now();
  const r=store.put('devices',{name:'CCR',type:'router'}),p=store.put('plans',radius.plan(base));
  const s=store.put('subscribers',radius.subscriber(store,{name:'A',username:'a',service:'pppoe',planId:p.id,expiresAt:now+864e5}));radius.setPassword(store,s.id,'pw123456');
  assert.equal(login(store,'a').attributes['reply:Mikrotik-Rate-Limit'],'5M/10M');
  speed.save(store,{scope:'isp',mode:'raise',downMbps:20,upMbps:10});assert.equal(login(store,'a').attributes['reply:Mikrotik-Rate-Limit'],'10M/20M','everyone raised to at least 20/10');
  speed.save(store,{scope:'router',targetId:r.id,mode:'cut',downMbps:8,upMbps:4});assert.equal(login(store,'a').attributes['reply:Mikrotik-Rate-Limit'],'4M/8M','router cut applies after the ISP raise');
  assert.equal(login(store,'a','HEX').attributes['reply:Mikrotik-Rate-Limit'],'10M/20M','other routers keep the ISP rule');
  const flight=speed.save(store,{scope:'customer',targetId:s.id,mode:'exact',downMbps:50,upMbps:25,until:now+36e5});
  const e=speed.resolve(store,{subscriber:s,plan:p,routerId:r.id,service:'pppoe',baseDown:10,baseUp:5},now);assert.equal(e.downMbps,50);assert.equal(e.steps.length,4);
  assert.equal(speed.resolve(store,{subscriber:s,plan:p,routerId:r.id,service:'pppoe',baseDown:10,baseUp:5},now+2*36e5).downMbps,8,'flight speed ended');
  speed.remove(store,flight.id);
  const night=speed.validate({scope:'isp',mode:'exact',downMbps:30,upMbps:30,schedule:{enabled:'on',days:[0,1,2,3,4,5,6],fromHour:0,toHour:6}});assert.equal(speed.activeNow({...night,enabled:true},Date.UTC(2026,9,26,0,0)),true,'03:00 Nairobi');assert.equal(speed.activeNow({...night,enabled:true},Date.UTC(2026,9,26,9,0)),false);
  assert.throws(()=>speed.validate({scope:'router',mode:'cut',downMbps:1,upMbps:1}),/Choose the router/);
 }finally{done();}
});
test('fair usage: daily period resets at midnight, adaptive steps slow further, routers restrict packages',()=>{
 const {store,done}=fx();try{const now=Date.UTC(2026,9,26,12,0),MB=1048576;
  const r1=store.put('devices',{name:'CCR',type:'router'}),r2=store.put('devices',{name:'HEX',type:'router'});
  assert.throws(()=>radius.plan({...base,fup:{enabled:true,downCapMB:1000,afterDownMbps:4,afterUpMbps:2,tiers:[{downCapMB:500,afterDownMbps:2,afterUpMbps:1}]}}),/bigger download cap/);
  const p=store.put('plans',radius.plan({...base,routerIds:[r1.id],fup:{enabled:true,period:'daily',downCapMB:1000,afterDownMbps:4,afterUpMbps:2,tiers:[{downCapMB:3000,afterDownMbps:1,afterUpMbps:0.5}]}}));
  const s=store.put('subscribers',radius.subscriber(store,{name:'B',username:'b',service:'pppoe',planId:p.id,expiresAt:now+20*864e5}));
  const add=(id,t,bytes)=>store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(id,JSON.stringify({username:'b',startedAt:t-36e5,updatedAt:t,stoppedAt:t,downloadBytes:bytes}),t,t);
  add('y',now-864e5,5000*MB);// yesterday: does not count today
  let st=packages.fupState(store,s,p,radius.planMs(p),now);assert.equal(st.active,false);
  add('t1',now-36e5,1200*MB);st=packages.fupState(store,s,p,radius.planMs(p),now);assert.equal(st.downMbps,4);
  add('t2',now-1800e3,2000*MB);st=packages.fupState(store,s,p,radius.planMs(p),now);assert.equal(st.downMbps,1);assert.equal(st.step,2);
  radius.setPassword(store,s.id,'pw123456');assert.equal(login(store,'b','HEX').status,401,'package only sold on CCR');
 }finally{done();}
});
test('free mode: free logins on chosen routers, expired customers get the free package, paid ones keep theirs',()=>{
 const {store,done}=fx();try{const now=Date.now(),r=store.put('devices',{name:'CCR',type:'router'});
  const paid=store.put('plans',radius.plan(base)),free=store.put('plans',radius.plan({...base,name:'Free',service:'both',downloadMbps:2,uploadMbps:1,price:0}));
  const a=store.put('subscribers',radius.subscriber(store,{name:'A',username:'a',service:'pppoe',planId:paid.id,expiresAt:now+864e5}));radius.setPassword(store,a.id,'pw123456');
  const x=store.put('subscribers',radius.subscriber(store,{name:'X',username:'x',service:'pppoe',planId:paid.id,expiresAt:now-864e5,paidEver:true}));radius.setPassword(store,x.id,'pw123456');
  assert.equal(radius.authorize(store,rest({'User-Name':'free-aabbccddeeff','Service-Type':'Login-User','NAS-Identifier':'CCR'})).status,401);
  assert.throws(()=>radius.updateSettings(store,{freeMode:{enabled:true,until:now-1,planId:free.id}}),/future/);
  radius.updateSettings(store,{freeMode:{enabled:true,until:now+2*36e5,planId:free.id,routerIds:[r.id],reason:'Launch day'}});
  const f=radius.authorize(store,rest({'User-Name':'free-aabbccddeeff','Service-Type':'Login-User','NAS-Identifier':'CCR'}));assert.equal(f.status,200);assert.equal(f.attributes['reply:Mikrotik-Rate-Limit'],'1M/2M');assert.ok(Number(f.attributes['reply:Session-Timeout'])<=7200);
  assert.equal(radius.authorize(store,rest({'User-Name':'free-aabbccddeeff','Service-Type':'Login-User','NAS-Identifier':'HEX'})).status,401,'other routers not included');
  assert.equal(login(store,'a').attributes['reply:Mikrotik-Rate-Limit'],'5M/10M','paid customers keep their package');
  const ex=login(store,'x');assert.equal(ex.status,200);assert.equal(ex.attributes['reply:Mikrotik-Rate-Limit'],'1M/2M');assert.equal(ex.attributes['reply:Mikrotik-Address-List'],undefined,'not restricted during free mode');
  assert.equal(portal.login(store,{free:true,mac:'AA:BB:CC:DD:EE:FF'}).username,'free-aabbccddeeff');
  assert.ok(portal.info(store).freeMode.until>now);
 }finally{done();}
});
test('payments record the package version they were made under',()=>{
 const {store,done}=fx();try{let p=store.put('plans',radius.plan(base));p=store.put('plans',radius.plan({...base,price:1500}),p);p=store.put('plans',radius.plan({...base,price:1500}),p);const s=store.put('subscribers',radius.subscriber(store,{name:'V',username:'v',service:'pppoe',planId:p.id}));
  const r=billing.pay(store,s.id,{amount:1500,reference:'VER00001',method:'cash'});assert.equal(r.payment.planVersion,3);assert.equal(r.payment.planPrice,1500);
 }finally{done();}
});
