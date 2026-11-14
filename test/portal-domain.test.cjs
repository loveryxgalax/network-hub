'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs');
const get=(port,host,p,extra={})=>new Promise((ok,bad)=>{const r=http.request({host:'127.0.0.1',port,path:p,method:extra.method||'GET',headers:{Host:host,...(extra.headers||{})}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:b}));});r.on('error',bad);if(extra.body)r.write(extra.body);r.end();});
test('customer pages on their own address: portal at /, no admin there, links and router pages use it, old links still work',async()=>{
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'pd-')),collector:false,publicOrigin:'https://netops.example.test',portalOrigin:'https://my.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const port=app.server.address().port,MY='my.example.test',OPS='netops.example.test';
 try{
  let r=await get(port,MY,'/');assert.equal(r.status,200);assert.match(r.body,/portal\.js/);assert.match(r.headers['strict-transport-security'],/max-age/);
  assert.equal((await get(port,MY,'/api/session')).status,404,'no admin API on the customer address');
  assert.equal((await get(port,MY,'/live')).status,404);
  r=await get(port,MY,'/workspace.js');assert.equal(r.status,302);assert.equal(r.headers.location,'/');
  assert.equal((await get(port,MY,'/img/favicon.png')).status,200);
  assert.equal((await get(port,MY,'/portal/api/config')).status,200,'portal API works on the customer address');
  assert.equal((await get(port,OPS,'/portal/')).status,200,'the portal still opens on the admin address (old links, routers not yet switched)');
  assert.equal((await get(port,'evil.example','/portal/')).status,200,'static portal pages are not host-restricted');
  r=await get(port,MY,'/portal/api/router/login.html');assert.match(r.body,/https:\/\/my\.example\.test\/portal\//,'router login page sends customers to the customer address');
  // Admin side: sign up, self-service link uses the customer address
  const setup=await fetch('http://127.0.0.1:'+port+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'O',workspace:'Q',email:'pd@example.test',password:'fixture-owner-password-123'})});
  const cookie=setup.headers.get('set-cookie').split(';')[0],csrf=(await setup.json()).csrf;
  const p=app.store.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days'}));
  const s=app.store.put('subscribers',radius.subscriber(app.store,{name:'Jane',username:'jane',service:'hotspot',planId:p.id,expiresAt:Date.now()+864e5}));
  r=await get(port,OPS,'/api/radius/subscribers/'+s.id+'/self-service',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json',Origin:'https://'+OPS},body:'{}'});
  const link=JSON.parse(r.body);assert.match(link.link,/^https:\/\/my\.example\.test\/[A-Za-z0-9]{7}$/);assert.match(link.fullLink,/^https:\/\/my\.example\.test\/portal\/account\.html\?t=/);
  r=await get(port,MY,new URL(link.link).pathname);assert.equal(r.status,302);assert.match(r.headers.location,/^\/portal\/account\.html/);
  // An admin shortening an old netops link still works
  const sl=require('../lib/shortlink.cjs');assert.match(sl.create(app.store,'https://netops.example.test/portal/?x=1',{origin:'https://my.example.test'}).url,/^https:\/\/my\.example\.test\//);
 }finally{app.server.close();}
});
