'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs'),ledger=require('../lib/ledger.cjs'),payouts=require('../lib/payouts.cjs'),paystack=require('../lib/paystack.cjs'),portal=require('../lib/portal.cjs'),mpesa=require('../lib/mpesa.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'money-')),store=new Store(dir);return {store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const home={name:'Home',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1500,durationValue:30,durationUnit:'days'};
const admin={id:'a1',email:'a@x.test',role:'admin'},other={id:'a2',email:'b@x.test',role:'admin'};

test('ledger: payments post whole cents, the hash chain detects edits, totals ignore wallet-only moves',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan(home)),s=store.put('subscribers',{...radius.subscriber(store,{name:'A',username:'a1',service:'pppoe',planId:p.id}),installFeeDue:500});
  billing.pay(store,s.id,{amount:2000.5,reference:'LEDG0001',method:'cash'});
  const e=ledger.list(store);assert.equal(e.length,2);const pay=e.find(x=>x.type==='payment'),fee=e.find(x=>x.type==='install-fee');
  assert.equal(pay.amountMinor,150050);assert.equal(fee.amountMinor,50000);assert.equal(pay.walletMinor,50);assert.ok(Number.isInteger(pay.amountMinor));
  assert.deepEqual(ledger.verify(store),{ok:true,entries:2});
  const t=ledger.totals(store);assert.equal(t.inMinor,200050);
  // Tampering with a stored row breaks the chain.
  const row=store.get('ledger',pay.id);store.db.prepare('UPDATE records SET body=? WHERE id=?').run(JSON.stringify({...row,amountMinor:1}),pay.id);
  assert.equal(ledger.verify(store).ok,false);
 }finally{done();}
});

test('reversal undoes exactly what the payment did and only once, with typed confirmation',()=>{
 const {store,done}=fx();try{store.setting('loyalty',{enabled:true,pointsPer100:1,pointValue:1});const p=store.put('plans',radius.plan(home));
  let s=store.put('subscribers',{...radius.subscriber(store,{name:'B',username:'b1',service:'pppoe',planId:p.id,expiresAt:Date.now()+5*864e5}),balance:100,installFeeDue:300});
  const before=store.get('subscribers',s.id);const r=billing.pay(store,s.id,{amount:2000,reference:'REVR0001',method:'mpesa'});
  s=store.get('subscribers',s.id);assert.ok(s.expiresAt>before.expiresAt);assert.equal(s.installFeeDue,0);assert.equal(s.points,20);assert.equal(s.balance,300);
  assert.throws(()=>ledger.reverse(store,radius,r.payment.id,{reason:'wrong customer',confirm:'NOPE',user:admin}),/Type the payment reference/);
  assert.throws(()=>ledger.reverse(store,radius,r.payment.id,{reason:'x',confirm:'REVR0001',user:admin}),/reason/);
  const out=ledger.reverse(store,radius,r.payment.id,{reason:'wrong customer',confirm:'revr0001',user:admin});
  s=out.subscriber;assert.equal(s.balance,100);assert.equal(s.installFeeDue,300);assert.equal(s.points,0);assert.ok(Math.abs(s.expiresAt-before.expiresAt)<5,'expiry back where it was');
  assert.throws(()=>ledger.reverse(store,radius,r.payment.id,{reason:'again please',confirm:'REVR0001',user:admin}),/already reversed/);
  const rev=ledger.list(store,{type:'reversal'})[0];assert.equal(rev.amountMinor,-200000);assert.equal(rev.reversalOf,r.payment.id);assert.equal(ledger.verify(store).ok,true);
  assert.equal(ledger.totals(store).reversedMinor,200000);
 }finally{done();}
});

test('wallet: loaded vs pending, staff adjustments need a reason and cannot go negative',()=>{
 const {store,done}=fx();try{const p=store.put('plans',radius.plan(home)),s=store.put('subscribers',{...radius.subscriber(store,{name:'C',username:'c1',service:'pppoe',planId:p.id}),balance:250});
  store.put('portalPayments',{subscriberId:s.id,status:'pending',amount:1500,time:Date.now()});
  assert.deepEqual(ledger.wallet(store,s),{loadedMinor:25000,pendingMinor:150000,loaded:250,pending:1500});
  assert.throws(()=>ledger.adjust(store,s.id,{amount:50,reason:'',user:admin}),/reason/);
  assert.throws(()=>ledger.adjust(store,s.id,{amount:-300,reason:'correction',user:admin}),/below zero/);
  assert.equal(ledger.adjust(store,s.id,{amount:-50.25,reason:'correction',user:admin}).balance,199.75);
  assert.equal(ledger.list(store,{type:'adjustment'})[0].walletMinor,-5025);
 }finally{done();}
});

