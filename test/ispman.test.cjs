'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),mirror=require('../lib/ispman.cjs'),{createApp}=require('../server.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ispman-test-')),store=new Store(dir);t.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}
const file='Payment Wallet,Username,Name,Phone Number,Email,Package,Balance,Expires At\r\nKNE-1,Jane@Realm,Jane,+254700000001,jane@example.test,"Home, Standard","KES: 0.00 / 0.00",No expiry';
const input={service:'pppoe',csv:file};
const save=(s,i)=>{const p=mirror.preview(s,i);return mirror.commit(s,{...i,digest:p.digest,revision:p.revision},{id:'owner'},1700000000000);};
test('ISPman preview is read-only; committing does not touch operational records or secrets',t=>{
 const s=fixture(t),sub=s.put('subscribers',{username:'Jane@Realm',name:'Netops Jane',service:'pppoe',balance:400,expiresAt:123,planId:'netops-plan'});s.secret('subscriber:'+sub.id,'private-test-value');s.put('payments',{amount:90});s.put('jobs',{name:'Existing job'});
 const before=s.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),secrets=s.db.prepare('SELECT * FROM secrets').all();
 const p=mirror.preview(s,input);assert.equal(p.creates,1);assert.equal(p.rows[0].match.id,sub.id);assert.equal(p.rows[0].balanceMinor,null);assert.equal(p.warnings.length,1);assert.equal(s.setting('ispmanMirror'),null);assert.equal(s.db.prepare('SELECT count(*) n FROM audit').get().n,0);
 save(s,input);assert.deepEqual(s.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),before);assert.deepEqual(s.db.prepare('SELECT * FROM secrets').all(),secrets);
 const o=mirror.overview(s);assert.equal(o.items[0].username,'Jane@Realm');assert.equal(o.items[0].balanceText,'KES: 0.00 / 0.00');assert.equal(o.items[0].expiresAt,null);assert.equal(o.items[0].package,'Home, Standard');assert.equal(o.lastImport.total,1);assert.doesNotMatch(JSON.stringify(o),/private-test-value/);
});
test('reimports update in place, preserve absent customers and keep services separate',t=>{
 const s=fixture(t);save(s,input);const id=mirror.overview(s).items[0].id;const p=mirror.preview(s,input);assert.equal(p.unchanged,1);save(s,input);assert.equal(mirror.overview(s).items[0].id,id);
 save(s,{service:'pppoe',csv:file.replace('Jane@Realm','Jane.Renamed').replace('KES: 0.00 / 0.00','KES: -125.50')});let o=mirror.overview(s);assert.equal(o.total,1);assert.equal(o.items[0].id,id);assert.equal(o.items[0].balanceMinor,-12550);
 save(s,{...input,service:'hotspot'});assert.equal(mirror.overview(s).total,2);
 save(s,{service:'pppoe',csv:'Username,Package\nOther,Daily'});assert.equal(mirror.overview(s).total,3);assert.equal(mirror.overview(s,{service:'hotspot'}).total,1);
});
test('duplicate identities and conflicting identifiers block the entire import',t=>{
 const s=fixture(t);save(s,input);const cases=[file+'\r\nKNE-1,Other,Other,,,Home,0,',file.replace('KNE-1','KNE-2'), 'Username,Package\nJane,Home\njane,Home'];
 for(const csv of cases){const i={service:'pppoe',csv},p=mirror.preview(s,i);assert.ok(p.errors.length);const before=JSON.stringify(s.setting('ispmanMirror'));assert.throws(()=>mirror.commit(s,{...i,digest:p.digest,revision:p.revision},{id:'owner'}));assert.equal(JSON.stringify(s.setting('ispmanMirror')),before);}
});
test('preview binds service, contents and revision; stale or changed commits save nothing',t=>{
 const s=fixture(t),p=mirror.preview(s,input);save(s,input);assert.throws(()=>mirror.commit(s,{...input,revision:p.revision,digest:p.digest},{id:'owner'}),e=>e.status===409);
 const fresh=mirror.preview(s,input);assert.throws(()=>mirror.commit(s,{...input,csv:file.replace('Jane@Realm','Other'),revision:fresh.revision,digest:fresh.digest},{id:'owner'}),e=>e.status===409);
});
test('partial exports preserve omitted fields and reject mixed services or repeated update targets',t=>{
 const s=fixture(t);save(s,input);save(s,{service:'pppoe',csv:'Username,Package\nJane@Realm,New Package'});let o=mirror.overview(s);assert.equal(o.items[0].phone,'+254700000001');assert.equal(o.items[0].externalId,'KNE-1');
 const mixed=mirror.preview(s,{service:'pppoe',csv:'Username,Package,Service\na,Home,Hotspot'});assert.equal(mixed.errors.length,1);
 const collision=mirror.preview(s,{service:'pppoe',csv:'Payment Wallet,Username,Package\nKNE-1,Renamed,Home\n,Jane@Realm,Home'});assert.equal(collision.errors.length,1);
});
test('CSV validation handles BOM, escaped quotes, delimiters, credentials and bounds',t=>{
 const s=fixture(t),p=mirror.preview(s,{service:'hotspot',csv:'\uFEFFUsername;Package;Name;Balance\r\nuser;"Daily; Plus";"A ""quoted"" name";"KES 1,200.50"'});assert.equal(p.errors.length,0);assert.equal(p.rows[0].name,'A "quoted" name');assert.equal(p.rows[0].balanceMinor,120050);
 for(const csv of ['Username,Package,Password\nu,p,secret','Username,Package\n"u,p','Username,Username,Package\nu,u,p','Name,Package\nu,p'])assert.throws(()=>mirror.preview(s,{service:'pppoe',csv}));
 assert.throws(()=>mirror.preview(s,{service:'pppoe',csv:'x'.repeat(mirror.MAX_BYTES+1)}));assert.throws(()=>mirror.preview(s,{service:'pppoe',csv:'Username,Package\n'+Array(5001).fill('u,p').join('\n')}));
 assert.throws(()=>mirror.preview(s,{...input,service:'static'}));
});
test('expiry text is retained and only unambiguous valid dates get parsed',t=>{
 const s=fixture(t),p=mirror.preview(s,{service:'pppoe',csv:'Username,Package,Expires At\na,Home,2026-02-30\nb,Home,11/12/2026\nc,Home,2026-11-12\nd,Home,No expiry'});
 assert.equal(p.warnings.length,2);assert.equal(p.rows[0].expiresAt,null);assert.equal(p.rows[1].expiryText,'11/12/2026');assert.equal(p.rows[2].expiresAt,Date.parse('2026-11-12T23:59:59+03:00'));assert.equal(p.rows[3].expiresAt,null);
});
test('HTTP endpoints enforce sign-in, CSRF and owner-only access',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ispman-api-')),app=createApp({dataDir:dir,collector:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.server.close(r));app.store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+app.server.address().port;let cookie='',csrf='';const api=async(route,method='GET',body,token=csrf)=>{const r=await fetch(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':token},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};};
 assert.equal((await api('ispman')).status,401);const owner=await api('setup','POST',{name:'Owner',workspace:'Test',email:'owner@example.test',password:'local-fixture-password-123'});cookie=owner.cookie.split(';')[0];csrf=owner.body.csrf;
 assert.equal((await api('ispman/preview','POST',input,'bad')).status,403);let p=await api('ispman/preview','POST',input);assert.equal(p.status,200);assert.equal((await api('ispman/import','POST',{...input,digest:p.body.digest,revision:p.body.revision})).status,200);
 assert.equal((await api('ispman')).body.total,1);
 for(const role of ['manager','support','viewer','network-technician','installer']){app.store.db.prepare('UPDATE users SET role=? WHERE email=?').run(role,'owner@example.test');assert.equal((await api('ispman')).status,403);assert.equal((await api('ispman/preview','POST',input)).status,403);assert.equal((await api('ispman/import','POST',input)).status,403);}
});
