'use strict';
// Clean-up voids only non-kept customers' ledger entries (chain intact, kept money unchanged), removes only disabled
// speed rules, refuses a stale confirm code; restore-check verifies a copied backup without touching the original.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {Store}=require('../lib/store.cjs'),ledger=require('../lib/ledger.cjs'),radius=require('../lib/radius.cjs');
const CLI=path.join(__dirname,'..','scripts','data-maintenance.cjs');
const run=(dir,args)=>{try{return execFileSync(process.execPath,[CLI,...args],{env:{...process.env,NETWORK_DATA_DIR:dir},encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(e){return 'EXIT '+e.status+'\n'+e.stdout+e.stderr;}};
test('cleanup and restore-check',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dm-')),st=new Store(dir);
 const plan=st.put('plans',radius.plan({name:'Lab 5',service:'pppoe',downloadMbps:5,uploadMbps:5,price:1,durationValue:30,durationUnit:'days'}));
 const keep=st.put('subscribers',{...radius.subscriber(st,{name:'User One',username:'user1',service:'pppoe',planId:plan.id,expiresAt:Date.now()+864e5}),balance:50});radius.setPassword(st,keep.id,'fixture-pw-1');
 const dummy=st.put('subscribers',radius.subscriber(st,{name:'Dummy',username:'dummy9',service:'pppoe',planId:plan.id,expiresAt:Date.now()}));
 for(const [s,a] of [[keep,1000],[keep,2000],[keep,3000],[dummy,500000],[dummy,7]])ledger.post(st,{subscriberId:s.id,type:'payment',amountMinor:a*100,ref:'R'});
 ledger.post(st,{type:'withdrawal',amountMinor:-100});
 st.setting('speedRules',{items:[{id:'r-off',scope:'customer',targetId:'gone',mode:'exact',downMbps:1,upMbps:1,enabled:false},{id:'r-on',scope:'isp',targetId:'',mode:'cut',downMbps:5,upMbps:5,enabled:true}]});
 const inBefore=ledger.totals(st).inMinor;st.close?.();
 // Plan only: nothing changes.
 let o=run(dir,['cleanup','--keep','user1']);assert.match(o,/Ledger entries to void \(customers not kept\): 2/);assert.match(o,/Speed rules to remove \(all disabled\): 1/);
 const code=o.match(/Confirm code: (\w+)/)[1];assert.match(run(dir,['cleanup','--keep','user1','--apply','--confirm','wrong']),/does not match/);
 assert.match(run(dir,['cleanup','--keep','nosuch']),/do not exist/);
 o=run(dir,['cleanup','--keep','user1','--apply','--confirm',code]);assert.match(o,/After: chain ok \(8 entries\)/);assert.match(o,/kept customers unchanged: true/);
 const s2=new Store(dir);assert.equal(ledger.verify(s2).ok,true);assert.equal(s2.list('ledger').length,8,'nothing deleted, 2 voids appended');
 assert.equal(ledger.totals(s2).inMinor,inBefore-500007*100,'money in drops by exactly the voided test payments');
 assert.deepEqual(s2.setting('speedRules').items.map(r=>r.id),['r-on'],'enabled rule kept, nothing enabled');
 assert.ok(fs.readdirSync(path.join(dir,'backups')).some(f=>/^pre-cleanup-.*\.sqlite$/.test(f)),'backup taken first');
 assert.equal(s2.get('subscribers',keep.id).balance,50);
 // Running again finds nothing new.
 assert.match(run(dir,['cleanup','--keep','user1']),/Ledger entries to void \(customers not kept\): 0/);s2.close?.();
 // Restore check on a COPY of the backup (+ key), never the live folder.
 const rdir=fs.mkdtempSync(path.join(os.tmpdir(),'rc-')),b=fs.readdirSync(path.join(dir,'backups')).find(f=>f.endsWith('.sqlite'));
 fs.copyFileSync(path.join(dir,'backups',b),path.join(rdir,'network.sqlite'));fs.copyFileSync(path.join(dir,'master.key'),path.join(rdir,'master.key'));
 o=run(dir,['restore-check',rdir]);assert.match(o,/integrity: ok/);assert.match(o,/ledger chain: ok \(6 entries\)/);assert.match(o,/passwords decrypt: 1 .* failed to decrypt: 0/);assert.doesNotMatch(o,/fixture-pw-1/);
 assert.match(run(dir,['restore-check',dir]),/Refusing: that is the live data folder/);
});
