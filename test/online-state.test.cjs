'use strict';
// Regression tests: session state (history "Online"), the dashboard's Online now scope, and hotspot server counts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),online=require('../lib/online.cjs'),hs=require('../lib/hotspot.cjs');
const MIN=60000,fresh=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'onl-')));
// RADIUS accounting through the real handler (so identity and stored fields are the production ones).
const acct=(st,t,kind,id,user,{nas='10.5.0.1',ident='LAB-HEX',mac='',hotspot=false,server=''}={})=>radius.accounting(st,{'Acct-Status-Type':kind,'Acct-Session-Id':id,'NAS-IP-Address':nas,'NAS-Identifier':ident,'User-Name':user,'Calling-Station-Id':mac,...(hotspot?{'Service-Type':'Login-User'}:{'Service-Type':'Framed-User','Framed-Protocol':'PPP'}),...(server?{'Called-Station-Id':server}:{})},t);
const sessions=(st,u)=>st.sessionsOf(u,0);

test('session history: fresh, stale without Stop, normal Stop, reconnect and two devices on one username',()=>{
 const st=fresh(),now=Date.now();
 acct(st,now-120*MIN,'Start','old-stop','user1',{mac:'AA:00:00:00:00:01'});acct(st,now-100*MIN,'Stop','old-stop','user1',{mac:'AA:00:00:00:00:01'});
 acct(st,now-90*MIN,'Start','stale','user1',{mac:'AA:00:00:00:00:03'});                              // laptop: no Stop, last update 90 min ago
 acct(st,now-40*MIN,'Start','recon-old','user1',{mac:'AA:00:00:00:00:01'});acct(st,now-12*MIN,'Interim-Update','recon-old','user1',{mac:'AA:00:00:00:00:01'});
 acct(st,now-10*MIN,'Start','recon-new','user1',{mac:'AA:00:00:00:00:01'});acct(st,now-1*MIN,'Interim-Update','recon-new','user1',{mac:'AA:00:00:00:00:01'});
 acct(st,now-5*MIN,'Start','phone2','user1',{mac:'AA:00:00:00:00:02'});                               // second device, same username
 const all=sessions(st,'user1'),states=online.sessionStates(all,now),by=Object.fromEntries(all.map(s=>[s.sessionId,states.get(s)]));
 assert.deepEqual(by,{'old-stop':'stopped',stale:'unclosed','recon-old':'replaced','recon-new':'active',phone2:'active'});
 // Nothing invented or deleted: unclosed sessions keep stoppedAt null and every record is still there.
 assert.equal(all.length,5);assert.equal(all.find(s=>s.sessionId==='stale').stoppedAt,null);assert.equal(all.find(s=>s.sessionId==='recon-old').stoppedAt,null);
 // The customer profile carries the same states, so history, Active Sessions and accounting labels agree.
 const plan=st.put('plans',radius.plan({name:'Lab 5',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'}));
 const sub=st.put('subscribers',radius.subscriber(st,{name:'User One',username:'user1',service:'pppoe',planId:plan.id,expiresAt:now+86400000}));
 const prof=require('../lib/revenue.cjs').profile(st,sub.id,now),ps=Object.fromEntries(prof.sessions.map(s=>[s.sessionId,s.state]));
 assert.deepEqual(ps,by);assert.equal(prof.sessions.filter(s=>s.state==='active').length,2,'only the two live devices are online');
 // The accounting log (By session) agrees.
 const ac=hs.acctSessions(st,new URLSearchParams('service=pppoe'),now).items,as=Object.fromEntries(ac.map(x=>[x.sessionId,x.state]));
 assert.deepEqual(as,by);assert.deepEqual(ac.filter(x=>x.open).map(x=>x.sessionId).sort(),['phone2','recon-new']);
 // A reconnect whose old session is still reporting (overlap) is not guessed as ended.
 const st2=fresh();acct(st2,now-5*MIN,'Start','a','u',{mac:'AA:00:00:00:00:09'});acct(st2,now-3*MIN,'Start','b','u',{mac:'AA:00:00:00:00:09'});acct(st2,now-1*MIN,'Interim-Update','a','u',{mac:'AA:00:00:00:00:09'});
 const s2=online.sessionStates(sessions(st2,'u'),now);assert.deepEqual([...s2.values()].sort(),['active','active']);
 // Sessions without a MAC are never "replaced" (no device identity), only aged out.
 const st3=fresh();acct(st3,now-30*MIN,'Start','x','v');acct(st3,now-2*MIN,'Start','y','v');
 const v=sessions(st3,'v');assert.deepEqual(Object.fromEntries(v.map(s=>[s.sessionId,online.stateOf(s,v,now)])),{x:'unclosed',y:'active'});
});

test('online now: router-only, RADIUS+router duplicates, shared-device account, stale report, expired and unknown accounts',()=>{
 const st=fresh(),now=Date.now(),rep=now-2*MIN;
 const hex=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'}),ccr=st.put('devices',{name:'CCR',type:'router',ip:'10.0.0.1'}),old=st.put('devices',{name:'RBX',type:'router',ip:'10.0.0.9'});
 const pl=st.put('plans',radius.plan({name:'Lab 5',service:'both',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'}));
 st.put('subscribers',radius.subscriber(st,{name:'Paid',username:'user1',service:'pppoe',planId:pl.id,expiresAt:now+86400000}));
 st.put('subscribers',radius.subscriber(st,{name:'Late',username:'user2',service:'pppoe',planId:pl.id,expiresAt:now-3600000}));
 st.put('subscribers',radius.subscriber(st,{name:'Family',username:'fam',service:'hotspot',planId:pl.id,expiresAt:now+86400000}));
 const ev=(src,name,mac,at=rep,extra={})=>({key:src+name+mac,lastObserved:at,evidence:{[src]:{name,mac,ip:'',observedAt:at,...extra}}});
 st.setting('customerDiscovery:'+hex.id,{lastReport:rep,observations:[ev('ppp','user1','AA:00:00:00:00:01'),ev('hotspot','fam','AA:00:00:00:00:0A',rep,{service:'netops-hotspot'}),ev('hotspot','fam','AA:00:00:00:00:0B',rep,{service:'netops-hotspot'})]});
 st.setting('customerDiscovery:'+ccr.id,{lastReport:rep,observations:[ev('ppp','ispman-only','AA:00:00:00:00:21'),ev('ppp','user2','AA:00:00:00:00:22')]});
 st.setting('customerDiscovery:'+old.id,{lastReport:now-3*3600000,observations:[ev('ppp','gone','AA:00:00:00:00:31',now-3*3600000)]});
 // RADIUS: user1 duplicate of the HEX row; fam's first device duplicate; a RADIUS-only login on HEX.
 acct(st,now-20*MIN,'Start','r1','user1',{mac:'AA:00:00:00:00:01'});acct(st,now-1*MIN,'Interim-Update','r1','user1',{mac:'AA:00:00:00:00:01'});
 acct(st,now-3*MIN,'Start','r2','fam',{mac:'AA:00:00:00:00:0A',hotspot:true,server:'netops-hotspot'});
 acct(st,now-1*MIN,'Start','r3','walkin',{mac:'AA:00:00:00:00:0C',hotspot:true,server:'netops-hotspot'});
 acct(st,now-60*MIN,'Start','r4','user1',{mac:'AA:00:00:00:00:05'});                                  // stale, no Stop: not online
 const s=online.summary(st,now),sum=o=>Object.values(o).reduce((a,b)=>a+b,0);
 assert.equal(s.unit,'connections');
 assert.equal(s.total,6,'user1, fam x2, walkin on HEX; ispman-only and user2 on CCR; RBX stale; old RADIUS session aged out');
 assert.equal(sum(s.byService),s.total);assert.equal(sum(s.byStatus),s.total);assert.equal(sum(s.bySource),s.total);
 assert.deepEqual(s.byService,{hotspot:3,pppoe:3});
 assert.deepEqual(s.byStatus,{active:3,expired:1,deactivated:0,unmatched:2});
 assert.deepEqual(s.bySource,{router:3,radius:1,both:2});
 assert.equal(s.customers,5,'fam\'s two devices are one customer');
 assert.deepEqual(s.stale.map(x=>[x.name,x.lastCount]),[['RBX',1]]);
 assert.equal(s.byRouter.reduce((a,r)=>a+r.total,0),s.total,'router breakdown reconciles to the total');
 // The dashboard uses the same numbers for the KPI and the router cards.
 const ov=require('../lib/overview.cjs').build(st,'24h',now),card=n=>ov.routers.find(r=>r.name===n).customers;
 assert.equal(ov.online.total,6);assert.equal(card('LAB-HEX').online,4);assert.equal(card('CCR').online,2);assert.equal(card('RBX').online,null);assert.equal(card('RBX').stale,true);
});

test('hotspot servers: one server, several servers, RADIUS-only, discovery-only, unknown server and stale reports',()=>{
 const now=Date.now(),rep=now-2*MIN,ev=(name,mac,service,at=rep)=>({key:name+mac,lastObserved:at,evidence:{hotspot:{name,mac,service,observedAt:at}}});
 const row=(st,r,n)=>hs.servers(st,now).items.find(x=>x.routerId===r.id&&x.name===n);
 // One defined server, RADIUS only (no discovery report): the reported LAB-HEX case. Counted, labelled RADIUS only.
 {const st=fresh(),r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});st.setting('routerHealth:'+r.id,{hotspots:[{name:'netops-hotspot',interface:'netops-bridge'}]});
  acct(st,now-2*MIN,'Start','h1','lab-two-device-qa',{mac:'AA:00:00:00:01:01',hotspot:true});           // old-style: no Called-Station-Id
  const x=row(st,r,'netops-hotspot');assert.equal(x.connected,1,'the only server on the router');assert.equal(x.evidence,'RADIUS only');
  // ...and the active list on the same router agrees.
  assert.equal(hs.sessions(st,new URLSearchParams('service=hotspot'),now).total,1);}
 // Two servers: attributed by the router row and by Called-Station-Id; a RADIUS session with no server name is not guessed.
 {const st=fresh(),r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});st.setting('routerHealth:'+r.id,{hotspots:[{name:'hs-a'},{name:'hs-b'}]});
  st.setting('customerDiscovery:'+r.id,{lastReport:rep,observations:[ev('u1','AA:00:00:00:02:01','hs-a'),ev('u2','AA:00:00:00:02:02','hs-b')]});
  acct(st,now-1*MIN,'Start','x1','u1',{mac:'AA:00:00:00:02:01',hotspot:true,server:'hs-a'});            // duplicate of the router row
  acct(st,now-1*MIN,'Start','x3','u3',{mac:'AA:00:00:00:02:03',hotspot:true,server:'hs-b'});
  acct(st,now-1*MIN,'Start','x4','u4',{mac:'AA:00:00:00:02:04',hotspot:true});
  assert.equal(row(st,r,'hs-a').connected,1);assert.equal(row(st,r,'hs-b').connected,2);
  const un=hs.servers(st,now).items.find(x=>x.unattributed);assert.equal(un.connected,1,'server not known: own row');
  assert.equal(hs.servers(st,now).total,2,'the unknown row is not a server');
  assert.equal(st.sessionsOf('u3',0)[0].server,'hs-b','Called-Station-Id stored for hotspot sessions');}
 // Discovery only (router uses another RADIUS): counted from the report.
 {const st=fresh(),r=st.put('devices',{name:'HEXS',type:'router',ip:'10.9.0.1'});
  st.setting('customerDiscovery:'+r.id,{lastReport:rep,observations:[ev('c1','AA:00:00:00:03:01','hotspot1'),ev('c2','AA:00:00:00:03:02','hotspot1')]});
  const x=row(st,r,'hotspot1');assert.equal(x.connected,2);assert.equal(x.evidence,'router report');}
 // Stale report and no RADIUS evidence: Unknown, not 0. A fresh report with nobody connected is a real 0.
 {const st=fresh(),r=st.put('devices',{name:'OLD',type:'router',ip:'10.9.0.2'}),r2=st.put('devices',{name:'EMPTY',type:'router',ip:'10.9.0.3'});
  st.setting('routerHealth:'+r.id,{hotspots:[{name:'hs'}]});st.setting('customerDiscovery:'+r.id,{lastReport:now-60*MIN,observations:[ev('c1','AA:00:00:00:04:01','hs',now-60*MIN)]});
  st.setting('routerHealth:'+r2.id,{hotspots:[{name:'hs2'}]});st.setting('customerDiscovery:'+r2.id,{lastReport:rep,observations:[]});
  assert.equal(row(st,r,'hs').connected,null);assert.equal(row(st,r,'hs').fresh,false);assert.equal(row(st,r2,'hs2').connected,0);}
 // PPPoE sessions never store a hotspot server name.
 {const st=fresh();acct(st,now,'Start','p1','pp',{server:'pppoe-in'});assert.equal(st.sessionsOf('pp',0)[0].server,undefined);}
});
