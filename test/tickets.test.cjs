'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('support tickets: replies, internal notes, status/priority/assignment history; viewers cannot change them',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tk-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;
 const as=s=>async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json()};};
 const login=async(email,password)=>{const r=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};};
 try{const o=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'own@example.test',password:'fixture-owner-password-123'})});
  const owner=as({cookie:o.headers.get('set-cookie').split(';')[0],csrf:(await o.json()).csrf});
  const t=(await owner('records/tickets','POST',{title:'No internet',category:'Something else',priority:'High',status:'Open'})).body;assert.equal(t.priority,'High');
  const mate=(await owner('team','POST',{name:'Agent',email:'agent@example.test',role:'support',password:'agent-password-12345'})).body;
  assert.equal((await owner('tickets/'+t.id+'/messages','POST',{text:'We are checking the line'})).status,201);
  assert.equal((await owner('tickets/'+t.id+'/messages','POST',{text:'Fibre cut near the market',internal:true})).status,201);
  assert.equal((await owner('tickets/'+t.id+'/messages','POST',{text:'  '})).status,400);
  assert.equal((await owner('tickets/'+t.id+'/update','POST',{status:'Pending',assigneeId:mate.id})).status,200);
  assert.equal((await owner('tickets/'+t.id+'/update','POST',{assigneeId:'not-a-member'})).status,400);
  const d=(await owner('tickets/'+t.id)).body;assert.equal(d.ticket.status,'Pending');assert.equal(d.ticket.assigneeId,mate.id);
  assert.deepEqual(d.replies.map(m=>m.text),['We are checking the line']);assert.deepEqual(d.notes.map(m=>m.text),['Fibre cut near the market']);
  assert.deepEqual(d.events.map(m=>m.text),['Status: Open → Pending','Assigned to Agent']);
  await owner('team','POST',{name:'Look',email:'look@example.test',role:'viewer',password:'viewer-password-12345'});const viewer=as(await login('look@example.test','viewer-password-12345'));
  const vr=await viewer('tickets/'+t.id+'/update','POST',{status:'Closed'});assert.ok([403].includes(vr.status),'viewer cannot change tickets: '+vr.status);
 }finally{await app.close();}
});
