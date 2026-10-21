'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),dgram=require('node:dgram');
const snmp=require('net-snmp');
const {snapshot,profile}=require('../lib/snmp.cjs');
test('direct SNMP collector uses authenticated UDP observations and vendor column mappings',async()=>{
 const probe=dgram.createSocket('udp4');await new Promise(resolve=>probe.bind(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const agent=snmp.createAgent({address:'127.0.0.1',port,disableAuthorization:false},()=>{}),mib=agent.getMib();agent.getAuthorizer().addCommunity('qa-private-community');
 agent.getAuthorizer().addUser({name:'qa-v3',level:snmp.SecurityLevel.authPriv,authProtocol:snmp.AuthProtocols.sha256,authKey:'qa-auth-passphrase',privProtocol:snmp.PrivProtocols.aes,privKey:'qa-privacy-passphrase'});
 for(const [name,oid,type,value]of [['sysDescr','1.3.6.1.2.1.1.1',snmp.ObjectType.OctetString,'SNMP fixture OLT'],['sysUpTime','1.3.6.1.2.1.1.3',snmp.ObjectType.TimeTicks,900000]]){mib.registerProvider({name,oid,type:snmp.MibProviderType.Scalar,scalarType:type,maxAccess:snmp.MaxAccess['read-only']});mib.setScalarValue(name,value);}
 const base='1.3.6.1.4.1.99999.1';mib.registerProvider({name:'onus',oid:base,type:snmp.MibProviderType.Table,maxAccess:snmp.MaxAccess['read-only'],tableColumns:[{number:1,name:'index',type:snmp.ObjectType.Integer,maxAccess:snmp.MaxAccess['read-only']},{number:2,name:'serial',type:snmp.ObjectType.OctetString,maxAccess:snmp.MaxAccess['read-only']},{number:3,name:'status',type:snmp.ObjectType.Integer,maxAccess:snmp.MaxAccess['read-only']},{number:4,name:'rx',type:snmp.ObjectType.Integer,maxAccess:snmp.MaxAccess['read-only']},{number:5,name:'pon',type:snmp.ObjectType.OctetString,maxAccess:snmp.MaxAccess['read-only']}],tableIndex:[{columnName:'index'}]});mib.addTableRow('onus',[1,'SNMPONU01',1,-215,'1/1']);mib.addTableRow('onus',[2,'SNMPONU02',2,-350,'1/2']);
 const mapping=JSON.stringify({serialOid:base+'.2',statusOid:base+'.3',rxPowerOid:base+'.4',ponOid:base+'.5',onlineValues:[1],powerScale:0.1});
 try{
  const device={ip:'127.0.0.1',snmpPort:port,snmpMapping:mapping};let result=await snapshot(device,{version:'2c',community:'qa-private-community'});assert.equal(result.source,'snmp');assert.equal(result.model,'SNMP fixture OLT');assert.equal(result.onus.length,2);assert.equal(result.onus[0].online,true);assert.equal(result.onus[0].power,-21.5);assert.equal(result.onus[1].online,false);assert.equal(result.onus[1].pon,'1/2');
  result=await snapshot(device,{version:'3',username:'qa-v3',authProtocol:'sha256',authKey:'qa-auth-passphrase',privKey:'qa-privacy-passphrase'});assert.equal(result.onus[0].serial,'SNMPONU01');
  const basic=await snapshot({...device,snmpMapping:''},{version:'2c',community:'qa-private-community'});assert.equal(basic.onus,undefined);assert.match(basic.onuCoverage,/not configured/);
  await assert.rejects(snapshot(device,{version:'2c',community:'wrong'}),/SNMP collection failed/);
  assert.throws(()=>profile('{'),/valid JSON/);assert.throws(()=>profile('{"serialOid":"1.2.3"}'),/statusOid/);assert.throws(()=>profile('{"serialOid":"garbage"}'),/serialOid/);
 }finally{await new Promise(resolve=>agent.close(resolve));}
});
