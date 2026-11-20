'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),hm=require('../lib/hotspotme.cjs');
function mk(){const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'pr-')));
 const plan=st.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Ann',username:'ann',service:'hotspot',planId:plan.id,expiresAt:Date.now()+864e5}));
 radius.setPassword(st,s.id,'secret123');st.put('subscriberPayments',{subscriberId:s.id,amount:50,reference:'UK3IF0TW26'});
 const start=(sid,mac)=>radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':sid,'NAS-IP-Address':'10.0.0.1','NAS-Identifier':'R1','User-Name':'ann','Calling-Station-Id':mac,'Framed-IP-Address':'10.5.0.9'});
 return {st,s,start};}
const login=(st,extra={})=>hm.codeLogin(st,{code:'UK3IF0TW26',mac:'AA:BB:CC:00:00:02',chapId:'\\001',chapChallenge:'\\002',...extra});
test('payment code login: sharing keeps the other device, migration signs it out',()=>{
 let {st,s,start}=mk();start('a1','AA:BB:CC:00:00:01');
 let r=login(st);assert.equal(r.mode,'sharing');assert.equal(st.sessionsOf('ann',0).filter(x=>!x.stoppedAt).length,1,'sharing leaves the first device on');
 radius.updateSettings(st,{payRefLogin:'migration'});r=login(st);assert.equal(r.mode,'migration');assert.equal(r.moved,1);
 assert.equal(st.sessionsOf('ann',0).filter(x=>!x.stoppedAt).length,0,'old device session ended');
 const sub=st.get('subscribers',s.id);assert.deepEqual(Object.keys(sub.devTokens||{}),['AA:BB:CC:00:00:02'],'only the new device is trusted');});
test('payment code login: customer beats router beats ISP, and off refuses',()=>{
 const {st,s}=mk();const r=st.put('devices',{name:'R1',type:'router',payRefLogin:'migration'});
 assert.equal(hm.refMode(st,s,'r1'),'migration');assert.equal(hm.refMode(st,s,''),'sharing');
 st.put('subscribers',{...s,payRefLogin:'off'},s);assert.throws(()=>login(st,{nas:'R1'}),/turned off/);});
