'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const pdf=require('../lib/pdf.cjs');
function xrefOk(buf){const s=buf.toString('latin1'),start=Number(/startxref\n(\d+)/.exec(s)[1]);assert.ok(s.slice(start).startsWith('xref'),'startxref points at xref');
 const lines=s.slice(start).split('\n'),n=Number(lines[1].split(' ')[1]);for(let i=1;i<n;i++){const off=Number(lines[2+i].slice(0,10));assert.ok(s.slice(off).startsWith(i+' 0 obj'),'object '+i+' offset');}return s;}
test('invoice PDF: valid structure, totals with tax and payments, and long invoices continue on more pages',()=>{
 const items=JSON.stringify([{d:'Installation',q:1,p:1500},{d:'Router',q:2,p:2500}]);
 const b=pdf.invoice({name:'INV-1',customer:'Jane (Kamau) \\ test',amount:7540,taxRate:16,items,status:'Unpaid',due:'2026-12-01'},{ws:{name:'Kade Networks',currency:'KES'},payments:[{amount:1000,reference:'TKA1'}]});
 const s=xrefOk(b);assert.ok(s.startsWith('%PDF-1.4'));assert.match(s,/\(INVOICE\) Tj/);assert.match(s,/Jane \\\(Kamau\\\) \\\\ test/,'brackets and backslashes escaped');
 assert.match(s,/KES 6,500\.00/);assert.match(s,/Tax \(16%\)|Tax \\\(16%\\\)/);assert.match(s,/KES 6,540\.00/,'balance due = total − paid');assert.match(s,/\/Count 1/);
 const many=JSON.stringify(Array.from({length:70},(_,i)=>({d:'Line '+i,q:1,p:10})));const m=xrefOk(pdf.invoice({name:'INV-2',customer:'Big',amount:700,items:many},{ws:{}}));
 assert.match(m,/\/Count [3-9]/);assert.match(m,/Page 1 of/);
 {const max=pdf.width('one two',10),lines=pdf.wrap('one two three four',max,10);assert.ok(lines.length>=2);for(const l of lines)assert.ok(pdf.width(l,10)<=max,'every wrapped line fits');}
});
test('invoice PDF route: staff download it, field installers cannot',async()=>{
 const {createApp}=require('../server.cjs'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-')),app=createApp({dataDir:dir,collector:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'pdf@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],inv=app.store.put('invoices',{name:'INV-9',customer:'Jane',amount:100,status:'Unpaid'});
  const r=await fetch(o+'/api/invoices/'+inv.id+'/pdf',{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');assert.match(r.headers.get('content-disposition'),/inline; filename="INV-9\.pdf"/);
  const buf=Buffer.from(await r.arrayBuffer());assert.equal(buf.slice(0,5).toString(),'%PDF-');
  assert.match((await fetch(o+'/api/invoices/'+inv.id+'/pdf?download=1',{headers:{Cookie:cookie}})).headers.get('content-disposition'),/^attachment/);
  assert.equal((await fetch(o+'/api/invoices/00000000-0000-0000-0000-000000000000/pdf',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await fetch(o+'/api/invoices/'+inv.id+'/pdf')).status,401);
 }finally{app.server.close();}
});
