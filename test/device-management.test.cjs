'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),I=require('../lib/inventory.cjs'),A=require('../lib/aps.cjs'),R=require('../lib/netreport.cjs');
const tmp=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dm-'));return {dir,store:new Store(dir)};};
test('inventory: vendor, model, firmware, parent/port; capability matrix says Not supported instead of guessing',()=>{const {dir,store}=tmp();try{
 const r=store.put('devices',{name:'LAB-HEX',type:'router',driver:'routeros-script',status:'online',lastSeen:Date.now(),metrics:{model:'E50UG',version:'7.25.1',uptime:'3d'}});
 const o=store.put('devices',{name:'OLT-1',type:'olt',driver:'snmp',parentId:r.id,uplinkPort:'ether3'});
 store.put('devices',{name:'ONT 1',type:'onu',serial:'HWTC0282729A',parentId:o.id,status:'online'});store.put('devices',{name:'Spare switch',type:'switch',driver:'none'});
 const L=I.list(store),hex=L.find(x=>x.name==='LAB-HEX'),olt=L.find(x=>x.name==='OLT-1'),ont=L.find(x=>x.name==='ONT 1'),sw=L.find(x=>x.name==='Spare switch');
 assert.equal(hex.vendor,'MikroTik');assert.equal(hex.model,'E50UG');assert.equal(hex.firmware,'7.25.1');assert.equal(hex.capabilities.optical,'no');assert.equal(hex.capabilities.reboot,'approval');
 assert.equal(olt.parent,'LAB-HEX');assert.equal(olt.port,'ether3');assert.equal(olt.clients,1,'online ONTs under the OLT');assert.equal(olt.capabilities.optical,'yes');
 assert.equal(ont.vendor,'Huawei','from the GPON serial prefix');assert.equal(ont.capabilities.cpu,'no');
 assert.equal(sw.management,'Inventory only');assert.ok(Object.values(sw.capabilities).every(v=>v==='no'),'inventory-only device claims nothing');
 const csv=I.csv(L);assert.match(csv.split('\n')[0],/^Name,Type,Vendor,Model/);assert.match(csv,/Not supported/);assert.match(csv,/With approval/);
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('inventory: manual network links refuse loops, self-parent, unknown parents and out-of-range polling',()=>{const {dir,store}=tmp();try{
 const a=store.put('devices',{name:'A',type:'router'}),b=store.put('devices',{name:'B',type:'switch',parentId:a.id});
 I.setLink(store,b.id,{port:'ether2',pollSeconds:120});assert.equal(store.get('devices',b.id).uplinkPort,'ether2');assert.equal(store.get('devices',b.id).pollSeconds,120);
 assert.throws(()=>I.setLink(store,a.id,{parentId:b.id}),/loop/);assert.throws(()=>I.setLink(store,a.id,{parentId:a.id}),/own parent/);
 assert.throws(()=>I.setLink(store,a.id,{parentId:'nope'}),/existing/);assert.throws(()=>I.setLink(store,a.id,{pollSeconds:5}),/between 30 and 3600/);
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('simulated AP: labelled simulated, counters only go up, clients split over radios, daily pattern',()=>{
 const d={id:'ap1'},t0=Date.parse('2026-11-20T01:00:00Z');let prev=null;
 for(let i=0;i<48;i++){const s=A.simulate(d,t0+i*36e5);assert.equal(s.simulated,true);assert.equal(s.radios[0].clients+s.radios[1].clients,s.clients);
  for(const r of s.radios){assert.ok(r.utilization>=0&&r.utilization<=98);assert.ok(r.signal<-50&&r.signal>-90);}
  if(prev)assert.ok(s.interfaces[0].rx>=prev.interfaces[0].rx&&s.interfaces[0].tx>=prev.interfaces[0].tx,'monotonic counters');prev=s;}
 const night=A.simulate(d,Date.parse('2026-11-20T00:30:00Z')).clients,evening=A.simulate(d,Date.parse('2026-11-20T17:00:00Z')).clients;assert.ok(evening>night,'busier in the evening');
});
test('AP comparison: concurrent (not total) clients, congestion share, ranking; no samples means no score',()=>{const {dir,store}=tmp();try{
 const busy=store.put('devices',{name:'Busy',type:'ap',driver:'ap-sim',status:'online'}),quiet=store.put('devices',{name:'Quiet',type:'ap',driver:'ap-sim',status:'online'}),none=store.put('devices',{name:'New',type:'ap',driver:'ap-sim'});
 const ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,1,?)'),now=Date.now();
 for(let i=0;i<10;i++){ins.run(busy.id,now-i*60000,JSON.stringify({source:'ap-sim',clients:30,radios:[{utilization:85,signal:-70}]}));ins.run(quiet.id,now-i*60000,JSON.stringify({source:'ap-sim',clients:3,radios:[{utilization:10,signal:-55}]}));}
 const c=A.compare(store,now,1);assert.deepEqual(c.map(x=>x.name),['Busy','Quiet','New']);
 assert.equal(c[0].peakClients,30,'peak concurrent, not 10 samples × 30');assert.equal(c[0].congestedShare,1);assert.equal(c[1].congestedShare,0);assert.equal(c[2].score,null);assert.equal(c[2].avgClients,null);
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('availability: offline runs and long silences are outages; no data is not 100 %; CSV lists every outage',()=>{const {dir,store}=tmp();try{
 const r=store.put('devices',{name:'R1',type:'router',driver:'routeros-script'}),q=store.put('devices',{name:'Quiet',type:'router',driver:'routeros-script'});
 const ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,?,?)'),now=Date.now(),t=m=>now-m*60000;
 for(const [m,on] of [[120,1],[119,1],[118,0],[117,0],[116,1],[115,1],[60,1],[59,1]])ins.run(r.id,t(m),on,'{}');
 const L=R.availability(store,now,1),x=L.find(v=>v.name==='R1'),y=L.find(v=>v.name==='Quiet');
 assert.equal(x.outages.length,2);assert.deepEqual(x.outages.map(o=>o.reason).sort(),['No data','Offline']);assert.ok(x.availability<100&&x.availability>0);
 assert.equal(y.availability,null);assert.equal(y.samples,0);
 const csv=R.csv(L);assert.equal(csv.split('\n').filter(l=>l.startsWith('R1,')).length,2);assert.match(csv,/Quiet,router,,0/);
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('HTTP: inventory, CSV, link edit (admin only), simulated APs polled by the collector into the AP dashboard, reports',async()=>{
 const {createApp}=require('../server.cjs'),app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'dmh-')),collector:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'dm@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,h={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},st=app.store;
  const rt=st.put('devices',{name:'LAB-HEX',type:'router',driver:'routeros-script',status:'online'});
  let res=await fetch(o+'/api/aps',{headers:h});assert.deepEqual((await res.json()).aps,[]);
  res=await fetch(o+'/api/aps/simulated',{method:'POST',headers:h,body:'{}'});assert.equal(res.status,201);const made=(await res.json()).made;assert.equal(made.length,3);
  // Poll the simulated APs twice through the real collector path (snapshot → recordSnapshot → measurements).
  const C=require('../lib/collector.cjs'),conn=require('../lib/connectors.cjs');for(let k=0;k<2;k++){C.reset();for(const id of made){const d=st.get('devices',id),s=await conn.snapshot(d,null);st.measure(id,true,{...s,traffic:k?{rxMbps:1.5,txMbps:0.4}:null});st.put('devices',{...d,status:'online',lastSeen:Date.now(),metrics:{...s,traffic:k?{rxMbps:1.5,txMbps:0.4}:null}},d);}}
  res=await fetch(o+'/api/aps?days=1',{headers:h});const aps=(await res.json()).aps;assert.equal(aps.length,3);assert.ok(aps.every(a=>a.simulated&&a.samples===2&&a.clientsNow!=null&&a.score!=null));
  res=await fetch(o+'/api/aps/'+made[0]+'/history?days=1',{headers:h});assert.equal((await res.json()).points.length,2);
  res=await fetch(o+'/api/inventory',{headers:h});const inv=await res.json();assert.equal(inv.items.length,4);assert.ok(inv.items.filter(x=>x.kind==='ap').every(x=>x.simulated&&x.capabilities.radio==='sim'));
  res=await fetch(o+'/api/inventory/'+made[0],{method:'PATCH',headers:h,body:JSON.stringify({parentId:rt.id,port:'ether4',pollSeconds:90})});assert.equal(res.status,200);assert.equal(st.get('devices',made[0]).uplinkPort,'ether4');
  res=await fetch(o+'/api/inventory.csv',{headers:h});assert.match(res.headers.get('content-disposition'),/kade-devices\.csv/);assert.match(await res.text(),/Simulated AP – Reception/);
  res=await fetch(o+'/api/net-reports?days=1',{headers:h});const nr=await res.json();assert.ok(nr.devices.some(d=>d.name==='LAB-HEX'&&d.availability===null),'no data → no figure');
  res=await fetch(o+'/api/aps/simulated',{method:'POST',headers:h,body:'{}'});assert.equal(res.status,201);res=await fetch(o+'/api/aps/simulated',{method:'POST',headers:h,body:'{}'});assert.equal(res.status,409,'at most 6 simulated APs');
 }finally{app.server.close();app.store.close?.();}
});
test('network map: hand-set parent links appear (manual), without duplicating discovered router pairs',()=>{const {dir,store}=tmp();try{
 const r=store.put('devices',{name:'CCR',type:'router'}),sw=store.put('devices',{name:'SW1',type:'switch',parentId:r.id,uplinkPort:'sfp1'}),ap=store.put('devices',{name:'AP1',type:'ap',parentId:sw.id,uplinkPort:'port 4'});
 const m=require('../lib/oltdetect.cjs').map(store);assert.ok(m.nodes.some(n=>n.id===ap.id&&n.kind==='Access point'));
 assert.deepEqual(m.links.filter(l=>l.kind==='manual').map(l=>[l.from,l.to,l.port]).sort((a,b)=>a[2].localeCompare(b[2])),[[sw.id,ap.id,'port 4'],[r.id,sw.id,'sfp1']]);
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
test('availability: thinned (15-minute) history is not reported as outages',()=>{const {dir,store}=tmp();try{
 const r=store.put('devices',{name:'Thin',type:'router',driver:'routeros-script'}),ins=store.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,1,?)'),now=Date.now();
 for(let i=0;i<96;i++)ins.run(r.id,now-6*864e5+i*15*60000,'{}');for(let i=0;i<60;i++)ins.run(r.id,now-i*30000,'{}');
 const x=R.availability(store,now,7).find(v=>v.name==='Thin');assert.equal(x.outages.filter(o=>o.reason==='No data').length,1,'only the real multi-day silence');
}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}});
