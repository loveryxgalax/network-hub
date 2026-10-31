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
