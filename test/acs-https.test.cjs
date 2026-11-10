'use strict';
// The optional non-SNI HTTPS ACS endpoint (deployment/acs/Caddyfile + compose.https.yml) and per-device ACS address pins.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..'),caddy=fs.readFileSync(path.join(root,'deployment/acs/Caddyfile'),'utf8'),overlay=fs.readFileSync(path.join(root,'deployment/acs/compose.https.yml'),'utf8'),base=fs.readFileSync(path.join(root,'docker-compose.yml'),'utf8');
const code=caddy.replace(/#.*$/gm,'');
test('Caddyfile: non-SNI default certificate, TLS 1.2+, RSA, admin API off, only CWMP forwarded to the isolation proxy',()=>{
 assert.match(code,/^\s*admin off\s*$/m);assert.match(code,/default_sni \{\$ACS_TLS_HOST\}/);
 assert.match(code,/protocols tls1\.2 tls1\.3/);assert.match(code,/key_type rsa2048/);
 assert.match(code,/@cwmp path \/cwmp \/cwmp\/\*/);
 const proxies=code.match(/reverse_proxy [^\s]+/g);assert.deepEqual(proxies,['reverse_proxy {$ACS_UPSTREAM:acs:7548}'],'one upstream: the 7548 isolation proxy, never 7547 or the NBI');
 assert.doesNotMatch(code,/7557|27017|4317|hub:|mongo:/,'no NBI, database or dashboard');
 assert.match(code,/handle \{\s*respond "Not found" 404\s*\}/,'everything else is 404');
 assert.doesNotMatch(code,/insecure_skip_verify|tls1\.0|tls1\.1|http:\/\//);});
test('Compose overlay: opt-in profile, publishes only 80/443, keeps certificate volumes; base compose publishes no ACS port',()=>{
 assert.match(overlay,/profiles: \[acs-https\]/);
 const ports=[...overlay.matchAll(/- "(\d+):(\d+)\/tcp"/g)].map(m=>m[1]+':'+m[2]);assert.deepEqual(ports,['80:80','443:443']);
 assert.match(overlay,/acs-tls-data:\/data/);assert.match(overlay,/acs-tls-config:\/config/);assert.match(overlay,/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
 const acs=base.split(/\n  (?=[a-z-]+:\n)/).find(b=>b.startsWith('acs:'));assert.ok(acs,'acs service in base compose');assert.doesNotMatch(acs,/ports:/,'ACS stays private in the base deployment');});
function withAcs(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acs-'));fs.writeFileSync(path.join(dir,'cpes.json'),JSON.stringify({devices:{}}));process.env.NETWORK_ACS_PRIVATE_DIR=dir;try{return fn(dir);}finally{delete process.env.NETWORK_ACS_PRIVATE_DIR;}}
test('per-device ACS address: a pinned Cambium keeps the dedicated URL through re-registration; clearing returns to the global one',()=>{withAcs(dir=>{
 const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),cpe=require('../lib/cpelink.cjs');
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'pin-')));radius.updateSettings(st,{acsPublicUrl:'https://netops.example.test/cwmp/'});
 const plan=st.put('plans',radius.plan({name:'P',service:'pppoe',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Lab',username:'user1',service:'pppoe',planId:plan.id}));
 const read=()=>JSON.parse(fs.readFileSync(path.join(dir,'cpes.json'),'utf8')).devices.WFWM0BKTD6CV;
 assert.throws(()=>cpe.pinAcsUrl(st,'WFWM0BKTD6CV','https://acs.example.test/cwmp/'),/allow-list/,'only a registered serial');
 const first=cpe.register(st,{subscriberId:s.id,serial:'WFWM0BKTD6CV',vendor:'Cambium'},{id:'u'});const pass=read().password;assert.equal(read().acsUrl,radius.settings(st).acsPublicUrl,'unpinned: the global address');
 for(const bad of ['http://acs.example.test/cwmp/','https://u:p@acs.example.test/cwmp/','https://acs.example.test/devices/','https://acs.example.test/cwmp/?x=1','nonsense'])assert.throws(()=>cpe.pinAcsUrl(st,'WFWM0BKTD6CV',bad),/https/);
 const r=cpe.pinAcsUrl(st,'WFWM0BKTD6CV','https://acs.example.test/cwmp/');assert.equal(r.pinned,true);
 const again=cpe.register(st,{subscriberId:s.id,serial:'WFWM0BKTD6CV',vendor:'Cambium'},{id:'u'});
 assert.equal(read().acsUrl,'https://acs.example.test/cwmp/','re-registration keeps the pin');assert.equal(again.acs.url,'https://acs.example.test/cwmp/','installers are shown the pinned address');
 assert.equal(read().password,pass,'credentials untouched by pinning');
 cpe.pinAcsUrl(st,'WFWM0BKTD6CV','');assert.equal(read().acsUrl,radius.settings(st).acsPublicUrl);assert.equal(read().acsUrlPinned,undefined);});});
test('unmatched new CPE: netops asks it (read-only) for its PPPoE login and WAN address, once an hour, on its own data model',async()=>{
 const http=require('node:http'),acs=require('../lib/acs.cjs'),{Store}=require('../lib/store.cjs'),st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'ask-')));
 const calls=[];const nbi=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{calls.push({method:req.method,url:req.url,body:JSON.parse(b||'{}')});res.writeHead(202,{'Content-Type':'application/json'});res.end('{"_id":"t1"}');});});
 await new Promise(r=>nbi.listen(0,'127.0.0.1',r));
 try{st.setting('acs',{origin:'http://127.0.0.1:'+nbi.address().port,onlineMinutes:15});st.secret('integration:acs',{username:'nbi',password:'test-only'});
  const now=Date.now();assert.equal(await acs.askPppLogin(st,{id:'CAMBIUM-1',tree:'InternetGatewayDevice'},now),true);
  assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');assert.match(calls[0].url,/^\/devices\/CAMBIUM-1\/tasks$/,'queued for the next check-in, no connection request');
  assert.equal(calls[0].body.name,'getParameterValues','read-only');
  assert.deepEqual(calls[0].body.parameterNames,['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username','InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress']);
  assert.equal(await acs.askPppLogin(st,{id:'CAMBIUM-1',tree:'InternetGatewayDevice'},now+60000),false,'not again within the hour');
  assert.equal(await acs.askPppLogin(st,{id:'X',tree:''},now),false,'unknown data model: ask nothing');
  await acs.askPppLogin(st,{id:'TR181',tree:'Device'},now);assert.deepEqual(calls.at(-1).body.parameterNames,['Device.PPP.Interface.1.Username','Device.PPP.Interface.1.IPCP.LocalIPAddress']);
 }finally{nbi.close();}});
test('active sessions: MAC falls back to the router-reported caller-id, then the customer\'s last MAC',()=>{
 const {Store}=require('../lib/store.cjs'),hs=require('../lib/hotspot.cjs'),st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'mac-'))),now=Date.now();
 const r=st.put('devices',{name:'LAB-HEX',type:'router'});st.put('subscribers',{name:'U2',username:'user2',service:'pppoe',lastMac:'AA:BB:CC:00:00:22'});
 const add=(id,u)=>st.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(id,JSON.stringify({username:u,service:'pppoe',sessionId:id,mac:'',updatedAt:now,startedAt:now-1e5}),now,now);
 add('s1','user1');add('s2','user2');st.setting('customerDiscovery:'+r.id,{lastReport:now,observations:[{key:'k',lastObserved:now,evidence:{ppp:{name:'user1',mac:'AA:BB:CC:00:00:11',observedAt:now}}}]});
 const items=hs.sessions(st,new URLSearchParams('service=pppoe'),now).items,m=Object.fromEntries(items.filter(x=>x.source==='radius').map(x=>[x.username,x.mac]));
 assert.match(m.user1,/AA:BB:CC:00:00:11/i);assert.match(m.user2,/AA:BB:CC:00:00:22/i);});
