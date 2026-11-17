'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const st=require('../lib/status.cjs');
test('new status designs: every one renders, keeps router context, live layer compiles, old designs still listed',()=>{
 assert.ok(st.FRESH.length>=9);for(const old of ['dashboard','classic','branded','minimal','receipt','aurora','boarding','neon','softdial','ribbon'])assert.ok(st.DESIGNS[old],old);
 for(const design of st.FRESH)for(const preview of [true,false]){
  const html=st.page({...st.DEFAULTS,design,showPackage:true},'https://netops.example',preview,false);
  assert.match(html,/id="tl"/);assert.match(html,/id="upt"/);assert.match(html,/data-k="big"|data-k="left"/);assert.match(html,/Maven Pro/);
  assert.match(html,/class="warn"/,design+' has the running-low warning');assert.match(html,/Top up/);
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1]);
  if(!preview){assert.match(html,/\$\(session-time-left\)/);assert.match(html,/\$\(bytes-out\)/);assert.match(html,/\/portal\/api\/active\?mac=/);assert.match(html,/\$\(link-logout\)/);
   const KNOWN=new Set(['session-time-left','uptime','bytes-out-nice','bytes-in-nice','bytes-out','bytes-in','ip','mac','username','link-logout','mac-esc','ip-esc','link-login-only-esc']);
   for(const m of html.matchAll(/\$\(([^)]*)\)/g))assert.ok(KNOWN.has(m[1]),design+': unexpected RouterOS variable $('+m[1]+')');}
  else assert.doesNotMatch(html,/\$\(/,design+' preview has no router variables');
 }
});
test('status page package lookup reports the package length for the share-left ring',()=>{
 const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),hm=require('../lib/hotspotme.cjs'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stf-')),store=new Store(path.join(dir,'db.sqlite'));
 const plan=store.put('plans',radius.plan({name:'NET PLUS',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:8,durationUnit:'hours'}));
 const now=Date.now(),s=store.put('subscribers',{...radius.subscriber(store,{name:'T',username:'tt1',service:'hotspot',planId:plan.id,phone:'0712345678'}),expiresAt:now+5*3600e3,lastMac:'AA:BB:CC:DD:EE:0F'});
 const dt=hm.trust(store,'tt1','AA:BB:CC:DD:EE:0F',true),a=hm.active(store,'AA:BB:CC:DD:EE:0F',now,dt);
 assert.equal(a.found,true);assert.equal(a.total,8*3600e3);assert.ok(a.left<=a.total);
});
