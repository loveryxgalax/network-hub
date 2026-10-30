'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),assistant=require('../lib/assistant.cjs');
test('assistant: key validation, snapshot without personal data, request shape, refusal handling',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'as-')),store=new Store(dir);
 try{const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1000,durationValue:30,durationUnit:'days'}));store.put('subscribers',radius.subscriber(store,{name:'Ann Wanjiru',username:'ann',service:'pppoe',planId:p.id,phone:'0712345678',email:'ann@x.co'}));
  store.put('devices',{name:'CCR Core',type:'router',driver:'none',status:'offline',lastError:'No check-in'});store.put('alerts',{title:'Core down',severity:'critical',status:'Open'});
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'user',text:'hi'}]),/API key/);assert.throws(()=>assistant.setConfig(store,{apiKey:'nope'}),/sk-ant-/);
  assistant.setConfig(store,{apiKey:'sk-ant-'+'a'.repeat(40),effort:'low'});assert.deepEqual(assistant.publicConfig(store),{configured:true,model:'claude-opus-5-5',effort:'low'});
  const snap=JSON.stringify(assistant.snapshot(store,radius.stateOf));assert.ok(snap.includes('CCR Core')&&snap.includes('Core down'));assert.ok(!snap.includes('0712345678')&&!snap.includes('ann@x.co')&&!snap.includes('Ann Wanjiru'),'no personal data');
  let sent;const client=reply=>({beta:{messages:{create:async body=>{sent=body;return reply;}}}});
  const r=await assistant.ask(store,radius.stateOf,[{role:'user',text:'Which router is down?'}],{client:client({stop_reason:'end_turn',model:'claude-opus-5-5',content:[{type:'text',text:'CCR Core is offline.'}],usage:{input_tokens:10,output_tokens:5}})});
  assert.equal(r.text,'CCR Core is offline.');assert.equal(sent.model,'claude-opus-5-5');assert.equal(sent.output_config.effort,'low');assert.equal(sent.fallbacks,'default');assert.deepEqual(sent.betas,['server-side-fallback-2026-07-01']);assert.equal(sent.messages.at(-1).content,'Which router is down?');assert.match(sent.messages[0].content,/^Network snapshot/);
  const refused=await assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{client:client({stop_reason:'refusal',model:'claude-opus-5-5',content:[]})});assert.equal(refused.refused,true);
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'assistant',text:'x'}]),/Ask a question/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
