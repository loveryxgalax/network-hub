'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),assistant=require('../lib/assistant.cjs');
test('assistant: key validation, snapshot without personal data, request shape, refusal handling',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'as-')),store=new Store(dir);
 try{const p=store.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1000,durationValue:30,durationUnit:'days'}));store.put('subscribers',radius.subscriber(store,{name:'Ann Wanjiru',username:'ann',service:'pppoe',planId:p.id,phone:'0712345678',email:'ann@x.co'}));
  store.put('devices',{name:'CCR Core',type:'router',driver:'none',status:'offline',lastError:'No check-in'});store.put('alerts',{title:'Core down',severity:'critical',status:'Open'});
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'user',text:'hi'}]),/API key/);assert.throws(()=>assistant.setConfig(store,{apiKey:'nope'}),/sk-ant-/);
  assistant.setConfig(store,{apiKey:'sk-ant-'+'a'.repeat(40),effort:'low'});assert.deepEqual(assistant.publicConfig(store),{configured:true,provider:'anthropic',model:'claude-opus-5-5',effort:'low'});
  const snap=JSON.stringify(assistant.snapshot(store,radius.stateOf));assert.ok(snap.includes('CCR Core')&&snap.includes('Core down'));assert.ok(!snap.includes('0712345678')&&!snap.includes('ann@x.co')&&!snap.includes('Ann Wanjiru'),'no personal data');
  let sent;const client=reply=>({beta:{messages:{create:async body=>{sent=body;return reply;}}}});
  const r=await assistant.ask(store,radius.stateOf,[{role:'user',text:'Which router is down?'}],{client:client({stop_reason:'end_turn',model:'claude-opus-5-5',content:[{type:'text',text:'CCR Core is offline.'}],usage:{input_tokens:10,output_tokens:5}})});
  assert.equal(r.text,'CCR Core is offline.');assert.equal(sent.model,'claude-opus-5-5');assert.equal(sent.output_config.effort,'low');assert.equal(sent.fallbacks,'default');assert.deepEqual(sent.betas,['server-side-fallback-2026-07-01']);assert.equal(sent.messages.at(-1).content,'Which router is down?');assert.match(sent.messages[0].content,/^Network snapshot/);
  const refused=await assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{client:client({stop_reason:'refusal',model:'claude-opus-5-5',content:[]})});assert.equal(refused.refused,true);
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'assistant',text:'x'}]),/Ask a question/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('assistant: DeepSeek and OpenRouter use the OpenAI-style API with the right key, model and errors',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'as-')),store=new Store(dir);
 try{store.put('devices',{name:'HEX',type:'router',driver:'none',status:'online'});
  assert.throws(()=>assistant.setConfig(store,{provider:'deepseek',apiKey:'sk-ant-'+'a'.repeat(40)}),/DeepSeek API key/);
  assistant.setConfig(store,{provider:'deepseek',apiKey:'sk-'+'b'.repeat(32)});assert.deepEqual(assistant.publicConfig(store),{configured:true,provider:'deepseek',model:'deepseek-chat',effort:'medium'});
  let call;const fake=(status,json)=>async(url,opts)=>{call={url,opts,body:JSON.parse(opts.body)};return {ok:status<300,status,json:async()=>json};};
  const r=await assistant.ask(store,radius.stateOf,[{role:'user',text:'Is HEX up?'}],{fetchImpl:fake(200,{model:'deepseek-chat',choices:[{message:{content:'Yes, HEX is online.'},finish_reason:'stop'}],usage:{prompt_tokens:9,completion_tokens:4}})});
  assert.equal(r.text,'Yes, HEX is online.');assert.equal(call.url,'https://api.deepseek.com/chat/completions');assert.equal(call.opts.headers.Authorization,'Bearer sk-'+'b'.repeat(32));
  assert.equal(call.body.model,'deepseek-chat');assert.equal(call.body.messages[0].role,'system');assert.match(call.body.messages[1].content,/HEX/);assert.equal(call.body.messages.at(-1).content,'Is HEX up?');
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{fetchImpl:fake(429,{})}),/rate limited/);
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{fetchImpl:fake(402,{})}),/no credit/);
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{fetchImpl:fake(200,{error:{message:'No endpoints found for this model'}})}),/No endpoints found/);
  await assert.rejects(assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{fetchImpl:async()=>{throw Object.assign(new Error('timed out'),{name:'TimeoutError'});}}),/took too long/);
  assert.equal((await assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{fetchImpl:fake(200,{choices:[{message:{content:'',reasoning:'Thinking only'}}]})})).text,'Thinking only');
  // Switching provider needs that provider's key; a blank key does not carry the DeepSeek key across.
  assert.throws(()=>assistant.setConfig(store,{provider:'openrouter',apiKey:''}),/OpenRouter API key/);
  assistant.setConfig(store,{provider:'openrouter',apiKey:'sk-or-v1-'+'c'.repeat(40)});
  await assistant.ask(store,radius.stateOf,[{role:'user',text:'x'}],{fetchImpl:fake(200,{choices:[{message:{content:'ok'}}]})});
  assert.equal(call.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(call.body.model,'deepseek/deepseek-chat-v3-0324:free');
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
