'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),billing=require('../lib/billing.cjs'),radius=require('../lib/radius.cjs');
test('message variables: full name, days left, paybill, account, company',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tv-')),st=new Store(dir);try{
  st.setting('workspace',{name:'Kade Networks'});st.secret('mpesa:config',{type:'paybill',shortcode:'4123456',env:'production'});
  const p=st.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
  const s=st.put('subscribers',radius.subscriber(st,{name:'Mary Wanjiku',username:'kne-n5zrh2',service:'pppoe',planId:p.id,expiresAt:Date.now()+2.5*864e5}));
  const v=billing.values(st,s);
  assert.deepEqual([v.name,v.fullname,v.account,v.paybill,v.company,v.days_left,v.price],['Mary','Mary Wanjiku','kne-n5zrh2','4123456','Kade Networks',3,'2,000']);
  assert.equal(billing.values(st,{name:'X',username:'x'}).plan,'','no package: no crash');
  assert.ok(['welcome','payment','reminder','expired'].every(k=>billing.TEMPLATES[k]));
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
