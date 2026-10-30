'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),statics=require('../lib/statics.cjs'),jobs=require('../lib/jobs.cjs'),bulk=require('../lib/bulk.cjs'),portal=require('../lib/portal.cjs'),landing=require('../lib/landing.cjs'),packages=require('../lib/packages.cjs'),di=require('../lib/devices-info.cjs'),mpesa=require('../lib/mpesa.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sv-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const rest=v=>Object.fromEntries(Object.entries(v).map(([k,x])=>[k,{type:'string',value:[x]}]));
const home={name:'Biz',service:'static',downloadMbps:20,uploadMbps:10,price:5000,durationValue:30,durationUnit:'days'};
test('static IP: per-router network, automatic addresses, no collisions, router jobs follow the account state',()=>{
 const {store,done}=fx();try{const r=store.put('devices',{name:'CCR',type:'router'}),p=store.put('plans',radius.plan(home)),now=Date.now();
  assert.throws(()=>radius.subscriber(store,{name:'A',username:'a',service:'static',planId:p.id,routerId:r.id}),/static network/);
  assert.throws(()=>statics.saveSettings(store,r.id,{network:'10.50.0.0/24',gateway:'10.60.0.1',iface:'bridge'}),/gateway must be inside/);
  statics.saveSettings(store,r.id,{network:'10.50.0.0/29',gateway:'10.50.0.1',iface:'bridge-lan'});
  const a=store.put('subscribers',radius.subscriber(store,{name:'A',username:'a',service:'static',planId:p.id,routerId:r.id,expiresAt:now+864e5,mac:'aa:bb:cc:dd:ee:01'}));assert.equal(a.staticIp,'10.50.0.2');
  const b=store.put('subscribers',radius.subscriber(store,{name:'B',username:'b',service:'static',planId:p.id,routerId:r.id,expiresAt:now+864e5}));assert.equal(b.staticIp,'10.50.0.3');
  assert.throws(()=>radius.subscriber(store,{name:'C',username:'c',service:'static',planId:p.id,routerId:r.id,staticIp:'10.50.0.2'}),/already assigned/);
  assert.equal(radius.authorize(store,rest({'User-Name':'a','Service-Type':'Framed-User'})).status,401,'static customers do not use RADIUS');
  assert.deepEqual(statics.sync(store,jobs,radius.stateOf),[],'no runner: nothing queued');assert.equal(store.get('subscribers',a.id).provisioning.status,'pending');
  jobs.enroll(store,r.id);assert.equal(statics.sync(store,jobs,radius.stateOf).length,2);assert.equal(statics.sync(store,jobs,radius.stateOf).length,0,'unchanged: nothing new');
  const j=store.list('routerJobs').find(x=>x.subscriberId===a.id);assert.equal(j.params.enabled,'yes');assert.equal(j.params.mac,'AA:BB:CC:DD:EE:01');
  const s=store.get('subscribers',a.id);store.put('subscribers',{...s,expiresAt:now-1000},s);statics.sync(store,jobs,radius.stateOf);
  assert.equal(store.list('routerJobs').filter(x=>x.subscriberId===a.id).sort((x,y)=>y.createdAt-x.createdAt)[0].params.enabled,'no','expired: blocked on the router');
 }finally{done();}
});
test('family accounts share the parent package, expiry and device limit; roaming is logged',()=>{
 const {store,done}=fx();try{const now=Date.now(),p=store.put('plans',radius.plan({...home,service:'hotspot',devices:2}));
  const par=store.put('subscribers',radius.subscriber(store,{name:'Mum',username:'mum',service:'hotspot',planId:p.id,expiresAt:now+864e5}));radius.setPassword(store,par.id,'111111');
  const kid=store.put('subscribers',{...radius.subscriber(store,{name:'Kid',username:'mum-01',service:'hotspot',planId:p.id,expiresAt:now-1}),parentId:par.id});radius.setPassword(store,kid.id,'222222');
  let r=radius.authorize(store,rest({'User-Name':'mum-01','Service-Type':'Login-User'}),now);assert.equal(r.status,200,'uses the parent expiry, not its own');assert.equal(r.attributes['control:Cleartext-Password'],'222222');
  const acct=(u,id,nas,t)=>radius.accounting(store,rest({'Acct-Status-Type':'Start','Acct-Session-Id':id,'User-Name':u,'NAS-Identifier':nas,'Calling-Station-Id':'AA:BB:CC:00:00:0'+id.slice(-1)}),t);
  acct('mum','s1','CCR',now);acct('mum-01','s2','CCR',now);
  assert.equal(radius.authorize(store,rest({'User-Name':'mum','Service-Type':'Login-User'}),now).reason,'Device limit reached','2 devices across the family');
  acct('mum','s3','HEX',now+1000);assert.equal(store.setting('roamingLog').items[0].from,'CCR');assert.equal(store.setting('roamingLog').items[0].to,'HEX');
  const pp=store.get('subscribers',par.id);store.put('subscribers',{...pp,status:'suspended'},pp);assert.equal(radius.authorize(store,rest({'User-Name':'mum-01','Service-Type':'Login-User'}),now).status,401,'parent suspended: family off');
 }finally{done();}
});
test('PIN unlocks account details on the portal; device and OS are recorded from the visit',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan({...home,service:'pppoe'}));const s=store.put('subscribers',radius.subscriber(store,{name:'Ann',username:'ann',service:'pppoe',planId:p.id,expiresAt:Date.now()+864e5}));
  store.secret('pin:'+s.id,{pin:'4321'});assert.equal(landing.account(store,'ann').verified,undefined);assert.equal(landing.account(store,'ann',Date.now(),'0000').pinError,'Wrong PIN');assert.equal(landing.account(store,'ann',Date.now(),'4321').verified,true);
  const ua='Mozilla/5.0 (Linux; Android 13; SM-A135F Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
  const v=di.record(store,'aa-bb-cc-dd-ee-ff',ua);assert.deepEqual([v.os,v.browser,v.device],['Android','Chrome','SM-A135F']);assert.equal(di.lookup(store,'AA:BB:CC:DD:EE:FF').os,'Android');
  assert.equal(di.stats(store,0,Date.now()+864e5).os[0].name,'Android');
 }finally{done();}
});
test('bulk actions: preview version and count must match; delete needs typed confirmation',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan({...home,service:'pppoe'})),p2=store.put('plans',radius.plan({...home,service:'pppoe',name:'Biz 2'}));
  for(let i=0;i<3;i++)store.put('subscribers',radius.subscriber(store,{name:'U'+i,username:'u'+i,service:'pppoe',planId:p.id,expiresAt:Date.now()-1,paidEver:true}));
  const f={state:'expired'},pv=bulk.preview(store,f,radius.stateOf);assert.equal(pv.count,3);
  assert.throws(()=>bulk.apply(store,f,'add-days',{days:7},{count:2,version:pv.version},radius.stateOf,{}),/changed since the preview/);
  assert.equal(bulk.apply(store,f,'add-days',{days:7},{count:3,version:pv.version},radius.stateOf,{}).done,3);assert.equal(bulk.preview(store,f,radius.stateOf).count,0);
  const all=bulk.preview(store,{},radius.stateOf);assert.throws(()=>bulk.apply(store,{},'delete',{},{count:3,version:all.version,confirm:'yes'},radius.stateOf,{}),/DELETE 3/);
  assert.equal(bulk.apply(store,{},'change-plan',{planId:p2.id},{count:3,version:all.version},radius.stateOf,{}).done,3);
 }finally{done();}
});
test('free trial once per device; quantity pricing with bulk discount renews several periods',async()=>{
 const {store,done}=fx();try{mpesa._reset();
  const p=store.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days',trial:{enabled:true,minutes:15,everyDays:7},custom:{enabled:true,maxQty:7,discounts:[{minQty:3,percent:10}]}}));
  const t=portal.trial(store,{planId:p.id,mac:'AA:BB:CC:00:11:22'});assert.match(t.username,/^t/);assert.ok(t.expiresAt<=Date.now()+15*60000);
  assert.throws(()=>portal.trial(store,{planId:p.id,mac:'aa:bb:cc:00:11:22'}),/already had a free trial/);
  assert.deepEqual(packages.quantityPrice(p,3),{qty:3,amount:135,percent:10});assert.throws(()=>packages.quantityPrice(p,8),/1 to 7/);
  mpesa.setConfig(store,{env:'production',type:'paybill',shortcode:'174379',consumerKey:'ck',consumerSecret:'cs',passkey:'pk'});
  const pushes=[];const fetchImpl=async(url,o={})=>{const j=v=>({ok:true,status:200,text:async()=>JSON.stringify(v)});if(String(url).includes('oauth'))return j({access_token:'t',expires_in:3599});if(String(url).includes('stkpush/v1/processrequest')){const id='ws_'+pushes.length;pushes.push(id);return j({ResponseCode:'0',CheckoutRequestID:id,MerchantRequestID:'m'});}if(String(url).includes('stkpushquery'))return j({ResultCode:'0',ResultDesc:'ok'});return j({});};
  const st=await portal.start(store,{kind:'hotspot',planId:p.id,phone:'0712345678',qty:3},'https://x.example',fetchImpl);assert.equal(st.amount,135);
  const secret=mpesa.config(store).callbackSecret;await portal.callback(store,secret,{Body:{stkCallback:{MerchantRequestID:'m',CheckoutRequestID:pushes[0],ResultCode:0,ResultDesc:'ok',CallbackMetadata:{Item:[{Name:'Amount',Value:135},{Name:'MpesaReceiptNumber',Value:'QTY0000001'},{Name:'PhoneNumber',Value:254712345678}]}}}},fetchImpl);
  const sub=store.list('subscribers').find(s=>s.phone==='+254712345678');assert.ok(sub.expiresAt>Date.now()+2.9*864e5,'three days for the discounted price');
 }finally{done();}
});
