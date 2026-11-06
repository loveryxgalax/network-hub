'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),sl=require('../lib/shortlink.cjs');
const O='https://netops.kadenetworks.com';
test('short links: only this site, unguessable codes, reused, expire',()=>{
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'sl-')));const now=Date.now();
 const a=sl.create(st,O+'/portal/account.html?t=eyJabc.def',{origin:O,now});assert.match(a.url,/^https:\/\/netops\.kadenetworks\.com\/s\/[A-Za-z0-9]{10}$/);
 assert.equal(sl.resolve(st,a.code),'/portal/account.html?t=eyJabc.def');
 assert.equal(sl.create(st,'/portal/account.html?t=eyJabc.def',{origin:O,now}).code,a.code,'same target reuses the code');
 assert.throws(()=>sl.create(st,'https://evil.example/phish',{origin:O}),/Only links on this site/);
 assert.throws(()=>sl.create(st,'//evil.example/x',{origin:O}),/valid|this site/);
 assert.throws(()=>sl.create(st,'javascript:alert(1)',{origin:O}),/valid|this site/);
 assert.equal(sl.resolve(st,'nope'),null);assert.equal(sl.resolve(st,'AAAAAAAAAA'),null);
 const b=sl.create(st,'/portal/',{origin:O,now,expiresAt:now+1000});assert.equal(sl.resolve(st,b.code,now+2000),null,'expired');
});
