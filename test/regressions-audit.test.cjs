'use strict';
// Audit findings 1-7: shared rate limits, auto-connect retry loop, voucher safety on routers the hub cannot read,
// paybill confirmations from non-Safaricom addresses, two-step staff sign-in, verified nightly copies, crash guards.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('../server.cjs'),{Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),vouchers=require('../lib/vouchers.cjs'),c2b=require('../lib/c2b.cjs'),mpesa=require('../lib/mpesa.cjs'),totp=require('../lib/totp.cjs'),dbbackup=require('../lib/dbbackup.cjs');
async function app(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aud-')),a=createApp({dataDir:dir,collector:false,publicOrigin:'https://n.example.test'});await new Promise(r=>a.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+a.server.address().port;
 const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'own@example.test',password:'fixture-owner-password-123'})}),sess=await owner.json(),cookie=owner.headers.get('set-cookie').split(';')[0];
 return {st:a.store,o,cookie,csrf:sess.csrf,dir,done:async()=>{await new Promise(r=>a.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}};}
function store(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aud2-')),st=new Store(dir);return {st,dir,done:()=>{st.close();fs.rmSync(dir,{recursive:true,force:true});}};}

test('1. rate limits are per device, not per site: 30 phones behind one address can each use their own allowance',async()=>{const a=await app();try{
 const call=(ua,ip)=>fetch(a.o+'/portal/api/code-login',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':ua,'CF-Connecting-IP':ip},body:JSON.stringify({code:'ZZ'+Math.random().toString(36).slice(2,10).toUpperCase()})}).then(r=>r.status);
 // 30 different phones at one site, 3 tries each (90 requests; the old shared limit was 12 for the whole site).
 for(let d=0;d<30;d++)for(let i=0;i<3;i++)assert.notEqual(await call('Phone-'+d,'41.90.1.1'),429,'device '+d+' try '+i);
 // One phone still cannot hammer: its own 13th try in the window is refused.
 let last=0;for(let i=0;i<13;i++)last=await call('Greedy','41.90.1.2');assert.equal(last,429);
 // Phones of the same model are told apart by their device address.
 const same=(mac)=>fetch(a.o+'/portal/api/active?mac='+mac,{headers:{'User-Agent':'SameModel','CF-Connecting-IP':'41.90.1.3'}}).then(r=>r.status);
 for(let i=0;i<241;i++)last=await same('AA:BB:CC:00:00:01');assert.equal(last,429);assert.equal(await same('AA:BB:CC:00:00:02'),200,'another phone of the same model is not blocked');
 // One address still has a ceiling however it disguises itself (25 x the device limit).
 let blocked=false;for(let i=0;i<320&&!blocked;i++)blocked=(await call('Rot-'+i,'41.90.1.9'))===429;assert.equal(blocked,true);
 }finally{await a.done();}});
test('2. after the router refuses a login the page does not count down and retry by itself',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../portal/portal.js'),'utf8');
 assert.match(src,/const justFailed=!!params\.get\('error'\)/);assert.match(src,/if\(!ADM&&!justFailed\)hxTimer=setInterval/);});
test('3. a voucher is never refused because of the form a router sends its login in; a provably wrong password still is',()=>{const {st,done}=store();try{
 const p=st.put('plans',radius.plan({name:'Hour',service:'hotspot',downloadMbps:5,uploadMbps:5,price:20,durationValue:1,durationUnit:'hours'}));
 const [c1,c2]=vouchers.generate(st,{planId:p.id,count:2,length:8,name:'QA'},{email:'q@x'}).codes,base={'Calling-Station-Id':'AA:00:00:00:00:01','NAS-IP-Address':'10.0.0.1'};
 // Nothing checkable (MS-CHAP, or CHAP without its challenge): redeemed as before, and noted for staff.
 assert.equal(radius.authorize(st,{...base,'User-Name':c1.toLowerCase(),'MS-CHAP-Challenge':'0x11','MS-CHAP2-Response':'0x22'}).status,200);
 assert.equal(st.list('vouchers').find(v=>v.code===c1).status,'used');assert.ok(st.db.prepare("SELECT count(*) n FROM audit WHERE action LIKE '%without a password the hub could check%'").get().n>=1);
 // Checkable and wrong: refused, voucher untouched.
 assert.equal(radius.authorize(st,{...base,'User-Name':c2.toLowerCase(),'User-Password':'wrong'}).status,404);assert.equal(st.list('vouchers').find(v=>v.code===c2).status,'unused');
 }finally{done();}});
test('4. paybill: a confirmation from a non-Safaricom address is held once Safaricom\'s addresses are proven; real ones credit; admin can still credit a held one',()=>{const {st,done}=store();try{
 mpesa._reset();mpesa.setConfig(st,{env:'production',type:'paybill',shortcode:'174379',consumerKey:'a',consumerSecret:'b',passkey:'c'});
 const p=st.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:5,uploadMbps:5,price:100,durationValue:30,durationUnit:'days'})),s=st.put('subscribers',radius.subscriber(st,{name:'C',username:'cust1',service:'pppoe',planId:p.id}));
 const note=(id,amt=100)=>({TransID:id,TransAmount:amt,BusinessShortCode:'174379',BillRefNumber:'cust1',FirstName:'A',MSISDN:'2547'});
 const paid=()=>st.list('subscriberPayments').length;
 // Before any real Safaricom confirmation has been seen: nothing is held (the check cannot break payments on day one), but it is marked.
 assert.equal(c2b.confirm(st,note('QA1UNKNOWN1'),Date.now(),{ip:'41.90.7.7'}).status,'credited');assert.equal(st.list('c2bPayments').find(x=>x.transId==='QA1UNKNOWN1').source,'unknown');
 // A real one arrives from Safaricom: credited, and the check is now proven on this server.
 assert.equal(c2b.confirm(st,note('QA2SAFARI01'),Date.now(),{ip:'196.201.214.200'}).status,'credited');assert.equal(c2b.guard(st).seenSafaricom,1);
 // A forged one afterwards: saved but NOT credited, and logged.
 const n=paid(),f=c2b.confirm(st,note('QA3FORGED01',5000),Date.now(),{ip:'41.90.7.7'});assert.equal(f.status,'held');assert.equal(paid(),n);
 assert.ok(st.db.prepare("SELECT count(*) n FROM audit WHERE action LIKE '%not Safaricom%'").get().n>=1);
 assert.equal(c2b.confirm(st,note('QA3FORGED01',5000),Date.now(),{ip:'41.90.7.7'}).duplicate,true,'a repeat is not saved twice');
 // After checking the statement an admin credits it by hand.
 assert.equal(c2b.assign(st,f.id,s.id).status,'credited');assert.equal(paid(),n+1);
 // Modes: always hold / only mark.
 c2b.setGuard(st,{mode:'flag'});assert.equal(c2b.confirm(st,note('QA4FLAGGED1'),Date.now(),{ip:'8.8.8.8'}).status,'credited');
 c2b.setGuard(st,{mode:'hold',prefixes:'196.201.214.200, 10.9.'});assert.equal(c2b.confirm(st,note('QA5HELD0001'),Date.now(),{ip:'196.201.213.5'}).status,'held');assert.equal(c2b.confirm(st,note('QA6OK000001'),Date.now(),{ip:'10.9.3.4'}).status,'credited');
 assert.throws(()=>c2b.setGuard(st,{prefixes:'not-an-address'}),/Write each address/);
 }finally{done();}});
