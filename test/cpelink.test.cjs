'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),cpe=require('../lib/cpelink.cjs');
function mk(){const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'cl-')));
 const plan=st.put('plans',radius.plan({name:'P',service:'pppoe',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Jane',username:'jane',service:'pppoe',planId:plan.id,expiresAt:Date.now()+1e6}));
 const t=st.put('subscribers',radius.subscriber(st,{name:'Tom',username:'tom',service:'pppoe',planId:plan.id,expiresAt:Date.now()+1e6}));return {st,s,t};}
const acct=(st,user,mac,id='a1')=>radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':id,'NAS-IP-Address':'10.0.0.1','NAS-Identifier':'R1','User-Name':user,'Calling-Station-Id':mac,'Service-Type':'Framed-User','Framed-Protocol':'PPP'});
test('first PPPoE login records the router MAC once, never overwriting',()=>{
 const {st,s}=mk();acct(st,'jane','AA-BB-CC-DD-EE-01');
 let d=st.list('devices');assert.equal(d.length,1);assert.equal(d[0].macAddress,'aa:bb:cc:dd:ee:01');assert.equal(d[0].subscriberId,s.id);assert.equal(d[0].type,'cpe');
 acct(st,'jane','AA-BB-CC-DD-EE-01','a2');acct(st,'jane','AA-BB-CC-DD-EE-99','a3');
 d=st.list('devices');assert.equal(d.length,1,'a second, different MAC is not guessed at');assert.equal(d[0].macAddress,'aa:bb:cc:dd:ee:01');
});
test('auto-link can be turned off, ignores hotspot and a MAC owned by another customer',()=>{
 let {st}=mk();radius.updateSettings(st,{autoLinkCpe:false});acct(st,'jane','AA-BB-CC-DD-EE-01');assert.equal(st.list('devices').length,0);
 ({st}=mk());acct(st,'jane','AA-BB-CC-DD-EE-01');acct(st,'tom','AA-BB-CC-DD-EE-01','b1');assert.equal(st.list('devices').length,1);
});
test('installer registers serial + MAC: entry created or completed, TR-069 ready, conflicts refused',()=>{
 const {st,s,t}=mk();const u={id:'u1'};
 const r=cpe.register(st,{subscriberId:s.id,serial:'48575443A1B2',mac:'aa:bb:cc:dd:ee:02',vendor:'Huawei'},u);
 assert.equal(r.device.serial,'48575443A1B2');assert.equal(r.device.onboardingStatus,'Ready for enrollment');assert.equal(r.device.managementMethod,'TR-069 / GenieACS');assert.match(r.acs.command,/enroll-cpe\.cjs 48575443A1B2/);
 cpe.register(st,{subscriberId:s.id,serial:'48575443A1B2'},u);assert.equal(st.list('devices').length,1,'registering again updates, not duplicates');
 assert.throws(()=>cpe.register(st,{subscriberId:t.id,serial:'48575443A1B2'},u),/already registered/);
 assert.throws(()=>cpe.register(st,{subscriberId:t.id,serial:'X Y;rm'},u),/serial/i);
 assert.throws(()=>cpe.register(st,{subscriberId:t.id,serial:'ABC123',mac:'aa:bb:cc:dd:ee:02'},u),/MAC belongs/);
 assert.throws(()=>cpe.register(st,{subscriberId:t.id,serial:'ABC123',mac:'zz'},u),/not valid/);
});
test('login after registration fills a missing MAC; ACS check-in marks it managed',()=>{
 const {st,s}=mk();cpe.register(st,{subscriberId:s.id,serial:'SN12345'},{id:'u'});assert.equal(st.list('devices')[0].macAddress,'');
 acct(st,'jane','AA-BB-CC-DD-EE-03');assert.equal(st.list('devices')[0].macAddress,'aa:bb:cc:dd:ee:03');
 assert.deepEqual(cpe.verify(st,[{serial:'OTHER'}]),[]);
 assert.deepEqual(cpe.verify(st,[{serial:'SN12345',manufacturer:'Huawei',model:'HG8145V'}]),['SN12345']);
 const d=st.list('devices')[0];assert.equal(d.onboardingStatus,'Managed / check-in observed');assert.equal(d.remoteEnrollmentVerified,true);assert.equal(d.vendor,'Huawei');
});
test('register allows the serial on the shared ACS allow-list, reuses credentials, never re-enables a disabled serial',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acs-'));fs.writeFileSync(path.join(dir,'cpes.json'),JSON.stringify({devices:{}}));process.env.NETWORK_ACS_PRIVATE_DIR=dir;
 try{const {st,s}=mk();const r=cpe.register(st,{subscriberId:s.id,serial:'SN777'},{id:'u'});
  assert.equal(r.acs.allowed,true);assert.ok(r.acs.password.length>=32);
  const f=JSON.parse(fs.readFileSync(path.join(dir,'cpes.json'),'utf8')).devices.SN777;assert.equal(f.enabled,true);assert.equal(f.password,r.acs.password);
  assert.equal(cpe.register(st,{subscriberId:s.id,serial:'SN777'},{id:'u'}).acs.password,r.acs.password,'same credentials on repeat');
  const d=JSON.parse(fs.readFileSync(path.join(dir,'cpes.json'),'utf8'));d.devices.SN777.enabled=false;fs.writeFileSync(path.join(dir,'cpes.json'),JSON.stringify(d));
  assert.equal(cpe.register(st,{subscriberId:s.id,serial:'SN777'},{id:'u'}).acs.allowed,false);
 }finally{delete process.env.NETWORK_ACS_PRIVATE_DIR;}
});
test('ACS address is a validated setting shown to installers',()=>{
 const {st,s}=mk();assert.throws(()=>radius.updateSettings(st,{acsPublicUrl:'http://x'}),/https/);
 radius.updateSettings(st,{acsPublicUrl:'https://acs.example.com:7547/'});
 assert.equal(cpe.register(st,{subscriberId:s.id,serial:'SN900'},{id:'u'}).acs.url,'https://acs.example.com:7547');
});
