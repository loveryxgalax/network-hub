'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),vouchers=require('../lib/vouchers.cjs'),landing=require('../lib/landing.cjs');
test('voucher stats: available vs activated in the period, by package and by router',()=>{
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'vs-')));const r=st.put('devices',{name:'HAP-NEW',type:'router',driver:'none'});
 const p=st.put('plans',radius.plan({name:'1 HOUR',service:'hotspot',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'hours'}));
 const out=vouchers.generate(st,{planId:p.id,count:3,length:8},{id:'u'});const code=out.codes[0].code||out.codes[0];
 const sub=vouchers.redeem(st,code);assert.ok(sub);
 st.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions','s1',?,?,?)").run(JSON.stringify({username:sub.username,nasName:'HAP-NEW',startedAt:Date.now(),updatedAt:Date.now()}),Date.now(),Date.now());
 const s=vouchers.stats(st,7);assert.equal(s.available,2);assert.equal(s.activated,1);assert.deepEqual(s.byPackage,[{name:'1 HOUR',n:1}]);assert.deepEqual(s.byRouter,[{name:'HAP-NEW',n:1}]);void r;
 assert.equal(vouchers.stats(st,7,Date.now()+30*864e5).activated,0,'outside the period');
});
test('the voucher option on the WiFi page can be switched off and stays off',()=>{
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'vs-')));assert.equal(landing.get(st).show.vouchers,true);
 const cur=landing.get(st);landing.save(st,{...cur,show:{...cur.show,vouchers:false}});assert.equal(landing.get(st).show.vouchers,false);
});
test('an SMS can go to chosen customers or to all static IP customers',()=>{
 const campaigns=require('../lib/campaigns.cjs');const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'cs-')));
 const p=st.put('plans',radius.plan({name:'H',service:'pppoe',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'days'}));
 const a=st.put('subscribers',radius.subscriber(st,{name:'A',username:'a1',service:'pppoe',planId:p.id,phone:'0711000001'}));
 st.put('subscribers',radius.subscriber(st,{name:'B',username:'b1',service:'pppoe',planId:p.id,phone:'0711000002'}));
 assert.equal(campaigns.preview(st,{segment:'ids',ids:[a.id]}).count,1);assert.equal(campaigns.preview(st,{segment:'pppoe'}).count,2);assert.equal(campaigns.preview(st,{segment:'static'}).count,0);
 assert.throws(()=>campaigns.preview(st,{segment:'ids',ids:[]}),/at least one/);
});
