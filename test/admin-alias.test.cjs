'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const req=(port,host,p,headers={})=>new Promise((ok,no)=>{const r=http.request({host:'127.0.0.1',port,path:p,headers:{host,...headers}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:b}));});r.on('error',no);r.end();});
test('moving the admin address: new main address, old one keeps working, people are redirected, others refused',async()=>{
 const {createApp}=require('../server.cjs');
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'al-')),collector:false,publicOrigin:'https://cloud.example.test',aliasOrigins:'https://netops.example.test',aliasRedirect:true});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const port=app.server.address().port;
 try{
  assert.equal((await req(port,'cloud.example.test','/api/session')).status,200);
  assert.equal((await req(port,'netops.example.test','/api/session')).status,200,'API on the old address still works');
  assert.equal((await req(port,'other.example.test','/api/session')).status,403,'unknown addresses are refused');
  const page=await req(port,'netops.example.test','/?x=1',{accept:'text/html'});assert.equal(page.status,301);assert.equal(page.headers.location,'https://cloud.example.test/?x=1');
  assert.notEqual((await req(port,'netops.example.test','/portal/api/router/login.html',{accept:'text/html'})).status,301,'router and portal paths are never redirected');
  assert.equal((await req(port,'cloud.example.test','/',{accept:'text/html'})).status,200);
  assert.match((await req(port,'netops.example.test','/api/session')).headers['strict-transport-security']||'',/max-age/);
 }finally{app.server.close();}
});
