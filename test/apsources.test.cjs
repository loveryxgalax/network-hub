'use strict';
// Access point sources (TR-069, router port/VLAN, Omada/Ruijie controller) and the tracking built on them.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),S=require('../lib/apsources.cjs'),A=require('../lib/aps.cjs');
const withStore=fn=>async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'apsrc-')),store=new Store(dir);try{await fn(store);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}};
const v=x=>({_value:x});

test('(a) TR-069: Huawei (IGD) and TR-181 host lists; inactive hosts left out; refresh asked once per 5 minutes',withStore(async store=>{
 store.setting('acs',{origin:'https://acs.example.test'});store.secret('integration:acs',{username:'u',password:'p'});
 const row={_id:'HW-1',_lastInform:new Date().toISOString(),InternetGatewayDevice:{LANDevice:{1:{Hosts:{Host:{1:{MACAddress:v('aa:bb:cc:00:00:01'),IPAddress:v('192.168.100.5'),HostName:v('Tecno-Spark'),Active:v(true),InterfaceType:v('802.11')},2:{MACAddress:v('aa:bb:cc:00:00:02'),Active:v(false)}}}}}}};
 const calls=[];const request=async(o,p,s,m)=>{calls.push(m+' '+p);return {body:m==='GET'?[row]:{}};};
 const d=store.put('devices',{name:'Huawei-AP-12',type:'ap',driver:'ap-acs',serial:'48575443ABCD'});
 const snap=await S.acsSnapshot(store,d,{request});assert.equal(snap.clients,1);assert.equal(snap.stations[0].mac,'AA:BB:CC:00:00:01');assert.equal(snap.stations[0].band,'Wi-Fi');
 assert.ok(calls[0].includes('_deviceId._SerialNumber'));assert.equal(calls.filter(c=>c.startsWith('POST')).length,2,'refresh both data models');
 await S.acsSnapshot(store,d,{request});assert.equal(calls.filter(c=>c.startsWith('POST')).length,2,'not again within 5 minutes');
 const tr181={_id:'X',_lastInform:new Date().toISOString(),Device:{Hosts:{Host:{1:{PhysAddress:v('11:22:33:44:55:66'),Active:v('true'),Layer1Interface:v('Device.WiFi.Radio.1')}}}}};
 assert.deepEqual(S.parseHosts(tr181).map(h=>h.mac),['11:22:33:44:55:66']);
 await assert.rejects(()=>S.acsSnapshot(store,{...d,serial:''},{request}),/serial number/);}));

test('(b) router port / VLAN / hotspot server: phones matched by any of those names, with speed; stale reports refused',withStore(async store=>{
 const now=Date.now(),r=store.put('devices',{name:'hEX S',type:'router'});
 const ob=(mac,ev)=>({key:mac,evidence:Object.fromEntries(Object.entries(ev).map(([k,e])=>[k,{mac,observedAt:now,...e}]))});
 store.setting('customerDiscovery:'+r.id,{lastReport:now,observations:[
  ob('AA:00:00:00:00:01',{hotspot:{ip:'10.44.0.10',name:'kne-a1',service:'hotspot-ap4',rx:1000,tx:5000,traffic:{downloadMbps:2.5,uploadMbps:0.4}}}),
  ob('AA:00:00:00:00:02',{arp:{ip:'10.44.0.11',interface:'vlan40'}}),
  ob('AA:00:00:00:00:03',{bridge:{interface:'ether4'}}),
  ob('AA:00:00:00:00:04',{hotspot:{service:'hotspot-ap9'}})]});
 const ap=store.put('devices',{name:'AP-4',type:'ap',driver:'ap-port',parentId:r.id,apMatch:'hotspot-ap4, vlan40, ether4'});
 const s=S.portSnapshot(store,ap,{now});assert.deepEqual(s.stations.map(x=>x.mac).sort(),['AA:00:00:00:00:01','AA:00:00:00:00:02','AA:00:00:00:00:03']);
 const a1=s.stations.find(x=>x.mac.endsWith('01'));assert.equal(a1.downMbps,2.5);assert.equal(a1.loggedIn,true);
 assert.throws(()=>S.portSnapshot(store,ap,{now:now+20*60000}),/has not reported/);assert.throws(()=>S.portSnapshot(store,{...ap,apMatch:''},{now}),/port, VLAN or hotspot server/);}));

