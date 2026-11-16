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
test('automatic WiFi page updates: only opted-in routers, once per 30 minutes, stops after 3 failures, never a reboot',()=>{
 const jobs=require('../lib/jobs.cjs'),portal=require('../lib/portal.cjs'),st=mk(),now=Date.now();let hash='v1';jobs.setPages('https://my.example.test',()=>hash);
 const a=st.put('devices',{name:'LAB-HEX',type:'router'}),b=st.put('devices',{name:'OTHER',type:'router'});for(const r of [a,b]){jobs.enroll(st,r.id);st.setting('pagesHash:'+r.id,'v1');st.put('routerJobs',{routerId:r.id,type:'push-design-auto',status:'succeeded',params:{},createdAt:now-864e5,createdBy:'staff'});}
 portal.saveRouterPortal(st,a.id,{...portal.routerPortal(st,a.id),autoPages:true});
 assert.deepEqual(jobs.autoUpdatePages(st,now),[],'pages are current: nothing to do');
 hash='v2';assert.deepEqual(jobs.autoUpdatePages(st,now),[a.id],'only the opted-in router is queued');
 const q=st.list('routerJobs').filter(j=>j.routerId===a.id&&j.type==='push-design-auto'&&j.status==='queued');assert.equal(q.length,1);assert.equal(q[0].type,'push-design-auto');assert.equal(q[0].createdBy,'Automatic');assert.equal(st.list('routerJobs').filter(j=>j.routerId===b.id&&j.type==='push-design-auto'&&j.status==='queued').length,0);
 assert.deepEqual(jobs.autoUpdatePages(st,now+1000),[],'a queued push is not queued twice');
 for(const j of q)st.put('routerJobs',{...j,status:'failed'},j);assert.deepEqual(jobs.autoUpdatePages(st,now+60000),[],'not again within 30 minutes');
 assert.deepEqual(jobs.autoUpdatePages(st,now+31*60000),[a.id],'retries after 30 minutes');
 // Three failed automatic attempts in a row: stop until a push succeeds.
 for(let i=0;i<3;i++){for(const j of st.list('routerJobs').filter(x=>x.routerId===a.id&&x.type==='push-design-auto'&&x.status==='queued'))st.put('routerJobs',{...j,status:'failed'},j);jobs.autoUpdatePages(st,now+(62+i*31)*60000);}
 for(const j of st.list('routerJobs').filter(x=>x.routerId===a.id&&x.type==='push-design-auto'&&x.status==='queued'))st.put('routerJobs',{...j,status:'failed'},j);
 assert.deepEqual(jobs.autoUpdatePages(st,now+400*60000),[],'stopped after repeated failures');
 assert.ok(!st.list('routerJobs').some(j=>/reboot|upgrade/.test(j.type)));
});
test('LAB-HEX updates its WiFi pages automatically by default; other routers stay off; a saved choice wins',()=>{
 const portal=require('../lib/portal.cjs'),st=mk(),a=st.put('devices',{name:'LAB-HEX',type:'router'}),b=st.put('devices',{name:'CCR2004',type:'router'});
 assert.equal(portal.routerPortal(st,a.id).autoPages,true);assert.equal(portal.routerPortal(st,b.id).autoPages,false);
 portal.saveRouterPortal(st,a.id,{...portal.routerPortal(st,a.id),autoPages:false});assert.equal(portal.routerPortal(st,a.id).autoPages,false);
});
test('account page: connected comes from the routers\' active list too, and lists the connected device MACs',()=>{
 const st=mk(),ss=require('../lib/selfservice.cjs'),p=st.put('plans',radius.plan({name:'P',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'})),now=Date.now();
 const s=st.put('subscribers',radius.subscriber(st,{name:'A',username:'kne-aaa111',service:'hotspot',planId:p.id,expiresAt:now+864e5}));
 const r=st.put('devices',{name:'LAB-HEX',type:'router'});
 st.setting('customerDiscovery:'+r.id,{lastReport:now-6e4,tables:{hotspot:{ok:true},ppp:{ok:true}},observations:[{evidence:{hotspot:{name:'kne-aaa111',mac:'5e:cb:3a:bf:9a:3d',ip:'10.5.3.248',observedAt:now-6e4}}}]});
 const c=ss.view(st,st.get('subscribers',s.id)).connection;assert.equal(c.connected,true,'router reports it online even without RADIUS accounting');assert.deepEqual(c.macs,['5E:CB:3A:BF:9A:3D']);
});
