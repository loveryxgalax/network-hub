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
test('RADIUS timeout alerts name whose server it is',()=>{
 const cu=require('../lib/customers.cjs'),{Store}=require('../lib/store.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'rl-')),st=new Store(dir);try{
  const ccr=st.put('devices',{name:'CCR',type:'router'}),t1=st.put('devices',{name:'TEST-1',type:'router'});st.put('wgPeers',{kind:'router',routerId:t1.id,address:'10.99.0.2'});
  const k={key:'radius-unreachable',title:'x',severity:'critical'};
  assert.equal(cu.radiusLabel(st,ccr,k).severity,'warning');assert.match(cu.radiusLabel(st,ccr,k).title,/not netops/);
  assert.equal(cu.radiusLabel(st,t1,k).severity,'critical');assert.match(cu.radiusLabel(st,t1,k).title,/^netops RADIUS/);
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('sharing code: friend joins a multi-device package as one of its devices',()=>{
 const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),landing=require('../lib/landing.cjs'),sc=require('../lib/sharecode.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sc-')),st=new Store(dir);try{
  const plan=st.put('plans',{name:'Duo',service:'hotspot',price:20,durationValue:1,durationUnit:'days',devices:2,downloadMbps:5,uploadMbps:5});
  const one=st.put('plans',{name:'Solo',service:'hotspot',price:10,durationValue:1,durationUnit:'days',devices:1});
  const o=st.put('subscribers',{name:'Mary Wanjiru',username:'mary1',service:'hotspot',planId:plan.id,status:'active',expiresAt:Date.now()+864e5});radius.setPassword(st,o.id,'pw12345');
  assert.equal(sc.preview(st,'SAAAAAAA'),null,'off by default');
  st.setting('landingConfig',{show:{shareCode:true}});const code=sc.codeOf(st,o);assert.match(code,/^S[A-Z0-9]{7}$/);
  assert.equal(sc.codeOf(st,st.put('subscribers',{name:'S',username:'s1',service:'hotspot',planId:one.id})),null,'single-device packages get no code');
  const pv=landing.account(st,code);assert.equal(pv.share,true);assert.equal(pv.owner,'Mary');assert.equal(pv.phone,undefined,'no private details');
  const auth=u=>radius.authorize(st,{'User-Name':u,'Calling-Station-Id':'AA:BB:CC:DD:EE:01'});
  assert.equal(auth(code.toLowerCase()).status,200,'friend logs in with the code');
  assert.equal(st.get('subscribers',o.id).username,'mary1','owner unchanged');
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}
});
