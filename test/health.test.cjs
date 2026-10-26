'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),health=require('../lib/health.cjs'),customers=require('../lib/customers.cjs');
test('router health reports raise and clear specific alerts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl-')),store=new Store(dir),now=Date.UTC(2026,9,26,6,0,0);
 try{
  const r=store.put('devices',{name:'CCR',type:'router',driver:'routeros-script'});
  const make=(over={})=>health.normalize({sensors:[{name:'temperature',value:'48'},{name:'voltage',value:'24'}],hdd:{free:'50000000',total:'100000000',bad:'0'},clock:{date:'oct/26/2026',time:'09:00:05',zone:'Africa/Nairobi'},ntp:'true',
   ethernet:[{name:'ether1',status:'link-ok',rate:'1Gbps',rxFcs:'0',rxAlign:'0'},{name:'sfp-sfpplus1',status:'link-ok',rate:'10Gbps',sfpPresent:'true',sfpRx:'-9.1',sfpTx:'-2',sfpTemp:'41',sfpVendor:'FS'}],
   pools:[{name:'dhcp_pool',ranges:'10.0.0.2-10.0.0.11',used:'4'}],pings:[{target:'1.1.1.1',sent:3,received:3,avgUs:20000},{target:'8.8.8.8',sent:3,received:3,avgUs:25000}],...over});
  health.ingest(store,r,make(),now);assert.equal(store.list('alerts').filter(a=>a.source==='router-health').length,0,'a healthy router raises nothing');
  const h=store.setting('routerHealth:'+r.id);assert.equal(h.drift,5,'clock drift is measured against netops time in the router zone');
  health.ingest(store,r,make({sensors:[{name:'temperature',value:'88'}],ethernet:[{name:'ether1',status:'link-ok',rate:'100Mbps',rxFcs:'0',rxAlign:'0'},{name:'sfp-sfpplus1',status:'link-ok',rate:'10Gbps',sfpPresent:'true',sfpRx:'-28.4',sfpTemp:'41'}],pools:[{name:'dhcp_pool',ranges:'10.0.0.2-10.0.0.11',used:'10'}],pings:[{target:'1.1.1.1',sent:3,received:0,avgUs:0},{target:'8.8.8.8',sent:3,received:1,avgUs:300000}]}),now+120000);
  const open=store.list('alerts').filter(a=>a.source==='router-health'&&a.status!=='Resolved').map(a=>a.logKey).sort();
  assert.deepEqual(open,['link:ether1','pool:dhcp_pool','sfp-rx:sfp-sfpplus1','temperature','wan-quality']);
  assert.equal(store.list('alerts').find(a=>a.logKey==='temperature').severity,'critical');
  health.ingest(store,r,make(),now+240000);assert.deepEqual(store.list('alerts').filter(a=>a.source==='router-health'&&a.status!=='Resolved').map(a=>a.logKey),['clock'],'everything recovered except the clock, which the test leaves 4 minutes off');
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('discovery counters become per-customer daily usage',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hl2-')),store=new Store(dir),now=Date.UTC(2026,9,26,6,0,0);
 try{
  const r=store.put('devices',{name:'CCR',type:'router',driver:'routeros-script'});
  const rep=(rx,tx,uptime)=>customers.normalize({schema:2,tables:{ppp:{ok:true,truncated:false,rows:[{ip:'10.1.1.5',mac:'AA:BB:CC:00:00:01',name:'ann',status:'connected',service:'pppoe',uptime,sessionId:'*1',rx,tx}]},dhcp:{ok:true,truncated:false,rows:[]},arp:{ok:true,truncated:false,rows:[]},hotspot:{ok:true,truncated:false,rows:[]},neighbor:{ok:true,truncated:false,rows:[]}},events:[]});
  customers.ingest(store,r,rep(1000,5000,'0:10:00'),now);customers.ingest(store,r,rep(3000,15000,'0:12:00'),now+120000);
  const o=store.setting('customerDiscovery:'+r.id).observations[0],day=Object.values(o.usageDays)[0];assert.deepEqual(day,{down:10000,up:2000});
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
