'use strict';
// A registered TV logs in with its MAC; its sessions, usage, online state and quota belong to the owning account.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),hs=require('../lib/hotspot.cjs'),online=require('../lib/online.cjs'),packages=require('../lib/packages.cjs');
const TV='2C:FE:E2:F6:01:E2',TV2='2C:FE:E2:00:00:02',MB=1048576,MIN=60000,DAY=864e5;
function setup(fup){const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'tv-'))),now=Date.now();st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});
 const plan=st.put('plans',{...radius.plan({name:'Lab TV',service:'hotspot',downloadMbps:3,uploadMbps:3,price:1,durationValue:1,durationUnit:'days',devices:3}),...(fup?{fup}:{})});
 const tv=st.put('subscribers',{...radius.subscriber(st,{name:'LAB Smart TV',username:'lab-tv',service:'hotspot',planId:plan.id,expiresAt:now+12*36e5}),tvs:[{mac:TV,name:'TV',addedAt:now-30*DAY},{mac:TV2,name:'TV 2',addedAt:now-30*DAY}]});radius.setPassword(st,tv.id,'fixture-pw-tv');
 const other=st.put('subscribers',radius.subscriber(st,{name:'Other',username:'lab-other',service:'hotspot',planId:plan.id,expiresAt:now+DAY}));
 const acct=(kind,id,user,t,{mac='',down=0}={})=>radius.accounting(st,{'Acct-Status-Type':kind,'Acct-Session-Id':id,'NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX','User-Name':user,'Calling-Station-Id':mac,'Framed-IP-Address':'10.5.3.247','Service-Type':'Login-User','Acct-Output-Octets':String(down)},t);
 const auth=(user,pw)=>radius.authorize(st,{'User-Name':user,'User-Password':pw,'NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX','Calling-Station-Id':user,'Service-Type':'Login-User'});
 return {st,now,plan,tv,other,acct,auth};}
