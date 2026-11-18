'use strict';
// Give hotspot customers created by a portal payment ("Hotspot 0712345678") the real name of the M-Pesa payer.
// Paybill confirmations carry the name; for STK payments we ask Safaricom's Transaction Status API (read only, free)
// using the B2C initiator, and its result carries "2547XXXXXXXX - JOHN DOE". Names typed by staff are never replaced.
const mpesa=require('./mpesa.cjs');
const DEFAULT=/^Hotspot\s+\+?\d{9,13}$/i;
const isDefault=name=>DEFAULT.test(String(name||'').trim());
function pretty(raw){
 let s=String(raw||'').replace(/^\s*\+?\d{6,15}\s*[-–:]\s*/,'').replace(/[^\p{L}\p{M}' .-]/gu,' ').replace(/\s+/g,' ').trim();
 if(!s||/^\d+$/.test(s))return '';
 return s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu,m=>m.toUpperCase()).slice(0,60);
}
function apply(store,subscriberId,raw,source){
 const s=subscriberId&&store.get('subscribers',subscriberId),name=pretty(raw);
 if(!s||!name||!isDefault(s.name))return null;
 const saved=store.put('subscribers',{...s,name},s);
 try{store.audit({id:'system',name:'M-Pesa'},`${s.username}: name set to ${name} from the ${source||'M-Pesa'} payer (was ${s.name})`,s.id);}catch{}
 return saved;
}
// Paybill payments already credited: name their customers from the payer (safe to run any number of times).
function backfill(store){let n=0;for(const p of store.list('c2bPayments'))if(p.status==='credited'&&p.payer&&p.subscriberId&&apply(store,p.subscriberId,p.payer,'paybill'))n++;return n;}

const b2c=store=>store.secret('mpesa:b2c');
// STK payments whose customer still has the automatic name: ask Safaricom who paid. A few per run, each receipt once.
async function lookup(store,origin,fetchImpl=fetch,now=Date.now()){
 const c=b2c(store),m=mpesa.config(store);if(!c||!m||!origin)return 0;
 // A failed lookup (network, Safaricom busy) is tried again after 6 hours, up to 3 times.
 const prior=new Map(store.list('nameLookups').map(x=>[x.receipt,x])),asked=new Set([...prior.values()].filter(x=>x.status!=='failed'||(x.tries||1)>=3||now-x.at<6*3600e3).map(x=>x.receipt));let n=0;
 for(const p of store.list('portalPayments')){
  if(n>=5)break;
  if(p.status!=='paid'||p.provider==='paystack'||!p.receipt||!p.subscriberId||asked.has(p.receipt)||now-(p.paidAt||0)>90*864e5)continue;
  const s=store.get('subscribers',p.subscriberId);if(!s||!isDefault(s.name))continue;
  const old=prior.get(p.receipt),rec=old?store.put('nameLookups',{...old,at:now,status:'asked',tries:(old.tries||1)+1},old):store.put('nameLookups',{receipt:p.receipt,subscriberId:p.subscriberId,at:now,status:'asked',tries:1});n++;
  try{const r=await mpesa.post(store,'/mpesa/transactionstatus/v1/query',{Initiator:c.initiatorName,SecurityCredential:c.securityCredential,CommandID:'TransactionStatusQuery',
    TransactionID:p.receipt,PartyA:m.shortcode,IdentifierType:'4',ResultURL:origin+'/portal/api/b2c/'+c.resultSecret+'/status',QueueTimeOutURL:origin+'/portal/api/b2c/'+c.resultSecret+'/status-timeout',Remarks:'Payer name',Occasion:'name'},fetchImpl);
   store.put('nameLookups',{...rec,conversation:String(r?.ConversationID||''),originator:String(r?.OriginatorConversationID||'')},rec);}
  catch(e){store.put('nameLookups',{...rec,status:'failed',error:String(e.message||e).slice(0,160)},rec);}
 }
 return n;
}
// Safaricom's answer to a lookup.
function result(store,body){
 const R=body?.Result||{},params=Object.fromEntries((R.ResultParameters?.ResultParameter||[]).filter(x=>x&&x.Key).map(x=>[x.Key,x.Value]));
 const receipt=String(params.ReceiptNo||R.TransactionID||'').toUpperCase(),conv=String(R.ConversationID||''),orig=String(R.OriginatorConversationID||'');
 const rec=store.list('nameLookups').find(x=>(conv&&x.conversation===conv)||(orig&&x.originator===orig)||(receipt&&x.receipt===receipt));if(!rec)return null;
 if(String(R.ResultCode)!=='0'){store.put('nameLookups',{...rec,status:'failed',error:String(R.ResultDesc||'').slice(0,160)},rec);return null;}
 const saved=apply(store,rec.subscriberId,params.DebitPartyName,'M-Pesa');store.put('nameLookups',{...rec,status:'done',name:pretty(params.DebitPartyName)},rec);return saved;
}
module.exports={isDefault,pretty,apply,backfill,lookup,result};
