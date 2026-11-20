'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),onboarding=require('../lib/onboarding.cjs'),stockreq=require('../lib/stockreq.cjs'),domain=require('../lib/domain.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ops-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const u={id:'u1',email:'m@x.test',role:'manager'};
test('onboarding: stages need their facts, scheduling makes a work order, completion needs the account',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
  assert.throws(()=>onboarding.create(store,{name:''},u),/name/);assert.throws(()=>onboarding.create(store,{name:'X',phone:'123'},u),/phone/);
  let x=onboarding.create(store,{name:'Mary Wanjiku',phone:'0712345678',location:'Kahawa West',planId:p.id,installFee:1000},u);assert.equal(x.stage,'lead');
  assert.throws(()=>onboarding.update(store,x.id,{stage:'scheduled'},u),/installation date/);
  x=onboarding.update(store,x.id,{stage:'scheduled',installAt:Date.now()+864e5},u);assert.ok(x.jobId);assert.equal(store.get('jobs',x.jobId).type,'Installation');
  assert.throws(()=>onboarding.update(store,x.id,{stage:'completed'},u),/customer account/);
  const c=onboarding.convert(store,x.id,{},u);assert.equal(c.subscriber.planId,p.id);assert.equal(c.subscriber.installFeeDue,1000);assert.equal(radius.stateOf(c.subscriber),'unpaid');assert.ok(c.password);
  assert.throws(()=>onboarding.convert(store,x.id,{},u),/Already/);
  x=onboarding.update(store,x.id,{stage:'completed'},u);assert.equal(x.stage,'completed');assert.equal(x.history.length>=3,true);
  const y=onboarding.create(store,{name:'Lost one'},u);assert.throws(()=>onboarding.update(store,y.id,{stage:'lost'},u),/why/);assert.equal(onboarding.update(store,y.id,{stage:'lost',lostReason:'Too far from fibre'},u).stage,'lost');
  const b=onboarding.board(store);assert.equal(b.stages.find(s=>s.key==='completed').items.length,1);
 }finally{done();}
});
test('stock: requests need approval, issue costs FIFO and cannot exceed stock; tickets link to customers',()=>{
 const {store,done}=fx();try{const item=store.put('stock',{name:'ONU',unit:'pcs',minimum:2,unitCost:2000});
  stockreq.receive(store,{stockId:item.id,quantity:3,unitCost:2000},u);stockreq.receive(store,{stockId:item.id,quantity:5,unitCost:2500},u);
  assert.equal(stockreq.onHand(store,item.id),8);
  const r=stockreq.request(store,{stockId:item.id,quantity:4,reason:'Kahawa installs'},{id:'t1',email:'t@x.test'});
  assert.throws(()=>stockreq.decide(store,r.id,'issue',u),/Approve it first/);
  stockreq.decide(store,r.id,'approve',u);const issued=stockreq.decide(store,r.id,'issue',u);assert.equal(issued.cost,3*2000+1*2500);assert.equal(stockreq.onHand(store,item.id),4);
  assert.equal(stockreq.overview(store).items[0].value,4*2500);
  const r2=stockreq.request(store,{stockId:item.id,quantity:9,reason:'too many'},u);assert.throws(()=>stockreq.decide(store,r2.id,'approve',u),/Only 4/);
  const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'})),s=store.put('subscribers',radius.subscriber(store,{name:'Tom',username:'tom1',service:'pppoe',planId:p.id}));
  const t=domain.validate('tickets',{title:'No internet',subscriberId:s.id},null,store);assert.equal(t.customer,'Tom');
  assert.throws(()=>domain.validate('tickets',{title:'x',subscriberId:'nope'},null,store),/does not exist/);
 }finally{done();}
});