test('5. two-step staff sign-in: password alone is refused, codes work once, recovery codes work once, lockout per account',async()=>{const a=await app();try{
 const post=(route,body,h={})=>fetch(a.o+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json().catch(()=>({})),cookie:r.headers.get('set-cookie')}));
 const auth={cookie:a.cookie,'X-CSRF-Token':a.csrf},cred={email:'own@example.test',password:'fixture-owner-password-123'};
 assert.equal((await post('me/2fa/start',{password:'wrong-password-xx'},auth)).status,400);
 const st1=await post('me/2fa/start',{password:cred.password},auth);assert.equal(st1.status,200);assert.match(st1.body.uri,/^otpauth:\/\/totp\//);
 assert.equal((await post('login',cred)).status,200,'not required until a code has been confirmed');
 const user=a.st.db.prepare('SELECT id FROM users WHERE email=?').get(cred.email),now=()=>Math.floor(Date.now()/30000);
 assert.equal((await post('me/2fa/enable',{code:'000000'},auth)).status,400);
 const en=await post('me/2fa/enable',{code:totp.codeAt(st1.body.secret,now())},auth);assert.equal(en.status,200);assert.equal(en.body.recovery.length,10);
 // Password alone is no longer enough.
 const r1=await post('login',cred);assert.equal(r1.status,401);assert.equal(r1.body.needCode,true);assert.equal(r1.cookie,null);
 assert.equal((await post('login',{...cred,code:'123456'})).status,401);
 const good=totp.codeAt(st1.body.secret,now()+1);assert.equal((await post('login',{...cred,code:good})).status,200);
 assert.equal((await post('login',{...cred,code:good})).status,401,'the same code cannot be used twice');
 assert.equal((await post('login',{...cred,code:en.body.recovery[0]})).status,200);assert.equal((await post('login',{...cred,code:en.body.recovery[0]})).status,401,'a recovery code works once');
 assert.equal(totp.status(a.st,user.id).recoveryLeft,9);
 // Two requests spending one code at the same moment: only one gets in.
 const c2=totp.codeAt(st1.body.secret,now()+1);a.st.secret('totp:'+user.id,{...a.st.secret('totp:'+user.id),lastStep:0});
 const both=await Promise.all([post('login',{...cred,code:c2}),post('login',{...cred,code:c2})]);assert.equal(both.filter(r=>r.status===200).length,1);
 // Per-account lockout across many addresses.
 let last=0;for(let i=0;i<11;i++)last=(await post('login',{email:'own@example.test',password:'guess-number-'+i+'-xxxx'},{'CF-Connecting-IP':'203.0.113.'+i})).status;assert.equal(last,429);
 }finally{await a.done();}});
