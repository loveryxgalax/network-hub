'use strict';
// Regression tests for login, session and quota findings 1-8 and 19.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs');
const T0=Date.UTC(2026,10,16,8,0,0);
function setup(o={}){const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'rga-')));
 const p=st.put('plans',radius.plan({name:'P',service:'hotspot',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'days',devices:o.devices||1,...(o.plan||{})}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'A',username:'kne-aaa111',service:'hotspot',planId:p.id,expiresAt:o.expiresAt??T0+864e5}));radius.setPassword(st,s.id,'pw-123456');return {st,p,s};}
const auth=(st,user,mac,nas='10.0.0.1',at=T0)=>radius.authorize(st,{'User-Name':user,'Calling-Station-Id':mac,'NAS-IP-Address':nas},at);
const acct=(st,type,user,mac,id,at,nas='10.0.0.1',extra={})=>radius.accounting(st,{'Acct-Status-Type':type,'Acct-Session-Id':id,'NAS-IP-Address':nas,'User-Name':user,'Calling-Station-Id':mac,...extra},at);
const A='AA:00:00:00:00:01',B='AA:00:00:00:00:02';
test('1. one-device account: a second device is refused before the first one\'s Start arrives; retries of the same device are free',()=>{
 const {st}=setup();assert.equal(auth(st,'kne-aaa111',A).status,200);assert.equal(auth(st,'kne-aaa111',A,'10.0.0.1',T0+1000).status,200,'same device retry');
 assert.equal(auth(st,'kne-aaa111',B,'10.0.0.1',T0+2000).status,401,'second device refused even without a Start');
 // A rejected final decision (wrong password at the router) frees the reservation.
 radius.finalDecision(st,{'User-Name':'kne-aaa111','Calling-Station-Id':A,'NAS-IP-Address':'10.0.0.1'},'reject',T0+3000);
 assert.equal(auth(st,'kne-aaa111',B,'10.0.0.1',T0+4000).status,200,'slot released after failure');
 // Reservations expire (bounded) if no Start ever comes.
 assert.equal(auth(st,'kne-aaa111',A,'10.0.0.1',T0+4000+130000).status,200);
});
test('2. the device already connected can re-authenticate at capacity',()=>{
 const {st}=setup();assert.equal(auth(st,'kne-aaa111',A).status,200);acct(st,'Start','kne-aaa111',A,'s1',T0+1000);
 assert.equal(auth(st,'kne-aaa111',A,'10.0.0.1',T0+200000).status,200,'same MAC re-auth');assert.equal(auth(st,'kne-aaa111',B,'10.0.0.1',T0+200000).status,401);
});
test('3. Session-Timeout never exceeds the time left',()=>{
 const {st}=setup({expiresAt:T0+10000});const r=auth(st,'kne-aaa111',A);assert.equal(r.status,200);assert.equal(r.attributes['reply:Session-Timeout'],'10');
 assert.equal(auth(st,'kne-aaa111',A,'10.0.0.1',T0+11000).status,401,'expired hotspot account refused');
});
test('4. Reset keeps accounting evidence and records the request; the slot is freed only by the router\'s Stop',()=>{
 const {st,s}=setup(),ss=require('../lib/selfservice.cjs');auth(st,'kne-aaa111',A);acct(st,'Start','kne-aaa111',A,'s1',Date.now()-1000);
 const before=JSON.stringify(st.list('radiusSessions'));ss.reset(st,st.get('subscribers',s.id));assert.equal(JSON.stringify(st.list('radiusSessions')),before,'no invented Stop');
 assert.equal(st.setting('resetRequests').items.length,1);assert.equal(auth(st,'kne-aaa111',B,'10.0.0.1',Date.now()).status,401,'still occupied until Stop');
 acct(st,'Stop','kne-aaa111',A,'s1',Date.now());assert.equal(auth(st,'kne-aaa111',B,'10.0.0.1',Date.now()+130000).status,200);
});
test('5. sharing summary appears with active sessions and slots left',()=>{
 const {st,s}=setup({devices:3}),ss=require('../lib/selfservice.cjs'),landing=require('../lib/landing.cjs');landing.save(st,{...landing.get(st),show:{...landing.get(st).show,shareCode:true}});
 acct(st,'Start','kne-aaa111',A,'s1',Date.now()-1000);const v=ss.view(st,st.get('subscribers',s.id));assert.ok(v.share,'share summary present');assert.equal(v.share.left,2);assert.match(v.share.code,/^S/);
});
test('6. quota after a period boundary counts only use after the boundary',()=>{
 const pk=require('../lib/packages.cjs'),{st,s}=setup(),MB=1048576,from=T0;
 acct(st,'Start','kne-aaa111',A,'s1',from-3600e3,'10.0.0.1',{'Acct-Session-Time':'0'});acct(st,'Interim-Update','kne-aaa111',A,'s1',from-60e3,'10.0.0.1',{'Acct-Session-Time':'3540','Acct-Output-Octets':String(80*MB)});
 acct(st,'Interim-Update','kne-aaa111',A,'s1',from+600e3,'10.0.0.1',{'Acct-Session-Time':'4200','Acct-Output-Octets':String(81*MB)});
 const u=pk.periodUsage(st,st.get('subscribers',s.id),864e5,from+700e3,from);assert.equal(u.down,1*MB,'only the 1 MB after the boundary');assert.equal(u.estimated,false);
});
test('7. package session limit counts the owner\'s own other devices too, but not a re-auth of the same device',()=>{
 const {st,p}=setup({devices:3,plan:{maxSessions:1}});acct(st,'Start','kne-aaa111',A,'s1',T0);
 assert.equal(auth(st,'kne-aaa111',B,'10.0.0.1',T0+1000).status,401,'owner\'s second device refused at package limit');assert.equal(auth(st,'kne-aaa111',A,'10.0.0.1',T0+1000).status,200,'same device ok');
});
test('8 and 19. a final decision updates only the attempt on the same router; wrong password shows as reject',()=>{
 const {st}=setup({devices:2}),last=()=>st.setting('radiusAuthLog').items;
 auth(st,'kne-aaa111',A,'10.0.0.1',T0);auth(st,'kne-aaa111',A,'10.0.0.2',T0+100);
 radius.finalDecision(st,{'User-Name':'kne-aaa111','Calling-Station-Id':A,'NAS-IP-Address':'10.0.0.1'},'reject',T0+200);
 const byNas=n=>last().find(e=>e.nas===n);assert.equal(byNas('10.0.0.1').result,'reject');assert.equal(byNas('10.0.0.2').result,'authorized','router B untouched');
 radius.finalDecision(st,{'User-Name':'kne-aaa111','Calling-Station-Id':A,'NAS-IP-Address':'10.0.0.2'},'accept',T0+300);assert.equal(byNas('10.0.0.2').result,'accept');
});

