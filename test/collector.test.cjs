'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const C=require('../lib/collector.cjs'),{Store}=require('../lib/store.cjs');
test('collector: at most 4 polls at once, a dead device does not stop the others, failures back off, success resets',async()=>{
 C.reset();const devs=Array.from({length:10},(_,i)=>({id:'d'+i,pollSeconds:60}));let now=0,peak=0;
 const r=await C.run(devs,async d=>{now++;peak=Math.max(peak,now);await new Promise(x=>setTimeout(x,15));now--;if(d.id==='d3')throw new Error('timeout');});
 assert.equal(peak,4);assert.deepEqual([r.ok,r.failed],[9,1]);
 const s=C.status('d3');assert.equal(s.failures,1);assert.ok(s.next-Date.now()>100e3,'backs off to ~2× the interval');
 assert.equal(C.due(devs).length,0,'nothing due straight after a run');
 assert.equal(C.backoff({pollSeconds:60},10),15*60000,'back-off is capped at 15 minutes');
});
test('collector: a hung device is cut off by the time limit and others still finish',async()=>{
 C.reset();const r=await C.run([{id:'hang'},{id:'ok'}],d=>d.id==='hang'?new Promise(()=>{}):1,{timeout:50});
 assert.deepEqual([r.ok,r.failed],[1,1]);assert.match(C.status('hang').lastError,/No answer/);
});
test('collector: per-device interval within 30 s – 1 h',()=>{assert.equal(C.interval({}),60000);assert.equal(C.interval({pollSeconds:5}),30000);assert.equal(C.interval({pollSeconds:99999}),3600000);});
test('counters: normal growth, 32-bit wrap, and a reboot reset never give a negative or false rate',()=>{
 assert.equal(C.rate(1000,3000,2),1000);
 assert.equal(Math.round(C.rate(2**32-1000,1000,10)),200,'wrapped 32-bit counter');
 assert.equal(C.rate(5e9,1000,10),null,'64-bit counter dropped: reboot/reset, no rate');
 assert.equal(C.rate(null,10,1),null);assert.equal(C.rate(1,2,0),null);
});
test('downsampling keeps raw data for 2 days, then one sample per 15 minutes per device',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ds-')),store=new Store(dir);try{
  const now=Date.now(),old=now-5*864e5,ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,1,?)');
  const b=Math.floor(old/900000)*900000;for(let i=0;i<15;i++)ins.run('r1',b+i*60000,'{}');for(let i=0;i<5;i++)ins.run('r1',now-i*60000,'{}');
  const removed=C.downsample(store,now);assert.equal(removed,14);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM measurements').get().n,6);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
