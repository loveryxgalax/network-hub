'use strict';
// The Router jobs page says when a router's WiFi pages (login, status, Disconnect) are older than the current ones.
// Nothing is queued automatically: staff press "Update WiFi pages".
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),jobs=require('../lib/jobs.cjs');
test('WiFi pages: never / current / outdated, recorded when a page push succeeds, never queued by itself',()=>{
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'pg-'))),now=Date.now();let version='v1';
 jobs.setPages('https://my.example.test',()=>version);
 const lab=st.put('devices',{name:'LAB-HEX',type:'router'}),prod=st.put('devices',{name:'PROD',type:'router'});jobs.enroll(st,lab.id);jobs.enroll(st,prod.id);
 assert.equal(jobs.pagesState(st,lab.id),'never');assert.equal(jobs.pagesState(st,prod.id),'never');
 // A page push on LAB-HEX succeeds: current.
 const j=jobs.create(st,{routerId:lab.id,type:'push-design-auto',params:{origin:'https://my.example.test',host:'my.example.test'}},now);
 const n=jobs.next(st,lab.id,now+1000).id;assert.equal(n,j.id);jobs.result(st,lab.id,j.id,{ok:true,output:'netops pages in 1 hotspot profile(s)'},now+2000);
 assert.equal(jobs.pagesState(st,lab.id),'current');
 // The pages change (new Disconnect page, new status design): outdated, and nothing was queued on any router.
 version='v2';const before=st.list('routerJobs').length;
 assert.equal(jobs.pagesState(st,lab.id),'outdated');assert.equal(jobs.pagesState(st,prod.id),'never','a router that never had netops pages is not offered an update');
 assert.equal(st.list('routerJobs').length,before);
 assert.deepEqual(jobs.overview(st,now+3000).routers.map(r=>[r.name,r.pages]).sort(),[['LAB-HEX','outdated'],['PROD','never']]);
});