test('payouts: wallet refund is held at approval, paid manually with a reference; a second admin must approve',()=>{
 const {store,done}=fx();try{const ins=store.db.prepare("INSERT INTO users(id,email,name,role,password,active,created) VALUES(?,?,?,?,?,1,?)");ins.run('a1','a@x.test','A','admin','x',1);ins.run('a2','b@x.test','B','admin','x',2);
  const p=store.put('plans',radius.plan(home)),s=store.put('subscribers',{...radius.subscriber(store,{name:'D',username:'d1',service:'pppoe',planId:p.id}),balance:400});
  assert.throws(()=>payouts.request(store,{kind:'refund',subscriberId:s.id,amount:500,reason:'moving away',to:'cash'},admin),/only has/);
  const x=payouts.request(store,{kind:'refund',subscriberId:s.id,amount:300,reason:'moving away',to:'cash'},admin);assert.equal(x.status,'requested');
  assert.throws(()=>payouts.approve(store,x.id,admin),/Another admin/);
  const ap=payouts.approve(store,x.id,other);assert.equal(ap.status,'approved');assert.equal(store.get('subscribers',s.id).balance,100);
  assert.throws(()=>payouts.markPaid(store,x.id,other,''),/reference/);
  const pd=payouts.markPaid(store,x.id,other,'rcpt-77');assert.equal(pd.status,'paid');assert.equal(pd.reference,'RCPT-77');
  const types=ledger.list(store).map(e=>e.type).sort();assert.deepEqual(types,['refund','wallet-debit']);assert.equal(ledger.totals(store).outMinor,30000);
  // Cancelling an approved payout returns the held credit.
  const y=payouts.request(store,{kind:'refund',subscriberId:s.id,amount:100,reason:'test hold',to:'cash'},other);payouts.approve(store,y.id,admin);assert.equal(store.get('subscribers',s.id).balance,0);
  payouts.cancel(store,y.id,admin);assert.equal(store.get('subscribers',s.id).balance,100);
  // A payment refund needs the payment reversed first and cannot exceed it.
  const r=billing.pay(store,s.id,{amount:1500,reference:'PAYREF01',method:'cash'});
  assert.throws(()=>payouts.request(store,{kind:'refund',subscriberId:s.id,paymentId:r.payment.id,amount:1500,reason:'double paid',to:'0712345678'},admin),/Reverse the payment first/);
  ledger.reverse(store,radius,r.payment.id,{reason:'double paid',confirm:'PAYREF01',user:admin});
  assert.throws(()=>payouts.request(store,{kind:'refund',subscriberId:s.id,paymentId:r.payment.id,amount:1600,reason:'double paid',to:'0712345678'},admin),/more than was paid/);
  assert.equal(payouts.request(store,{kind:'refund',subscriberId:s.id,paymentId:r.payment.id,amount:1500,reason:'double paid',to:'0712345678'},admin).source,'payment');
 }finally{done();}
});

