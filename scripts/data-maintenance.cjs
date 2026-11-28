#!/usr/bin/env node
'use strict';
// Data maintenance for Network Hub. Never prints secrets (passwords, keys); only counts and ids.
//
//   node scripts/data-maintenance.cjs restore-check <dir>
//     <dir> holds an UNPACKED backup (network.sqlite + its matching master.key), never the live data folder.
//     Checks: SQLite integrity, the ledger hash chain, that customer credentials decrypt with this key (counted, never
//     shown), and money reconciliation (payments vs ledger, wallets vs ledger).
//
//   node scripts/data-maintenance.cjs cleanup --keep user1,user2,... [--apply --confirm <code>]
//     Runs on NETWORK_DATA_DIR (default /data). Without --apply it only shows the plan and its confirm code.
//     With --apply: takes a backup (database + master.key into <data>/backups/), then in ONE transaction:
//       * removes speed rules that are disabled (never enables any), and customer rules aimed at customers that no
//         longer exist (only if also disabled);
//       * appends one 'test-void' ledger entry for each ledger entry of a customer NOT in --keep (and not already voided).
//         The ledger is append-only and hash-chained, so nothing is deleted or edited: the original entries stay and the
//         chain still verifies; totals leave out voided entries. Entries without a customer are never touched.
//     Then re-checks the chain, the kept customers' entries and wallets, and lists orphaned references.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {Store}=require(path.join(root,'lib/store.cjs')),ledger=require(path.join(root,'lib/ledger.cjs'));
const out=(...a)=>console.log(...a),die=m=>{console.error(m);process.exit(2);};
const kes=m=>'KSh '+(m/100).toLocaleString('en-KE',{minimumFractionDigits:0,maximumFractionDigits:2});

function integrity(dir){const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(dir,'network.sqlite'),{readOnly:true});const r=db.prepare('PRAGMA integrity_check').get().integrity_check;db.close();return r;}
function reconcile(store){
 const pays=store.list('subscriberPayments'),live=pays.filter(p=>!p.reversedAt),v=ledger.voided(store),entries=store.list('ledger').filter(e=>e.type!=='test-void'&&!v.has(e.seq));
 const ledgerPay=entries.filter(e=>e.type==='payment').reduce((a,e)=>a+e.amountMinor,0),payMinor=live.reduce((a,p)=>a+Math.round((Number(p.amount)||0)*100),0);
 const subs=store.list('subscribers'),walletLedger=entries.reduce((a,e)=>a+(e.walletMinor||0),0),walletNow=subs.reduce((a,s)=>a+Math.round((Number(s.balance)||0)*100),0);
 return {payments:live.length,paymentsTotal:payMinor,ledgerPayments:ledgerPay,walletsTotal:walletNow,ledgerWallet:walletLedger};}
function orphans(store){const ids=new Set(store.list('subscribers').map(s=>s.id)),out={};
 for(const [kind,f] of [['subscriberPayments','subscriberId'],['portalPayments','subscriberId'],['routerJobs','subscriberId'],['tickets','subscriberId'],['ledger','subscriberId']]){const n=store.list(kind).filter(x=>x[f]&&!ids.has(x[f])).length;if(n)out[kind]=n;}
 const rules=(store.setting('speedRules')?.items||[]).filter(r=>r.scope==='customer'&&!ids.has(r.targetId)).length;if(rules)out.speedRulesForMissingCustomers=rules;return out;}

function restoreCheck(dir){
 dir=path.resolve(dir);if(!fs.existsSync(path.join(dir,'network.sqlite'))||!fs.existsSync(path.join(dir,'master.key')))die('Need network.sqlite and master.key in '+dir);
 const live=path.resolve(process.env.NETWORK_DATA_DIR||'/data');if(dir===live)die('Refusing: that is the live data folder. Unpack the backup somewhere else.');
 out('integrity:',integrity(dir));
 const store=new Store(dir),radius=require(path.join(root,'lib/radius.cjs'));
 const subs=store.list('subscribers');let ok=0,none=0,bad=0;for(const s of subs){try{const p=radius.password(store,s.id);if(p)ok++;else none++;}catch{bad++;}}
 const chain=ledger.verify(store),r=reconcile(store),t=ledger.totals(store);
 out('customers:',subs.length,'| passwords decrypt:',ok,'| no password:',none,'| failed to decrypt:',bad);
 out('ledger chain:',chain.ok?'ok ('+chain.entries+' entries)':'BROKEN at '+chain.at+': '+chain.reason);
 out('money in (ledger):',kes(t.inMinor),'| payments recorded:',r.payments,kes(r.paymentsTotal),'| ledger payments:',kes(r.ledgerPayments));
 out('wallets now:',kes(r.walletsTotal),'| wallet movements in ledger:',kes(r.ledgerWallet));
 out('records:',JSON.stringify(Object.fromEntries(['subscribers','plans','subscriberPayments','radiusSessions','devices','vouchers'].map(k=>[k,store.list(k).length]))));
 const o=orphans(store);out('orphaned references:',Object.keys(o).length?JSON.stringify(o):'none');
 store.close?.();return {integrity:'ok',chain,bad};}

