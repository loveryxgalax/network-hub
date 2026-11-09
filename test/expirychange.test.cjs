'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),jobs=require('../lib/jobs.cjs'),expiry=require('../lib/expirychange.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'expiry-')),store=new Store(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const now=Date.now(),router=store.put('devices',{name:'LAB-HEX',type:'router',tunnelIp:'10.99.0.3'});store.secret('jobs:'+router.id,{installed:true});
 const sub=store.put('subscribers',{name:'Parent',username:'parent',service:'hotspot',status:'active',expiresAt:now+864e5,shareCode:'s1234567',tvs:[{mac:'2C:FE:E2:F6:01:E2'}]});
 const child=store.put('subscribers',{name:'Child',username:'child',service:'hotspot',parentId:sub.id,expiresAt:sub.expiresAt});
 function session(username,nasName='LAB-HEX',extra={}){return store.put('radiusSessions',{username,nasName,updatedAt:now,...extra});}
 return {store,now,router,sub,child,session};}
test('shortening hotspot expiry refreshes live parent, family, sharing and TV logins in one scoped job',t=>{
 const {store,now,router,sub,session}=fixture(t);
 for(const u of ['parent','child','s1234567','2c:fe:e2:f6:01:e2','unrelated'])session(u);
 const other=store.put('devices',{name:'PRODUCTION',type:'router'});store.secret('jobs:'+other.id,{installed:true});session('unrelated','PRODUCTION');
 session('parent','PRODUCTION',{stoppedAt:now});session('child','PRODUCTION',{updatedAt:now-11*60000});
 const after=store.put('subscribers',{...sub,expiresAt:now-1000},sub),out=expiry.changed(store,after,sub,null,now);
 assert.equal(out.queued.length,1);assert.equal(store.list('routerJobs').length,1);assert.equal(store.list('routerJobs')[0].routerId,router.id);
 const job=jobs.next(store,router.id,now);for(const u of ['parent','child','s1234567','2c:fe:e2:f6:01:e2'])assert.ok(job.script.includes('user="'+u+'"'));
 assert.doesNotMatch(job.script,/unrelated|\/ppp active/);assert.equal(radius.settings(store).liveApply,false,'expiry correction does not enable global live apply');
});
test('renewal/restoration supersedes an undelivered expiry refresh and detached aliases are excluded',t=>{
 const {store,now,router,sub,session}=fixture(t);session('parent');session('2c:fe:e2:f6:01:e2');
 let after=store.put('subscribers',{...sub,expiresAt:now-1},sub);const first=expiry.changed(store,after,sub,null,now).queued[0];
 const renewed=store.put('subscribers',{...after,expiresAt:now+864e5},after);assert.equal(jobs.next(store,router.id,now),null);assert.equal(store.get('routerJobs',first).status,'cancelled');
 after=store.put('subscribers',{...renewed,expiresAt:now+3600000},renewed);expiry.changed(store,after,renewed,null,now);
 store.put('subscribers',{...after,tvs:[]},after);const n=jobs.next(store,router.id,now);assert.match(n.script,/user="parent"/);assert.doesNotMatch(n.script,/2c:fe/);
});
test('no refresh for unchanged/increased expiry, child-only expiry, PPPoE, stale sessions or missing runner',t=>{
 const {store,now,sub,child,session}=fixture(t);session('parent');
 assert.equal(expiry.changed(store,sub,sub,null,now).queued.length,0);
 assert.equal(expiry.changed(store,{...sub,expiresAt:now+2*864e5},sub,null,now).queued.length,0);
 assert.equal(expiry.changed(store,{...child,expiresAt:now-1},child,null,now).queued.length,0);
 assert.equal(expiry.changed(store,{...sub,service:'pppoe',expiresAt:now-1},sub,null,now).queued.length,0);
 store.db.exec('DELETE FROM secrets');const r=expiry.changed(store,{...sub,expiresAt:now-1},sub,null,now);assert.equal(r.queued.length,0);assert.equal(r.skipped.length,1);
});
test('HTTP expiry edit hands the runner a refresh; restoring before pickup cancels it',async t=>{
 const {createApp}=require('../server.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'expiry-http-'));
 const app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',radiusToken:'bridge-token-for-tests-0123456789',radiusPort:0});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.server.close();app.bridge?.close?.();fs.rmSync(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 const api=async(route,method='GET',input)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json(),response:r};};
 const owner=await api('setup','POST',{name:'QA',workspace:'QA',email:'expiry@example.test',password:'fixture-password-1234'});cookie=owner.response.headers.get('set-cookie').split(';')[0];csrf=owner.body.csrf;
 const router=app.store.put('devices',{name:'LAB-HEX',type:'router',driver:'none'}),{token}=jobs.enroll(app.store,router.id),now=Date.now();
 const plan=app.store.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'days',devices:2}));
 const s=app.store.put('subscribers',radius.subscriber(app.store,{name:'Test',username:'labuser',service:'hotspot',planId:plan.id,expiresAt:now+864e5}));
 app.store.put('radiusSessions',{username:'labuser',nasName:'LAB-HEX',updatedAt:now});
 const edited=await api('radius/subscribers/'+s.id,'PATCH',{expiresAt:now-1000});assert.equal(edited.status,200);assert.equal(edited.body.expiryRefresh.queued.length,1);
 const pull=async()=>{const r=await fetch(origin+'/api/router-jobs/next/'+router.id,{headers:{Authorization:'Bearer '+token}});return r.json();};
 const n=await pull();assert.match(n.script,/hotspot active remove/);assert.match(n.script,/user="labuser"/);
 await fetch(origin+'/api/router-jobs/result/'+router.id+'/'+n.id,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({ok:true,output:'refreshed 1 hotspot session(s)'})});
 const again=await api('radius/subscribers/'+s.id,'PATCH',{expiresAt:now-2000});assert.equal(again.body.expiryRefresh.queued.length,1);
 await api('radius/subscribers/'+s.id,'PATCH',{expiresAt:now+864e5});assert.deepEqual(await pull(),{});assert.equal(app.store.get('routerJobs',again.body.expiryRefresh.queued[0]).status,'cancelled');
});
