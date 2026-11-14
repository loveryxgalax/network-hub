'use strict';
// Money going out: refunds to customers (from their wallet or for a reversed payment) and withdrawals to the
// business. Every payout is requested, then approved by an admin (a different admin when there is more than one),
// then paid either manually (cash/bank with a reference) or by M-Pesa B2C. Ledger entries are written when money
// is held (wallet debit), when it is confirmed paid, and when a failed B2C payment releases the hold.
const crypto=require('node:crypto'),ledger=require('./ledger.cjs'),billing=require('./billing.cjs'),mpesa=require('./mpesa.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const STATES=['requested','approved','sent','paid','failed','rejected'];

function b2cConfig(store){return store.secret('mpesa:b2c');}
function b2cPublic(store){const c=b2cConfig(store);return c?{configured:true,initiatorName:c.initiatorName,shortcode:c.shortcode,commandId:c.commandId}:{configured:false};}
function setB2c(store,input){const prior=b2cConfig(store)||{},v=k=>String(input[k]??'').trim();
 const initiatorName=v('initiatorName'),shortcode=v('shortcode'),cred=v('securityCredential')||prior.securityCredential;
 if(!/^[A-Za-z0-9_.-]{2,40}$/.test(initiatorName))fail('Enter the B2C initiator username from the M-Pesa org portal');
 if(!/^\d{5,8}$/.test(shortcode))fail('Enter the B2C shortcode');
 if(!cred||cred.length<100)fail('Paste the security credential (the initiator password encrypted with the Safaricom certificate)');
 const commandId=['BusinessPayment','SalaryPayment','PromotionPayment'].includes(input.commandId)?input.commandId:'BusinessPayment';
 store.secret('mpesa:b2c',{initiatorName,shortcode,securityCredential:cred,commandId,resultSecret:prior.resultSecret||crypto.randomBytes(18).toString('hex')});return b2cPublic(store);}

const admins=store=>store.db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all();
function request(store,input,user,now=Date.now()){
 const kind=input.kind==='withdrawal'?'withdrawal':'refund',amountMinor=ledger.minor(input.amount),reason=String(input.reason||'').trim();
 if(!(amountMinor>=100&&amountMinor<=15000000))fail('Enter an amount between KSh 1 and KSh 150,000');if(reason.length<4)fail('Give a reason');
 const method=input.method==='mpesa-b2c'?'mpesa-b2c':'manual';let to=String(input.to||'').trim().slice(0,80),subscriberId=null,paymentId=null,source=null;
 if(method==='mpesa-b2c'){const ph=billing.phone(to);if(!ph)fail('Enter a Safaricom number to send to');to=ph;if(!b2cConfig(store))fail('Set up M-Pesa B2C first, or pay manually');}
 else if(!to)fail('Say where the money goes (phone, bank account or "cash")');
 if(kind==='refund'){const s=store.get('subscribers',String(input.subscriberId||''));if(!s)fail('Choose the customer',404);subscriberId=s.id;
  if(input.paymentId){const p=store.get('subscriberPayments',String(input.paymentId));if(!p||p.subscriberId!==s.id)fail('Payment not found',404);if(!p.reversedAt)fail('Reverse the payment first, so the days it bought are taken back');
   const already=store.list('payouts').filter(x=>x.paymentId===p.id&&!['failed','rejected'].includes(x.status)).reduce((a,x)=>a+x.amountMinor,0);if(already+amountMinor>ledger.minor(p.amount))fail('That is more than was paid');paymentId=p.id;source='payment';}
  else{if(amountMinor>ledger.minor(s.balance||0))fail('The wallet only has KSh '+(s.balance||0));source='wallet';}}
 return store.put('payouts',{kind,method,to,subscriberId,paymentId,source,amountMinor,amount:ledger.major(amountMinor),reason:reason.slice(0,200),status:'requested',requestedBy:user?.email||null,requestedById:user?.id||null,requestedAt:now,history:[{at:now,by:user?.email||null,status:'requested'}]});
}
function step(store,x,status,user,extra={},now=Date.now()){return store.put('payouts',{...x,...extra,status,history:[...(x.history||[]),{at:now,by:user?.email||'system',status,...(extra.error?{error:extra.error}:{})}].slice(-20)},x);}
function approve(store,id,user,now=Date.now()){return store.transaction(()=>{const x=store.get('payouts',id);if(!x)fail('Payout not found',404);if(x.status!=='requested')fail('Already '+x.status,409);
 if(x.requestedById===user?.id&&admins(store).length>1)fail('Another admin must approve a payout you requested',403);
 if(x.source==='wallet'){const s=store.get('subscribers',x.subscriberId);if(!s)fail('Customer not found',404);const left=ledger.minor(s.balance||0)-x.amountMinor;if(left<0)fail('The wallet no longer has enough credit',409);
  store.put('subscribers',{...s,balance:ledger.major(left)},s);ledger.post(store,{subscriberId:s.id,type:'wallet-debit',walletMinor:-x.amountMinor,ref:'PAYOUT',payoutId:x.id,actor:user?.email,note:'Held for refund'},now);}
 return step(store,x,'approved',user,{approvedBy:user?.email||null,approvedAt:now},now);});}
function reject(store,id,user,reason,now=Date.now()){const x=store.get('payouts',id);if(!x)fail('Payout not found',404);if(x.status!=='requested')fail('Only requested payouts can be rejected',409);return step(store,x,'rejected',user,{error:String(reason||'').slice(0,160)},now);}
function release(store,x,user,now){if(x.source==='wallet'){const s=store.get('subscribers',x.subscriberId);if(s){store.put('subscribers',{...s,balance:ledger.major(ledger.minor(s.balance||0)+x.amountMinor)},s);ledger.post(store,{subscriberId:s.id,type:'wallet-credit',walletMinor:x.amountMinor,ref:'PAYOUT',payoutId:x.id,actor:user?.email,note:'Refund failed; credit returned'},now);}}}
function paid(store,x,user,reference,now){const ref=String(reference||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{3,40}$/.test(ref))fail('Enter the payment reference (M-Pesa code, bank reference or receipt number)');
 ledger.post(store,{subscriberId:x.subscriberId,type:x.kind,amountMinor:-x.amountMinor,ref,payoutId:x.id,paymentId:x.paymentId,actor:user?.email,note:x.reason},now);return step(store,x,'paid',user,{reference:ref,paidAt:now},now);}
function markPaid(store,id,user,reference,now=Date.now()){return store.transaction(()=>{const x=store.get('payouts',id);if(!x)fail('Payout not found',404);if(x.method!=='manual')fail('M-Pesa payouts are confirmed by Safaricom',409);if(x.status!=='approved')fail('Approve it first',409);return paid(store,x,user,reference,now);});}
function cancel(store,id,user,now=Date.now()){return store.transaction(()=>{const x=store.get('payouts',id);if(!x)fail('Payout not found',404);if(x.status!=='approved')fail('Only approved, unsent payouts can be cancelled',409);release(store,x,user,now);return step(store,x,'failed',user,{error:'Cancelled'},now);});}
// Send an approved M-Pesa payout. Safaricom answers later on the result URL.
async function send(store,id,user,origin,fetchImpl=fetch,now=Date.now()){const x=store.get('payouts',id);if(!x)fail('Payout not found',404);if(x.method!=='mpesa-b2c'||x.status!=='approved')fail('Only approved M-Pesa payouts can be sent',409);const c=b2cConfig(store);if(!c)fail('M-Pesa B2C is not set up',503);
 const oc='NH'+crypto.randomBytes(10).toString('hex');const sent=step(store,x,'sent',user,{originatorConversationId:oc,sentAt:now},now);
 try{const r=await mpesa.post(store,'/mpesa/b2c/v3/paymentrequest',{OriginatorConversationID:oc,InitiatorName:c.initiatorName,SecurityCredential:c.securityCredential,CommandID:c.commandId,Amount:Math.round(x.amountMinor/100),PartyA:c.shortcode,PartyB:x.to.replace(/^\+/,''),Remarks:x.reason.slice(0,100)||'Refund',QueueTimeOutURL:origin+'/portal/api/b2c/'+c.resultSecret+'/timeout',ResultURL:origin+'/portal/api/b2c/'+c.resultSecret+'/result',Occasion:x.kind},fetchImpl,now);
  if(String(r?.ResponseCode)!=='0')throw new Error(r?.ResponseDescription||r?.errorMessage||'Rejected by M-Pesa');return store.put('payouts',{...sent,conversationId:r.ConversationID||''},sent);}
 catch(e){return store.transaction(()=>{const cur=store.get('payouts',id);release(store,cur,user,now);return step(store,cur,'failed',user,{error:String(e.message).slice(0,160)},now);});}}
function validResultSecret(store,given){const c=b2cConfig(store);if(!c||typeof given!=='string')return false;const a=Buffer.from(given),b=Buffer.from(c.resultSecret);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function result(store,body,timeout=false,now=Date.now()){const r=body?.Result||{},oc=String(r.OriginatorConversationID||''),x=store.list('payouts').find(p=>p.originatorConversationId===oc);if(!x||x.status!=='sent')return {ok:true};
 return store.transaction(()=>{const cur=store.get('payouts',x.id);if(cur.status!=='sent')return {ok:true};
  if(!timeout&&String(r.ResultCode)==='0'){paid(store,cur,null,String(r.TransactionID||'B2C'+oc.slice(-8)),now);return {ok:true};}
  release(store,cur,null,now);step(store,cur,'failed',null,{error:timeout?'M-Pesa timed out; check the org portal before retrying':String(r.ResultDesc||'Failed').slice(0,160)},now);return {ok:true};});}
function list(store){return store.list('payouts').sort((a,b)=>b.requestedAt-a.requestedAt).slice(0,500);}
module.exports={STATES,b2cPublic,setB2c,request,approve,reject,markPaid,cancel,send,result,validResultSecret,list};
