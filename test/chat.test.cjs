'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('portal chat box creates a ticket by default and can be switched off',async()=>{
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'chat-')),collector:false,publicOrigin:'https://network.example.test'});
 const port=await new Promise(r=>app.server.listen(0,'127.0.0.1',()=>r(app.server.address().port))),url='http://127.0.0.1:'+port+'/portal/api/message';
 const send=b=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{
  assert.equal((await send({name:'Amina',phone:'0712345678',message:'Slow internet'})).status,404,'the old form stays off unless enabled');
  assert.equal((await send({chat:true,name:'Amina',phone:'0712345678',message:'Slow internet'})).status,200);
  assert.equal(app.store.list('tickets').filter(t=>t.source==='portal').length,1);
  const landing=require('../lib/landing.cjs');app.store.setting('landingConfig',{...landing.get(app.store),show:{...landing.get(app.store).show,chat:false}});
  assert.equal((await send({chat:true,name:'Amina',phone:'0712345678',message:'Slow internet'})).status,404,'chat can be switched off');
 }finally{app.server.close();}
});
