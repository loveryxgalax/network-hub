'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs'),access=require('../lib/access.cjs');
test('invite link, branches scope, quick extend',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tb-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'tb@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store;
  const call=(m,u,b)=>fetch(o+'/api/'+u,{method:m,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(b?{body:JSON.stringify(b)}:{})}).then(async r=>({status:r.status,body:await r.json()}));
  // Branch with one router; a support person in it sees only that router's customers.
  const r1=st.put('devices',{name:'R1',type:'router',driver:'none'}),r2=st.put('devices',{name:'R2',type:'router',driver:'none'});
  const br=(await call('POST','branches',{name:'Ikutha',routerIds:[r1.id]})).body;assert.ok(br.id);
  assert.equal((await call('POST','branches',{name:'ikutha'})).status,409);
  // Invite: no password yet, cannot sign in, link sets the password once.
  const inv=await call('POST','team',{name:'Mary',email:'mary@example.test',role:'support',invite:true,branchIds:[br.id]});assert.equal(inv.status,201);const link=inv.body.inviteLink;assert.match(link,/#invite=/);
  const token=link.split('#invite=')[1];
  assert.equal((await fetch(o+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'mary@example.test',password:'whatever-password-1'})})).status,401);
  const info=await (await fetch(o+'/api/invite?token='+token)).json();assert.equal(info.email,'mary@example.test');
  assert.equal((await fetch(o+'/api/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:'short'})})).status,400);
  const ok=await fetch(o+'/api/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:'mary-new-password-1'})});assert.equal(ok.status,200);
  assert.equal((await fetch(o+'/api/invite?token='+token)).status,404,'link works once');
  const mary=st.db.prepare('SELECT * FROM users WHERE email=?').get('mary@example.test');assert.equal(mary.active,1);
  const sc=access.scope(st,mary);assert.ok(sc.has(r1.id)&&!sc.has(r2.id));
  // Quick extend: +1 day from the current expiry, reason required, recorded.
  const plan=st.put('plans',{name:'P',service:'pppoe',price:100,durationValue:30,durationUnit:'days'}),t=Date.now()+36e5;
  const c=st.put('subscribers',{name:'C',username:'c1',service:'pppoe',planId:plan.id,status:'active',expiresAt:t});
  assert.equal((await call('POST','radius/subscribers/'+c.id+'/extend',{step:'1d'})).status,400);
  const ex=await call('POST','radius/subscribers/'+c.id+'/extend',{step:'1d',reason:'outage Tuesday'});assert.equal(ex.status,200);assert.equal(ex.body.expiresAt,t+864e5);
  assert.ok(st.list('expiryChanges').some(x=>x.subscriberId===c.id&&x.after===t+864e5));
  assert.equal(st.list('subscriberPayments').length,0,'extend is not a payment');
 }finally{app.server.close();fs.rmSync(dir,{recursive:true,force:true});}
});
