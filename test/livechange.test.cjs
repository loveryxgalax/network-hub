'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs');
function mk(){const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'lc-'))),r=st.put('devices',{name:'HAP-NEW',type:'router',driver:'none'});st.secret('jobs:'+r.id,{h:1});
 const plan=st.put('plans',radius.plan({name:'P',service:'pppoe',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'C',username:'c1',service:'pppoe',planId:plan.id,expiresAt:Date.now()-1000}));
 st.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions','s1',?,?,?)").run(JSON.stringify({username:'c1',nasName:'HAP-NEW',service:'pppoe',updatedAt:Date.now()}),Date.now(),Date.now());return {st,r,s,plan};}
test('live apply is off by default and queues one reconnect when on (expired customer renewed, online, runner installed)',()=>{
 let {st,s}=mk();radius.renew(st,s.id,1);assert.equal(st.list('routerJobs').length,0,'off by default');
 ({st,s}=mk());radius.updateSettings(st,{liveApply:true});radius.renew(st,s.id,1);
 const jobs=st.list('routerJobs');assert.equal(jobs.length,1);assert.equal(jobs[0].type,'disconnect');assert.equal(jobs[0].params.username,'c1');
 radius.renew(st,s.id,1);assert.equal(st.list('routerJobs').length,1,'an active customer is not kicked on an early renewal');
});
test('live apply skips customers who are offline or on a router without the runner',()=>{
 let {st,s}=mk();radius.updateSettings(st,{liveApply:true});st.db.exec("DELETE FROM records WHERE kind='radiusSessions'");radius.renew(st,s.id,1);assert.equal(st.list('routerJobs').length,0);
 ({st,s}=mk());radius.updateSettings(st,{liveApply:true});st.db.exec("DELETE FROM secrets");radius.renew(st,s.id,1);assert.equal(st.list('routerJobs').length,0);
});
