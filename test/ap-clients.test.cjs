'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),A=require('../lib/aps.cjs');
const tmp=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apc-'));return {dir,store:new Store(dir)};};
test('devices on an AP: named only with a RADIUS login from the same MAC; moves between APs are recorded',()=>{const {dir,store}=tmp();try{
 const a=store.put('devices',{name:'AP-A',type:'ap',driver:'ap-sim'}),b=store.put('devices',{name:'AP-B',type:'ap',driver:'ap-sim'});
 const sub=store.put('subscribers',{name:'Lab User One',username:'lab1',service:'hotspot'});store.put('radiusSessions',{username:'lab1',mac:'aa-bb-cc-dd-ee-01',updatedAt:Date.now()});
 const t0=Date.now()-30*60000;A.track(store,a,[{mac:'AA:BB:CC:DD:EE:01',band:'5 GHz',signal:-55},{mac:'02:5A:00:00:00:09',band:'2.4 GHz',signal:-70}],t0);
 A.track(store,b,[{mac:'aabbccddee01',band:'5 GHz',signal:-60}],t0+5*60000);
 let c=A.clients(store,a.id);assert.equal(c.stations.length,2);const me=c.stations.find(x=>x.mac==='AA:BB:CC:DD:EE:01');assert.equal(me.customer.id,sub.id);assert.match(me.customer.evidence,/RADIUS/);
 assert.equal(c.stations.find(x=>x.mac==='02:5A:00:00:00:09').customer,null,'no proof → not matched');
 c=A.clients(store,b.id);assert.equal(c.moves.length,1);assert.deepEqual([c.moves[0].fromName,c.moves[0].toName,c.moves[0].customer.username],['AP-A','AP-B','lab1']);
 A.track(store,b,[{mac:'aabbccddee01'}],t0+6*60000);assert.equal(A.clients(store,b.id).moves.length,1,'staying on the same AP is not a move');
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('revenue per AP: only when the payer was on exactly one AP at payment time; the rest is unattributed',()=>{const {dir,store}=tmp();try{
 const a=store.put('devices',{name:'AP-A',type:'ap'}),b=store.put('devices',{name:'AP-B',type:'ap'}),now=Date.now();
 const s1=store.put('subscribers',{name:'One',username:'u1',service:'hotspot'}),s2=store.put('subscribers',{name:'Two',username:'u2',service:'hotspot'}),s3=store.put('subscribers',{name:'Three',username:'u3',service:'hotspot'});
 store.put('radiusSessions',{username:'u1',mac:'AA:00:00:00:00:01',updatedAt:now});store.put('radiusSessions',{username:'u2',mac:'AA:00:00:00:00:02',updatedAt:now});
 A.track(store,a,[{mac:'AA:00:00:00:00:01'},{mac:'AA:00:00:00:00:02'}],now-60*60000);A.track(store,b,[{mac:'AA:00:00:00:00:02'}],now-60*60000);
 store.put('subscriberPayments',{subscriberId:s1.id,username:'u1',amount:50,time:now-55*60000});
 store.put('subscriberPayments',{subscriberId:s2.id,username:'u2',amount:30,time:now-55*60000});
 store.put('subscriberPayments',{subscriberId:s3.id,username:'u3',amount:20,time:now-55*60000});
 store.put('subscriberPayments',{subscriberId:s1.id,username:'u1',amount:99,time:now-5*864e5});
 const r=A.revenue(store,now,1);const ra=r.aps.find(x=>x.name==='AP-A'),rb=r.aps.find(x=>x.name==='AP-B');
 assert.equal(ra.amount,50);assert.equal(ra.payments,1);assert.equal(rb.amount,0);
 assert.deepEqual(r.unattributed,{amount:50,payments:2},'u2 was on two APs, u3 has no device proof; old payment outside the period');
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('congestion alert: opens after 3 busy reports, only once, and closes after 3 calm reports',()=>{const {dir,store}=tmp();try{
 const ap=store.put('devices',{name:'AP-Busy',type:'ap',apCapacity:20}),busy={clients:19,radios:[{utilization:50}]},calm={clients:5,radios:[{utilization:20}]};
 const open=()=>store.list('alerts').filter(a=>a.source==='ap-capacity'&&a.status!=='Resolved');
 A.alerts(store,ap,busy);A.alerts(store,ap,busy);assert.equal(open().length,0,'not after 2');
 A.alerts(store,ap,busy);A.alerts(store,ap,{clients:1,radios:[{utilization:90}]});assert.equal(open().length,1,'radio ≥ 80 % also counts, one alert');assert.match(open()[0].details,/capacity 20/);
 A.alerts(store,ap,calm);A.alerts(store,ap,calm);assert.equal(open().length,1);A.alerts(store,ap,calm);assert.equal(open().length,0);
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('simulated stations: devices are shared between simulated APs and move between them over time',()=>{
 const t=Date.parse('2026-11-20T15:00:00Z'),aps=[0,1,2].map(i=>({id:'s'+i,simIndex:i,simCount:3}));
 const at=tt=>new Map(aps.flatMap(a=>A.simulate(a,tt).stations.map(x=>[x.mac,a.id])));const m1=at(t),m2=at(t+20*60000);
 const both=[...m1.keys()].filter(k=>m2.has(k));assert.ok(both.length>5);assert.ok(both.some(k=>m1.get(k)!==m2.get(k)),'some devices roam');
 for(const a of aps){const s=A.simulate(a,t);assert.equal(s.clients,s.stations.length);}
});
test('simulated APs never raise alerts and close any they raised before',()=>{const {dir,store}=tmp();try{
 const ap=store.put('devices',{name:'Simulated AP – Hall',type:'ap',driver:'ap-sim',apCapacity:50}),busy={clients:54,radios:[{utilization:90}]};
 const old=store.put('alerts',{title:'Simulated AP – Hall is congested',deviceId:ap.id,source:'ap-capacity',severity:'warning',status:'Open'});
 const open=()=>store.list('alerts').filter(a=>a.deviceId===ap.id&&a.status!=='Resolved');
 for(let i=0;i<5;i++)A.alerts(store,ap,busy);assert.equal(open().length,0);assert.equal(store.get('alerts',old.id).status,'Resolved');
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
