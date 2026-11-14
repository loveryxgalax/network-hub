'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server.cjs');
test('HTTP: static IP settings and conversion, family accounts, PINs, bulk, trial and visit capture',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-svc-')),app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test',radiusToken:'bridge-token-for-tests-0123456789',radiusPort:0});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));await new Promise(r=>app.bridge.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';
 const api=async(route,method='GET',input,headers={})=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...headers},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json()};};
 const pub=async(route,method='GET',input,headers={})=>{const r=await fetch(origin+'/portal/api/'+route,{method,headers:{'Content-Type':'application/json',...headers},...(input===undefined?{}:{body:JSON.stringify(input)})});return {status:r.status,body:await r.json()};};
 try{
  const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Svc QA',workspace:'QA',email:'svc@example.test',password:'fixture-owner-password-123'})});cookie=owner.headers.get('set-cookie').split(';')[0];csrf=(await owner.json()).csrf;
  const router=(await api('records/devices','POST',{name:'Core',type:'router',driver:'none',host:'10.0.0.1'})).body;
  const home=(await api('radius/plans','POST',{name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days',devices:1})).body;
  const daily=(await api('radius/plans','POST',{name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days',devices:3,trial:{enabled:true,minutes:10,everyDays:30},custom:{enabled:true,maxQty:7,discounts:[{minQty:3,percent:10}]}})).body;
  assert.equal(daily.trial.minutes,10);assert.equal(daily.custom.maxQty,7);

  assert.equal((await api('statics/settings/'+router.id,'PUT',{network:'10.50.0.0/24',gateway:'10.50.0.1',iface:'bridge-lan',arpPinning:true})).status,200);
  const st=(await api('radius/subscribers','POST',{name:'Shop',username:'shop1',service:'static',planId:home.id,routerId:router.id,mac:'aa-bb-cc-dd-ee-01'})).body;
  assert.equal(st.staticIp,'10.50.0.2');assert.equal(st.staticMac,'AA:BB:CC:DD:EE:01');
  const ov=(await api('statics')).body;assert.equal(ov.items.length,1);assert.equal(ov.routers[0].runner,false);
  assert.equal((await api('radius/subscribers','POST',{name:'Clash',username:'shop2',service:'static',planId:home.id,routerId:router.id,staticIp:'10.50.0.2'})).status,409,'addresses never collide');
  const pp=(await api('radius/subscribers','POST',{name:'Jane',username:'jane',service:'pppoe',planId:home.id,phone:'0712345678'})).body;
  const conv=await api('radius/subscribers/'+pp.id+'/convert','POST',{to:'static',routerId:router.id});assert.equal(conv.status,200);assert.equal(conv.body.subscriber.staticIp,'10.50.0.3');
  const back=await api('radius/subscribers/'+pp.id+'/convert','POST',{to:'pppoe'});assert.equal(back.status,200);assert.equal(back.body.subscriber.staticIp,'');assert.ok(back.body.password);

  const hs=(await api('radius/subscribers','POST',{name:'Ann',username:'ann',service:'hotspot',planId:daily.id,phone:'0722000000'})).body;
  const kid=await api('radius/subscribers/'+hs.id+'/children','POST',{name:'Ann tablet'});assert.equal(kid.status,201);assert.equal(kid.body.child.parentId,hs.id);
  assert.equal((await api('radius/subscribers/'+hs.id+'/children','POST',{})).status,201);
  assert.equal((await api('radius/subscribers/'+hs.id+'/children','POST',{})).status,409,'device limit counts family accounts');
  const prof=(await api('customers/'+hs.id+'/profile')).body;assert.equal(prof.children.length,2);assert.equal(prof.hasPin,false);

  const pin=(await api('radius/subscribers/'+hs.id+'/pin','POST',{})).body.pin;assert.match(pin,/^\d{4}$/);
  assert.equal((await pub('account','POST',{query:'ann',pin:pin==='0000'?'1111':'0000'})).body.pinError,'Wrong PIN');
  assert.equal((await pub('account','POST',{query:'ann',pin})).body.verified,true);
  assert.equal((await api('pins/dispatch','POST',{service:'pppoe',dryRun:true})).body.count,1,'only customers with a phone and no PIN');
  assert.equal((await api('pins/dispatch','POST',{service:'pppoe',confirm:5})).status,400,'the count must be confirmed');

  const pv=(await api('bulk/preview','POST',{filters:{service:'hotspot',state:'all'}})).body;assert.equal(pv.count,3);
  assert.equal((await api('bulk/apply','POST',{filters:{service:'hotspot',state:'all'},action:'add-days',params:{days:2},count:pv.count+1,version:pv.version})).status,409);
  assert.equal((await api('bulk/apply','POST',{filters:{service:'hotspot',state:'all'},action:'add-days',params:{days:2},count:pv.count,version:pv.version})).body.done,3);

  const ua={'User-Agent':'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'};
  assert.equal((await pub('config?mac=AA:BB:CC:00:00:09','GET',undefined,ua)).status,200);
  const cfgPlan=(await pub('config')).body.plans.find(p=>p.id===daily.id);assert.deepEqual(cfgPlan.trial,{minutes:10});assert.equal(cfgPlan.custom.maxQty,7);
  const tr=await pub('trial','POST',{planId:daily.id,mac:'AA:BB:CC:00:00:09'});assert.equal(tr.status,200);assert.match(tr.body.username,/^kne-/);
  assert.equal((await pub('trial','POST',{planId:daily.id,mac:'AA:BB:CC:00:00:09'})).status,429,'one trial per device');
  const rep=(await api('reports?period=today')).body;assert.ok(rep.portalVisits.total>=1);assert.equal(rep.portalVisits.os[0].name,'Android');
  assert.equal((await api('roaming')).status,200);
  assert.equal((await api('radius/manual-connect','POST',{subscriberId:hs.id,reason:''})).status,400,'a reason is required');
  const before=(await api('customers/'+hs.id+'/profile')).body.subscriber.expiresAt,mc=(await api('radius/manual-connect','POST',{subscriberId:hs.id,reason:'Paid cash at office'})).body;
  assert.equal(mc.before,before);assert.ok(mc.after>Math.max(Date.now(),before||0));assert.equal(mc.by,'svc@example.test');assert.equal((await api('radius/manual-connect')).body.items[0].reason,'Paid cash at office');
  // Money: payment → ledger, reversal (typed), wallet adjust, payout request/approve/paid, Paystack settings and webhook signature.
  const paid=(await api('radius/subscribers/'+pp.id+'/payments','POST',{amount:1500,reference:'HTTPPAY1',method:'cash'})).body;assert.ok(paid.payment);
  let lg=(await api('ledger')).body;assert.equal(lg.integrity.ok,true);assert.ok(lg.items.some(e=>e.ref==='HTTPPAY1'&&e.amountMinor===150000));
  assert.equal((await api('payments/'+paid.payment.id+'/reverse','POST',{reason:'wrong account',confirm:'WRONG'})).status,400);
  assert.equal((await api('payments/'+paid.payment.id+'/reverse','POST',{reason:'wrong account',confirm:'HTTPPAY1'})).status,200);
  assert.equal((await api('payments/'+paid.payment.id+'/reverse','POST',{reason:'wrong account',confirm:'HTTPPAY1'})).status,409);
  assert.equal((await api('radius/subscribers/'+hs.id+'/wallet','POST',{amount:200,reason:'goodwill'})).body.balance,200);
  const po=(await api('payouts','POST',{kind:'refund',subscriberId:hs.id,amount:150,reason:'closing account',to:'cash'})).body;assert.equal(po.status,'requested');
  assert.equal((await api('payouts/'+po.id+'/approve','POST',{})).body.status,'approved','the only admin may approve their own request');
  assert.equal((await api('payouts/'+po.id+'/paid','POST',{reference:'CASH001'})).body.status,'paid');
  assert.equal((await api('customers/'+hs.id+'/profile')).body.wallet.loaded,50);
  const csv=await fetch(origin+'/api/ledger?format=csv',{headers:{Cookie:cookie}});assert.match(await csv.text(),/^seq,time,type/);
  assert.equal((await api('paystack','PUT',{secretKey:'sk_test_'+'b'.repeat(40),currency:'KES'})).body.mode,'test');
  assert.equal((await pub('config')).body.paystack,true);
  const wh=await fetch(origin+'/portal/api/paystack/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-paystack-signature':'0'.repeat(128)},body:'{"event":"charge.success"}'});assert.equal(wh.status,401);
  assert.equal((await pub('b2c/'+'0'.repeat(36)+'/result','POST',{})).status,404);
 }finally{await new Promise(r=>app.server.close(r));await new Promise(r=>app.bridge.close(r));app.close?.();fs.rmSync(directory,{recursive:true,force:true});}
});
