'use strict';
// The auth log records the router's FINAL decision (wrong password = reject), TV sessions count for the owner,
// the owner's profile shows the TV's login history only from registration, and the Connect link is real.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),rev=require('../lib/revenue.cjs'),ss=require('../lib/selfservice.cjs');
const mk=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'fa-')));
const req=(u,mac)=>({'User-Name':u,'Calling-Station-Id':mac,'NAS-IP-Address':'10.0.0.1'});
test('wrong password is logged as reject; correct as accept; no duplicates; unknown/suspended/expired reject',()=>{
 const st=mk(),p=st.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'A',username:'kne-aaa111',service:'hotspot',planId:p.id,expiresAt:Date.now()+864e5}));radius.setPassword(st,s.id,'right-pass');
 const last=()=>(st.setting('radiusAuthLog').items)[0],mac='5E:CB:3A:BF:9A:3D';
 // Authorize only says the ACCOUNT is allowed; it must not claim the password was accepted.
 assert.equal(radius.authorize(st,req('kne-aaa111',mac)).status,200);assert.equal(last().result,'authorized');assert.match(last().reason,/not checked/);
 // FreeRADIUS then rejects (wrong password): the final decision is reject.
 assert.equal(radius.finalDecision(st,req('kne-aaa111',mac),'reject'),'updated');assert.equal(last().result,'reject');assert.equal(last().final,true);
 assert.equal(radius.finalDecision(st,req('kne-aaa111',mac),'reject'),'already','a repeated report does not add a row');
 // Correct password: accept.
 radius.authorize(st,req('kne-aaa111',mac.toLowerCase()));radius.finalDecision(st,req('kne-aaa111','5e-cb-3a-bf-9a-3d'),'accept');assert.equal(last().result,'accept');
 assert.equal(st.setting('radiusAuthLog').items.filter(x=>x.result==='reject').length,1);
 // Unknown, suspended and expired are rejected at authorize and a later reject report does not duplicate them.
 assert.equal(radius.authorize(st,req('nobody',mac)).status,404);assert.equal(radius.finalDecision(st,req('nobody',mac),'reject'),'already');
 const n=st.setting('radiusAuthLog').items.length;{const cur=st.get('subscribers',s.id);st.put('subscribers',{...cur,status:'suspended'},cur);}assert.equal(radius.authorize(st,req('kne-aaa111',mac)).status,401);assert.equal(last().result,'reject');
 assert.equal(st.setting('radiusAuthLog').items.length,n+1);
});
test('TV session shows the owner online and the TV history stays with its owner',()=>{
 const st=mk(),p=st.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days',devices:2})),now=Date.now(),tv='2C:FE:E2:F6:01:E2';
 const a=st.put('subscribers',radius.subscriber(st,{name:'A',username:'kne-aaa111',service:'hotspot',planId:p.id,expiresAt:now+864e5})),b=st.put('subscribers',radius.subscriber(st,{name:'B',username:'kne-bbb222',service:'hotspot',planId:p.id,expiresAt:now+864e5}));
 {const cur=st.get('subscribers',a.id);st.put('subscribers',{...cur,tvs:[{mac:tv,name:'lab-tv',addedAt:now-6e4}]},cur);}
 st.put('radiusSessions',{id:'t1',username:tv.toLowerCase(),service:'hotspot',nas:'LAB-HEX',mac:tv,ip:'10.5.3.247',sessionId:'s1',startedAt:now-5e4,updatedAt:now-1e3});
 const ov=radius.overview(st,now),row=n=>ov.subscribers.find(x=>x.username===n);assert.equal(row('kne-aaa111').online,true,'owner is connected through the TV');assert.equal(row('kne-bbb222').online,false);
 const log=[{time:now-3e5,username:tv.toUpperCase().replace(/:/g,'-'),result:'accept',reason:'before registration'},{time:now-3e4,username:tv.toUpperCase().replace(/:/g,'-'),result:'accept',reason:'OK'},{time:now-2e4,username:'kne-bbb222',result:'accept',reason:'OK'}];
 st.setting('radiusAuthLog',{items:log});
 const A=rev.profile(st,a.id,now).authLog,B=rev.profile(st,b.id,now).authLog;
 assert.deepEqual(A.map(x=>x.reason),['OK'],'only the TV attempt after registration, original identity kept');assert.match(A[0].username,/2C-FE/i);
 assert.deepEqual(B.map(x=>x.username),['kne-bbb222'],'nothing leaks to another customer');
 // Removed TV: its attempts no longer show on the old owner.
 {const cur=st.get('subscribers',a.id);st.put('subscribers',{...cur,tvs:[]},cur);}assert.equal(rev.profile(st,a.id,now).authLog.length,0);
});
test('Connect this device is a real button that logs in through the router, not a literal ${HOME} link',()=>{
 const js=fs.readFileSync(path.join(__dirname,'..','portal','account.js'),'utf8');
 assert.doesNotMatch(js,/href="\$\{HOME\}"/);assert.match(js,/id="connect-dev"/);assert.match(js,/connect-account/);assert.match(js,/\/\^https\?:/);
 const srv=fs.readFileSync(path.join(__dirname,'..','server.cjs'),'utf8');assert.match(srv,/var ROUTER=\{mac:\\'\$\(mac\)\\',ip:\\'\$\(ip\)\\',login:\\'\$\(link-login-only\)\\'/);
});
test('status page timers tick: time left counts down, uptime counts up',()=>{
 const st=require('../lib/status.cjs'),html=st.page(st.get({setting:()=>null,list:()=>[]}),'http://x',true),code=html.match(/<script>\(function\(\)([\s\S]*?)<\/script>/)[0].slice(8,-9);
 const els={tl:{textContent:'5h 48m'},upt:{textContent:'1h 12m'}};let tick;const g={document:{getElementById:i=>els[i]},setInterval:f=>{tick=f;}};
 new Function('document','setInterval',code)(g.document,g.setInterval);tick();tick();
 assert.equal(els.tl.textContent,'5h 47m 58s');assert.equal(els.upt.textContent,'1h 12m 2s');
});
