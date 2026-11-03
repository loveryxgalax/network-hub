'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createApp}=require('../server.cjs'),{Store}=require('../lib/store.cjs'),outbox=require('../lib/outbox.cjs'),radius=require('../lib/radius.cjs');
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
test('outbox: changes become ordered events; cursor, catch-up and reset',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ob-')),store=new Store(dir);try{outbox.watch(store);
  const r=store.put('devices',{name:'CCR',type:'router',status:'online'});store.put('devices',{...r,status:'offline'},r);
  const a=store.put('alerts',{title:'CCR down',status:'Open',severity:'critical'});store.put('alerts',{...a,status:'Resolved'},a);
  store.put('subscriberPayments',{name:'Mary',amount:500,method:'mpesa'});
  const p=store.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}));
  store.put('subscribers',radius.subscriber(store,{name:'Kim',username:'kim',service:'hotspot',planId:p.id}));
  radius.accounting(store,{'Acct-Status-Type':'Start','Acct-Session-Id':'s1','User-Name':'kim','NAS-Identifier':'CCR','Service-Type':'Login-User'});
  radius.accounting(store,{'Acct-Status-Type':'Interim-Update','Acct-Session-Id':'s1','User-Name':'kim','NAS-Identifier':'CCR','Service-Type':'Login-User'});
  radius.accounting(store,{'Acct-Status-Type':'Stop','Acct-Session-Id':'s1','User-Name':'kim','NAS-Identifier':'CCR','Service-Type':'Login-User','Acct-Terminate-Cause':'Idle-Timeout'});
  const all=outbox.since(store,0);
  assert.deepEqual(all.events.map(e=>e.type),['router.down','alert.opened','alert.resolved','payment.received','customer.added','session.start','session.stop']);
  assert.ok(all.events.every((e,i,x)=>!i||e.seq>x[i-1].seq),'ordered');assert.equal(all.events.find(e=>e.type==='payment.received').admin,true);
  assert.equal(all.events.at(-1).name,'Kim');assert.equal(all.events.at(-1).cause,'Idle-Timeout');
  const mid=all.events[2].seq;assert.deepEqual(outbox.since(store,mid).events.map(e=>e.type),['payment.received','customer.added','session.start','session.stop']);
  assert.equal(outbox.since(store,all.last).events.length,0);
  const fresh=outbox.since(store,null,3);assert.equal(fresh.events.length,3,'no cursor: the latest few');assert.equal(fresh.events.at(-1).type,'session.stop');
  const ahead=outbox.since(store,all.last+100);assert.equal(ahead.reset,true,'cursor ahead of the outbox (restored database): start again');
  // A failing listener never breaks a save.
  store.hooks.push(()=>{throw new Error('boom');});assert.ok(store.put('tickets',{title:'x'}));
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('internal v1: snapshot with cursor, events, sign-in check that ends on logout; roles flag',async()=>{
 let seen=null;const upstream=http.createServer((req,res)=>{seen=req.headers;res.writeHead(200);res.end('ok');});const upPort=await listen(upstream);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v1-')),token='live-token-for-tests-0123456789';
 const app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',liveToken:token,liveUrl:'http://127.0.0.1:'+upPort,liveRoles:'admin,manager'});
 const port=await listen(app.server),feedPort=await listen(app.liveFeed),origin='http://127.0.0.1:'+port,feed=p=>fetch('http://127.0.0.1:'+feedPort+p,{headers:{Authorization:'Bearer '+token}}).then(async r=>({status:r.status,body:await r.json()}));
 try{const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'v1@example.test',password:'fixture-owner-password-123'})});const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf;
  assert.equal((await fetch('http://127.0.0.1:'+feedPort+'/internal/v1/events')).status,401);
  app.store.put('alerts',{title:'Test alert',status:'Open'});
  const snap=await feed('/internal/v1/snapshot');assert.equal(snap.status,200);assert.ok(snap.body.seq>=1);assert.ok(snap.body.online);
  const ev=await feed('/internal/v1/events?after=0');assert.ok(ev.body.events.some(e=>e.type==='alert.opened'));assert.equal(ev.body.last,snap.body.seq);
  assert.equal((await feed('/internal/v1/nope')).status,404);
  // The hub forwards a session id; Phoenix checks it, and it stops being valid after sign-out.
  assert.equal((await fetch(origin+'/live',{headers:{Cookie:cookie}})).status,200);const sid=seen['x-netops-session'];assert.match(sid,/^[a-f0-9]{64}$/);
  assert.deepEqual((await feed('/internal/v1/session?sid='+sid)).body,{valid:true,role:'admin',email:'v1@example.test'});
  assert.equal((await feed('/internal/v1/session?sid='+'0'.repeat(64))).body.valid,false);assert.equal((await feed('/internal/v1/session?sid=bad')).body.valid,false);
  const lo=await fetch(origin+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:'{}'});assert.ok(lo.status<300,'logout '+lo.status);
  assert.equal((await feed('/internal/v1/session?sid='+sid)).body.valid,false,'signed out: the live view session ends');
  // Roles flag: an operator is refused when NETWORK_LIVE_ROLES lists admin and manager only.
  const own=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'v1@example.test',password:'fixture-owner-password-123'})}),c2=own.headers.get('set-cookie').split(';')[0],t2=(await own.json()).csrf;
  const mk=await fetch(origin+'/api/team',{method:'POST',headers:{'Content-Type':'application/json',Cookie:c2,'X-CSRF-Token':t2},body:JSON.stringify({name:'Op',email:'op@example.test',role:'operator',password:'fixture-operator-password-1'})});assert.ok(mk.status<300,'create user '+mk.status);
  const op=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'op@example.test',password:'fixture-operator-password-1'})}),c3=op.headers.get('set-cookie').split(';')[0];
  seen=null;const r=await fetch(origin+'/live',{headers:{Cookie:c3}});assert.equal(r.status,403);assert.equal(seen,null,'nothing reached Phoenix');
 }finally{await app.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('internal v1 actions: alerts acknowledged/resolved by the signed-in viewer, audited; refused after sign-out',async()=>{
 const upstream=http.createServer((req,res)=>{res.writeHead(200);res.end('ok');});const upPort=await listen(upstream);let seen=null;upstream.on('request',req=>{seen=req.headers;});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v1a-')),token='live-token-for-tests-0123456789';
 const app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',liveToken:token,liveUrl:'http://127.0.0.1:'+upPort});
 const port=await listen(app.server),feedPort=await listen(app.liveFeed),origin='http://127.0.0.1:'+port;
 const act=(input,tok=token)=>fetch('http://127.0.0.1:'+feedPort+'/internal/v1/actions',{method:'POST',headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify(input)}).then(async r=>({status:r.status,body:await r.json()}));
 try{const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'act@example.test',password:'fixture-owner-password-123'})});const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf;
  await fetch(origin+'/live',{headers:{Cookie:cookie}});const sid=seen['x-netops-session'];
  const a=app.store.put('alerts',{title:'RB951 is unreachable',status:'Open',severity:'critical'});
  assert.equal((await act({sid,action:'alert.acknowledge',id:a.id},'wrong-token-wrong-token-wrong-tok')).status,401,'needs the shared token');
  assert.equal((await act({sid:'0'.repeat(64),action:'alert.acknowledge',id:a.id})).status,401,'unknown session');
  assert.equal((await act({sid,action:'router.reboot',id:a.id})).status,400,'only whitelisted actions');
  assert.equal((await act({sid,action:'alert.resolve',id:'00000000-0000-4000-8000-000000000000'})).status,404);
  const r=await act({sid,action:'alert.acknowledge',id:a.id});assert.equal(r.status,200);assert.equal(r.body.alert.status,'Acknowledged');assert.equal(app.store.get('alerts',a.id).acknowledgedBy,'act@example.test');
  assert.ok(app.store.db.prepare("SELECT 1 FROM audit WHERE action LIKE 'Acknowledged alert:%'").get(),'audited');
  const ev=require('../lib/outbox.cjs').since(app.store,0).events.map(e=>e.type);assert.ok(ev.includes('alert.acknowledged'));
  assert.equal((await act({sid,action:'alert.resolve',id:a.id})).body.alert.status,'Resolved');
  await fetch(origin+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},body:'{}'});
  assert.equal((await act({sid,action:'alert.reopen',id:a.id})).status,401,'signed out: no more actions');
 }finally{await app.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
