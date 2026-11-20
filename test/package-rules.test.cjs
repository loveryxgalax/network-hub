'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),packages=require('../lib/packages.cjs'),portal=require('../lib/portal.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pr-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const base={name:'Net plus',service:'hotspot',downloadMbps:10,uploadMbps:5,price:10,durationValue:30,durationUnit:'days'};
test('policy: data limit, purchase limit, hour slots, trial options',()=>{
 const p=radius.plan({...base,dataLimit:{downGB:'5',upGB:''},buyLimit:{enabled:'on',count:'2',every:'7',unit:'days',mode:'fixed',showLeft:'on'},window:{hours:'on',mode:'slots',slots:[22,23,0]},trial:{enabled:'on',minutes:'10',allowOld:false,reset:'fixed',every:'1',unit:'days'}});
 assert.deepEqual(p.dataLimit,{downGB:5,upGB:0});assert.deepEqual(p.buyLimit,{enabled:true,count:2,unit:'days',every:7,mode:'fixed',showLeft:true});
 assert.deepEqual(p.window.slots,[0,22,23]);assert.equal(p.trial.allowOld,false);assert.equal(p.trial.reset,'fixed');assert.equal(p.trial.everyDays,1);
 assert.throws(()=>radius.plan({...base,window:{hours:'on',mode:'slots',slots:[]}}),/at least one hour/);
 const at=h=>Date.UTC(2026,10,18,h-3,30);assert.equal(packages.buyable(p,at(23)).ok,true);assert.equal(packages.buyable(p,at(12)).ok,false);assert.match(packages.buyable(p,at(12)).reason,/00:00–01:00, 22:00–24:00/);
 assert.ok(packages.restrictions(p).includes('Data limit'));
 const old=radius.plan({...base,trial:{enabled:'on',minutes:'10',everyDays:'30'}});assert.equal(old.trial.every,30);assert.equal(old.trial.allowOld,true);assert.equal(old.trial.reset,'rolling');
});
test('data limit: stopped when used up, router told the bytes left',()=>{const {store,done}=fx();try{
 const p=store.put('plans',radius.plan({...base,service:'pppoe',dataLimit:{downGB:1}}));
 const s=store.put('subscribers',radius.subscriber(store,{name:'Ann',username:'ann',service:'pppoe',planId:p.id,expiresAt:Date.now()+20*864e5}));radius.setPassword(store,s.id,'secret123');
 const req={'User-Name':'ann','Service-Type':'Framed-User','Framed-Protocol':'PPP','NAS-Identifier':'north'};
 let r=radius.authorize(store,req);assert.equal(r.status,200);const body=JSON.stringify(r);assert.match(body,/Mikrotik-Xmit-Limit"?:"?1073741824/);assert.doesNotMatch(body,/Recv-Limit/);
 radius.accounting(store,{'Acct-Status-Type':'Interim-Update','Acct-Session-Id':'x1','User-Name':'ann','NAS-Identifier':'north','Acct-Output-Octets':String(1073741824+10),'Acct-Input-Octets':'5'},Date.now());
 r=radius.authorize(store,req);assert.equal(r.status,401);assert.match(JSON.stringify(r),/Data limit reached/);
}finally{done();}});
test('purchase limit and trial rules on the WiFi page',async()=>{const {store,done}=fx();try{
 const p=store.put('plans',radius.plan({...base,buyLimit:{enabled:'on',count:'1',every:'24',unit:'hours',mode:'rolling',showLeft:'on'},trial:{enabled:'on',minutes:'5',allowOld:false,every:'1',unit:'days'}}));
 store.secret('mpesa:config',{env:'sandbox',type:'paybill',shortcode:'600000',consumerKey:'k',consumerSecret:'s',passkey:'p',callbackSecret:'c'.repeat(32),c2bSecret:'d'.repeat(32)});assert.equal(portal.info(store).plans.find(x=>x.id===p.id).buyLimit,'Once every 24 hours');
 store.put('portalPayments',{kind:'hotspot',planId:p.id,phone:'254712345678',mac:'AA:BB:CC:00:11:22',status:'paid',paidAt:Date.now()-3600e3,amount:10});
 await assert.rejects(portal.start(store,{planId:p.id,phone:'0712345678',mac:'aa:bb:cc:00:99:99'},'https://n.test',async()=>{throw new Error('no network');}),/used up Net plus for now\. You can buy it again/);
 await assert.rejects(portal.start(store,{planId:p.id,phone:'0700000001',mac:'AA:BB:CC:00:11:22'},'https://n.test',async()=>{throw new Error('no network');}),/used up/,'same device, other phone');
 assert.throws(()=>portal.trial(store,{planId:p.id,mac:'aa:bb:cc:00:11:22'}),/new customers/,'older customer kept off the trial');
 const t=portal.trial(store,{planId:p.id,mac:'AA:BB:CC:00:77:77'});assert.ok(t.username);assert.throws(()=>portal.trial(store,{planId:p.id,mac:'AA:BB:CC:00:77:77'}),/already had a free trial/);
}finally{done();}});