test('payouts: M-Pesa B2C sends, Safaricom result marks paid; a failure releases the hold',async()=>{
 const {store,done}=fx();try{mpesa._reset();store.secret('mpesa:config',{env:'sandbox',type:'paybill',shortcode:'600000',consumerKey:'k',consumerSecret:'s',passkey:'p',callbackSecret:'c'.repeat(32),c2bSecret:'d'.repeat(32)});
  payouts.setB2c(store,{initiatorName:'apiop',shortcode:'600000',securityCredential:'X'.repeat(300)});
  const p=store.put('plans',radius.plan(home)),s=store.put('subscribers',{...radius.subscriber(store,{name:'E',username:'e1',service:'pppoe',planId:p.id}),balance:500});
  let sent=null;const ok=async(url,o)=>{if(url.includes('oauth'))return new Response(JSON.stringify({access_token:'t',expires_in:3599}));sent=JSON.parse(o.body);return new Response(JSON.stringify({ResponseCode:'0',ConversationID:'AG_1'}));};
  const x=payouts.request(store,{kind:'refund',subscriberId:s.id,amount:200,reason:'service ended',to:'0712345678',method:'mpesa-b2c'},admin);payouts.approve(store,x.id,admin);
  const sx=await payouts.send(store,x.id,admin,'https://n.test',ok);assert.equal(sx.status,'sent');assert.equal(sent.PartyB,'254712345678');assert.equal(sent.Amount,200);assert.match(sent.ResultURL,/^https:\/\/n\.test\/portal\/api\/b2c\/[a-f0-9]{36}\/result$/);
  payouts.result(store,{Result:{ResultCode:0,OriginatorConversationID:sent.OriginatorConversationID,TransactionID:'QKX1234ABC'}});
  const fin=store.get('payouts',x.id);assert.equal(fin.status,'paid');assert.equal(fin.reference,'QKX1234ABC');assert.equal(store.get('subscribers',s.id).balance,300);
  const y=payouts.request(store,{kind:'refund',subscriberId:s.id,amount:100,reason:'service ended',to:'0712345678',method:'mpesa-b2c'},admin);payouts.approve(store,y.id,admin);await payouts.send(store,y.id,admin,'https://n.test',ok);
  payouts.result(store,{Result:{ResultCode:2001,ResultDesc:'The initiator information is invalid.',OriginatorConversationID:sent.OriginatorConversationID}});
  assert.equal(store.get('payouts',y.id).status,'failed');assert.equal(store.get('subscribers',s.id).balance,300,'hold released');
  const z=payouts.request(store,{kind:'withdrawal',amount:1000,reason:'owner draw',to:'0712345678',method:'mpesa-b2c'},admin);payouts.approve(store,z.id,admin);
  const zf=await payouts.send(store,z.id,admin,'https://n.test',async(url)=>url.includes('oauth')?new Response(JSON.stringify({access_token:'t',expires_in:3599})):new Response(JSON.stringify({errorMessage:'Bad credential'}),{status:400}));
  assert.equal(zf.status,'failed');assert.equal(ledger.verify(store).ok,true);
 }finally{done();}
});

test('Paystack: checkout link, credit only after verified amount and currency, signed webhooks',async()=>{
 const {store,done}=fx();try{assert.throws(()=>paystack.setConfig(store,{secretKey:'pk_test_nope'}),/secret key/);
  const key='sk_test_'+'a'.repeat(40);paystack.setConfig(store,{secretKey:key,currency:'KES'});
  const plan=store.put('plans',radius.plan({name:'Daily',service:'hotspot',downloadMbps:5,uploadMbps:2,price:50,durationValue:1,durationUnit:'days'}));
  let verifyAs={status:'success',amount:5000,currency:'KES'},init=null;
  const f=async(url,o)=>{if(url.endsWith('/transaction/initialize')){init=JSON.parse(o.body);return new Response(JSON.stringify({status:true,data:{authorization_url:'https://checkout.paystack.com/abc',reference:init.reference}}));}
   if(url.includes('/transaction/verify/'))return new Response(JSON.stringify({status:true,data:verifyAs}));throw new Error('unexpected '+url);};
  await assert.rejects(portal.start(store,{provider:'paystack',planId:plan.id,phone:'0712345678',email:'bad'},'https://n.test',f),/email/);
  const st=await portal.start(store,{provider:'paystack',planId:plan.id,phone:'0712345678',email:'a@b.co',router:{login:'http://10.5.50.1/login',mac:'AA:BB:CC:DD:EE:FF'}},'https://n.test',f);
  assert.equal(st.redirect,'https://checkout.paystack.com/abc');assert.equal(init.amount,5000);assert.equal(init.currency,'KES');assert.match(init.callback_url,/^https:\/\/n\.test\/portal\/\?ps=[a-f0-9]{32}&pt=.+&login=/);
  const s1=await portal.status(store,st.id,st.token,f);assert.equal(s1.status,'paid');assert.ok(s1.username&&s1.password);
  const pay=store.list('subscriberPayments')[0];assert.equal(pay.method,'card');assert.match(pay.reference,/^PS[A-Z0-9]{14}$/);
  // Wrong amount is never credited.
  verifyAs={status:'success',amount:100,currency:'KES'};const st2=await portal.start(store,{provider:'paystack',planId:plan.id,phone:'0722345678',email:'a@b.co'},'https://n.test',f);
  assert.equal((await portal.status(store,st2.id,st2.token,f)).status,'failed');assert.equal(store.list('subscriberPayments').length,1);
  const raw=Buffer.from(JSON.stringify({event:'charge.success',data:{reference:'X'}}));
  assert.equal(paystack.validSignature(store,raw,crypto.createHmac('sha512',key).update(raw).digest('hex')),true);
  assert.equal(paystack.validSignature(store,raw,crypto.createHmac('sha512','other').update(raw).digest('hex')),false);
 }finally{done();}
});
