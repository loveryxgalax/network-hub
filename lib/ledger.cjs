'use strict';
// Append-only money ledger in integer minor units (cents). Entries are never edited or deleted:
// a mistake is undone by a reversal entry that points at the original. Each entry carries the hash
// of the previous one, so a changed or removed row is detectable with verify().
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const TYPES=['payment','install-fee','wallet-credit','wallet-debit','points','reversal','refund','withdrawal','adjustment'];
const minor=v=>{const n=Number(v);if(!Number.isFinite(n))fail('Invalid amount');return Math.round(n*100);};
const major=m=>Math.round(m)/100;
const digest=(prev,e)=>crypto.createHash('sha256').update(prev+'|'+JSON.stringify([e.time,e.type,e.subscriberId,e.amountMinor,e.walletMinor,e.ref,e.reversalOf,e.actor,e.note])).digest('hex');
const all=store=>store.list('ledger').sort((a,b)=>a.seq-b.seq);

// amountMinor: money that moved (positive in, negative out). walletMinor: change to the customer's wallet.
function post(store,{subscriberId=null,type,amountMinor=0,walletMinor=0,ref='',reversalOf=null,actor=null,note='',paymentId=null,payoutId=null},now=Date.now()){
 if(!TYPES.includes(type))fail('Unknown ledger entry type');
 if(!Number.isInteger(amountMinor)||!Number.isInteger(walletMinor))fail('Ledger amounts must be whole cents');
 const meta=store.setting('ledgerHead')||{seq:0,hash:'genesis'};
 const e={seq:meta.seq+1,time:now,type,subscriberId,amountMinor,walletMinor,currency:'KES',ref:String(ref).slice(0,60),reversalOf,paymentId,payoutId,actor:actor?String(actor).slice(0,120):null,note:String(note).slice(0,200),prev:meta.hash};
 e.hash=digest(meta.hash,e);
 const saved=store.put('ledger',e);store.setting('ledgerHead',{seq:e.seq,hash:e.hash});return saved;
}
function verify(store){let prev='genesis',seq=0;for(const e of all(store)){seq++;if(e.seq!==seq)return {ok:false,at:seq,reason:'An entry is missing'};if(e.prev!==prev||digest(prev,e)!==e.hash)return {ok:false,at:e.seq,reason:'An entry was changed'};prev=e.hash;}
 const head=store.setting('ledgerHead');if(head&&head.seq!==seq)return {ok:false,at:seq+1,reason:'Entries after '+seq+' are missing'};return {ok:true,entries:seq};}

// Loaded = spendable wallet credit. Pending = portal payments sent to the phone but not yet confirmed.
function wallet(store,s,now=Date.now()){const pending=store.list('portalPayments').filter(p=>p.subscriberId===s.id&&p.status==='pending'&&now-(p.time||p.created)<10*60000).reduce((a,p)=>a+minor(p.amount),0);
 return {loadedMinor:minor(s.balance||0),pendingMinor:pending,loaded:major(minor(s.balance||0)),pending:major(pending)};}

function list(store,{subscriberId,type,from,to,limit=500}={}){return all(store).reverse().filter(e=>(!subscriberId||e.subscriberId===subscriberId)&&(!type||e.type===type)&&(!from||e.time>=from)&&(!to||e.time<to)).slice(0,limit);}
function totals(store,from=0,to=Infinity){const t={};for(const e of all(store))if(e.time>=from&&e.time<to)t[e.type]=(t[e.type]||0)+e.amountMinor;
 const inMinor=(t.payment||0)+(t['install-fee']||0),outMinor=-((t.refund||0)+(t.withdrawal||0)),revMinor=-(t.reversal||0);return {byType:t,inMinor,outMinor,reversedMinor:revMinor,netMinor:inMinor-outMinor-revMinor};}

// Undo a payment exactly: the wallet credit it left, the days it added, the installation fee it settled and the points it earned.
function reverse(store,radius,paymentId,{reason,confirm,rollbackExpiry=true,user},now=Date.now()){
 const why=String(reason||'').trim();if(why.length<4)fail('Give a reason for the reversal');
 return store.transaction(()=>{
  const p=store.get('subscriberPayments',paymentId);if(!p)fail('Payment not found',404);if(p.reversedAt)fail('This payment was already reversed',409);
  if(String(confirm||'').trim().toUpperCase()!==p.reference)fail('Type the payment reference '+p.reference+' to confirm');
  let s=store.get('subscribers',p.subscriberId);const amountMinor=minor(p.amount);let walletMinor=0,expiryMs=0;
  if(s){const patch={};
   if(p.walletAfter!=null&&p.walletBefore!=null){walletMinor=-(minor(p.walletAfter)-minor(p.walletBefore));patch.balance=major(minor(s.balance||0)+walletMinor);}
   if(rollbackExpiry&&p.expiresBefore!==undefined&&p.expiresAt){expiryMs=p.expiresAt-(p.expiresBefore&&p.expiresBefore>(p.time||0)?p.expiresBefore:(p.time||now));if(s.expiresAt)patch.expiresAt=Math.max(now-1,s.expiresAt-expiryMs);}
   if(p.installFee>0)patch.installFeeDue=major(minor(s.installFeeDue||0)+minor(p.installFee));
   if(p.pointsEarned>0)patch.points=Math.max(0,(s.points||0)-p.pointsEarned);
   s=store.put('subscribers',{...s,...patch},s);}
  const saved=store.put('subscriberPayments',{...p,reversedAt:now,reversedBy:user?.email||null,reversalReason:why.slice(0,200)},p);
  post(store,{subscriberId:p.subscriberId,type:'reversal',amountMinor:-amountMinor,walletMinor,ref:p.reference,reversalOf:p.id,paymentId:p.id,actor:user?.email,note:why},now);
  return {payment:saved,subscriber:s,walletMinor,expiryRolledBackMs:expiryMs};
 });
}
// Staff correction of the wallet (goodwill credit or a debit), always with a reason.
function adjust(store,subscriberId,{amount,reason,user},now=Date.now()){const m=minor(amount),why=String(reason||'').trim();if(!m||Math.abs(m)>1e8)fail('Enter a non-zero amount');if(why.length<4)fail('Give a reason');
 return store.transaction(()=>{const s=store.get('subscribers',subscriberId);if(!s)fail('Customer not found',404);const next=minor(s.balance||0)+m;if(next<0)fail('The wallet cannot go below zero');
  const saved=store.put('subscribers',{...s,balance:major(next)},s);post(store,{subscriberId,type:'adjustment',amountMinor:0,walletMinor:m,ref:'ADJ',actor:user?.email,note:why},now);return saved;});}
module.exports={TYPES,minor,major,post,verify,wallet,list,totals,reverse,adjust};