test('TV MAC login (any casing) is the owner\'s session everywhere; login name and evidence kept; no double count',()=>{
 const {st,now,tv,acct}=setup();
 acct('Start','t1','2c-fe-e2-f6-01-e2',now-10*MIN,{mac:TV});acct('Interim-Update','t1','2C:FE:E2:F6:01:E2',now-MIN,{mac:TV,down:42*MB});
 acct('Start','t2',TV2,now-5*MIN,{mac:TV2,down:5*MB});acct('Start','p1','lab-tv',now-4*MIN,{mac:'AA:00:00:00:00:01',down:MB});
 acct('Start','o1','lab-other',now-3*MIN,{mac:'AA:00:00:00:00:09',down:9*MB});
 const rec=st.sessionsOf('lab-tv',0);assert.equal(rec.length,3,'both TVs and the phone');
 const t1=rec.find(x=>x.sessionId==='t1');assert.equal(t1.account,'lab-tv');assert.match(t1.username,/^2c[:-]fe/,'the login name is kept as it was sent');assert.equal(t1.downloadBytes,42*MB);
 assert.equal(st.sessionsOf('lab-other',0).length,1,'no cross-customer attribution');
 // Active sessions and accounting log show the customer, not Unknown.
 const act=hs.sessions(st,new URLSearchParams('service=hotspot'),now).items;assert.equal(act.length,4);assert.ok(act.filter(x=>x.customer?.username==='lab-tv').length===3);assert.ok(!act.some(x=>!x.customer));
 assert.ok(hs.acctSessions(st,new URLSearchParams('service=hotspot'),now).items.every(x=>x.customer));
 // Dashboard: 4 connections, 2 customers, none "not in NetOps".
 const s=online.summary(st,now);assert.equal(s.total,4);assert.equal(s.customers,2);assert.equal(s.byStatus.unmatched,0);
 const ov=require('../lib/overview.cjs').build(st,'24h',now);assert.equal(ov.hotspot.notInNetops,0);assert.equal(ov.hotspot.online,2);
 // Profile: online, with the TV's usage; owner's own last device not overwritten by the TV.
 const prof=require('../lib/revenue.cjs').profile(st,tv.id,now);assert.equal(prof.online,true);assert.equal(prof.sessions.reduce((a,x)=>a+x.downloadBytes,0),48*MB);
 assert.equal(st.get('subscribers',tv.id).lastMac,'AA:00:00:00:00:01');assert.ok(st.get('subscribers',tv.id).lastSeen>=now-10*MIN);
});
test('device limit counts each live session once; removed and reassigned TVs',()=>{
 const {st,now,tv,other,acct,auth}=setup();
 acct('Start','t1',TV,now-MIN,{mac:TV});acct('Start','p1','lab-tv',now-MIN,{mac:'AA:00:00:00:00:01'});
 assert.equal(auth('lab-tv','fixture-pw-tv').status,200,'2 of 3 devices used (the TV is not counted twice)');
 acct('Start','t2',TV2,now-MIN,{mac:TV2});assert.equal(auth('lab-tv','fixture-pw-tv').status,401,'3 of 3');
 // TV removed from the account: its past sessions stay with the account that owned it then; new logins are unknown.
 const cur=st.get('subscribers',tv.id);st.put('subscribers',{...cur,tvs:cur.tvs.filter(t=>t.mac!==TV2)},cur);
 acct('Stop','t2',TV2,now);acct('Start','t3',TV2,now+1000,{mac:TV2});
 assert.equal(st.sessionsOf('lab-tv',0).some(x=>x.sessionId==='t2'),true);assert.equal(st.sessionsOf('lab-tv',0).some(x=>x.sessionId==='t3'),false);
 // Reassigned to another customer: only sessions from then on are theirs (also for the startup backfill).
 const o=st.get('subscribers',other.id);st.put('subscribers',{...o,tvs:[{mac:TV2,name:'TV',addedAt:now+2000}]},o);
 acct('Start','t4',TV2,now+3000,{mac:TV2});radius.attributeAliases(st);
 assert.deepEqual(st.sessionsOf('lab-other',0).map(x=>x.sessionId),['t4']);assert.equal(st.sessionsOf('lab-tv',0).some(x=>x.sessionId==='t4'),false);
 // Backfill of an old unattributed TV session (recorded before this fix).
 st.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions','old1',?,?,?)").run(JSON.stringify({username:TV.toLowerCase(),service:'hotspot',sessionId:'old1',mac:TV,startedAt:now-DAY,updatedAt:now-DAY,stoppedAt:now-DAY+1,downloadBytes:7*MB,uploadBytes:0}),now-DAY,now-DAY);
 assert.equal(radius.attributeAliases(st)>=1,true);const old=st.sessionsOf('lab-tv',0).find(x=>x.sessionId==='old1');assert.equal(old.account,'lab-tv');assert.equal(old.downloadBytes,7*MB,'evidence unchanged');
});
test('quota: aliases add up on the owner, and a manual extension does not reset the measured period',()=>{
 const fup={enabled:true,period:'total',downCapMB:40,afterDownMbps:0.5,afterUpMbps:0.5};
 const {st,now,plan,tv,acct,auth}=setup(fup);
 acct('Start','t1',TV,now-30*MIN,{mac:TV});acct('Stop','t1',TV,now-MIN,{mac:TV,down:30*MB});acct('Start','p1','lab-tv',now-20*MIN);acct('Stop','p1','lab-tv',now-MIN,{down:12*MB});
 const state=s=>packages.fupState(st,s,st.get('plans',plan.id),radius.planMs(plan),now);
 assert.equal(state(st.get('subscribers',tv.id)).active,true,'30 MB on the TV + 12 MB on the phone = over 40 MB');
 // The TV re-authenticates: reduced speed in the RADIUS reply.
 const r=auth(TV,TV),rl=JSON.stringify(r.body||r.reply||r);assert.equal(r.status,200,rl);assert.match(rl,/512k\/512k|500k\/500k|0\.5M/,'fallback speed sent to the router: '+rl.slice(0,300));
 // Manual extension by 3 days (expiry now far ahead): the period still contains today's usage.
 const cur=st.get('subscribers',tv.id);st.put('subscribers',{...cur,expiresAt:cur.expiresAt+3*DAY},cur);
 const u=packages.periodUsage(st,st.get('subscribers',tv.id),radius.planMs(plan),now);assert.ok(u.from<=now,'period start is not in the future');assert.equal(u.down,42*MB);
 assert.equal(state(st.get('subscribers',tv.id)).active,true,'still over the cap after the extension');
});
