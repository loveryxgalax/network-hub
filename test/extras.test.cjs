'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs'),vouchers=require('../lib/vouchers.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ex-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const req=(user,nas,extra={})=>({'User-Name':user,'Service-Type':'Framed-User','Framed-Protocol':'PPP','NAS-Identifier':nas,...extra});
test('roaming lock, location and referral fields on customers',()=>{
 const {store,done}=fx();try{const north=store.put('devices',{name:'north',type:'router',driver:'none'}),south=store.put('devices',{name:'south',type:'router',driver:'none'});
  const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1000,durationValue:30,durationUnit:'days'}));
  const s=store.put('subscribers',radius.subscriber(store,{name:'Ann',username:'ann',service:'pppoe',planId:p.id,routerId:north.id,expiresAt:Date.now()+864e5,latitude:'-1.2186',longitude:'36.923',address:'Kahawa West, blue gate'}));radius.setPassword(store,s.id,'secret123');
  assert.equal(s.latitude,-1.2186);assert.equal(s.address,'Kahawa West, blue gate');assert.throws(()=>radius.subscriber(store,{name:'X',username:'x',service:'pppoe',planId:p.id,latitude:'200'}),/latitude/);
  assert.equal(radius.authorize(store,req('ann','south')).status,200,'roaming is allowed by default');
  radius.updateSettings(store,{roaming:'assigned'});assert.equal(radius.authorize(store,req('ann','south')).status,401);assert.equal(radius.authorize(store,req('ann','north')).status,200);
  store.put('subscribers',{...store.get('subscribers',s.id),roaming:'any'},store.get('subscribers',s.id));assert.equal(radius.authorize(store,req('ann','south')).status,200,'per-customer override');
  assert.throws(()=>radius.subscriber(store,{name:'B',username:'bob',service:'pppoe',planId:p.id,referredBy:'nobody'}),/Referred by/);
 }finally{done();}
});
test('referral points on the first payment and daily visit points once a day',()=>{
 const {store,done}=fx();try{billing.setLoyalty(store,{enabled:true,pointsPer100:1,pointValue:1,referralPoints:50,visitPoints:2});
  const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1000,durationValue:30,durationUnit:'days'}));
  const a=store.put('subscribers',radius.subscriber(store,{name:'A',username:'amy',service:'pppoe',planId:p.id})),b=store.put('subscribers',radius.subscriber(store,{name:'B',username:'ben',service:'pppoe',planId:p.id,referredBy:'amy'}));
  billing.pay(store,b.id,{amount:1000,reference:'REF00001',method:'cash'});assert.equal(store.get('subscribers',a.id).points,50);
  billing.pay(store,b.id,{amount:1000,reference:'REF00002',method:'cash'});assert.equal(store.get('subscribers',a.id).points,50,'only the first payment');
  const acct=(id,t)=>radius.accounting(store,{'Acct-Status-Type':'Start','Acct-Session-Id':id,'User-Name':'amy','NAS-IP-Address':'10.0.0.1'},t);
  const t0=Date.parse('2026-10-30T08:00:00+03:00');acct('s1',t0);acct('s2',t0+36e5);assert.equal(store.get('subscribers',a.id).points,52);acct('s3',t0+864e5);assert.equal(store.get('subscribers',a.id).points,54);
  assert.equal(store.setting('pointsLog').items.length,3);
 }finally{done();}
});
test('vouchers: last day to use, single named voucher, apply to an existing hotspot customer',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}));
  assert.throws(()=>vouchers.generate(store,{planId:p.id,count:5,assignedName:'Jo'}),/one voucher/);assert.throws(()=>vouchers.generate(store,{planId:p.id,count:1,validUntil:'2020-01-01'}),/future/);
  const now=Date.now(),g=vouchers.generate(store,{planId:p.id,count:2,validUntil:now+864e5},null,now);
  assert.ok(vouchers.peek(store,g.codes[0]));assert.equal(vouchers.redeem(store,g.codes[0],now+2*864e5),null,'expired batch cannot be redeemed');
  const one=vouchers.generate(store,{planId:p.id,count:1,assignedName:'Jo Doe',assignedPhone:'0712345678'});assert.equal(vouchers.codes(store,one.batch.id)[0].assignedName,'Jo Doe');
  const s=store.put('subscribers',radius.subscriber(store,{name:'Hot',username:'hot1',service:'hotspot',planId:p.id,expiresAt:now+36e5}));
  const r=vouchers.applyTo(store,g.codes[1].toLowerCase(),s.id,now);assert.ok(Math.abs(r.subscriber.expiresAt-(now+36e5+864e5))<5);
  assert.throws(()=>vouchers.applyTo(store,g.codes[1],s.id,now),/already used/);
 }finally{done();}
});
