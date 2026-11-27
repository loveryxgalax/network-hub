'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),P=require('../lib/popups.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
test('portal popups: master switch, per-popup switch, dates, routers, account page, counts, picture',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pu-')),st=new Store(dir);try{const now=Date.now();
  const r1=st.put('devices',{name:'hEX S',type:'router'}),r2=st.put('devices',{name:'LAB-HEX',type:'router'});
  const a=P.save(st,{title:'Join our WhatsApp Channel',text:'Offers first',points:'🎁 Bonus\n⚡ New packages\n',buttonText:'JOIN',buttonLink:'https://whatsapp.com/channel/x',image:PNG});
  assert.deepEqual(a.points,['🎁 Bonus','⚡ New packages']);
  const b=P.save(st,{title:'Only LAB',routers:[r2.id],onAccount:true});
  assert.deepEqual(P.forPortal(st,{routerId:r1.id,now}).map(x=>x.title),['Join our WhatsApp Channel'],'b is for LAB-HEX only');
  assert.equal(P.forPortal(st,{routerId:r2.id,now}).length,2);assert.deepEqual(P.forPortal(st,{where:'account',routerId:r2.id,now}).map(x=>x.title),['Only LAB']);
  assert.ok(!JSON.stringify(P.forPortal(st,{routerId:r1.id})).includes('base64'),'the picture is not sent inline');assert.equal(P.forPortal(st,{routerId:r1.id})[0].hasImage,true);
  assert.equal(P.imageOf(st,a.id).type,'image/png');
  P.setEnabled(st,false);assert.equal(P.forPortal(st,{routerId:r1.id}).length,0,'master switch off');P.setEnabled(st,true);
  P.save(st,{...st.get(P.KIND,a.id),active:false},st.get(P.KIND,a.id));assert.equal(P.forPortal(st,{routerId:r1.id}).length,0,'popup switched off');
  P.save(st,{...st.get(P.KIND,a.id),active:true,endsAt:'2020-01-01'},st.get(P.KIND,a.id));assert.equal(P.forPortal(st,{routerId:r1.id}).length,0,'ended');
  P.count(st,b.id,'view');P.count(st,b.id,'view');P.count(st,b.id,'tap');P.count(st,b.id,'hack');const c=P.list(st).find(x=>x.id===b.id);assert.equal(c.views,2);assert.equal(c.taps,1);
  assert.throws(()=>P.save(st,{title:'x',buttonText:'Go',buttonLink:'javascript:alert(1)'}),/https/);assert.throws(()=>P.save(st,{title:'<script>'}),/cannot contain/);
  assert.throws(()=>P.save(st,{title:'x',image:'data:text/html;base64,AAAA'}),/JPG, PNG/);assert.throws(()=>P.save(st,{title:'x',buttonText:'Go'}),/link/);
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}});

test('router report: resource details and public IP are kept; bad IP refused',()=>{const H=require('../lib/health.cjs');
 const h=H.normalize({res:{cpuFreq:'2000',build:'2026-09-29 14:21:27',factory:'7.1',platform:'MikroTik',board:'CCR2004-16G-2S+',wsr:'389227',wst:'1343167'},pubip:'129.222.147.124',hdd:{free:'96714752',total:'134217728',bad:'0'}});
 assert.equal(h.res.cpuFreq,2000);assert.equal(h.res.wst,1343167);assert.equal(h.publicIp,'129.222.147.124');assert.equal(h.hdd.bad,0);
 assert.equal(H.normalize({pubip:'<script>'}).publicIp,'');assert.doesNotMatch(H.SCRIPT,/:resolve [^\n]*server=/,'no :resolve server= (RouterOS 6 cannot parse it, which breaks the whole report script)');assert.match(H.SCRIPT,/write-sect-total/);});

test('account numbers: pattern, padding, ISP code, skips numbers in use (deleted too), suggest, off by default',()=>{const AN=require('../lib/acctnum.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'an-')),st=new Store(dir);try{
  assert.equal(AN.take(st),'','off by default');assert.throws(()=>AN.save(st,{enabled:true}),/pattern/);assert.throws(()=>AN.save(st,{pattern:'ACC'}),/\{n\}/);assert.throws(()=>AN.save(st,{pattern:'A<{n}'}),/letters/);
  st.put('subscribers',{username:'acc-00002',service:'pppoe'});st.put('deletedSubscribers',{username:'acc-00003'});st.put('subscribers',{username:'acc-00041',service:'static'});
  AN.save(st,{pattern:'ACC-{n:5}',enabled:true});assert.equal(AN.view(st).next,'ACC-00001');assert.equal(AN.take(st),'ACC-00001');assert.equal(AN.take(st),'ACC-00004','2 in use, 3 deleted');
  assert.equal(AN.suggest(st,'ACC-{n:5}').last,41);AN.save(st,{ispCode:true,last:99});assert.equal(AN.take(st),'KNE-ACC-00100');
 }finally{st.close();fs.rmSync(dir,{recursive:true,force:true});}});
