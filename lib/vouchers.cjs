'use strict';
// Prepaid hotspot vouchers. A voucher code is both the username and the password. The time starts at the first
// login (redeemed inside the RADIUS decision). A batch can have a last day to start using it, and a single voucher
// can be made for one named customer, or applied by staff to an existing hotspot account.
const crypto=require('node:crypto'),radius=require('./radius.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789',norm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const code=n=>Array.from(crypto.randomBytes(n),b=>ALPHABET[b%ALPHABET.length]).join('');
const find=(store,c)=>{const row=store.db.prepare("SELECT * FROM records WHERE kind='vouchers' AND json_extract(body,'$.code')=?").get(c);return row?store.unpack(row):null;};
function generate(store,input,user,now=Date.now()){
 const plan=store.get('plans',String(input.planId||''));if(!plan||plan.service==='pppoe')fail('Choose a hotspot plan');
 const count=Math.round(Number(input.count));if(!(count>=1&&count<=500))fail('Make 1 to 500 vouchers at a time');
 let validUntil=null;if(input.validUntil!==''&&input.validUntil!=null){validUntil=typeof input.validUntil==='number'?input.validUntil:Date.parse(String(input.validUntil)+(/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)?'T23:59:59+03:00':''));if(!(validUntil>now))fail('The last day to use the vouchers must be in the future');}
 const assignedName=String(input.assignedName||'').trim().slice(0,80),assignedPhone=String(input.assignedPhone||'').trim().slice(0,20);if((assignedName||assignedPhone)&&count!==1)fail('Make one voucher at a time for a named customer');
 const length=[6,8,10].includes(Number(input.length))?Number(input.length):8,name=String(input.name||'').trim().slice(0,60)||plan.name+' · '+new Date(now).toISOString().slice(0,10);
 return store.transaction(()=>{
  const batch=store.put('voucherBatches',{name,planId:plan.id,planName:plan.name,count,length,createdAt:now,createdBy:user?.name||'',manual:input.manual===true,validUntil}),made=[];
  for(let i=0;i<count;i++){let c;do{c=code(length);}while(find(store,c)||made.includes(c));made.push(c);store.put('vouchers',{code:c,batchId:batch.id,planId:plan.id,status:'unused',createdAt:now,...(assignedName||assignedPhone?{assignedName,assignedPhone}:{})});}
  return {batch,codes:made};});
}
function batches(store){const all=store.list('vouchers'),plans=new Map(store.list('plans').map(p=>[p.id,p]));
 return store.list('voucherBatches').map(b=>{const mine=all.filter(v=>v.batchId===b.id);const expired=b.validUntil&&b.validUntil<=Date.now();return {...b,expired:!!expired,planName:plans.get(b.planId)?.name||b.planName,unused:mine.filter(v=>v.status==='unused').length,used:mine.filter(v=>v.status==='used').length};});}
function codes(store,batchId){return store.list('vouchers').filter(v=>v.batchId===batchId).map(v=>({code:v.code,status:v.status,usedAt:v.usedAt||null,usedBy:v.usedBy||'',assignedName:v.assignedName||'',assignedPhone:v.assignedPhone||''}));}
function removeBatch(store,batchId){const b=store.get('voucherBatches',batchId);if(!b)fail('Batch not found',404);return store.transaction(()=>{let removed=0;for(const v of store.list('vouchers').filter(x=>x.batchId===batchId&&x.status==='unused')){store.remove('vouchers',v.id);removed++;}if(!store.list('vouchers').some(v=>v.batchId===batchId))store.remove('voucherBatches',batchId);return {removed};});}
// Used by the RADIUS decision when a login name matches no subscriber: an unused voucher becomes a subscriber now.
function redeem(store,username,now=Date.now()){
 const c=norm(username);if(!/^[A-Z0-9]{6,12}$/.test(c))return null;const v=find(store,c);if(!v||v.status!=='unused')return null;
 const plan=store.get('plans',v.planId);if(!plan||plan.active===false||expiredBatch(store,v,now))return null;
 return store.transaction(()=>{
  const fresh=find(store,c);if(!fresh||fresh.status!=='unused')return null;
  const sub=store.put('subscribers',{...radius.subscriber(store,{name:'Voucher '+c,username:c,service:'hotspot',planId:plan.id,expiresAt:now+radius.planMs(plan)}),voucher:c});
  radius.setPassword(store,sub.id,c.toLowerCase());store.put('vouchers',{...fresh,status:'used',usedAt:now,usedBy:sub.username},fresh);return sub;});
}
const expiredBatch=(store,v,now)=>{const b=store.get('voucherBatches',v.batchId);return !!(b?.validUntil&&b.validUntil<=now);};
// Staff apply an unused voucher to an existing hotspot customer: their package time grows by the voucher's package.
function applyTo(store,codeInput,subscriberId,now=Date.now()){const c=norm(codeInput);return store.transaction(()=>{const v=find(store,c);if(!v)fail('Voucher not found',404);if(v.status!=='unused')fail('This voucher was already used',409);if(expiredBatch(store,v,now))fail('This voucher has expired',409);
 const s=store.get('subscribers',String(subscriberId||''));if(!s)fail('Customer not found',404);if(s.service!=='hotspot')fail('Vouchers are for hotspot customers');const plan=store.get('plans',v.planId);if(!plan)fail('The voucher package was removed',409);
 const saved=store.put('subscribers',{...s,status:'active',expiresAt:Math.max(now,s.expiresAt||0)+radius.planMs(plan)},s);store.put('vouchers',{...v,status:'used',usedAt:now,usedBy:s.username},v);return {subscriber:saved,plan:plan.name};});}
function peek(store,username){const c=norm(username);if(!/^[A-Z0-9]{6,12}$/.test(c))return null;const v=find(store,c);if(!v||v.status!=='unused'||expiredBatch(store,v,Date.now()))return null;const plan=store.get('plans',v.planId);return plan?{code:c,plan}:null;}
module.exports={applyTo,generate,batches,codes,removeBatch,redeem,peek,norm};
