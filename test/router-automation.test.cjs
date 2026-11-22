'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),jobs=require('../lib/jobs.cjs'),RA=require('../lib/routerauto.cjs'),radius=require('../lib/radius.cjs');
const mk=()=>new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ra-')),'db.sqlite'));
const at=h=>Date.UTC(2026,10,19,h-3,10);// h o'clock Nairobi
function router(st,name,n){const r=st.put('devices',{name,type:'router'});jobs.enroll(st,r.id);st.put('wgPeers',{kind:'router',routerId:r.id,name,address:'10.99.0.'+n,publicKey:'k'+n});
 st.setting('customerDiscovery:'+r.id,{lastReport:at(3),observations:[]});return r;}
const finish=(st,id,t)=>{const j=st.get('routerJobs',id);st.put('routerJobs',{...j,status:'succeeded',finishedAt:t},j);};
test('moves one router at a time, only in the quiet hours, and checks logins afterwards',()=>{const st=mk(),a=router(st,'LAB-HEX',5),b=router(st,'CCR2004',6);
 assert.equal(RA.tick(st,at(12)),null,'not outside the quiet hours');
 const j1=RA.tick(st,at(3));assert.ok(j1);assert.equal(st.get('routerJobs',j1).type,'radius-move');assert.equal(st.get('routerJobs',j1).createdBy,'Automatic');
 assert.equal(RA.tick(st,at(3)+60000),null,'one router at a time');
 finish(st,j1,at(3)+120000);RA.tick(st,at(3)+180000);assert.equal(st.setting('radiusAuto:'+st.get('routerJobs',j1).routerId).stage,'watching');
 // Logins arrive from that router: the move is kept.
 const moved=st.get('devices',st.get('routerJobs',j1).routerId);radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':'s1','User-Name':'ann','NAS-Identifier':moved.name},at(3)+5*60000);
 RA.tick(st,at(3)+20*60000);assert.equal(st.setting('radiusAuto:'+moved.id).stage,'done');assert.ok(st.list('alerts').some(x=>/now uses Kade Cloud RADIUS/.test(x.title)));
 // The next router starts; nothing arrives from it, so it is moved back.
 const other=st.list('devices').find(r=>r.id!==moved.id).id,j2=st.setting('radiusAuto:'+other).jobId;assert.ok(j2,'the next router is queued as soon as the first passes its check');assert.equal(RA.tick(st,at(3)+21*60000),null);
 finish(st,j2,at(3)+22*60000);RA.tick(st,at(3)+23*60000);RA.tick(st,at(3)+40*60000);
 assert.equal(st.setting('radiusAuto:'+other).stage,'rolled-back');assert.ok(st.list('routerJobs').some(x=>x.routerId===other&&x.type==='radius-rollback'));
 assert.ok(st.list('alerts').some(x=>x.severity==='critical'&&/moved back/.test(x.title)));
 assert.equal(RA.tick(st,at(4)),null,'a router moved back waits for a person; the other one is already moved');
});
test('does not move a router with customers missing from netops, or without the job runner',()=>{const st=mk(),r=router(st,'HEX',7);
 st.setting('customerDiscovery:'+r.id,{lastReport:at(3),observations:[{evidence:{ppp:{name:'stranger',observedAt:at(3)}}}]});
 assert.match(RA.blockers(st,r,at(3)).join(),/1 customer\(s\) online without a Kade Cloud account/);assert.equal(RA.tick(st,at(3)),null);
 const n=st.put('devices',{name:'NEW',type:'router'});assert.match(RA.blockers(st,n,at(3)).join(),/job runner not installed/);
 RA.save(st,{radiusMove:false});st.setting('customerDiscovery:'+r.id,{lastReport:at(3),observations:[]});assert.equal(RA.tick(st,at(3)),null,'switched off');
});
test('live router: setup script keeps existing services and refuses clashes',()=>{const pv=require('../lib/provision.cjs');
 const spec={pppoe:true,hotspot:false,ports:['ether5'],uplink:'ether1',nat:true,release:false,pp:pv.subnet('10.28.0.1/16','x'),portalHost:'my.example.com'};
 assert.match(pv.servicesBody(spec,'https://my.example.com'),/already has a PPPoE server/);
 const live=pv.servicesBody({...spec,live:true},'https://my.example.com');assert.doesNotMatch(live,/already has a PPPoE server/);assert.match(live,/Kade Cloud PPPoE profile already exists/);assert.match(live,/already in use on this router/);
});
