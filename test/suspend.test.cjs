'use strict';
// Deactivate = refuse new logins now + disconnect the sessions that are on, on the right router, with an honest status.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),jobs=require('../lib/jobs.cjs');
async function boot(){const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'sp-')),collector:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const o='http://127.0.0.1:'+app.server.address().port,owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'sp@example.test',password:'fixture-owner-password-123'})});
 const H={'Content-Type':'application/json',Cookie:owner.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await owner.json()).csrf};
 const st=app.store,post=(p,b={})=>fetch(o+p,{method:'POST',headers:H,body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
 const get=p=>fetch(o+p,{headers:H}).then(r=>r.json());return {app,o,st,post,get};}
const acct=(st,kind,id,user,{nas='10.5.0.1',ident='LAB-HEX',mac='',hotspot=false}={})=>radius.accounting(st,{'Acct-Status-Type':kind,'Acct-Session-Id':id,'NAS-IP-Address':nas,'NAS-Identifier':ident,'User-Name':user,'Calling-Station-Id':mac,...(hotspot?{'Service-Type':'Login-User'}:{'Service-Type':'Framed-User','Framed-Protocol':'PPP'})});
const auth=(st,user,pw,hotspot=false)=>radius.authorize(st,{'User-Name':user,'User-Password':pw,'NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX',...(hotspot?{'Service-Type':'Login-User'}:{'Service-Type':'Framed-User','Framed-Protocol':'PPP'})});
const pull=(st,rid)=>jobs.next(st,rid);
test('PPPoE: deactivate refuses logins and disconnects the live session; runner failure, retry, applied',async()=>{
 const {app,st,post,get}=await boot();
 try{const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});jobs.enroll(st,r.id);
  const plan=st.put('plans',radius.plan({name:'Lab 20',service:'pppoe',downloadMbps:20,uploadMbps:10,price:1,durationValue:30,durationUnit:'days'}));
  const u2=st.put('subscribers',radius.subscriber(st,{name:'User Two',username:'user2',service:'pppoe',planId:plan.id,routerId:r.id,expiresAt:Date.now()+864e5}));radius.setPassword(st,u2.id,'fixture-pw-u2');
  assert.equal(auth(st,'user2','fixture-pw-u2').status,200);acct(st,'Start','p1','user2',{mac:'AA:00:00:00:00:02'});
  const d=await post('/api/radius/subscribers/'+u2.id+'/deactivate',{reason:'QA suspension test'});
  assert.equal(d.status,200);assert.match(d.body.message,/new logins are refused now/);assert.match(d.body.message,/Disconnect queued on LAB-HEX/);
  assert.equal(d.body.enforcement.state,'queued');assert.equal(auth(st,'user2','fixture-pw-u2').status,401,'login refused at once');
  // Runner: first attempt fails, retry succeeds.
  let j=pull(st,r.id);assert.match(j.script,/\/ppp active find where name="user2"/);jobs.result(st,r.id,j.id,{ok:false,error:'timeout'});
  let prof=await get('/api/customers/'+u2.id+'/profile');assert.equal(prof.subscriber.suspension.state,'queued','retrying, not claimed applied');
  const cur=st.get('routerJobs',j.id);st.put('routerJobs',{...cur,nextAttemptAt:0},cur);j=pull(st,r.id);jobs.result(st,r.id,j.id,{ok:true,output:'removed 1 session(s)'});
  prof=await get('/api/customers/'+u2.id+'/profile');assert.equal(prof.subscriber.suspension.state,'applied');assert.equal(prof.subscriber.suspension.targets[0].status,'applied');
  // Reactivate: logins work again, nothing pending.
  const a=await post('/api/radius/subscribers/'+u2.id+'/activate');assert.equal(a.status,200);assert.equal(auth(st,'user2','fixture-pw-u2').status,200);
  // Accounting history untouched.
  assert.equal(st.sessionsOf('user2',0).length,1);assert.equal(st.sessionsOf('user2',0)[0].stoppedAt,null,'no invented Stop');
 }finally{app.server.close();}
});
test('hotspot: all devices, child, share code and TV of the account; other accounts untouched',async()=>{
 const {app,st,post}=await boot();
 try{const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});jobs.enroll(st,r.id);
  const plan=st.put('plans',radius.plan({name:'Lab Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days',devices:3}));
  const h=st.put('subscribers',{...radius.subscriber(st,{name:'Shared',username:'lab-share',service:'hotspot',planId:plan.id,routerId:r.id,expiresAt:Date.now()+864e5}),shareCode:'SHR123',tvs:[{mac:'2C:FE:E2:F6:01:E2',name:'TV'}]});
  const kid=st.put('subscribers',{...radius.subscriber(st,{name:'Kid',username:'lab-kid',service:'hotspot',planId:plan.id,expiresAt:Date.now()+864e5}),parentId:h.id});
  const other=st.put('subscribers',radius.subscriber(st,{name:'Other',username:'lab-other',service:'hotspot',planId:plan.id,expiresAt:Date.now()+864e5}));
  for(const [id,u,m] of [['a','lab-share','AA:00:00:00:00:0A'],['b','lab-share','AA:00:00:00:00:0B'],['c','lab-kid','AA:00:00:00:00:0C'],['d','SHR123','AA:00:00:00:00:0D'],['e','2C:FE:E2:F6:01:E2','2C:FE:E2:F6:01:E2'],['f','lab-other','AA:00:00:00:00:0F']])acct(st,'Start',id,u,{mac:m,hotspot:true});
  const d=await post('/api/radius/subscribers/'+h.id+'/deactivate',{reason:'QA hotspot suspension'});assert.equal(d.status,200);
  const names=st.list('routerJobs').filter(j=>j.type==='disconnect').map(j=>j.params.username).sort();
  assert.deepEqual(names,['2C:FE:E2:F6:01:E2','2c:fe:e2:f6:01:e2','SHR123','lab-kid','lab-share','shr123'],'each login name in its recorded and its seen spelling; both lab-share devices go with one job');
  assert.ok(!names.includes('lab-other'));
  // Child deactivated on its own is refused too (it used to inherit only the parent's status).
  await post('/api/radius/subscribers/'+h.id+'/activate');radius.setPassword(st,kid.id,'fixture-pw-kid');
  for(const [id,u] of [['a','lab-share'],['b','lab-share'],['c','lab-kid'],['d','SHR123'],['e','2C:FE:E2:F6:01:E2']])acct(st,'Stop',id,u,{hotspot:true}); // free the 3 device slots
  assert.equal(auth(st,'lab-kid','fixture-pw-kid',true).status,200);
  await post('/api/radius/subscribers/'+kid.id+'/deactivate',{reason:'QA child'});assert.equal(auth(st,'lab-kid','fixture-pw-kid',true).status,401);
 }finally{app.server.close();}
});
test('evidence: last-known router without fresh sessions, router without runner, no router at all',async()=>{
 const {app,st,post}=await boot();
 try{const lab=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});jobs.enroll(st,lab.id);const bare=st.put('devices',{name:'NO-RUNNER',type:'router',ip:'10.9.9.9'});
  const plan=st.put('plans',radius.plan({name:'Lab 5',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1,durationValue:30,durationUnit:'days'}));
  const mk=(u,rid)=>st.put('subscribers',radius.subscriber(st,{name:u,username:u,service:'pppoe',planId:plan.id,routerId:rid,expiresAt:Date.now()+864e5}));
  // Stale: last session 2 hours ago on LAB-HEX, no Stop. Not "live", but LAB-HEX is the last known router: covered.
  const s1=mk('stale1',lab.id);radius.accounting(st,{'Acct-Status-Type':'Start','Acct-Session-Id':'x1','NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX','User-Name':'stale1','Service-Type':'Framed-User','Framed-Protocol':'PPP'},Date.now()-2*36e5);
  let d=await post('/api/radius/subscribers/'+s1.id+'/deactivate',{reason:'QA stale'});assert.deepEqual(d.body.enforcement.targets.map(t=>[t.router,t.status,t.evidence[0]]),[['LAB-HEX','queued','last-known']]);
  // Live on a router with no job runner: honest "unavailable".
  const s2=mk('norun',bare.id);acct(st,'Start','x2','norun',{nas:'10.9.9.9',ident:'NO-RUNNER'});
  d=await post('/api/radius/subscribers/'+s2.id+'/deactivate',{reason:'QA no runner'});
  assert.equal(d.body.enforcement.state,'incomplete');assert.match(d.body.message,/Not enforced on: NO-RUNNER \(no job runner on this router\)/);
  assert.equal(st.list('routerJobs').filter(j=>j.routerId===bare.id).length,0);
  // Never connected, no router: nothing to disconnect, said plainly.
  const s3=mk('never','');d=await post('/api/radius/subscribers/'+s3.id+'/deactivate',{reason:'QA never'});assert.match(d.body.message,/No live session found/);assert.equal(d.body.enforcement.state,'no-live-session');
 }finally{app.server.close();}
});
test('races: reactivation before the runner pulls cancels; after it pulled is reported; re-suspension keeps its disconnect',async()=>{
 const {app,st,post}=await boot();
 try{const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});jobs.enroll(st,r.id);
  const plan=st.put('plans',radius.plan({name:'Lab 5',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1,durationValue:30,durationUnit:'days'}));
  const u=st.put('subscribers',radius.subscriber(st,{name:'User One',username:'user1',service:'pppoe',planId:plan.id,routerId:r.id,expiresAt:Date.now()+864e5}));acct(st,'Start','p','user1',{mac:'AA:00:00:00:00:01'});
  // 1. Deactivate, then activate before the router checks in: the disconnect is cancelled and never handed out.
  await post('/api/radius/subscribers/'+u.id+'/deactivate',{reason:'QA race 1'});let a=await post('/api/radius/subscribers/'+u.id+'/activate');
  assert.match(a.body.message,/1 waiting disconnect\(s\) cancelled/);assert.equal(pull(st,r.id),null,'nothing reaches the router');
  // 2. A guarded job that somehow is still queued after reactivation is dropped at hand-out time.
  await post('/api/radius/subscribers/'+u.id+'/deactivate',{reason:'QA race 2'});const q=st.list('routerJobs').find(j=>j.type==='disconnect'&&j.status==='queued');
  const s=st.get('subscribers',u.id);st.put('subscribers',{...s,status:'active',deactivatedAt:null},s);
  assert.equal(pull(st,r.id),null);assert.equal(st.get('routerJobs',q.id).status,'cancelled');
  // 3. Re-suspended while a disconnect is waiting: that disconnect now belongs to the new suspension and runs.
  const s2=st.get('subscribers',u.id);st.put('subscribers',{...s2,status:'suspended',deactivatedAt:1},s2);
  st.put('routerJobs',{...st.get('routerJobs',q.id),status:'queued'},st.get('routerJobs',q.id));
  await post('/api/radius/subscribers/'+u.id+'/activate');await post('/api/radius/subscribers/'+u.id+'/deactivate',{reason:'QA race 3'});
  const waiting=st.list('routerJobs').filter(j=>j.type==='disconnect'&&j.status==='queued');assert.equal(waiting.length,1);const j=pull(st,r.id);assert.ok(j&&/user1/.test(j.script),'the current suspension\'s disconnect is delivered');
  // 4. Activated after the router already took the job: reported, not hidden.
  a=await post('/api/radius/subscribers/'+u.id+'/activate');assert.match(a.body.message,/already sent to the router/);
 }finally{app.server.close();}
});
test('bulk deactivate enforces too',async()=>{
 const bulk=require('../lib/bulk.cjs'),{Store}=require('../lib/store.cjs'),st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'bk-')));
 const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});jobs.enroll(st,r.id);
 const plan=st.put('plans',radius.plan({name:'Lab 5',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1,durationValue:30,durationUnit:'days'}));
 const u=st.put('subscribers',radius.subscriber(st,{name:'B',username:'bulk1',service:'pppoe',planId:plan.id,routerId:r.id,expiresAt:Date.now()+864e5}));acct(st,'Start','b1','bulk1');
 const f={q:'bulk1'},pv=bulk.preview(st,f,radius.stateOf);
 const out=bulk.apply(st,f,'deactivate',{reason:'QA bulk'},{count:pv.count,version:pv.version,confirm:pv.confirm||''},radius.stateOf,{id:'x',email:'qa@example.test'});
 assert.equal(st.get('subscribers',u.id).status,'suspended');assert.equal(out.disconnects.queued,1);
});
