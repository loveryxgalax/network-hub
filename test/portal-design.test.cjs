'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('WiFi page design switch: previous design by default, new on request, preview can show either',async()=>{
 const {createApp}=require('../server.cjs'),landing=require('../lib/landing.cjs');
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'pd-')),collector:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const o='http://127.0.0.1:'+app.server.address().port,get=async u=>(await fetch(o+u)).text();
 try{
  assert.equal(landing.get(app.store).portalDesign,'previous');
  let t=await get('/portal/');assert.match(t,/\/portal\/portal\.js/);assert.doesNotMatch(t,/wifi\.js/);
  assert.match(await get('/portal/?preview=1&design=new'),/\/portal\/wifi\.js/);
  assert.match(await get('/portal/?design=new'),/\/portal\/portal\.js/,'design in the address only counts for the admin preview');
  landing.save(app.store,{...landing.get(app.store),portalDesign:'new'});
  assert.match(await get('/portal/'),/\/portal\/wifi\.js/);
  assert.match(await get('/portal/?preview=1&design=previous'),/\/portal\/portal\.js/);
  assert.equal(landing.validate({...landing.get(app.store),portalDesign:'bogus'}).portalDesign,'previous');
 }finally{app.server.close();}
});
