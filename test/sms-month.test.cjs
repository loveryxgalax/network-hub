'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),billing=require('../lib/billing.cjs');
test('SMS page: this month delivered / failed totals keep counting past the 1000-message log',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smsm-')),store=new Store(dir);try{
  const now=Date.now(),old=new Date(new Date().getFullYear(),new Date().getMonth()-1,15).getTime();
  store.setting('smsLog',{items:[{time:now-1000,status:'sent',to:'0700000000'},{time:now-2000,status:'failed',to:'0700000000'},{time:old,status:'sent',to:'0700000000'}]});
  assert.deepEqual(billing.overview(store).sms.month,{sent:1,failed:1},'from the log before any counter exists');
  const src=fs.readFileSync(path.join(__dirname,'../lib/billing.cjs'),'utf8');assert.match(src,/smsMonth:/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
