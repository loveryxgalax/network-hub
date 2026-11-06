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
test('every link in a message to a customer is shortened automatically (this site and outside links)',async()=>{
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'sl-')));sl.setOrigin(O);
 const msg='Hi Jane, renew here: '+O+'/portal/account.html?t=eyJzIjoiMjZlNjc1ZTYtOWVmOC00ZTFlLWFjOWItYTBhNjYzYmI5ZmU3IiwiZSI6MTc5ODk5NTY1NzIzMX0.jEZHws_MWwtAAmyYtBsLE. Or see https://example.com/some/very/long/page?with=parameters&and=more.';
 const out=sl.shortenText(st,msg);const links=out.match(/https:\/\/netops\.kadenetworks\.com\/s\/[A-Za-z0-9]{10}/g);
 assert.equal(links.length,2);assert.ok(out.includes(links[0]+'. Or'),'full stop kept after the link');assert.ok(out.endsWith('.'));
 assert.match(sl.resolve(st,links[0].slice(-10)),/^\/portal\/account\.html\?t=/);assert.equal(sl.resolve(st,links[1].slice(-10)),'https://example.com/some/very/long/page?with=parameters&and=more');
 assert.equal(sl.shortenText(st,out),out,'short links are left alone');assert.equal(sl.shortenText(st,'No links here'),'No links here');
 // Through the real send path: the logged message carries the short link.
 const billing=require('../lib/billing.cjs');billing.setSmsConfig(st,{username:'kade',apiKey:'atsk_test_key',senderId:'KADENET'});
 const r=await billing.sendSms(st,'0712345678',msg,'manual',async()=>({ok:true,status:201,text:async()=>JSON.stringify({SMSMessageData:{Recipients:[{status:'Success'}]}})}));
 assert.ok(!r.message.includes('t=eyJ'),'no long token in what was sent');assert.match(r.message,/\/s\/[A-Za-z0-9]{10}/);
});