test('6. nightly copy is test-restored; a damaged copy fails; the health status names what is missing',()=>{const {st,dir,done}=store();try{
 const p=st.put('plans',radius.plan({name:'Home',service:'pppoe',downloadMbps:5,uploadMbps:5,price:100,durationValue:30,durationUnit:'days'}));for(let i=0;i<20;i++){const s=st.put('subscribers',radius.subscriber(st,{name:'C'+i,username:'c'+i,service:'pppoe',planId:p.id}));radius.setPassword(st,s.id,'pass-'+i);}
 const r=dbbackup.nightly(st);assert.equal(r.ok,true,JSON.stringify(r.checks));assert.ok(r.bytes>0);assert.ok(fs.existsSync(path.join(dir,'backups','nightly',r.file)));
 assert.equal(dbbackup.tick(st),null,'runs once a day');assert.ok(dbbackup.tick(st,Date.now()+25*3600000).ok);
 // A damaged copy does not pass.
 const bad=path.join(dir,'bad.sqlite');fs.writeFileSync(bad,Buffer.concat([fs.readFileSync(path.join(dir,'backups','nightly',r.file)).subarray(0,3000),Buffer.alloc(5000,7)]));assert.equal(dbbackup.verify(st,bad).ok,false);
 let s=dbbackup.status(st);assert.ok(s.problems.some(x=>/off-site/i.test(x)),'missing off-site backup is called out');assert.ok(s.nightlyCopies.length>=1);
 fs.writeFileSync(path.join(dir,'backups','offsite.json'),JSON.stringify({time:Date.now(),name:'network-hub-x.tar.gz.age',size:'4M'}));s=dbbackup.status(st);assert.equal(s.problems.some(x=>/off-site/i.test(x)),false);assert.equal(s.offsite.size,'4M');
 fs.writeFileSync(path.join(dir,'backups','offsite.json'),JSON.stringify({time:Date.now()-3*864e5,name:'old',size:'4M'}));assert.ok(dbbackup.status(st).problems.some(x=>/two days old/.test(x)));
 // Only 7 nightly copies are kept.
 for(let d=2;d<12;d++)dbbackup.nightly(st,Date.now()+d*864e5);assert.equal(fs.readdirSync(path.join(dir,'backups','nightly')).length,7);
 }finally{done();}});
test('7. the hub keeps serving after a background task fails, and the off-site script reports to the hub',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../server.cjs'),'utf8');assert.match(src,/process\.on\('unhandledRejection'/);assert.match(src,/process\.on\('uncaughtException'/);
 assert.match(fs.readFileSync(path.join(__dirname,'../deployment/docker/backup.sh'),'utf8'),/offsite\.json/);assert.ok(fs.existsSync(path.join(__dirname,'../scripts/restore-test.sh')));});
test('new WiFi portal (ISPman layout): served at /portal/, same endpoints, old portal kept for reference, no auto-retry after a refused login',async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../portal/index.html'),'utf8'),js=fs.readFileSync(path.join(__dirname,'../portal/wifi.js'),'utf8');
 assert.match(html,/wifi\.js/);assert.match(html,/id="hotspotPkgs"/);assert.ok(fs.existsSync(path.join(__dirname,'../portal/legacy/index.html')),'previous portal kept');assert.match(fs.readFileSync(path.join(__dirname,'../portal/legacy/index.html'),'utf8'),/portal\.js/);
 for(const ep of ["'pay'","'login'","'code-login'","'connect-now'","'usage?","'active?","'account'","'redeem-points'","'trial'","'message'"])assert.ok(js.includes(ep),'uses '+ep);
 assert.match(js,/const failed=!!params\.get\('error'\)/);assert.match(js,/if\(!ADM&&!failed\)timer=setInterval/);
 assert.doesNotMatch(js,/password:password\b(?![^}]*chap)/,'logins go to the router only as the server\'s CHAP answer');});
test('portal designs: all 20 designs and the package layout (auto/list/grid/swipe) are wired to the saved settings and the admin preview',()=>{
 const js=fs.readFileSync(path.join(__dirname,'../portal/wifi.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../portal/wifi-themes.css'),'utf8'),html=fs.readFileSync(path.join(__dirname,'../portal/index.html'),'utf8');
 assert.match(html,/wifi-themes\.css/);
 const themes=JSON.parse(/const THEMES=(\[[^\]]+\])/.exec(js)[1].replace(/'/g,'"'));const landingThemes=JSON.parse(/THEMES=(\[[^\]]+\])/.exec(fs.readFileSync(path.join(__dirname,'../lib/landing.cjs'),'utf8'))[1].replace(/'/g,'"'));
 assert.deepEqual([...themes].sort(),[...landingThemes].sort(),'every design the admin can pick is known to the portal');
 for(const t of themes.filter(t=>t!=='classic'))assert.ok(css.includes('[data-theme='+t+']'),'styles for '+t);
 for(const l of ['list','grid','swipe'])assert.ok(css.includes('body.lay-'+l),'layout '+l);
 assert.match(js,/kade:'ready'/);assert.match(js,/e\.data\?\.kade!=='config'/);});
