'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('small-router mode: one part per pass, separate download and import, slower discovery',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stg-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://netops.example.test',radiusSecret:'testRadiusSecret123'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'sg@example.test',password:'fixture-owner-password-123'})});const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store;
  const api=async(r,method='GET',input)=>{const x=await fetch(origin+'/api/'+r,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,Host:'netops.example.test'},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:x.status,body:await x.json().catch(()=>null)};};
  st.setting('wgServer',{publicKey:'A'.repeat(43)+'=',endpoint:'203.0.113.10',port:51820});
  assert.equal((await api('provision','POST',{name:'HAP NEW',stages:[]})).status,400);
  const a=await api('provision','POST',{name:'HAP NEW',stages:['identity'],lite:true});assert.equal(a.status,201,JSON.stringify(a.body));
  assert.equal(a.body.staged,true);assert.deepEqual(a.body.parts,['Router name (identity)']);
  assert.match(a.body.fetchCommand,/\/tool fetch url="https:\/\/netops\.example\.test\/api\/provision\/bundle\/[a-f0-9-]{36}" http-header-field="Authorization:Bearer [A-Za-z0-9_-]{43}" check-certificate=yes dst-path="netops-link\.rsc"$/);
  assert.doesNotMatch(a.body.fetchCommand,/\/import/);assert.match(a.body.importCommand,/^\/import file-name="netops-link\.rsc"; \/file remove/);assert.equal(a.body.checkCommand,'/file print where name="netops-link.rsc"');assert.ok(a.body.bytes>20&&a.body.bytes<400);
  const rid=a.body.router.id,pass=(stage,extra={})=>api('provision','POST',{routerId:rid,stages:[stage],lite:true,...extra});
  assert.equal((await pass('radius')).status,409,'RADIUS needs the tunnel first');
  const w=await pass('wireguard');assert.equal(w.status,201);assert.match(w.body.parts[0],/^WireGuard tunnel/);assert.ok(w.body.bytes<2500);
  assert.equal((await pass('wireguard')).status,409,'a second WireGuard pass does not reissue silently');
  assert.ok((await pass('wireguard',{newWireguardKey:true})).status===201);
  const m=await pass('monitoring');assert.deepEqual(m.body.parts,['Monitoring (read-only)']);const agentSecret=st.secret('agent:'+rid);assert.ok(agentSecret);
  const rr=await pass('radius');assert.equal(rr.status,201);assert.match(rr.body.parts[0],/^netops RADIUS/);
  assert.deepEqual(st.secret('agent:'+rid),agentSecret,'a part that is not monitoring leaves the monitoring credential alone');
  const d=await pass('discovery');assert.match(d.body.parts[0],/every 10 minutes/);
  const dev=fs.existsSync(dir);assert.ok(dev);
  const full=await api('provision','POST',{routerId:rid,identity:true,wireguard:false,radius:'none',runner:true});assert.equal(full.status,201);assert.equal(full.body.staged,undefined);assert.ok(full.body.parts.length>=3);
 }finally{app.server.close();}
});
