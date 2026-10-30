'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const connectors=require('../lib/connectors.cjs');
test('TR-069: CPE PPPoE login is read from the ACS and written with setParameterValues',async()=>{
 const calls=[],row={_id:'ONT-1',_lastInform:new Date().toISOString(),InternetGatewayDevice:{DeviceInfo:{Manufacturer:{_value:'Huawei'},ModelName:{_value:'HG8145V5'}},WANDevice:{1:{WANConnectionDevice:{2:{WANPPPConnection:{1:{Username:{_value:'old-user'}}}}}}}}};
 const orig=connectors.request;connectors.request=async(base,resource,cred,method='GET',payload)=>{calls.push({resource,method,payload});if(method==='POST')return {status:202,body:{_id:'task-1'}};return {status:200,body:[row],serverTime:Date.now()};};
 delete require.cache[require.resolve('../lib/acs.cjs')];const acs=require('../lib/acs.cjs');
 const {Store}=require('../lib/store.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'acs-')),store=new Store(dir);
 try{store.setting('acs',{origin:'https://acs.example.test',onlineMinutes:15});store.secret('integration:acs',{username:'u',password:'p'});
  const list=await acs.list(store);assert.deepEqual(list[0].ppp,[{path:'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1',username:'old-user'}]);
  await assert.rejects(acs.task(store,'ONT-1','pppoe',{username:'bad user',password:'secret12'}),/username/);
  const r=await acs.task(store,'ONT-1','pppoe',{username:'jane',password:'secret12'});assert.equal(r.remoteId,'task-1');
  const post=calls.find(c=>c.method==='POST');assert.equal(post.payload.name,'setParameterValues');assert.deepEqual(post.payload.parameterValues[0],['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.Username','jane','xsd:string']);
 }finally{connectors.request=orig;delete require.cache[require.resolve('../lib/acs.cjs')];store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
