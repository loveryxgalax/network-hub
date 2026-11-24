'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),c2b=require('../lib/c2b.cjs'),mpesa=require('../lib/mpesa.cjs');
test('a paybill report of a WiFi-page payment already credited is linked, not "needs assigning", and never credited twice',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'c2bdup-')),store=new Store(dir);try{
  const orig=mpesa.config;mpesa.config=()=>({shortcode:'600000',c2bSecret:'a'.repeat(32)});try{
   const s=store.put('subscribers',{name:'Hotspot 0769384426',username:'kne-79xf2z',service:'hotspot',phone:'+254769384426',status:'active'});
   store.put('subscriberPayments',{subscriberId:s.id,amount:15,reference:'UKO384IH3P',time:Date.now(),method:'mpesa'});
   const body=(id,acct='')=>({TransID:id,TransAmount:'15',BusinessShortCode:'600000',BillRefNumber:acct,FirstName:'Joshua'});
   // WiFi-page payment credited first, paybill report afterwards.
   const r=c2b.confirm(store,body('UKO384IH3P'),Date.now(),{ip:'196.201.214.10'});assert.equal(r.status,'credited');assert.equal(r.via,'portal');
   assert.equal(store.list('subscriberPayments').filter(p=>p.reference==='UKO384IH3P').length,1,'not credited twice');
   const rec=store.list('c2bPayments').find(p=>p.transId==='UKO384IH3P');assert.equal(rec.subscriberId,s.id);
   // Paybill report first (no account typed), WiFi-page credit afterwards: the sweep links it.
   const r2=c2b.confirm(store,body('UKN8L41OHH'),Date.now(),{ip:'196.201.214.10'});assert.equal(r2.status,'unallocated');
   store.put('subscriberPayments',{subscriberId:s.id,amount:15,reference:'UKN8L41OHH',time:Date.now(),method:'mpesa'});
   assert.equal(c2b.reconcile(store),1);assert.equal(store.list('c2bPayments').find(p=>p.transId==='UKN8L41OHH').status,'credited');
   // A real paybill payment with no matching account still waits for a person.
   assert.equal(c2b.confirm(store,body('UKZZZ00001','wrongacct'),Date.now(),{ip:'196.201.214.10'}).status,'unallocated');
  }finally{mpesa.config=orig;}
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
