'use strict';
// Ledger findings against 4369b51: a reversal and its refund were both subtracted (Net −150 for a 150 payment that was
// fully refunded), and the CSV export stopped at 2,000 rows without saying so.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),{createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),billing=require('../lib/billing.cjs'),ledger=require('../lib/ledger.cjs'),payouts=require('../lib/payouts.cjs');
const admin={id:'a1',email:'a@x.test',role:'admin'},DAY=864e5;
function fx(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ldg-')),st=new Store(dir);
 const p=st.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:10,uploadMbps:10,price:150,durationValue:30,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'C',username:'c1',service:'pppoe',planId:p.id}));return {st,s,done:()=>{st.close();fs.rmSync(dir,{recursive:true,force:true});}};}
const pay=(st,s,amount,ref)=>billing.pay(st,s.id,{amount,reference:ref,method:'mpesa'}).payment;
const reverse=(st,p)=>ledger.reverse(st,radius,p.id,{reason:'chargeback',confirm:p.reference,rollbackExpiry:false,user:admin});
const refund=(st,s,amount,extra={})=>{const x=payouts.request(st,{kind:'refund',subscriberId:s.id,amount,reason:'service ended',to:'cash',method:'manual',...extra},admin);payouts.approve(st,x.id,admin);return payouts.markPaid(st,x.id,admin,'CASH'+Math.random().toString(36).slice(2,8).toUpperCase());};
const k=m=>m/100;

test('reversal + full refund: net cash 0, payments after adjustments 0 (not −150)',()=>{const {st,s,done}=fx();try{
 const p=pay(st,s,150,'QA00000001');reverse(st,p);refund(st,s,150,{paymentId:p.id});const t=ledger.totals(st);
 assert.equal(k(t.cash.inMinor),150);assert.equal(k(t.cash.outMinor),150);assert.equal(k(t.cash.netMinor),0);assert.equal(k(t.netMinor),0,'the headline Net is net cash');
 assert.equal(k(t.adjusted.netMinor),0);assert.equal(k(t.reversedMinor),150);
 assert.equal(st.list('ledger').length,3,'history kept: payment, reversal, refund');}finally{done();}});
test('partial refund of a reversed payment, and reversal without refund',()=>{const {st,s,done}=fx();try{
 const p=pay(st,s,150,'QA00000002');reverse(st,p);let t=ledger.totals(st);assert.equal(k(t.cash.netMinor),150,'money still held');assert.equal(k(t.adjusted.netMinor),0);
 refund(st,s,100,{paymentId:p.id});t=ledger.totals(st);assert.equal(k(t.cash.netMinor),50);assert.equal(k(t.adjusted.netMinor),0,'refund of a reversed payment is not taken off twice');}finally{done();}});
test('wallet refund and withdrawal: cash out; a wallet refund also lowers adjusted payments; wallet balance preserved',()=>{const {st,s,done}=fx();try{
 st.put('subscribers',{...st.get('subscribers',s.id),balance:200},st.get('subscribers',s.id));pay(st,s,150,'QA00000003');
 const bal=st.get('subscribers',s.id).balance;refund(st,s,50);assert.equal(st.get('subscribers',s.id).balance,bal-50,'wallet debited once');
 const w=payouts.request(st,{kind:'withdrawal',amount:30,reason:'owner draw',to:'bank',method:'manual'},admin);payouts.approve(st,w.id,admin);payouts.markPaid(st,w.id,admin,'BANK001');
 const t=ledger.totals(st);assert.equal(k(t.cash.inMinor),150);assert.equal(k(t.cash.refundMinor),50);assert.equal(k(t.cash.withdrawalMinor),30);assert.equal(k(t.cash.netMinor),70);
 assert.equal(k(t.adjusted.netMinor),100,'150 − 50 wallet refund; a withdrawal is not a payment adjustment');}finally{done();}});
test('a refund confirmed twice for one payout is counted once (both entries kept)',()=>{const {st,s,done}=fx();try{
 const p=pay(st,s,150,'QA00000004');reverse(st,p);const x=refund(st,s,150,{paymentId:p.id});
 assert.throws(()=>payouts.markPaid(st,x.id,admin,'CASH2'),/Approve it first/);
 // A duplicate confirmation that reached the ledger anyway (e.g. from older code) does not change the totals.
 ledger.post(st,{subscriberId:s.id,type:'refund',amountMinor:-15000,ref:'CASHDUP',payoutId:x.id,paymentId:p.id,note:'duplicate'});
 const t=ledger.totals(st);assert.equal(k(t.cash.netMinor),0);assert.equal(t.duplicatePayoutEntries,1);assert.equal(st.list('ledger').filter(e=>e.type==='refund').length,2);
 assert.equal(ledger.verify(st).ok,true);}finally{done();}});
