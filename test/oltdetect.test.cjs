'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),oltdetect=require('../lib/oltdetect.cjs');
test('OLTs are picked out of router neighbour reports',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'olt-')),store=new Store(dir);
 try{
  const r=store.put('devices',{name:'CCR',type:'router',driver:'routeros-script'});
  const nb=(key,n)=>({key,mac:n.mac,lastObserved:5,evidence:{neighbor:{observedAt:5,...n}}});
  store.setting('customerDiscovery:'+r.id,{lastReport:5,observations:[
   nb('a',{mac:'00:E0:FC:11:22:33',ip:'10.0.0.5',name:'MA5608T-Ikutha',platform:'',model:'',interface:'sfp-sfpplus1'}),
   nb('b',{mac:'AA:BB:CC:00:00:01',name:'edge',platform:'MikroTik',model:'hEX',interface:'ether3'}),
   nb('c',{mac:'AA:BB:CC:00:00:02',name:'switch-1',platform:'TP-Link',interface:'ether4'}),
   nb('d',{mac:'AA:BB:CC:00:00:03',name:'V1600D8',platform:'VSOL GPON OLT',interface:'sfp-sfpplus2'})]});
  const d=oltdetect.detect(store);
  assert.deepEqual(d.olts.map(x=>x.key).sort(),['a','d']);assert.equal(d.olts.find(x=>x.key==='a').vendor,'Huawei');assert.equal(d.olts.find(x=>x.key==='d').confidence,'high');
  assert.deepEqual(d.others.map(x=>x.key),['c'],'MikroTik neighbours are ignored; other gear is offered manually');
  store.put('devices',{name:'OLT',type:'olt',ip:'10.0.0.5'});assert.equal(oltdetect.detect(store).olts.find(x=>x.key==='a').added,true);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
