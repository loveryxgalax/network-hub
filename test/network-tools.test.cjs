'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),customers=require('../lib/customers.cjs'),backups=require('../lib/backups.cjs'),upgrades=require('../lib/upgrades.cjs'),radius=require('../lib/radius.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nt-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const empty={ok:true,truncated:false,rows:[]};
const report=(rows,extra={})=>customers.normalize({schema:2,tables:{ppp:{ok:true,truncated:false,rows},dhcp:empty,arp:empty,hotspot:empty,neighbor:empty},events:[],...extra});
const ppp=n=>Array.from({length:n},(_,i)=>({ip:'10.1.1.'+(i+2),mac:'AA:BB:CC:00:00:'+(i+16).toString(16).padStart(2,'0'),name:'u'+i,status:'connected',service:'pppoe',uptime:'0:10:00',sessionId:'*'+i,rx:1000,tx:1000}));
test('config backups keep versions, ignore timestamp lines and flag changes',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'CCR',type:'router'});
  const exp=(t,body)=>backups.normalize({name:'CCR',text:`# ${t} by RouterOS 7.24.5\n/ip address\nadd address=10.0.0.1/24 interface=ether1\n${body}`});
  assert.equal(backups.ingest(store,r,exp('2026-10-26 03:00:01',''),1).changed,true);
  assert.equal(backups.ingest(store,r,exp('2026-10-27 03:00:02',''),2).changed,false,'only the date line differs');
  assert.equal(backups.ingest(store,r,exp('2026-10-28 03:00:02','/ip firewall filter\nadd chain=input action=drop\n'),3).changed,true);
  const o=backups.overview(store)[0].items;assert.equal(o.length,2);assert.equal(o[0].added,2);assert.equal(o[0].removed,0);
  assert.equal(store.list('alerts').filter(a=>a.logKey==='config-changed').length,1);
  assert.throws(()=>backups.normalize({text:'hello world'}),/RouterOS export/);
 }finally{done();}
});
test('upgrade tracker compares versions and orders routers least critical first',async()=>{
 const {store,done}=fx();try{
  store.put('devices',{name:'CCR',type:'router',metrics:{model:'CCR2004-1G-12S+2XS',version:'7.20 (stable)'}});store.put('devices',{name:'RBX',type:'router',metrics:{model:'RB951Ui-2HnD',version:'7.25 (stable)'}});store.put('devices',{name:'HEX',type:'router',metrics:{model:'RB760iGS',version:'7.24.5 (stable)'}});
  const o=await upgrades.overview(store,'stable',async()=>({ok:true,text:async()=>'7.25 1761000000\n'}),Date.now()+1e9);
  assert.equal(o.newest,'7.25');assert.deepEqual(o.routers.map(r=>r.name),['RBX','HEX','CCR']);assert.deepEqual(o.routers.map(r=>r.behind),[false,true,true]);
 }finally{done();}
});
test('a sudden drop of PPPoE customers is one critical alert that clears on recovery; heavy users are flagged',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'CCR',type:'router'}),t0=Date.UTC(2026,9,26,6,0,0);
  for(let i=0;i<5;i++)customers.ingest(store,r,report(ppp(20)),t0+i*120000);
  customers.ingest(store,r,report(ppp(4)),t0+5*120000);
  let a=store.list('alerts').filter(x=>x.logKey==='drop:ppp');assert.equal(a.length,1);assert.equal(a[0].severity,'critical');assert.match(a[0].title,/PPPoE customers dropped/);
  customers.ingest(store,r,report(ppp(5)),t0+6*120000);assert.equal(store.list('alerts').find(x=>x.logKey==='drop:ppp').status,'Open','still down');
  customers.ingest(store,r,report(ppp(19)),t0+7*120000);assert.equal(store.list('alerts').find(x=>x.logKey==='drop:ppp').status,'Resolved');
  // heavy user: 6 ten-minute samples at 90% of a 5 Mbps plan
  const plan=store.put('plans',radius.plan({name:'Home 5',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days'}));store.put('subscribers',radius.subscriber(store,{name:'U0',username:'u0',service:'pppoe',planId:plan.id,expiresAt:t0+30*864e5}));
  const key='ppp:u0',s=store.setting('customerDiscovery:'+r.id);const o=s.observations.find(x=>x.evidence.ppp?.name==='u0');o.trafficHistory=Array.from({length:6},(_,i)=>({time:t0+8*120000-(5-i)*600000+1,downloadMbps:4.5,uploadMbps:.5}));store.setting('customerDiscovery:'+r.id,s);
  customers.ingest(store,r,report(ppp(20)),t0+8*120000);assert.equal(store.list('alerts').filter(x=>x.logKey==='heavy:u0'&&x.status!=='Resolved').length,1);
 }finally{done();}
});
