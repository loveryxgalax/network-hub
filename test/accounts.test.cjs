'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs'),comp=require('../lib/compensation.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ac-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const home={name:'Home',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days'};
test('never-paid accounts are "unpaid", lapsed ones "expired", and paying turns them active',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan(home));
  const fresh=store.put('subscribers',radius.subscriber(store,{name:'New',username:'new1',service:'pppoe',planId:p.id}));radius.setPassword(store,fresh.id,'pw123456');
  const old=store.put('subscribers',radius.subscriber(store,{name:'Old',username:'old1',service:'pppoe',planId:p.id,expiresAt:Date.now()+1000}));
  assert.equal(radius.stateOf(fresh,Date.now()+5),'unpaid');assert.equal(radius.stateOf(store.get('subscribers',old.id),Date.now()+5000),'expired');
  const o=radius.overview(store,Date.now()+5000);assert.equal(o.counts.unpaid,1);assert.equal(o.counts.expired,1);
  billing.pay(store,fresh.id,{amount:1500,reference:'PAYNEW01',method:'cash'});assert.equal(radius.stateOf(store.get('subscribers',fresh.id)),'active');
 }finally{done();}
});
test('expired PPPoE accounts are deactivated after the grace period and reactivated by payment',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan(home)),now=Date.now();
  assert.throws(()=>radius.updateSettings(store,{deactivateAfterDays:3}),/7–365/);radius.updateSettings(store,{deactivateAfterDays:7});
  const a=store.put('subscribers',radius.subscriber(store,{name:'A',username:'a',service:'pppoe',planId:p.id,expiresAt:now-8*864e5,paidEver:true}));
  const b=store.put('subscribers',radius.subscriber(store,{name:'B',username:'b',service:'pppoe',planId:p.id,expiresAt:now-2*864e5,paidEver:true}));
  assert.deepEqual(radius.autoDeactivate(store,now),[a.id]);assert.equal(store.get('subscribers',a.id).status,'suspended');assert.equal(store.get('subscribers',b.id).status,'active');
  billing.pay(store,a.id,{amount:1500,reference:'REACT001',method:'mpesa'});assert.equal(store.get('subscribers',a.id).status,'active');
 }finally{done();}
});
test('installation fee: default for new PPPoE customers, override or waive, settled before the package',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan(home));radius.updateSettings(store,{installFeePppoe:true,installFeeAmount:2000});
  const a=store.put('subscribers',radius.subscriber(store,{name:'A',username:'a',service:'pppoe',planId:p.id}));assert.equal(a.installFeeDue,2000);
  const w=store.put('subscribers',radius.subscriber(store,{name:'W',username:'w',service:'pppoe',planId:p.id,installFee:0}));assert.equal(w.installFeeDue,0);
  const r=billing.pay(store,a.id,{amount:3000,reference:'INST0001',method:'cash'});assert.equal(r.payment.installFee,2000);assert.equal(r.periods,0,'KSh 1,000 left is not a full month');assert.equal(r.balance,1000);
  const r2=billing.pay(store,a.id,{amount:500,reference:'INST0002',method:'cash'});assert.equal(r2.periods,1);assert.equal(store.get('subscribers',a.id).installFeeDue,0);
 }finally{done();}
});
test('outage compensation: preview, version check, idempotent apply, top-up when the outage end moves',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan(home)),now=Date.now(),H=36e5;
  const r1=store.put('devices',{name:'CCR',type:'router'}),r2=store.put('devices',{name:'HEX',type:'router'});
  const mk=(u,exp,nas)=>{const s=store.put('subscribers',radius.subscriber(store,{name:u,username:u,service:'pppoe',planId:p.id,expiresAt:exp,paidEver:true}));store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run('s-'+u,JSON.stringify({username:u,nasName:nas,startedAt:now-10*H,updatedAt:now-5*H}),now,now);return s;};
  const a=mk('a',now+10*24*H,'CCR'),b=mk('b',now-2*H,'CCR'),c=mk('c',now+5*24*H,'HEX');// b expired during the outage
  const out=comp.create(store,{start:now-4*H,end:now-1*H,routerIds:[r1.id],reason:'Fibre cut'},{name:'T'});
  const pv=comp.preview(store,{...out,outageId:out.id},now);assert.deepEqual(pv.items.map(i=>i.username).sort(),['a','b']);
  assert.equal(pv.items.find(i=>i.username==='a').add,3*H);assert.equal(pv.items.find(i=>i.username==='b').add,2*H,'only the paid time inside the outage');
  assert.throws(()=>comp.apply(store,out.id,{version:'stale'},{name:'T'},now),/Preview again/);
  const r=comp.apply(store,out.id,{version:pv.version},{name:'T'},now);assert.equal(r.applied,2);assert.equal(store.get('subscribers',a.id).expiresAt,a.expiresAt+3*H);
  const again=comp.preview(store,{...out,outageId:out.id},now);assert.equal(again.count,0,'nothing more to grant');
  const later=comp.preview(store,{...out,end:now-0.5*H,outageId:out.id},now);assert.equal(later.items.find(i=>i.username==='a').add,0.5*H,'only the extra half hour');
  assert.equal(store.get('subscribers',c.id).expiresAt,c.expiresAt,'other router untouched');
  // ongoing outage: the preview's cut-off minute is reused by apply even if time has moved on
  const on=comp.create(store,{start:now-2*H,service:'pppoe',routerIds:[r2.id]},{name:'T'},now),pv2=comp.preview(store,{...on,outageId:on.id},now);
  const r3=comp.apply(store,on.id,{version:pv2.version,asOf:pv2.asOf},{name:'T'},now+90000);assert.equal(r3.applied,1);
 }finally{done();}
});
