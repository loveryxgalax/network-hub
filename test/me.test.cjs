'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('my account: own password change signs out other devices; sign-ins and activity are listed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'me-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 const as=s=>async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json()};};
 const login=async(email,password,ua='test-a')=>{const r=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':ua},body:JSON.stringify({email,password})});return r.status===200?{cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf}:null;};
 try{await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'own@example.test',password:'fixture-owner-password-123'})});
  const a=as(await login('own@example.test','fixture-owner-password-123','browser-a')),b=as(await login('own@example.test','fixture-owner-password-123','browser-b'));
  const me=(await a('me')).body;assert.equal(me.user.email,'own@example.test');assert.equal(me.otherSessions,2);assert.ok(me.signins.length>=2);
  assert.equal((await a('me/password','POST',{current:'wrong-password-000',next:'brand-new-password-456'})).status,400);
  assert.equal((await a('me/password','POST',{current:'fixture-owner-password-123',next:'short'})).status,400);
  assert.equal((await a('me/password','POST',{current:'fixture-owner-password-123',next:'brand-new-password-456'})).status,200);
  assert.equal((await b('me')).status,401,'other device signed out');assert.equal((await a('me')).status,200,'this device stays signed in');
  assert.equal(await login('own@example.test','fixture-owner-password-123'),null);assert.ok(await login('own@example.test','brand-new-password-456'));
  assert.deepEqual((await a('me/alerts','PUT',{signinAlerts:true})).body,{signinAlerts:true});
  assert.ok((await a('me')).body.activity.some(x=>x.action==='Changed own password'));
 }finally{await app.close();}
});