test('(c) controllers: Omada and Ruijie client lists split per AP; one poll serves all APs; secrets never returned',withStore(async store=>{
 const om=S.saveController(store,{type:'omada',name:'Omada HQ',url:'https://omada.example.test',site:'site1',omadacId:'cid',clientId:'id',clientSecret:'sec'});
 assert.ok(!JSON.stringify(S.controllers(store)).includes('sec'));
 let calls=0;const fetchImpl=async(u,o)=>{calls++;if(u.includes('/authorize/token'))return new Response(JSON.stringify({errorCode:0,result:{accessToken:'T'}}));
  assert.equal(o.headers.Authorization,'AccessToken=T');return new Response(JSON.stringify({errorCode:0,result:{data:[{mac:'11-11-11-11-11-01',apMac:'AC-84-C6-00-00-01',rssi:-60,radioId:1,activity:250000,trafficDown:9e6,trafficUp:1e6},{mac:'11-11-11-11-11-02',apMac:'AC-84-C6-00-00-02'}]}}));};
 const ap1=store.put('devices',{name:'Omada AP 1',type:'ap',driver:'ap-controller',controllerId:om.id,apKey:'ac:84:c6:00:00:01'}),ap2=store.put('devices',{name:'Omada AP 2',type:'ap',driver:'ap-controller',controllerId:om.id,apKey:'AC84C6000002'});
 const s1=await S.controllerSnapshot(store,ap1,{fetchImpl}),s2=await S.controllerSnapshot(store,ap2,{fetchImpl});
 assert.equal(s1.clients,1);assert.equal(s1.stations[0].band,'5 GHz');assert.equal(s1.stations[0].downMbps,2);assert.equal(s2.clients,1);assert.equal(calls,2,'token + one client list for both APs');
 S._cache.clear();
 const rj=S.saveController(store,{type:'ruijie',name:'Ruijie',url:'https://cloud.ruijienetworks.com',site:'G1',clientId:'app',clientSecret:'s'});
 const rf=async u=>u.includes('access_token?token=')?new Response(JSON.stringify({accessToken:'R'})):new Response(JSON.stringify({code:0,list:[{mac:'22:22:22:22:22:01',sn:'G1RX0001',rssi:-55},{mac:'22:22:22:22:22:02',sn:'G1RX0002'}]}));
 const ap3=store.put('devices',{name:'Ruijie AP',type:'ap',driver:'ap-controller',controllerId:rj.id,apKey:'g1rx0001'});
 assert.deepEqual((await S.controllerSnapshot(store,ap3,{fetchImpl:rf})).stations.map(x=>x.mac),['22:22:22:22:22:01']);
 assert.throws(()=>S.saveController(store,{type:'omada',name:'x',url:'http://plain.example',site:'s',clientId:'a',clientSecret:'b',omadacId:'c'}),/https/);}));

test('tracking: speed from counters, usage per hour, recorded sessions, paid vs unpaid, find a phone',withStore(async store=>{
 const now=Date.now(),ap=store.put('devices',{name:'AP-1',type:'ap',driver:'ap-port',sector:'Sector East'});
 const s=store.put('subscribers',{name:'Jane',username:'kne-j1',phone:'+254712345678',status:'active',expiresAt:now+3600e3,service:'hotspot'});
 store.put('radiusSessions',{username:'kne-j1',mac:'AA:00:00:00:00:01',updatedAt:now});
 A.track(store,ap,[{mac:'aa:00:00:00:00:01',rx:0,tx:0},{mac:'aa:00:00:00:00:09',rx:0,tx:0}],now-60000);
 A.track(store,ap,[{mac:'aa:00:00:00:00:01',rx:750000,tx:7500000},{mac:'aa:00:00:00:00:09',rx:0,tx:0}],now);
 const c=A.clients(store,ap.id),j=c.stations.find(x=>x.mac.endsWith('01'));assert.equal(j.down,1);assert.equal(j.up,0.1);assert.equal(j.paid,true);
 assert.equal(A.usage(store,'AA:00:00:00:00:01',now).total,8250000);
 const cmp=A.compare(store,now,1)[0];assert.equal(cmp.sessions,2);assert.equal(cmp.paidNow,1);assert.equal(cmp.unpaidNow,1);assert.equal(cmp.sector,'Sector East');
 const f=A.find(store,'0712345678',now);assert.equal(f.found,true);assert.equal(f.apName,'AP-1');assert.equal(f.current,true);
 assert.equal(A.find(store,'0799999999',now).found,false);}));

test('router report: the bridge host table is optional (older scripts still accepted) and the new script asks for it',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../lib/customers.cjs'),'utf8');assert.match(src,/interface bridge host print as-value where !local/);assert.match(src,/older report scripts do not send the bridge table/);});
