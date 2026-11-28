'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),rollup=require('../lib/rollup.cjs'),overview=require('../lib/overview.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'roll-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
test('daily rollup: hourly averages from WAN counters, kept beyond raw data, weekday × hour heatmap and 90-day series',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'Core',type:'router',driver:'routeros-script'});
  const now=Date.parse('2026-10-30T09:00:00+03:00'),day0=Date.parse('2026-10-28T00:00:00+03:00');const ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,1,?)');
  // 28 Oct (a Wednesday): 20:00–21:00 Nairobi at 80 Mbps down / 8 up, sampled every minute; the rest of the day idle.
  let rx=0,tx=0;for(let m=0;m<24*60;m++){const t=day0+m*60000,busy=m>=20*60&&m<21*60;if(m){rx+=busy?80e6/8*60:1e6/8*60;tx+=busy?8e6/8*60:0.1e6/8*60;}ins.run(r.id,t,JSON.stringify({cpu:busy?40:10,interfaces:[{name:'sfp1',type:'ether',rx,tx}]}));}
  store.setting('onlineSeries:'+r.id,{points:[[day0+20*36e5+60000,120,30],[day0+3*36e5,10,2]]});
  assert.equal(rollup.run(store,now).rolled>=2,true);const d=store.setting('dailyRollup').days['2026-10-28'][r.id];
  assert.equal(d[20][0],80);assert.equal(d[20][1],8);assert.equal(d[20][4],40);assert.equal(d[20][5],150);assert.equal(d[3][0],1);
  assert.equal(rollup.run(store,now).rolled,0,'each day rolled once');
  store.db.prepare('DELETE FROM measurements').run();// raw data pruned; the rollup remains
  const h=rollup.heatmap(store,{days:30},now);assert.equal(h.covered,1);assert.equal(h.traffic[2][20],80);assert.equal(h.online[2][20],150);assert.equal(h.traffic[0][20],null);
  const o=overview.build(store,'90d',now);assert.equal(o.routers[0].series.length,1);assert.equal(o.routers[0].series[0][1],80);assert.equal(o.routers[0].onlineSeries[0][1],150);
 }finally{done();}
});
