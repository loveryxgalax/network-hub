'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),cl=require('../lib/cleanup.cjs'),radius=require('../lib/radius.cjs');
const admin={id:'a1',name:'Admin',email:'a@x.test'};
function mk(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cl-')),st=new Store(dir);
 st.db.prepare("INSERT INTO users(id,email,name,role,password,active,created) VALUES('a1','a@x.test','Admin','admin','h',1,1),('o1','o@x.test','Op','operator','h',1,1)").run();return st;}
test('delete data: items, cascade, confirmation, plan-in-use guard, logs, staff, backup',()=>{
 const st=mk(),plan=st.put('plans',radius.plan({name:'P',service:'hotspot',downloadMbps:1,uploadMbps:1,price:10,durationValue:1,durationUnit:'hours'}));
 const c=st.put('subscribers',radius.subscriber(st,{name:'Cust',username:'c1',service:'hotspot',planId:plan.id}));
 st.put('subscriberPayments',{subscriberId:c.id,username:'c1',amount:10});const t=st.put('tickets',{title:'T'});st.put('ticketMessages',{ticketId:t.id,text:'x'});
 st.setting('smsLog',{items:[1,2,3]});st.put('alerts',{title:'A'});
 const ov=cl.overview(st,admin);assert.equal(ov.find(x=>x.id==='customers').count,1);assert.equal(ov.find(x=>x.id==='sms-log').count,3);assert.equal(ov.find(x=>x.id==='staff').count,1);
 assert.equal(cl.items(st,'customers').items[0].title,'Cust');
 assert.throws(()=>cl.remove(st,'alerts',{all:true,confirm:'no'},admin),/Type DELETE/);
 assert.throws(()=>cl.remove(st,'plans',{all:true,confirm:'DELETE'},admin),/still used/);
 let r=cl.remove(st,'customers',{ids:[c.id],confirm:'DELETE'},admin);assert.equal(r.deleted,1);assert.ok(r.backup&&fs.existsSync(r.backup));
 assert.equal(st.list('subscriberPayments').length,0);assert.equal(cl.remove(st,'plans',{all:true,confirm:'DELETE'},admin).deleted,1);
 cl.remove(st,'tickets',{all:true,confirm:'DELETE'},admin);assert.equal(st.list('ticketMessages').length,0);
 assert.equal(cl.remove(st,'sms-log',{all:true,confirm:'DELETE'},admin).deleted,3);assert.deepEqual(st.setting('smsLog').items,[]);
 cl.remove(st,'alerts',{all:true,confirm:'DELETE'},admin);assert.equal(st.list('alerts').length,0);
 assert.equal(cl.remove(st,'staff',{all:true,confirm:'DELETE'},admin).deleted,1);assert.equal(st.db.prepare('SELECT count(*) n FROM users').get().n,1,'the admin is never deleted');
 assert.throws(()=>cl.remove(st,'nope',{all:true,confirm:'DELETE'},admin),/Unknown/);
});
test('delete data: a router is forgotten through the purge flow',()=>{
 const st=mk(),r=st.put('devices',{name:'TEST-1',type:'router'});st.put('routerJobs',{routerId:r.id,type:'backup-now'});st.secret('jobs:'+r.id,{h:1});
 const out=cl.remove(st,'routers',{ids:[r.id],confirm:'DELETE'},admin);assert.equal(out.deleted,1);assert.equal(st.list('devices').length,0);assert.equal(st.list('routerJobs').length,0);assert.equal(st.secret('jobs:'+r.id),null);
});