function plan(store,keep){
 const subs=store.list('subscribers'),byName=new Map(subs.map(s=>[String(s.username).toLowerCase(),s])),missing=keep.filter(k=>!byName.has(k));
 if(missing.length)die('These --keep accounts do not exist: '+missing.join(', ')+'. Nothing changed.');
 const keepIds=new Set(keep.map(k=>byName.get(k).id)),ids=new Set(subs.map(s=>s.id)),v=ledger.voided(store);
 const rules=(store.setting('speedRules')?.items||[]).filter(r=>r.enabled===false);
 const entries=store.list('ledger').filter(e=>e.type!=='test-void'&&e.subscriberId&&!keepIds.has(e.subscriberId)&&!v.has(e.seq)).sort((a,b)=>a.seq-b.seq);
 const code=crypto.createHash('sha256').update(JSON.stringify([rules.map(r=>r.id),entries.map(e=>e.seq),[...keepIds].sort()])).digest('hex').slice(0,10);
 return {keepIds,rules,entries,code,ids};}
function cleanup(args){
 const dir=path.resolve(process.env.NETWORK_DATA_DIR||'/data'),keep=String(args[args.indexOf('--keep')+1]||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
 if(!args.includes('--keep')||!keep.length)die('Give the accounts to keep: --keep user1,user2,...');
 const store=new Store(dir),p=plan(store,keep),before={chain:ledger.verify(store),totals:ledger.totals(store),kept:keptSnapshot(store,p.keepIds)};
 out('Speed rules to remove (all disabled):',p.rules.length);for(const r of p.rules)out('  -',r.id,r.scope,r.targetId||'',r.mode,r.downMbps+'/'+r.upMbps+' Mbps');
 out('Ledger entries to void (customers not kept):',p.entries.length,kes(p.entries.reduce((a,e)=>a+e.amountMinor,0)));
 for(const e of p.entries)out('  - #'+e.seq,e.type,kes(e.amountMinor),'customer',e.subscriberId,p.ids.has(e.subscriberId)?'':'(deleted)');
 out('Kept accounts:',keep.join(', '),'| their ledger entries stay as they are:',before.kept.entries);
 out('Ledger chain now:',before.chain.ok?'ok':'BROKEN','| money in now:',kes(before.totals.inMinor));
 out('Confirm code:',p.code);
 if(!args.includes('--apply'))return out('Plan only. To apply: --apply --confirm '+p.code);
 if(args[args.indexOf('--confirm')+1]!==p.code)die('Confirm code does not match the current plan. Nothing changed.');
 if(!before.chain.ok)die('The ledger chain is already broken; not touching it. Nothing changed.');
 // Backup first: database (consistent copy) + master.key.
 const t=new Date().toISOString().replace(/[:.]/g,'-'),bdir=path.join(dir,'backups');fs.mkdirSync(bdir,{recursive:true});
 store.db.exec(`VACUUM INTO '${path.join(bdir,'pre-cleanup-'+t+'.sqlite').replace(/'/g,"''")}'`);fs.copyFileSync(path.join(dir,'master.key'),path.join(bdir,'pre-cleanup-'+t+'.master.key'));
 out('Backup:',path.join(bdir,'pre-cleanup-'+t+'.sqlite'),'(+ master.key)');
 const ref='cleanup-'+t.slice(0,19);
 store.transaction(()=>{
  const items=store.setting('speedRules')?.items||[],drop=new Set(p.rules.map(r=>r.id));store.setting('speedRules',{items:items.filter(r=>!(drop.has(r.id)&&r.enabled===false))});
  for(const e of p.entries)ledger.post(store,{subscriberId:e.subscriberId,type:'test-void',amountMinor:-e.amountMinor,walletMinor:-(e.walletMinor||0),ref,reversalOf:e.seq,actor:'data clean-up',note:`Test data: voids entry #${e.seq} (${e.type})`});
  store.audit({id:'system'},`Data clean-up ${ref}: removed ${p.rules.length} disabled speed rule(s); voided ${p.entries.length} test ledger entr${p.entries.length===1?'y':'ies'} (kept: ${keep.join(', ')})`,'data-cleanup');});
 const after={chain:ledger.verify(store),totals:ledger.totals(store),kept:keptSnapshot(store,p.keepIds)};
 out('After: chain',after.chain.ok?'ok ('+after.chain.entries+' entries)':'BROKEN','| money in:',kes(after.totals.inMinor),'| kept customers unchanged:',JSON.stringify(after.kept)===JSON.stringify(before.kept));
 const o=orphans(store);out('Orphaned references:',Object.keys(o).length?JSON.stringify(o):'none');
 if(!after.chain.ok||JSON.stringify(after.kept)!==JSON.stringify(before.kept))die('CHECK FAILED after clean-up. Restore the backup above.');}
// What must not change for kept customers: their ledger entries (seq, type, amount), balances, payments and expiry.
function keptSnapshot(store,keepIds){const subs=store.list('subscribers').filter(s=>keepIds.has(s.id)).sort((a,b)=>a.id.localeCompare(b.id));
 return {entries:store.list('ledger').filter(e=>keepIds.has(e.subscriberId)&&e.type!=='test-void').map(e=>[e.seq,e.type,e.amountMinor]).sort((a,b)=>a[0]-b[0]).length,
  detail:store.list('ledger').filter(e=>keepIds.has(e.subscriberId)&&e.type!=='test-void').map(e=>[e.seq,e.type,e.amountMinor]).sort((a,b)=>a[0]-b[0]),
  accounts:subs.map(s=>[s.username,s.balance||0,s.expiresAt||null,s.planId,s.status]),payments:store.list('subscriberPayments').filter(x=>keepIds.has(x.subscriberId)).map(x=>[x.id,x.amount]).sort()};}

if(require.main===module){const [cmd,...args]=process.argv.slice(2);
 if(cmd==='restore-check')restoreCheck(args[0]||die('Usage: restore-check <dir>'));else if(cmd==='cleanup')cleanup(args);else die('Usage: restore-check <dir> | cleanup --keep a,b [--apply --confirm CODE]');}
module.exports={restoreCheck,plan,reconcile,orphans};
