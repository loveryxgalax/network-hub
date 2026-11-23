'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),tk=require('../lib/tickets.cjs');
test('customer chat: start, team reply shows, internal notes never show, customer writes again, closed chat reopens, wrong token refused',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chat-')),store=new Store(dir);try{
  const {token,ticket}=tk.chatStart(store,{who:'Lab User',phone:'254700000001',text:'Nataka kulipa na mpesa',customer:'Lab User',conn:'IP: 10.5.0.9 · MAC: 82:8A:45:92:8C:97'},1000);
  assert.ok(token.length>=30);assert.equal(store.get('tickets',ticket.id).chatHash.length,64);assert.ok(!JSON.stringify(store.get('tickets',ticket.id)).includes(token),'token stored only as a hash');
  tk.post(store,ticket.id,{text:'Which issue are you facing?'},{id:'u1',name:'Agent'},2000);tk.post(store,ticket.id,{text:'customer seems confused',internal:true},{id:'u1',name:'Agent'},2500);
  let v=tk.chatView(store,token);assert.deepEqual(v.messages.map(m=>[m.from,m.text]),[['customer','Nataka kulipa na mpesa'],['team','Which issue are you facing?']]);
  assert.ok(!JSON.stringify(v).includes('confused'),'internal note hidden');assert.ok(!JSON.stringify(v).includes('Agent'),'staff names not shown to customers');
  tk.update(store,ticket.id,{status:'Closed'},{id:'u1',name:'Agent'},[],3000);tk.chatSend(store,token,'Still not working',4000);
  assert.equal(store.get('tickets',ticket.id).status,'Open');v=tk.chatView(store,token);assert.equal(v.messages.at(-1).text,'Still not working');
  assert.equal(tk.detail(store,ticket.id).replies.filter(m=>m.from==='customer').length,2,'admin sees both customer messages');
  assert.throws(()=>tk.chatView(store,'x'.repeat(32)),/ended/);assert.throws(()=>tk.chatSend(store,token,'   '),/Write a message/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
