'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),access=require('../lib/access.cjs'),purge=require('../lib/purge.cjs');
test('role permissions: owner edits a role, everyone with it follows, personal grants still win, reset restores',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rl-')),store=new Store(dir);try{
  const sup={id:'u1',role:'support'};assert.equal(access.can(store,sup,'messages.send'),true);assert.equal(access.can(store,sup,'packages.edit'),false);
  access.setRoleCaps(store,'support',['packages.edit']);assert.equal(access.can(store,sup,'packages.edit'),true);assert.equal(access.can(store,sup,'messages.send'),false);
  access.set(store,'u1',{grant:['messages.send'],deny:['packages.edit']});assert.equal(access.can(store,sup,'messages.send'),true);assert.equal(access.can(store,sup,'packages.edit'),false);
  access.resetRoleCaps(store,'support');access.set(store,'u1',{});assert.equal(access.can(store,sup,'messages.send'),true);
  assert.throws(()=>access.setRoleCaps(store,'admin',[]),/cannot be changed/);assert.throws(()=>access.setRoleCaps(store,'manager',['nope']),/Unknown/);
  assert.equal(access.can(store,{id:'a',role:'admin'},'payouts.approve'),true);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('forgetting a router removes its jobs and unassigns customers (what Delete on a router now does)',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fg-')),store=new Store(dir);try{
  const r=store.put('devices',{name:'TEST-1',type:'router',driver:'none'});store.put('routerJobs',{routerId:r.id,type:'backup-now'});const c=store.put('subscribers',{name:'test1',username:'test1',service:'hotspot',routerId:r.id});
  assert.throws(()=>purge.run(store,r.id,{confirm:'wrong'},null),/Type the router name/);
  purge.run(store,r.id,{confirm:'TEST-1'},null);assert.equal(store.get('devices',r.id),null);assert.equal(store.list('routerJobs').length,0);assert.equal(store.get('subscribers',c.id).routerId,'');
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