test('refund in a later reporting period: each period shows its own cash, nothing double counted across them',()=>{const {st,s,done}=fx();try{
 const T=Date.UTC(2026,9,10);const p=billing.pay(st,s.id,{amount:150,reference:'QA00000005',method:'mpesa'},T).payment;
 ledger.reverse(st,radius,p.id,{reason:'chargeback',confirm:p.reference,rollbackExpiry:false,user:admin},T+DAY);
 const x=payouts.request(st,{kind:'refund',subscriberId:s.id,paymentId:p.id,amount:150,reason:'service ended',to:'cash',method:'manual'},admin,T+40*DAY);payouts.approve(st,x.id,admin,T+40*DAY);payouts.markPaid(st,x.id,admin,'CASHLATE',T+40*DAY);
 const oct=ledger.totals(st,T-DAY,T+20*DAY),nov=ledger.totals(st,T+30*DAY,T+60*DAY),all=ledger.totals(st);
 assert.equal(k(oct.cash.netMinor),150);assert.equal(k(oct.adjusted.netMinor),0);assert.equal(k(nov.cash.netMinor),-150);assert.equal(k(nov.adjusted.netMinor),0);
 assert.equal(k(all.cash.netMinor),0);assert.equal(k(oct.cash.netMinor+nov.cash.netMinor),k(all.cash.netMinor));}finally{done();}});

async function server(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ldgh-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://n.example.test'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'l@example.test',password:'fixture-owner-password-123'})});const cookie=owner.headers.get('set-cookie').split(';')[0];
 return {st:app.store,o,cookie,get:u=>fetch(o+u,{headers:{cookie}}),done:async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};}
const parse=text=>{const lines=text.split('\n');const rows=lines.slice(1).filter(Boolean).map(l=>{const c=[];let cur='',q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(q){if(ch==='"'&&l[i+1]==='"'){cur+='"';i++;}else if(ch==='"')q=false;else cur+=ch;}else if(ch==='"')q=true;else if(ch===','){c.push(cur);cur='';}else cur+=ch;}c.push(cur);return c;});return {header:lines[0],rows};};
const fill=(st,n,from=0)=>st.transaction(()=>{for(let i=0;i<n;i++)ledger.post(st,{type:i%3===2?'refund':'payment',amountMinor:i%3===2?-100:250,ref:'R'+(from+i),note:i===1?'has "quotes", commas\nand a newline':'n'+i});});
test('CSV export: 0, 2,000, 2,100 and 5,000 entries all exported, escaped, ordered, reconciled with the same snapshot',async()=>{const a=await server();try{
 for(const [n,add] of [[0,0],[2000,2000],[2100,100],[5000,2900]]){if(add)fill(a.st,add,a.st.list('ledger').length);
  const r=await a.get('/api/ledger?format=csv');assert.equal(r.status,200);const text=await r.text(),{header,rows}=parse(text);
  assert.equal(header,'seq,time,type,customer,amount_kes,wallet_change_kes,reference,note,actor,hash');
  // A note with a newline spans two physical lines; count rows by seq values instead.
  const seqs=[...text.matchAll(/^"(\d+)","\d{4}-/gm)].map(m=>Number(m[1]));
  assert.equal(seqs.length,n,'rows for '+n);assert.equal(Number(r.headers.get('x-ledger-rows')),n);
  assert.deepEqual(seqs,[...seqs].sort((x,y)=>y-x),'newest first');assert.equal(new Set(seqs).size,n,'no duplicates');
  if(n){assert.equal(Number(r.headers.get('x-ledger-snapshot-seq')),seqs[0]);const t=ledger.totals(a.st);
   const sum=[...text.matchAll(/^"\d+","[^"]+","(payment|refund)","[^"]*","(-?\d+\.\d\d)"/gm)].reduce((acc,m)=>acc+Math.round(Number(m[2])*100),0);
   assert.equal(sum,t.cash.netMinor,'exported amounts reconcile with the totals');assert.ok(text.includes('"has ""quotes"", commas\nand a newline"'),'escaping kept');}}
 // Filters still apply to the full export.
 const r=await a.get('/api/ledger?format=csv&type=refund'),text=await r.text();assert.equal([...text.matchAll(/^"\d+","[^"]+","refund"/gm)].length,a.st.list('ledger').filter(e=>e.type==='refund').length);
 }finally{await a.done();}});
test('CSV export during concurrent writes: exactly the snapshot, no missing or duplicated rows',async()=>{const a=await server();try{
 fill(a.st,3000);let writing=true,added=0;const writer=(async()=>{while(writing){ledger.post(a.st,{type:'payment',amountMinor:100,ref:'LIVE'+added});added++;await new Promise(r=>setImmediate(r));}})();
 const r=await a.get('/api/ledger?format=csv');const text=await r.text();writing=false;await writer;
 const seqs=[...text.matchAll(/^"(\d+)","\d{4}-/gm)].map(m=>Number(m[1])),snap=Number(r.headers.get('x-ledger-snapshot-seq'));
 assert.equal(seqs.length,Number(r.headers.get('x-ledger-rows')));assert.equal(new Set(seqs).size,seqs.length);
 assert.deepEqual(seqs,Array.from({length:snap},(_,i)=>snap-i),'every entry up to the snapshot, none after it');
 assert.ok(added>0,'writes really happened during the export');
 // Permissions unchanged: no session, no ledger.
 assert.equal((await fetch(a.o+'/api/ledger?format=csv')).status,401);
 }finally{await a.done();}});
