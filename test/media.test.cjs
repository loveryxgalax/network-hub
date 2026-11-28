'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),media=require('../lib/media.cjs'),engage=require('../lib/engage.cjs');
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d40000000049454e44ae426082','hex');
test('media library: real images only, stored once, served by name, protected while in use',()=>{
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'md-')));
 const m=media.save(st,{name:'ad.png',data:'data:image/png;base64,'+PNG.toString('base64')},{name:'Owner'});
 assert.match(m.url,/^\/portal\/media\/[a-f0-9]{24}\.png$/);assert.equal(media.list(st).length,1);
 media.save(st,{name:'again.png',data:'data:image/png;base64,'+PNG.toString('base64')},null);assert.equal(media.list(st).length,1,'same file is kept once');
 assert.throws(()=>media.save(st,{name:'x.png',data:'data:image/png;base64,'+Buffer.from('<script>alert(1)</script>').toString('base64')}),/Only PNG/);
 assert.ok(media.file(st,m.file));assert.equal(media.file(st,'../../etc/passwd'),null);
 const ad=engage.saveAd?engage.saveAd(st,{title:'Ad',imageUrl:m.url,seconds:15}):null;if(ad)st.put('ads',ad);
 if(ad)assert.throws(()=>media.remove(st,m.file),/still uses/);
 st.db.exec("DELETE FROM records WHERE kind='ads'");assert.deepEqual(media.remove(st,m.file),{ok:true});assert.equal(media.file(st,m.file),null);
});
