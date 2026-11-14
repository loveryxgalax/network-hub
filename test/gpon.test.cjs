'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),gpon=require('../lib/gpon.cjs'),cpe=require('../lib/cpelink.cjs');
const mk=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'gp-')));
// A made-up Huawei serial (not from any real label).
const LABEL='HWTC1A2B3C4D',HEX='485754431A2B3C4D';
test('label, OLT and ACS forms of a GPON serial are the same ONT',()=>{
 assert.deepEqual(gpon.canon(HEX),{serial:LABEL,hex:HEX,vendorId:'HWTC',vendor:'Huawei',number:'1A2B3C4D'});
 for(const v of ['hwtc1a2b3c4d','HWTC-1A2B3C4D','48575443 1A2B3C4D','48:57:54:43:1a:2b:3c:4d'])assert.equal(gpon.key(v),LABEL,v);
 assert.equal(gpon.canon('ZTEGC0FFEE11').vendor,'ZTE');
 assert.equal(gpon.canon('2150083223AGH2538757'),null,'the long equipment serial is not a GPON serial');
 assert.ok(!gpon.same('CNPILOT123','HWTC1A2B3C4D'));assert.ok(gpon.same('CNPILOT123','cnpilot123'));
});
function seed(){const st=mk(),now=Date.now();
 const p=st.put('plans',radius.plan({name:'Fibre 20',service:'pppoe',downloadMbps:20,uploadMbps:10,price:3000,durationValue:30,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Amina',username:'amina',phone:'0711000111',service:'pppoe',planId:p.id,expiresAt:now+1e9}));
 radius.setPassword(st,s.id,'fibre-pass-1');
 const olt=st.put('devices',{name:'OLT-1',type:'olt'});const onu=st.put('devices',{name:'Amina ONU',type:'onu',parentId:olt.id,serial:HEX,subscriberId:s.id});
 return {st,s,onu,now};}
test('an ONT that checks in to the ACS is matched to the customer assigned to its ONU on the OLT',()=>{
 const {st,s,onu,now}=seed();const m=cpe.match(st,{serial:HEX,ppp:[]},now);
 assert.equal(m.sub.id,s.id);assert.equal(m.onu.id,onu.id);assert.match(m.how,/GPON serial HWTC1A2B3C4D/);
 const r=cpe.register(st,{subscriberId:s.id,serial:HEX,linkedOnuId:onu.id},{id:'system'});
 assert.equal(r.device.gponSerial,LABEL);assert.equal(r.device.vendor,'Huawei');assert.equal(r.device.linkedOnuId,onu.id);assert.equal(r.device.cpeCategory,'Fibre ONT');
 assert.throws(()=>cpe.register(st,{subscriberId:st.put('subscribers',radius.subscriber(st,{name:'B',username:'bee',service:'pppoe',planId:s.planId,expiresAt:now+1e9})).id,serial:LABEL},{id:'u'}),/already registered/,'label form of the same serial is the same ONT');
 assert.deepEqual(cpe.verify(st,[{serial:HEX,manufacturer:'Huawei Technologies Co., Ltd',productClass:'HG8546M'}],now),[HEX]);
});
test('fibre set-up writes the customer PPPoE login once, waits for a WAN, and is off unless switched on',async()=>{
 const {st,s,now}=seed();cpe.register(st,{subscriberId:s.id,serial:LABEL},{id:'system'});const calls=[];
 const acs={task:async(store,id,action,input)=>{calls.push({id,action,...input});return {status:'Executed by ACS',remoteId:'t1'};},askPppLogin:async()=>{calls.push({ask:true});return true;}};
 const row={id:'acs-1',serial:HEX,online:true,manufacturer:'Huawei',productClass:'HG8546M',ppp:[]};
 assert.deepEqual(await cpe.fibre(st,[row],acs,now),{pushed:[],waiting:[]},'off by default');
 radius.updateSettings(st,{acsAutoFibre:true});
 let r=await cpe.fibre(st,[row],acs,now);assert.deepEqual(r.waiting,[LABEL]);assert.equal(calls[0].ask,true);
 assert.equal(st.list('devices').find(d=>d.type==='cpe').fibrePppoe.state,'Needs a PPPoE WAN');
 const path='InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1';
 r=await cpe.fibre(st,[{...row,ppp:[{path,username:''}]}],acs,now);assert.deepEqual(r.pushed,[LABEL]);
 assert.deepEqual(calls.at(-1),{id:'acs-1',action:'pppoe',path,username:'amina',password:'fibre-pass-1'});
 assert.equal(st.list('devices').find(d=>d.type==='cpe').fibrePppoe.state,'Pushed');
 const n=calls.length;await cpe.fibre(st,[{...row,ppp:[{path,username:''}]}],acs,now);assert.equal(calls.length,n,'not pushed twice');
 const mt=seed();radius.updateSettings(mt.st,{acsAutoFibre:true});cpe.register(mt.st,{subscriberId:mt.s.id,serial:LABEL},{id:'system'});
 assert.deepEqual((await cpe.fibre(mt.st,[{...row,manufacturer:'MikroTik',ppp:[{path,username:''}]}],acs,now)).pushed,[],'MikroTik never touched');
});
