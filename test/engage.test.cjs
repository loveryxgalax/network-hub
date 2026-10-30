'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),engage=require('../lib/engage.cjs'),portal=require('../lib/portal.cjs'),landing=require('../lib/landing.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eng-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
test('adverts: https only, views give a ticket, free minutes only after the full viewing time and once a day per device',()=>{
 const {store,done}=fx();try{const plan=store.put('plans',radius.plan({name:'Ad speed',service:'hotspot',downloadMbps:2,uploadMbps:1,price:10,durationValue:1,durationUnit:'hours'}));
  assert.throws(()=>engage.saveAd(store,{title:'X',imageUrl:'http://x.test/a.png'}),/https/);
  const a=engage.saveAd(store,{title:'Buy bread',link:'https://bakery.example/',active:true,seconds:10,earn:{enabled:true,minutes:15,planId:plan.id}});
  engage.saveAd(store,{title:'Old',active:true,until:Date.now()-1000,from:Date.now()-5000});
  const pv=engage.forPortal(store);assert.equal(pv.ads.length,1);assert.equal(pv.ads[0].earn.minutes,15);assert.equal(pv.ads[0].hasLink,true);assert.equal(pv.ads[0].link,undefined);
  const t0=Date.now(),{ticket}=engage.view(store,a.id,t0);assert.equal(store.get('ads',a.id).views,1);
  assert.throws(()=>engage.claimAd(store,portal.grantFree,a.id,{ticket,mac:'AA:BB:CC:DD:EE:01'},t0+3000),/longer/);
  assert.throws(()=>engage.claimAd(store,portal.grantFree,a.id,{ticket:ticket.replace(/.$/,'0'),mac:'AA:BB:CC:DD:EE:01'},t0+11000),/Watch the advert first/);
  const g=engage.claimAd(store,portal.grantFree,a.id,{ticket,mac:'AA:BB:CC:DD:EE:01'},t0+11000);assert.ok(g.username&&g.password);
  const s=store.list('subscribers').find(x=>x.username===g.username);assert.equal(s.freeKind,'ad');assert.ok(Math.abs(s.expiresAt-(t0+11000+15*60000))<5);
  assert.throws(()=>engage.claimAd(store,portal.grantFree,a.id,{ticket,mac:'AA:BB:CC:DD:EE:01'},t0+12000),/already/);
  assert.equal(engage.click(store,a.id),'https://bakery.example/');assert.equal(store.get('ads',a.id).clicks,1);
 }finally{done();}
});
test('quiz: answer hidden from the page, one attempt per device per day, right answer grants minutes',()=>{
 const {store,done}=fx();try{const plan=store.put('plans',radius.plan({name:'Quiz speed',service:'hotspot',downloadMbps:2,uploadMbps:1,price:10,durationValue:1,durationUnit:'hours'}));
  assert.throws(()=>engage.saveQuiz(store,{question:'Q',options:'only one',answer:0,earn:{planId:plan.id,minutes:5}}),/2 to 6/);
  const q=engage.saveQuiz(store,{question:'Capital of Kenya?',options:'Mombasa\nNairobi\nKisumu',answer:1,active:true,earn:{planId:plan.id,minutes:5}});
  const pv=engage.forPortal(store).quiz;assert.equal(pv.id,q.id);assert.equal(pv.answer,undefined);
  assert.deepEqual(engage.answer(store,portal.grantFree,q.id,{choice:0,mac:'AA:BB:CC:DD:EE:02'}),{correct:false});
  assert.throws(()=>engage.answer(store,portal.grantFree,q.id,{choice:1,mac:'AA:BB:CC:DD:EE:02'}),/tomorrow/);
  const r=engage.answer(store,portal.grantFree,q.id,{choice:1,mac:'AA:BB:CC:DD:EE:03'});assert.equal(r.correct,true);assert.ok(r.username);
  assert.equal(store.get('quizzes',q.id).attempts,2);assert.equal(store.get('quizzes',q.id).correct,1);
 }finally{done();}
});
test('landing: loading screen, terms and French are saved and validated',()=>{
 const {store,done}=fx();try{const base={...landing.get(store)};
  const saved=landing.save(store,{...base,defaultLang:'fr',loadingStyle:'progress',loadingText:'Kade',terms:'1. Be fair.\n2. No abuse.'});assert.equal(saved.defaultLang,'fr');assert.equal(saved.loadingStyle,'progress');assert.match(saved.terms,/No abuse/);
  assert.throws(()=>landing.save(store,{...base,terms:'<script>x</script>'}),/plain text/);
  assert.equal(landing.save(store,{...base,loadingStyle:'weird'}).loadingStyle,'spinner');
 }finally{done();}
});
test('picture questions: images on answers, and opinion questions where any pick connects and picks are counted',()=>{
 const {store,done}=fx();try{const plan=store.put('plans',radius.plan({name:'Quiz speed',service:'hotspot',downloadMbps:2,uploadMbps:1,price:10,durationValue:1,durationUnit:'hours'}));
  assert.throws(()=>engage.saveQuiz(store,{question:'Q',options:'Coke | http://x.test/c.jpg\nFanta',answer:'any',earn:{planId:plan.id,minutes:5}}),/https/);
  const q=engage.saveQuiz(store,{question:'Which drink do you like?',options:'Coke | https://img.example/coke.jpg\nFanta | https://img.example/fanta.jpg\nSprite',answer:'any',active:true,earn:{planId:plan.id,minutes:5}});
  assert.equal(q.answer,-1);assert.deepEqual(q.options,['Coke','Fanta','Sprite']);assert.deepEqual(q.images,['https://img.example/coke.jpg','https://img.example/fanta.jpg','']);
  assert.deepEqual(engage.forPortal(store).quiz.images,q.images);
  const r=engage.answer(store,portal.grantFree,q.id,{choice:1,mac:'AA:BB:CC:DD:EE:31'});assert.equal(r.correct,true,'any pick connects');
  assert.throws(()=>engage.answer(store,portal.grantFree,q.id,{choice:9,mac:'AA:BB:CC:DD:EE:32'}),/Choose an answer/);
  assert.deepEqual(store.get('quizzes',q.id).picks,[0,1,0]);
 }finally{done();}
});
test('quiz results for a period: attempts, passed and picks per answer',()=>{
 const {store,done}=fx();try{const plan=store.put('plans',radius.plan({name:'Q',service:'hotspot',downloadMbps:2,uploadMbps:1,price:10,durationValue:1,durationUnit:'hours'}));
  const q=engage.saveQuiz(store,{question:'Capital?',options:'Mombasa\nNairobi',answer:1,active:true,earn:{planId:plan.id,minutes:5}});
  engage.answer(store,portal.grantFree,q.id,{choice:0,mac:'AA:BB:CC:DD:EE:41'});engage.answer(store,portal.grantFree,q.id,{choice:1,mac:'AA:BB:CC:DD:EE:42'});engage.answer(store,portal.grantFree,q.id,{choice:1,mac:'AA:BB:CC:DD:EE:43'});
  const r=engage.results(store,7);assert.deepEqual([r.attempts,r.passed,r.passRate],[3,2,67]);assert.deepEqual(r.quizzes[0].picks,[1,2]);
  assert.equal(engage.results(store,7,Date.now()+8*864e5).attempts,0,'older answers drop out of the period');
 }finally{done();}
});