test('8b. retries on the same router and MAC: each final result goes to its own attempt, whatever order they arrive in',()=>{
 const {st}=setup();const base={'User-Name':'kne-aaa111','Calling-Station-Id':A,'NAS-IP-Address':'10.0.0.1'};
 const try1={...base,'CHAP-Challenge':'0x01','CHAP-Password':'0xaa'},try2={...base,'CHAP-Challenge':'0x02','CHAP-Password':'0xbb'};
 assert.equal(radius.authorize(st,try1,T0).status,200);assert.equal(radius.authorize(st,try2,T0+500).status,200);
 const rows=()=>(st.setting('radiusAuthLog')||{items:[]}).items.filter(e=>e.username==='kne-aaa111');
 assert.equal(radius.finalDecision(st,try1,'reject',T0+800),'updated');
 let r=rows();assert.equal(r.length,2);assert.equal(r[0].result,'authorized','newer attempt untouched by the older reject');assert.equal(r[1].result,'reject');
 assert.equal(radius.finalDecision(st,try2,'accept',T0+900),'updated','newer acceptance is recorded');
 r=rows();assert.equal(r[0].result,'accept');assert.equal(r[1].result,'reject');
 assert.equal(radius.finalDecision(st,try1,'reject',T0+950),'already','duplicate report ignored');
 // Reversed order: accept for the newer attempt first, then the older reject.
 const {st:s2}=setup();radius.authorize(s2,try1,T0);radius.authorize(s2,try2,T0+500);
 radius.finalDecision(s2,try2,'accept',T0+800);radius.finalDecision(s2,try1,'reject',T0+900);
 const r2=(s2.setting('radiusAuthLog')||{items:[]}).items;assert.equal(r2[0].result,'accept');assert.equal(r2[1].result,'reject');
 // The accepted device keeps its reservation even though the older attempt was rejected: a second device is still refused.
 assert.equal(radius.authorize(s2,{...base,'Calling-Station-Id':B},T0+1000).status,401);
});
