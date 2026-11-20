'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),overview=require('../lib/overview.cjs');
test('the 7 day range still draws traffic when samples are thinned',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ov-')),store=new Store(dir),now=Date.now();
 try{
  const d=store.put('devices',{name:'CCR',type:'router',driver:'routeros-script',status:'online',lastSeen:now});
  const ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,1,?)');let rx=0,tx=0;
  for(let t=now-7*864e5;t<=now;t+=120000){rx+=3e6;tx+=1e6;ins.run(d.id,t,JSON.stringify({cpu:10,memory:40,interfaces:[{name:'ether1',type:'ether',rx,tx}]}));}
  assert.ok(overview.build(store,'24h').totals.series.length>0);
  assert.ok(overview.build(store,'7d').totals.series.length>10,'7d must not be empty');
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
