'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),hm=require('../lib/hotspotme.cjs'),status=require('../lib/status.cjs');
const mk=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'ca-')));
const chap={chapId:'\\001',chapChallenge:'\\123\\045\\067\\211\\012\\034\\056\\170\\101\\102\\103\\104\\105\\106\\107\\110'};
test('Connect now on an account: no password for its own device, password asked on a new device, nothing for expired/banned',()=>{
 const st=mk(),now=Date.now(),p=st.put('plans',radius.plan({name:'Test 1 hour',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'hours'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Hotspot',username:'kne-4h96zq',service:'hotspot',planId:p.id,expiresAt:now+36e5}));radius.setPassword(st,s.id,'4821');
 st.put('subscribers',{...st.get('subscribers',s.id),lastMac:'1A:84:B6:88:64:76'},st.get('subscribers',s.id));
 const r=hm.connectAccount(st,{account:'KNE-4H96ZQ',mac:'1a:84:b6:88:64:76',...chap},now);assert.equal(r.username,'kne-4h96zq');assert.equal(r.chap,true);assert.notEqual(r.password,'4821','only the CHAP response leaves the server');assert.ok(r.dt,'the device gets its secret');
 assert.throws(()=>hm.connectAccount(st,{account:'kne-4h96zq',mac:'AA:AA:AA:AA:AA:AA',...chap},now),e=>e.status===403&&/SMS/.test(e.message));
 assert.throws(()=>hm.connectAccount(st,{account:'kne-4h96zq',mac:'1A:84:B6:88:64:76'},now),/WiFi/,'only from the WiFi login page');
 // The device secret alone finds the account when the page is opened outside the WiFi login (no MAC).
 assert.equal(hm.session(st,'',now,r.dt).account,'kne-4h96zq');assert.equal(hm.session(st,'',now,'wrong').found,false);
 st.put('subscribers',{...st.get('subscribers',s.id),expiresAt:now-1},st.get('subscribers',s.id));
 assert.throws(()=>hm.connectAccount(st,{account:'kne-4h96zq',mac:'1A:84:B6:88:64:76',...chap},now),/not active/);
});
test('router logout page: disconnected message with Connect again and Buy a package, and Disconnect asks first',()=>{
 const html=status.logoutPage({...status.DEFAULTS,brandName:'Kade Networks'},'https://netops.example');
 assert.match(html,/You are disconnected/);assert.match(html,/href="\$\(link-login-only\)"/);assert.match(html,/https:\/\/netops\.example\/portal\//);
 assert.match(status.page({...status.DEFAULTS,brandName:'K'},'https://n',false),/confirm\('Disconnect this device\?/);
});
