'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('chat: a short first message such as "Hi" starts a chat; the plain contact form still needs 3 characters',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chs-'));const {createApp}=require('../server.cjs'),app=createApp({dataDir:dir,collector:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port,post=b=>fetch(o+'/portal/api/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});try{
  const r=await post({chat:true,phone:'0712345678',message:'Hi'});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));assert.ok(d.token,'chat token returned');
  const t=await fetch(o+'/portal/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Chat-Token':d.token},body:JSON.stringify({text:'ok'})});assert.equal(t.status,200,'2-letter follow-up');
  const c=await post({name:'Jane',phone:'0712345678',message:'Hi'});assert.notEqual(c.status,200,'contact form keeps its 3-character minimum');
 }finally{app.server.close();fs.rmSync(dir,{recursive:true,force:true});}});
