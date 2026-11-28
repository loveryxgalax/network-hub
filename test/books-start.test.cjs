'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),ledger=require('../lib/ledger.cjs');
test('start books: earlier entries deleted after a database copy, chain re-linked, wallets untouched',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'books-')),store=new Store(dir);try{
  const cut=Date.parse('2026-11-22T00:00:00+03:00'),s=store.put('subscribers',{name:'A',username:'u1',balance:50});
  ledger.post(store,{subscriberId:s.id,type:'payment',amountMinor:100000,ref:'OLD1',paymentId:'p-old'},cut-5*864e5);
  ledger.post(store,{subscriberId:s.id,type:'payment',amountMinor:2000,ref:'OLD2'},cut-1000);
  ledger.post(store,{subscriberId:s.id,type:'payment',amountMinor:1500,ref:'NEW1',paymentId:'p-new'},cut+1000);
  ledger.post(store,{subscriberId:s.id,type:'reversal',amountMinor:-100000,ref:'OLD1',paymentId:'p-old',reversalOf:'p-old'},cut+2000);
  ledger.post(store,{subscriberId:s.id,type:'payment',amountMinor:1000,ref:'NEW2'},cut+3000);
  ledger.post(store,{type:'test-void',reversalOf:5,ref:'T'},cut+4000);
  assert.throws(()=>ledger.startBooks(store,{date:'2026-11-22',confirm:'yes'}),/Type DELETE/);
  assert.throws(()=>ledger.startBooks(store,{date:'2999-01-01',confirm:'DELETE'}),/future/);
  const r=ledger.startBooks(store,{date:'2026-11-22',confirm:'DELETE',user:{email:'owner@example.test'}},cut+5000);
  assert.equal(r.removed,3,'two old payments and the reversal of an old payment');assert.equal(r.removedCashInMinor,102000);
  assert.ok(fs.existsSync(path.join(dir,'backups',r.backup)),'database copy exists');
  const left=ledger.snapshot(store);assert.deepEqual(left.map(e=>[e.seq,e.ref]),[[1,'NEW1'],[2,'NEW2'],[3,'T']]);
  assert.equal(left[2].reversalOf,2,'test-void points at the renumbered entry');
  assert.deepEqual(ledger.verify(store),{ok:true,entries:3});
  assert.equal(ledger.totals(store).cash.inMinor,1500,'NEW2 is voided as test data');
  assert.equal(store.get('subscribers',s.id).balance,50,'wallet unchanged');
  ledger.post(store,{type:'payment',amountMinor:500,ref:'AFTER'},cut+6000);assert.equal(ledger.verify(store).ok,true,'new entries chain on');
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
