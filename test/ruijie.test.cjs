'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),customers=require('../lib/customers.cjs'),ruijie=require('../lib/ruijie.cjs'),radius=require('../lib/radius.cjs'),selfservice=require('../lib/selfservice.cjs');
const report=(t={})=>({schema:1,tables:Object.fromEntries(Object.keys(customers.SOURCES).map(s=>[s,{ok:true,truncated:false,rows:t[s]||[]}]))});
const mk=()=>{const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'rj-')));const r=st.put('devices',{name:'Core',type:'router',location:'Town'});return {st,r};};
test('Ruijie MAC prefixes and names are recognised, others are not',()=>{
 assert.ok(ruijie.isRuijieMac('58:69:6C:12:34:56'));assert.ok(ruijie.isRuijieMac('c0-b8-e6-aa-bb-cc'));assert.ok(!ruijie.isRuijieMac('AA:BB:CC:DD:EE:FF'));
 assert.ok(ruijie.isRuijie({mac:'AA:BB:CC:DD:EE:FF',platform:'Reyee'}));assert.ok(!ruijie.isRuijie({mac:'AA:BB:CC:DD:EE:FF',name:'tenda'}));});
test('an AP on a DHCP lease is added to Devices once, linked to its router, and kept up to date',()=>{
 const {st,r}=mk();let now=Date.now();
 customers.ingest(st,r,customers.normalize(report({dhcp:[{ip:'10.0.0.50',mac:'58:69:6C:12:34:56',name:'Ruijie',status:'bound',interface:'lan'}],arp:[{ip:'10.0.0.9',mac:'AA:BB:CC:DD:EE:FF',status:'',interface:'lan'}]})),now);
 let aps=st.list('devices').filter(d=>d.type==='cpe');assert.equal(aps.length,1);const ap=aps[0];
 assert.equal(ap.vendor,'Ruijie');assert.equal(ap.cpeCategory,'Wi-Fi access point');assert.equal(ap.parentId,r.id);assert.equal(ap.observedViaRouterId,r.id);assert.equal(ap.ip,'10.0.0.50');assert.equal(ap.macAddress,'58:69:6C:12:34:56');
 now+=120000;customers.ingest(st,r,customers.normalize(report({dhcp:[{ip:'10.0.0.51',mac:'58:69:6C:12:34:56',name:'Ruijie',status:'bound',interface:'lan'}]})),now);
 aps=st.list('devices').filter(d=>d.type==='cpe');assert.equal(aps.length,1,'not duplicated');assert.equal(aps[0].ip,'10.0.0.51');
 const l=ruijie.list(st,now);assert.equal(l.length,1);assert.equal(l[0].router,'Core');assert.equal(l[0].online,true);});
test('an LLDP neighbour named Reyee is detected; a Ruijie router dialling PPPoE is left to the customer link',()=>{
 const {st,r}=mk(),now=Date.now();
 customers.ingest(st,r,customers.normalize(report({neighbor:[{ip:'10.0.0.60',mac:'AA:BB:CC:00:00:01',name:'Office AP',platform:'Reyee',model:'RG-RAP2200',interface:'ether3'}],ppp:[{ip:'10.9.0.2',mac:'C0:B8:E6:00:00:02',name:'jane',status:'connected',service:'pppoe'}]})),now);
 const aps=st.list('devices').filter(d=>d.vendor==='Ruijie');assert.equal(aps.length,1);assert.equal(aps[0].name,'Office AP');assert.equal(aps[0].model,'RG-RAP2200');});
test('account page usage falls back to the router counters when no RADIUS accounting arrives',()=>{
 const {st,r}=mk();const plan=st.put('plans',radius.plan({name:'P',service:'pppoe',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'days'}));
 const sub=st.put('subscribers',radius.subscriber(st,{name:'Vegas',username:'lasvegas',service:'pppoe',planId:plan.id,expiresAt:Date.now()+1e7}));
 let now=Date.now();const row=(rx,tx)=>({ip:'10.9.0.3',mac:'AA:BB:CC:00:00:09',name:'LasVegas',status:'connected',service:'pppoe',uptime:'1h0'+(rx>1000?'1':'0')+':00',sessionId:'*1',rx,tx});
 customers.ingest(st,r,customers.normalize(report({ppp:[{...row(1000,5000),uptime:'1:00:00'}]})),now);now+=60000;
 customers.ingest(st,r,customers.normalize(report({ppp:[{...row(3000,905000),uptime:'1:01:00'}]})),now);
 const u=selfservice.view(st,st.get('subscribers',sub.id),now).usage;
 assert.equal(u.source,'router');assert.equal(u.month.down,900000);assert.equal(u.month.up,2000);});
test('neighbour discovery is queued once, after a delay, for routers with the job runner',()=>{
 const {st,r}=mk(),jobs=require('../lib/jobs.cjs'),now=Date.now();jobs.enroll(st,r.id);
 let q=st.list('routerJobs').filter(j=>j.type==='neighbor-discovery');assert.equal(q.length,1);assert.ok(q[0].nextAttemptAt>now+20*60000);
 assert.equal(jobs.next(st,r.id,now),null,'never ahead of work queued now');assert.match(jobs.next(st,r.id,now+31*60000).script,/protocol=cdp,lldp,mndp/);
 jobs.autoNeighbor(st);assert.equal(st.list('routerJobs').filter(j=>j.type==='neighbor-discovery').length,1,'only once');});
