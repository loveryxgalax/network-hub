'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),ss=require('../lib/selfservice.cjs'),portal=require('../lib/portal.cjs');
function mk(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tv-'));return new Store(dir);}
test('registered TV signs in by MAC, counts as a device, and can be removed; prefix is configurable',()=>{
 const st=mk(),plan=st.put('plans',{name:'Hour',service:'hotspot',price:10,downloadMbps:5,uploadMbps:5,devices:2,durationValue:1,durationUnit:'hours',validityDays:1});
 const sub=st.put('subscribers',radius.subscriber(st,{name:'T',username:'kne-aaaaaa',service:'hotspot',planId:plan.id,expiresAt:Date.now()+3600000}));
 radius.setPassword(st,sub.id,'1234');
 const req=u=>({'User-Name':u,'Service-Type':'Login-User','NAS-Identifier':'x','Calling-Station-Id':'AA-BB-CC-11-22-33'});
 assert.equal(radius.authorize(st,req('AA:BB:CC:11:22:33')).status,404,'unknown MAC is rejected');
 ss.addTv(st,st.get('subscribers',sub.id),{mac:'aa-bb-cc-11-22-33',name:'Lounge'});
 assert.equal(radius.authorize(st,req('AA:BB:CC:11:22:33')).status,200,'registered TV is accepted');
 assert.throws(()=>ss.addTv(st,st.get('subscribers',sub.id),{mac:'AA:BB:CC:11:22:33'}),/already/);
 assert.equal(ss.removeTv(st,st.get('subscribers',sub.id),'AA:BB:CC:11:22:33').tvs.length,0);
 assert.equal(radius.authorize(st,req('AA:BB:CC:11:22:33')).status,404);
 assert.equal(portal.settings(st).accountPrefix,'KNE');
 portal.updateSettings(st,{name:'Kade',support:'',accountPrefix:'kd'});assert.equal(portal.settings(st).accountPrefix,'KD');
 assert.throws(()=>portal.updateSettings(st,{name:'Kade',support:'',accountPrefix:'!'}),/prefix/);
 portal.updateSettings(st,{name:'Kade2',support:''});assert.equal(portal.settings(st).accountPrefix,'KD','prefix survives other saves');
});
