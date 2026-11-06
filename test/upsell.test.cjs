'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),up=require('../lib/upsell.cjs'),acs=require('../lib/acs.cjs');
const mk=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'up-')));
test('PPPoE line at full speed most evenings gets the next faster package, with devices on its router',()=>{
 const st=mk(),now=Date.now(),r=st.put('devices',{name:'Core',type:'router'});
 const p10=st.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
 st.put('plans',radius.plan({name:'Home 20',service:'pppoe',downloadMbps:20,uploadMbps:10,price:3000,durationValue:30,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Jane Doe',username:'jane',phone:'0712345678',service:'pppoe',planId:p10.id,expiresAt:now+1e9}));
 const hist=[];for(let d=0;d<3;d++)for(let i=0;i<30;i++)hist.push({time:now-d*864e5-i*6e5,downloadMbps:i<24?9.6:1,uploadMbps:1});
 st.setting('customerDiscovery:'+r.id,{observations:[{key:'ppp:jane',lastObserved:now,evidence:{ppp:{name:'jane'}},trafficHistory:hist}]});
 acs.recordHosts(st,[{id:'acs-1',hosts:7,ppp:[{username:'jane'}],serial:'',online:true}],now);
 const x=up.suggestions(st,now)[0];assert.equal(x.id,s.id);assert.equal(x.suggest.name,'Home 20');assert.match(x.reason,/full speed/);assert.equal(x.detail.devices.now,7);
 assert.match(up.message(st,x,'https://x/s/abc'),/Home 20 gives you 20 Mbps for KES 3000/);});
test('hotspot customer buying daily packages is shown the weekly that would have cost less; quiet customers are not',()=>{
 const st=mk(),now=Date.now();
 const day=st.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days'}));
 st.put('plans',radius.plan({name:'Weekly',service:'hotspot',downloadMbps:5,uploadMbps:5,price:250,durationValue:7,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Ann',username:'ann',phone:'0712345678',service:'hotspot',planId:day.id,expiresAt:now+864e5}));
 const q=st.put('subscribers',radius.subscriber(st,{name:'Quiet',username:'q',service:'hotspot',planId:day.id,expiresAt:now+864e5}));
 for(let i=0;i<20;i++)st.put('subscriberPayments',{subscriberId:s.id,amount:50,time:now-i*864e5});st.put('subscriberPayments',{subscriberId:q.id,amount:50,time:now});
 const list=up.suggestions(st,now);assert.equal(list.length,1);assert.equal(list[0].suggest.name,'Weekly');assert.ok(list[0].save>0);assert.match(list[0].reason,/Bought 20 packages for KES 1000 in 20 days/);});
