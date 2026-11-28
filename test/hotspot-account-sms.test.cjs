'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),billing=require('../lib/billing.cjs'),sl=require('../lib/shortlink.cjs'),self=require('../lib/selfservice.cjs');
test('first hotspot payment SMS carries the account number and a short personal link, once',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hsacct-')),store=new Store(dir);sl.setOrigin('https://my.example.test');try{
  store.secret('sms:config',{provider:'custom',url:'https://sms.example.test/send',apiKey:'k',senderId:'',format:'json',phoneFormat:'254',fields:{apiKey:'api_key',senderId:'sender_id',phone:'phone',message:'message'}});
  const sent=[];const fake=async(u,o)=>{sent.push(JSON.parse(o.body).message);return new Response('{"status":"ok"}',{status:200});};
  const plan=store.put('plans',{name:'BEST DEAL',price:20,durationMinutes:60,service:'hotspot'});
  const s=store.put('subscribers',{name:'Hotspot 0712345678',username:'kne-ab12cd',service:'hotspot',phone:'+254712345678',status:'active',planId:plan.id});
  const pay=(amt,ref)=>{const p=store.put('subscriberPayments',{subscriberId:s.id,amount:amt,reference:ref,time:Date.now()});return {payment:p,subscriber:store.get('subscribers',s.id)};};
  await billing.receipt(store,pay(20,'UKA1'),fake);
  assert.match(sent[0],/^Payment of KSh 20 received\. Acc: KNE-AB12CD\. Ref: UKA1\. Your internet is active until .*Check balance & buy again: my\.example\.test\/[A-Za-z0-9]{6,10}\nKade Networks\.$/s);assert.ok(sent[0].length<=160*2,'stays short');
  const code=sent[0].split('/').pop().split('\n')[0],target=sl.resolve(store,code);assert.match(String(target?.target||target?.path||JSON.stringify(target)),/\/portal\/account\.html\?t=/);
  const t=decodeURIComponent(String(target?.target||target?.path||JSON.stringify(target)).split('t=')[1].replace(/"$/,''));assert.equal(self.subscriberOf(store,t)?.id,s.id,'the link opens this customer');
  await billing.receipt(store,pay(20,'UKA2'),fake);assert.match(sent[1],/^Hi .*we received KSh 20 \(UKA2\)/,'second payment: normal SMS');assert.doesNotMatch(sent[1],/Acc:/);
  const p2=store.put('subscribers',{name:'PPPoE',username:'kne-pp0001',service:'pppoe',phone:'+254722000000',status:'active'});
  store.put('subscriberPayments',{subscriberId:p2.id,amount:1500,reference:'UKP1',time:Date.now()});
  await billing.receipt(store,{payment:{amount:1500,reference:'UKP1'},subscriber:p2},fake);assert.doesNotMatch(sent[2],/Acc:/,'PPPoE unchanged');
 }finally{sl.setOrigin('');store.close();fs.rmSync(dir,{recursive:true,force:true});}});
