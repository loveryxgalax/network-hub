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
test('router jobs can wait for a start time',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rj-')),store=new Store(dir),jobs=require('../lib/jobs.cjs');try{
  const r=store.put('devices',{name:'TEST-1',type:'router',driver:'none'});store.secret('jobs:'+r.id,{token:'x'});const now=Date.now();
  const j=jobs.create(store,{routerId:r.id,type:'backup-now',runAt:now+36e5},now);assert.equal(jobs.next(store,r.id,now),null,'not before its time');
  assert.equal(jobs.next(store,r.id,now+36e5+1)?.id,j.id);
  assert.throws(()=>jobs.create(store,{routerId:r.id,type:'backup-now',runAt:now-36e5},now),/past/);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('scheduled maintenance: notice on the WiFi page, alert escalation paused for those routers only',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mt-')),store=new Store(dir),mt=require('../lib/maintenance.cjs'),esc=require('../lib/escalation.cjs');try{
  const a=store.put('devices',{name:'TEST-1',type:'router',driver:'none'}),b=store.put('devices',{name:'Other',type:'router',driver:'none'});const now=Date.now();
  mt.save(store,{title:'Fibre work',repeat:'once',from:now-6e4,to:now+36e5,routerIds:[a.id]});
  assert.equal(mt.notice(store,a.id,now).title,'Fibre work');assert.equal(mt.notice(store,b.id,now),null);assert.equal(mt.quiet(store,a.id,now),true);assert.equal(mt.quiet(store,b.id,now),false);
  assert.throws(()=>mt.save(store,{title:'x',repeat:'once',from:now,to:now-1}),/after the start/);
  const d=new Date(now),w=mt.save(store,{title:'Weekly',repeat:'weekly',day:d.getDay(),start:'00:00',end:'23:59'});assert.equal(mt.activeOne(w,now),d.getHours()*60+d.getMinutes()<1439);
  esc.save(store,{enabled:true,levels:[{afterMinutes:1,minSeverity:'info',sms:'0712345678'}]});
  store.put('alerts',{deviceId:a.id,title:'TEST-1 down',severity:'critical',status:'Open',created:now-36e5});
  const r=await esc.run(store,now,async()=>({ok:true,status:200,text:async()=>'{}'}));assert.equal(store.list('alerts')[0].escalations,undefined,'paused during maintenance');void r;
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
