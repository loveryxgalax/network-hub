'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs');
test('customer portal: all payments, own receipts only, email update; admin insight: lifetime value, timeline, heatmap',async()=>{
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'ins-')),collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'ins@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store,H={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  const plan=st.put('plans',radius.plan(st,{name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:10,price:1500,durationValue:1,durationUnit:'months'}));
  const sub=st.put('subscribers',radius.subscriber(st,{name:'Amina',username:'kne-ins1',service:'pppoe',planId:plan.id,phone:'0712345678',expiresAt:Date.now()+864e5}));
  const other=st.put('subscribers',radius.subscriber(st,{name:'Baraka',username:'kne-ins2',service:'pppoe',planId:plan.id,phone:'0722345678',expiresAt:Date.now()+864e5}));
  const now=Date.now(),D=864e5;
  for(let i=0;i<7;i++)st.put('subscriberPayments',{subscriberId:sub.id,username:sub.username,amount:1500,reference:'QK'+i+'ABCDEF',method:'mpesa',planName:i<3?'Home 5':'Home 10',time:now-(50-i*7)*D});
  const rev=st.put('subscriberPayments',{subscriberId:sub.id,username:sub.username,amount:999,reference:'REVERSED1',method:'mpesa',time:now-D,reversedAt:now});
  const theirs=st.put('subscriberPayments',{subscriberId:other.id,username:other.username,amount:500,reference:'OTHER1',method:'mpesa',time:now-D});
  st.put('radiusSessions',{username:sub.username,startedAt:now-3*D,stoppedAt:now-3*D+2*36e5,downloadBytes:5e8,uploadBytes:1e8,updatedAt:now-3*D+2*36e5});
  st.put('radiusSessions',{username:sub.username,startedAt:now-40*D,stoppedAt:now-40*D+36e5,downloadBytes:1e8,uploadBytes:1e7,updatedAt:now-40*D+36e5});
  st.put('tickets',{title:'Slow at night',status:'Open',priority:'Normal',subscriberId:sub.id});
  // Customer side
  const link=await fetch(o+'/api/radius/subscribers/'+sub.id+'/self-service',{method:'POST',headers:H,body:'{}'}).then(r=>r.json());
  const hop=await fetch(o+new URL(link.link).pathname,{redirect:'manual'}),t=new URL(hop.headers.get('location'),o).searchParams.get('t'),q='t='+encodeURIComponent(t);
  const all=await fetch(o+'/portal/api/me/payments?'+q).then(r=>r.json());
  assert.equal(all.items.length,7,'reversed and other customers\' payments are left out');assert.ok(all.items.every(p=>p.id&&p.amount===1500));
  assert.ok(all.items[0].time>all.items[6].time,'newest first');assert.ok(!all.items.some(p=>p.ref==='QK0ABCDEF'),'references are masked');
  const rc=await fetch(o+'/portal/api/me/receipt?'+q+'&id='+all.items[0].id);assert.equal(rc.status,200);assert.match(await rc.text(),/1,?500/);
  assert.equal((await fetch(o+'/portal/api/me/receipt?'+q+'&id='+theirs.id)).status,404,'another customer\'s receipt is refused');
  assert.equal((await fetch(o+'/portal/api/me/receipt?'+q+'&id='+rev.id)).status,404,'a reversed payment has no receipt');
  assert.equal((await fetch(o+'/portal/api/me/payments?t=bad')).status,404);
  const post=b=>fetch(o+'/portal/api/me/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t,...b})});
  assert.equal((await post({email:'not-an-email'})).status,400);
  const ok=await post({email:'  Amina@Example.test '});assert.equal(ok.status,200);assert.equal((await ok.json()).email,'amina@example.test');
  assert.equal(st.get('subscribers',sub.id).email,'amina@example.test');
  assert.equal((await fetch(o+'/portal/api/me?'+q).then(r=>r.json())).email,'amina@example.test');
  // Admin side
  const ins=await fetch(o+'/api/radius/subscribers/'+sub.id+'/insight',{headers:H}).then(r=>r.json());
  assert.equal(ins.lifetime.total,10500);assert.equal(ins.lifetime.payments,7);assert.equal(typeof ins.lifetime.trend,'number');
  assert.deepEqual(ins.timeline.map(x=>x.key),['created','firstPayment','firstSession','lastSession','today']);
  assert.ok(ins.timeline.every(x=>x.at),'every lifecycle step has a date');
  assert.equal(ins.activity.activeDays,2);assert.equal(Object.values(ins.activity.days).reduce((n,d)=>n+d.sessions,0),2);
  assert.deepEqual(ins.packages.map(p=>p.name),['Home 10','Home 5'],'package history, newest first');assert.equal(ins.packages[0].payments,4);
  assert.equal(ins.tickets.length,1);assert.ok(Array.isArray(ins.log));
  assert.equal((await fetch(o+'/api/radius/subscribers/'+sub.id+'/insight')).status,401,'staff only');
  // A banned customer cannot change contact details.
  await fetch(o+'/api/radius/subscribers/'+sub.id+'/ban',{method:'POST',headers:H,body:JSON.stringify({reason:'Fraud test'})});
  assert.equal((await post({email:'x@example.test'})).status,403);
  assert.equal((await fetch(o+'/api/radius/subscribers/'+sub.id+'/insight',{headers:H}).then(r=>r.json())).timeline.some(x=>x.key==='banned'),true);
 }finally{app.server.close();}
});
