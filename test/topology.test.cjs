'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {summary}=require('../lib/topology.cjs');
test('topology summary: equipment, users online from router reports, device kinds from the last 24 h',()=>{
 const now=Date.now(),settings={'onlineSeries:r1':{points:[[now-60000,7,30]]},'onlineSeries:r2':{points:[[now-36e5,9,9]]},
  deviceInfo:{byMac:{a:{os:'Android',device:'TECNO KI5',last:now},b:{os:'iOS',device:'iPad',last:now},c:{os:'Windows',device:'Computer',last:now},d:{os:'Android',device:'X',last:now-2*864e5}}}};
 const store={setting:k=>settings[k],list:()=>[{service:'static',status:'active'},{service:'pppoe'}]};
 const map={nodes:[{id:'r1',kind:'router'},{id:'r2',kind:'router'},{id:'n1',kind:'MikroTik'},{id:'n2',kind:'Ubiquiti radio'},{id:'n3',kind:'OLT'}]};
 assert.deepEqual(summary(store,map,now),{routers:2,mikrotiks:3,neighbours:3,accessPoints:1,olts:1,statics:1,hotspot:30,pppoe:7,phones:1,tablets:1,computers:1,other:0});
});
test('hotspot fair usage: capped bundles by share of allowance used; uncapped bundles counted apart',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),fu=require('../lib/fairuse.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fu-')),store=new Store(dir);
 try{const now=Date.now(),MB=1048576;
  const capped=store.put('plans',{...radius.plan({name:'Day 1GB',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}),fup:{enabled:true,period:'package',downCapMB:1000,upCapMB:0,timeCapMinutes:0,afterDownMbps:1,afterUpMbps:1,tiers:[]}});
  const open=store.put('plans',radius.plan({name:'Hour',service:'hotspot',downloadMbps:5,uploadMbps:2,price:10,durationValue:1,durationUnit:'hours'}));
  const used=[100,400,600,900,1200];used.forEach((mb,i)=>{const s=store.put('subscribers',radius.subscriber(store,{name:'U'+i,username:'u'+i,service:'hotspot',planId:capped.id,expiresAt:now+12*36e5}));
   store.put('radiusSessions',{username:s.username,service:'hotspot',startedAt:now-36e5,updatedAt:now-60000,downloadBytes:mb*MB,uploadBytes:0});});
  store.put('subscribers',radius.subscriber(store,{name:'Open',username:'open',service:'hotspot',planId:open.id,expiresAt:now+1800000}));
  store.put('subscribers',radius.subscriber(store,{name:'Gone',username:'gone',service:'hotspot',planId:capped.id,expiresAt:now-1000}));
  const r=fu.summary(store,now);
  assert.equal(r.inUse,6);assert.equal(r.capped,5);assert.equal(r.uncapped,1);
  assert.deepEqual(r.counts,{under30:1,b30:1,b50:1,b80:1,limit:1});assert.equal(r.reachedCustomers,1);
  assert.deepEqual(r.byPlan,[{name:'Day 1GB',capMB:1000,b30:1,b50:1,b80:1,limit:1}]);assert.equal(r.history.length,1);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
