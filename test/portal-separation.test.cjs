'use strict';
// my.kadenetworks.com = PPPoE only; the router's WiFi pages (http origin) = hotspot only; callbacks (no page) unchanged.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),jobs=require('../lib/jobs.cjs');
test('strict mode (open portal switched off): service separation by page, wrong-domain accounts, direct links and router redirects',async()=>{
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'sep-')),collector:false,publicOrigin:'https://kade.example.test',portalOrigin:'https://my.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port,st=app.store;
 {const lc=require('../lib/landing.cjs');lc.save(st,{...lc.get(st),show:{...lc.get(st).show,openPortal:false}});}
 try{const MY={Host:'my.example.test',Origin:'https://my.example.test'},WIFI={Host:'my.example.test',Origin:'http://wifi.example.test'};
  const hp=st.put('plans',radius.plan({name:'Lab Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'}));
  const pp=st.put('plans',radius.plan({name:'Lab 20',service:'pppoe',downloadMbps:20,uploadMbps:10,price:1,durationValue:30,durationUnit:'days'}));
  st.put('subscribers',radius.subscriber(st,{name:'Hot',username:'g55g4hva',service:'hotspot',planId:hp.id,phone:'0711000001',expiresAt:Date.now()+864e5}));
  st.put('subscribers',radius.subscriber(st,{name:'Home',username:'user2',service:'pppoe',planId:pp.id,phone:'0711000002',expiresAt:Date.now()+864e5}));
  const post=(p,b,h)=>fetch(o+'/portal/api/'+p,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(b)});
  // Account lookup: hotspot account refused on my., PPPoE account refused on the WiFi page.
  let r=await post('account',{query:'g55g4hva'},MY);assert.equal(r.status,409);assert.match((await r.json()).error,/WiFi \(hotspot\) account/);
  r=await post('account',{query:'user2'},WIFI);assert.equal(r.status,409);
  // Renewal/purchase: hotspot renewal and new hotspot packages refused on my.
  r=await post('pay',{kind:'account',username:'g55g4hva',phone:'0711000001'},MY);assert.equal(r.status,409);
  r=await post('pay',{planId:hp.id,phone:'0711000001'},MY);assert.equal(r.status,409);
  // Hotspot-only endpoints refused on my.; allowed from the WiFi page (CORS for the router origin).
  assert.equal((await fetch(o+'/portal/api/session?mac=AA:BB:CC:00:00:01',{headers:{...MY,Referer:'https://my.example.test/portal/'}})).status,409);
  r=await fetch(o+'/portal/api/session?mac=AA:BB:CC:00:00:01',{headers:WIFI});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'http://wifi.example.test');
  assert.equal((await fetch(o+'/portal/api/pay',{method:'OPTIONS',headers:WIFI})).status,204);
  // Package lists follow the page.
  const cfgMy=await (await fetch(o+'/portal/api/config',{headers:MY})).json(),cfgWifi=await (await fetch(o+'/portal/api/config',{headers:WIFI})).json();
  assert.equal(cfgMy.mode,'pppoe');assert.equal(cfgMy.plans.length,0);assert.equal(cfgWifi.mode,'hotspot');assert.equal(cfgWifi.pppoePlans.length,0);
  // No page at all (callbacks, server-to-server): unchanged.
  assert.notEqual((await post('account',{query:'g55g4hva'},{Host:'my.example.test'})).status,409);
  // Self-service link of a hotspot account opened on my.: refused with directions.
  const sub=st.list('subscribers').find(x=>x.username==='g55g4hva'),t=require('../lib/selfservice.cjs').token(st,sub);
  r=await fetch(o+'/portal/api/me?t='+encodeURIComponent(t),{headers:{...MY,Referer:'https://my.example.test/portal/account.html'}});assert.equal(r.status,409);
  // Page: my. without router details is PPPoE; with details from a router not yet updated it keeps the hotspot flow (signed pass).
  let page=await (await fetch(o+'/portal/',{headers:{Host:'my.example.test'}})).text();assert.match(page,/name="portal-mode" content="pppoe"/);
  const lab=st.put('devices',{name:'LAB-HEX',type:'router'});jobs.enroll(st,lab.id);
  const q='?mac=AA:BB:CC:00:00:01&login='+encodeURIComponent('http://wifi.example.test/login')+'&nas=LAB-HEX';
  page=await (await fetch(o+'/portal/'+q,{headers:{Host:'my.example.test'}})).text();assert.match(page,/content="hotspot"/);
  const pass=page.match(/name="portal-pass" content="([^"]+)"/)[1];
  assert.equal((await post('account',{query:'g55g4hva'},{...MY,'X-Portal-Pass':pass})).status!==409,true,'legacy router phones keep working');
  assert.equal((await post('account',{query:'g55g4hva'},{...MY,'X-Portal-Pass':pass.slice(0,-2)+'xx'})).status,409,'forged pass refused');
  // Router updated (current pages): the phone goes back to the router's own page, never to a host from the link.
  st.setting('pagesHash:'+lab.id,'x');jobs.setPages('https://my.example.test',()=>'x');st.put('routerJobs',{routerId:lab.id,type:'push-design-auto',status:'succeeded',params:{},createdAt:1});
  r=await fetch(o+'/portal/'+q+'&renew=1',{headers:{Host:'my.example.test'},redirect:'manual'});assert.equal(r.status,302);assert.match(r.headers.get('location'),/^http:\/\/wifi\.example\.test\/buy\.html\?/);
  r=await fetch(o+'/portal/?mac=AA:BB:CC:00:00:01&nas=LAB-HEX&login='+encodeURIComponent('http://evil.example/x'),{headers:{Host:'my.example.test'},redirect:'manual'});assert.match(r.headers.get('location'),/^http:\/\/wifi\.example\.test\/login$/);
  // Hotspot self-service: any central link goes to the router's own account page; staff View portal gets a signed preview.
  r=await fetch(o+'/portal/account.html?t='+encodeURIComponent(t),{headers:{Host:'my.example.test'},redirect:'manual'});assert.equal(r.status,302);assert.match(r.headers.get('location'),/^http:\/\/wifi\.example\.test\/account\.html\?t=/);
  const sp=require('../lib/portalmode.cjs').pass(st,'staff');page=await (await fetch(o+'/portal/account.html?t='+encodeURIComponent(t)+'&sp='+sp,{headers:{Host:'my.example.test'}})).text();assert.match(page,/name="portal-pass"/);
  assert.equal((await fetch(o+'/portal/api/me?t='+encodeURIComponent(t),{headers:{...MY,'X-Portal-Pass':sp}})).status,200,'staff preview loads the hotspot account');
  const me=await fetch(o+'/portal/api/me?t='+encodeURIComponent(t),{headers:WIFI});assert.equal(me.status,200,'the customer on the WiFi page');assert.equal((await me.json()).account,'g55g4hva');
  assert.equal((await post('me/tv',{t,mac:'2C:FE:E2:F6:01:E2',name:'TV'},WIFI)).status,200,'TV registration from the WiFi page');
  const acc=await (await fetch(o+'/portal/api/router/account.html',{headers:{Host:'my.example.test'}})).text();assert.match(acc,/portal-base" content="https:\/\/my\.example\.test"/);assert.match(acc,/src="https:\/\/my\.example\.test\/portal\/account\.js/);
  // PPPoE account page stays on the customer address.
  const pt=require('../lib/selfservice.cjs').token(st,st.list('subscribers').find(x=>x.username==='user2'));assert.equal((await fetch(o+'/portal/account.html?t='+encodeURIComponent(pt),{headers:{Host:'my.example.test'},redirect:'manual'})).status,200);
  // The router pages: login.html carries the portal and the router's CHAP values; buy.html is plain.
  const login=await (await fetch(o+'/portal/api/router/login.html',{headers:{Host:'my.example.test'}})).text();
  assert.match(login,/name="portal-mode" content="hotspot"/);assert.match(login,/\$\(chap-challenge\)/);assert.match(login,/src="https:\/\/my\.example\.test\/portal\/portal\.js/);
  assert.match(await (await fetch(o+'/portal/api/router/buy.html',{headers:{Host:'my.example.test'}})).text(),/portal-base" content="https:\/\/my\.example\.test"/);
 }finally{app.server.close();}
});
