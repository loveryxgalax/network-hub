'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),pv=require('../lib/provision.cjs'),jobs=require('../lib/jobs.cjs'),health=require('../lib/health.cjs');
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
test('subnets: gateway, pool around the gateway, private ranges only, overlaps',()=>{
 const a=pv.subnet('10.5.0.1/22','x');assert.equal(a.network,'10.5.0.0/22');assert.equal(a.ranges,'10.5.0.2-10.5.3.254');
 const b=pv.subnet('192.168.88.100/24','x');assert.equal(b.ranges,'192.168.88.1-192.168.88.99,192.168.88.101-192.168.88.254');
 assert.throws(()=>pv.subnet('8.8.8.1/24','x'),/private/);assert.throws(()=>pv.subnet('10.0.0.0/24','x'),/network or broadcast/);assert.throws(()=>pv.subnet('10.0.0.1/8','x'),/16 to \/29/);assert.throws(()=>pv.subnet('10.0.0.1','x'),/like/);
 assert.equal(pv.overlaps(pv.subnet('10.5.0.1/22','x'),pv.subnet('10.5.3.1/24','x')),true);assert.equal(pv.overlaps(pv.subnet('10.5.0.1/22','x'),pv.subnet('10.20.0.1/22','x')),false);
});
test('services: refuses the uplink, used ports and overlapping networks; the script checks the router before changing it',()=>{
 const state={ports:[{name:'ether1',uplink:true},{name:'ether2'},{name:'ether3'},{name:'ether4',bridge:'bridge1'},{name:'ether5',address:'192.168.88.1/24'}],addresses:[{address:'192.168.88.1/24',interface:'ether5'}]};
 const ok={pppoe:true,hotspot:true,ports:['ether2','ether3'],uplink:'ether1'},ctx={portalHost:'netops.example.test',state};
 assert.throws(()=>pv.validateServices({...ok,ports:['ether1']},ctx),/uplink/);
 assert.throws(()=>pv.validateServices({...ok,ports:['ether4']},ctx),/bridge1/);
 assert.throws(()=>pv.validateServices({...ok,ports:['ether5']},ctx),/192.168.88.1/);
 assert.throws(()=>pv.validateServices({...ok,ports:['ether9']},ctx),/not a port/);
 assert.throws(()=>pv.validateServices({...ok,ports:['ether2;/system reboot']},ctx),/Invalid port/);
 assert.throws(()=>pv.validateServices({...ok,hotspotNet:'192.168.88.50/24'},ctx),/overlaps/);
 assert.throws(()=>pv.validateServices({...ok,hotspotNet:'10.20.0.1/22',pppoeNet:'10.20.1.1/24'},ctx),/overlap/);
 assert.throws(()=>pv.validateServices({...ok,pppoe:false,hotspot:false},ctx),/PPPoE, Hotspot/);
 assert.throws(()=>pv.validateServices({...ok,dnsName:'bad name'},ctx),/DNS/);
 const s=pv.validateServices(ok,ctx),body=pv.servicesBody(s,'https://netops.example.test');
 // Every check comes before the first change, and a refusal returns STOPPED without changing anything.
 const firstChange=body.indexOf('/interface bridge add'),stop=body.indexOf(':return ("STOPPED');
 assert.ok(stop>0&&stop<firstChange);
 for(const check of ['pppoe-server server print count-only','/ip hotspot print count-only','/radius print count-only where comment~"netops"','bridge port print count-only where interface=$p','/ip address print count-only where interface=$p','dst-address=10.5.0.0/22'])assert.ok(body.indexOf(check)>=0&&body.indexOf(check)<firstChange,check);
 assert.match(body,/\/ip hotspot add name="netops-hotspot" interface="netops-bridge"/);assert.match(body,/pppoe-server server add service-name="netops" interface="netops-bridge"/);
 assert.match(body,/ranges=10\.5\.0\.2-10\.5\.3\.254/);assert.match(body,/interface list member add list="LAN" interface="netops-bridge"/);assert.match(body,/ppp profile set \[find where name="netops-ppp"\] interface-list=LAN/);assert.match(body,/out-interface="ether1" action=masquerade/);assert.match(body,/check-certificate=yes/);
 assert.ok(!/reboot|package|reset-configuration|\/user (add|set|remove)/.test(body),'never reboots, upgrades, resets or touches users');
 const paste=pv.pasteScript(body,'R1');assert.match(paste,/:local run do=\{/);assert.match(paste,/:put \[\$run\]/);
 // The job carries the spec and rebuilds the same script.
 assert.equal(jobs.TYPES['provision-services'].script({spec:pv.encodeSpec(s),origin:'https://netops.example.test'}),body);
 assert.equal(jobs.TYPES['provision-services'].risky,true);
});
test('health reports addresses, bridge ports, DHCP clients and the PPPoE server count',()=>{
 const h=health.normalize({addresses:[{address:'192.168.88.1/24',interface:'bridge'}],bridgePorts:[{bridge:'bridge',interface:'ether2'}],dhcpClients:[{interface:'ether1'}],pppoeServers:'0'});
 assert.deepEqual([h.addresses.length,h.bridgePorts[0].interface,h.dhcpClients[0].interface,h.pppoeServers],[1,'ether2','ether1',0]);
 assert.match(health.SCRIPT,/pppoe-server server print count-only/);assert.ok(!/\/(ip address|interface bridge port|ip dhcp-client) (add|set|remove)/.test(health.SCRIPT));
});
test('HTTP: link a MikroTik end to end (bundle once per link, checks, in-service guard, typed confirmation, STOPPED)',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prov-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://netops.example.test',radiusSecret:'testRadiusSecret123'});
 const port=await listen(app.server),origin='http://127.0.0.1:'+port;
 try{const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'p@example.test',password:'fixture-owner-password-123'})});const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf;
  const api=async(r,method='GET',input)=>{const x=await fetch(origin+'/api/'+r,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,Host:'netops.example.test'},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:x.status,body:await x.json().catch(()=>null)};};
  const st=app.store;
  assert.equal((await api('provision','POST',{name:'bad;name'})).status,400);
  assert.equal((await api('provision','POST',{name:'HEX Ikutha',radius:'all'})).status,409,'RADIUS needs WireGuard set up on the server');
  st.setting('wgServer',{publicKey:'A'.repeat(43)+'=',endpoint:'203.0.113.10',port:51820});
  const r=await api('provision','POST',{name:'HEX Ikutha',radius:'all',runner:true});assert.equal(r.status,201,JSON.stringify(r.body));
  assert.match(r.body.oneLiner,/^\/tool fetch url="https:\/\/netops\.example\.test\/api\/provision\/bundle\/[a-f0-9-]{36}" http-header-field="Authorization:Bearer [A-Za-z0-9_-]{43}" check-certificate=yes/);
  assert.deepEqual(r.body.parts.map(p=>p.split(' ')[0]),['Router','WireGuard','netops','Monitoring','Customer','Job']);
  assert.equal((await api('provision','POST',{name:'hex ikutha'})).status,409,'same name');
  const [,bid,tok]=/bundle\/([a-f0-9-]{36})" http-header-field="Authorization:Bearer ([A-Za-z0-9_-]{43})"/.exec(r.body.oneLiner);
  const bundle=await fetch(origin+'/api/provision/bundle/'+bid,{headers:{Authorization:'Bearer '+tok,Host:'netops.example.test'}});assert.equal(bundle.status,200);const text=await bundle.text();
  for(const piece of ['/system identity set name="HEX Ikutha"','/interface wireguard add name=wg-netops','/radius add address=10.99.0.1 secret="testRadiusSecret123" service=ppp,hotspot src-address=10.99.0.','network-hub-agent','network-hub-discovery','network-hub-jobs'])assert.ok(text.includes(piece),piece);
  assert.ok(!text.includes('<RADIUS_SECRET>'));assert.ok(!/check-certificate=no/.test(text));
  assert.equal((await fetch(origin+'/api/provision/bundle/'+bid,{headers:{Authorization:'Bearer '+'x'.repeat(43),Host:'netops.example.test'}})).status,404);
  assert.equal((await fetch(origin+'/api/provision/bundle/'+bid,{headers:{Host:'netops.example.test'}})).status,404);
  const id=r.body.router.id;let s=(await api('provision/'+id)).body;assert.equal(s.checks.monitoring,null);assert.equal(s.checks.runner,0,'runner installed but not polled yet');assert.match(s.checks.wireguard.address,/^10\.99\.0\./);
  // Before the router reports, services are refused.
  const spec={pppoe:true,hotspot:true,ports:['ether2','ether3'],uplink:'ether1'};
  assert.equal((await api('provision/'+id+'/services','POST',spec)).status,409);
  // The router reports: interfaces (monitoring) and health (discovery).
  {const d=st.get('devices',id);st.put('devices',{...d,lastSeen:Date.now(),metrics:{model:'RB5009',interfaces:['ether1','ether2','ether3','ether4','bridge'].map(n=>({name:n,type:n==='bridge'?'bridge':'ether',running:true,disabled:false}))}},d);}
  st.setting('routerHealth:'+id,{time:Date.now(),...health.normalize({routes:[{gateway:'192.168.1.1',interface:'192.168.1.1%ether1'}],addresses:[{address:'192.168.1.20/24',interface:'ether1'}],bridgePorts:[{bridge:'bridge',interface:'ether4'}],dhcpClients:[{interface:'ether1'}],pppoeServers:0,hotspots:[]})});
  s=(await api('provision/'+id)).body;assert.equal(s.state.known,true);assert.equal(s.state.inService,false);assert.deepEqual(s.state.uplinks,['ether1']);assert.equal(s.state.ports.find(p=>p.name==='ether4').bridge,'bridge');
  const pre=await api('provision/'+id+'/services','POST',spec);assert.equal(pre.status,200,JSON.stringify(pre.body));assert.match(pre.body.script,/STOPPED/);assert.ok(pre.body.summary.length>=4);
  assert.equal((await api('provision/'+id+'/services','POST',{...spec,ports:['ether4']})).status,400);
  assert.equal((await api('provision/'+id+'/services','POST',{...spec,apply:true,confirm:'wrong'})).status,400,'typed router name required');
  const ap=await api('provision/'+id+'/services','POST',{...spec,apply:true,confirm:'HEX Ikutha'});assert.equal(ap.status,201,JSON.stringify(ap.body));
  assert.equal((await api('provision/'+id+'/services','POST',{...spec,apply:true,confirm:'HEX Ikutha'})).status,409,'one setup job at a time');
  // The router picks it up and refuses (e.g. someone added a PPPoE server meanwhile): the job fails with the reason.
  const j=jobs.next(st,id);assert.match(j.script,/STOPPED/);const res=jobs.result(st,id,j.id,{ok:true,output:'STOPPED: nothing was changed. this router already has a PPPoE server'});assert.equal(res.status,'failed');
  s=(await api('provision/'+id)).body;assert.equal(s.job.status,'failed');assert.match(s.job.error,/already has a PPPoE server/);
  // A router already serving customers is never configured.
  st.setting('routerHealth:'+id,{...st.setting('routerHealth:'+id),pppoeServers:1});
  const busy=await api('provision/'+id+'/services','POST',spec);assert.equal(busy.status,409);assert.match(busy.body.error,/already serves customers/);
  // Re-issue for the same router keeps its WireGuard address and says so.
  const again=await api('provision','POST',{routerId:id,radius:'none',wireguard:true});assert.equal(again.status,201);assert.match(again.body.warnings[0],/already has 10\.99\.0\./);
  const fresh=await api('provision','POST',{routerId:id,radius:'none',wireguard:true,newWireguardKey:true});assert.equal(fresh.status,201);assert.equal(fresh.body.warnings.length,0);assert.ok(fresh.body.parts.some(p=>/WireGuard tunnel to netops \(10\.99\.0\.2\)/.test(p)),'new key, same address');assert.equal(st.list('wgPeers').filter(p=>p.routerId===id).length,1);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
