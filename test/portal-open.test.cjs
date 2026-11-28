'use strict';
// Open portal (the default, like ISPman): every customer page works in any browser; only connecting a device needs the
// router's WiFi page. Switching it off restores the strict hotspot / home internet split.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),self=require('../lib/selfservice.cjs'),hm=require('../lib/hotspotme.cjs'),lc=require('../lib/landing.cjs');
test('open portal: hotspot and home customers use every page from any browser; connecting still needs the WiFi; switching off restores the split',async()=>{
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'open-')),collector:false,publicOrigin:'https://kade.example.test',portalOrigin:'https://my.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port,st=app.store;
 try{const MY={Host:'my.example.test',Origin:'https://my.example.test',Referer:'https://my.example.test/portal/'};
  const hp=st.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days'})),pp=st.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:10,price:1500,durationValue:30,durationUnit:'days'}));
  const h=st.put('subscribers',{...radius.subscriber(st,{name:'H',username:'kne-hot001',service:'hotspot',planId:hp.id,phone:'0712000001',expiresAt:Date.now()+864e5}),points:4});
  const home=st.put('subscribers',radius.subscriber(st,{name:'P',username:'home-001',service:'pppoe',planId:pp.id,phone:'0712000002',expiresAt:Date.now()+864e5}));
  const get=(u,h2=MY)=>fetch(o+u,{headers:h2,redirect:'manual'}),post=(u,b,h2=MY)=>fetch(o+u,{method:'POST',headers:{...h2,'Content-Type':'application/json'},body:JSON.stringify(b)});
  assert.equal(lc.get(st).show.openPortal,true,'on by default');
  // One page for everyone on the customer address: hotspot and home packages.
  let page=await (await get('/portal/')).text();assert.doesNotMatch(page,/portal-mode" content="pppoe"/);
  const cfg=await (await get('/portal/api/config')).json();assert.equal(cfg.plans.length,1);assert.equal(cfg.pppoePlans.length,1);
  assert.match(await (await get('/portal/?home=1')).text(),/portal-mode" content="pppoe"/,'home internet page still exists');
  // A hotspot customer's account link opens in any browser (no redirect to the WiFi).
  const t=self.token(st,h);let r=await get('/portal/account.html?t='+encodeURIComponent(t));assert.equal(r.status,200);
  r=await get('/portal/api/me?t='+encodeURIComponent(t));assert.equal(r.status,200);assert.equal((await r.json()).username||'kne-hot001','kne-hot001');
  // Usage and points by this browser's device secret, without the router's device address.
  const dt=hm.trust(st,'kne-hot001','AA:BB:CC:00:00:01');const u=await (await get('/portal/api/usage?mac=&dt='+encodeURIComponent(dt))).json();assert.equal(u.found,true);assert.equal(u.points,4);
  // Home customer's page works too.
  assert.equal((await get('/portal/api/me?t='+encodeURIComponent(self.token(st,home)))).status,200);
  // Connecting off the WiFi: refused with a clear message.
  r=await post('/portal/api/connect-now',{mac:'AA:BB:CC:00:00:01',dt});assert.equal(r.status,400);assert.match((await r.json()).error,/Join our WiFi first/);
  // Switch it off: the strict split is back.
  lc.save(st,{...lc.get(st),show:{...lc.get(st).show,openPortal:false}});
  assert.match(await (await get('/portal/')).text(),/portal-mode" content="pppoe"/);
  r=await get('/portal/account.html?t='+encodeURIComponent(t));assert.equal(r.status,302,'hotspot account goes back to the WiFi page');
  assert.notEqual((await get('/portal/api/me?t='+encodeURIComponent(t))).status,200,'hotspot account refused on the home internet address');
  assert.equal((await (await get('/portal/api/config')).json()).plans.length,0,'no hotspot packages on the home internet address');
 }finally{await new Promise(r=>app.server.close(r));}});
