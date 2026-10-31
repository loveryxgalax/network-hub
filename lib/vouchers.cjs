'use strict';
// Prepaid hotspot vouchers. A voucher code is both the username and the password. The time starts at the first
// login (redeemed inside the RADIUS decision). A batch can have a last day to start using it, and a single voucher
// can be made for one named customer, or applied by staff to an existing hotspot account.
const crypto=require('node:crypto'),radius=require('./radius.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789',norm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const code=n=>Array.from(crypto.randomBytes(n),b=>ALPHABET[b%ALPHABET.length]).join('');
const find=(store,c)=>{const row=store.db.prepare("SELECT * FROM records WHERE kind='vouchers' AND json_extract(body,'$.code')=?").get(c);return row?store.unpack(row):null;};
function generate(store,input,user,now=Date.now()){
 const plan=store.get('plans',String(input.planId||''));if(!plan||plan.service==='pppoe')fail('Choose a hotspot plan');
 const count=Math.round(Number(input.count));if(!(count>=1&&count<=500))fail('Make 1 to 500 vouchers at a time');
 let validUntil=null;if(input.validUntil!==''&&input.validUntil!=null){validUntil=typeof input.validUntil==='number'?input.validUntil:Date.parse(String(input.validUntil)+(/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)?'T23:59:59+03:00':''));if(!(validUntil>now))fail('The last day to use the vouchers must be in the future');}
 const assignedName=String(input.assignedName||'').trim().slice(0,80),assignedPhone=String(input.assignedPhone||'').trim().slice(0,20);if((assignedName||assignedPhone)&&count!==1)fail('Make one voucher at a time for a named customer');
 const length=[6,8,10].includes(Number(input.length))?Number(input.length):8,name=String(input.name||'').trim().slice(0,60)||plan.name+' · '+new Date(now).toISOString().slice(0,10);
 return store.transaction(()=>{
  const batch=store.put('voucherBatches',{name,planId:plan.id,planName:plan.name,count,length,createdAt:now,createdBy:user?.name||'',manual:input.manual===true,validUntil}),made=[];
  for(let i=0;i<count;i++){let c;do{c=code(length);}while(find(store,c)||made.includes(c));made.push(c);store.put('vouchers',{code:c,batchId:batch.id,planId:plan.id,status:'unused',createdAt:now,...(assignedName||assignedPhone?{assignedName,assignedPhone}:{})});}
  return {batch,codes:made};});
}
function batches(store){const all=store.list('vouchers'),plans=new Map(store.list('plans').map(p=>[p.id,p]));
 return store.list('voucherBatches').map(b=>{const mine=all.filter(v=>v.batchId===b.id);const expired=b.validUntil&&b.validUntil<=Date.now();return {...b,expired:!!expired,planName:plans.get(b.planId)?.name||b.planName,unused:mine.filter(v=>v.status==='unused').length,used:mine.filter(v=>v.status==='used').length};});}
function codes(store,batchId){return store.list('vouchers').filter(v=>v.batchId===batchId).map(v=>({code:v.code,status:v.status,usedAt:v.usedAt||null,usedBy:v.usedBy||'',assignedName:v.assignedName||'',assignedPhone:v.assignedPhone||''}));}
function removeBatch(store,batchId){const b=store.get('voucherBatches',batchId);if(!b)fail('Batch not found',404);return store.transaction(()=>{let removed=0;for(const v of store.list('vouchers').filter(x=>x.batchId===batchId&&x.status==='unused')){store.remove('vouchers',v.id);removed++;}if(!store.list('vouchers').some(v=>v.batchId===batchId))store.remove('voucherBatches',batchId);return {removed};});}
// Used by the RADIUS decision when a login name matches no subscriber: an unused voucher becomes a subscriber now.
function redeem(store,username,now=Date.now()){
 const c=norm(username);if(!/^[A-Z0-9]{6,12}$/.test(c))return null;const v=find(store,c);if(!v||v.status!=='unused')return null;
 const plan=store.get('plans',v.planId);if(!plan||plan.active===false||expiredBatch(store,v,now))return null;
 return store.transaction(()=>{
  const fresh=find(store,c);if(!fresh||fresh.status!=='unused')return null;
  const sub=store.put('subscribers',{...radius.subscriber(store,{name:'Voucher '+c,username:c,service:'hotspot',planId:plan.id,expiresAt:now+radius.planMs(plan)}),voucher:c});
  radius.setPassword(store,sub.id,c.toLowerCase());store.put('vouchers',{...fresh,status:'used',usedAt:now,usedBy:sub.username},fresh);return sub;});
}
const expiredBatch=(store,v,now)=>{if(v.validUntil&&v.validUntil<=now)return true;const b=store.get('voucherBatches',v.batchId);return !!(b?.validUntil&&b.validUntil<=now);};
// Staff apply an unused voucher to an existing hotspot customer: their package time grows by the voucher's package.
function applyTo(store,codeInput,subscriberId,now=Date.now()){const c=norm(codeInput);return store.transaction(()=>{const v=find(store,c);if(!v)fail('Voucher not found',404);if(v.status!=='unused')fail('This voucher was already used',409);if(expiredBatch(store,v,now))fail('This voucher has expired',409);
 const s=store.get('subscribers',String(subscriberId||''));if(!s)fail('Customer not found',404);if(s.service!=='hotspot')fail('Vouchers are for hotspot customers');const plan=store.get('plans',v.planId);if(!plan)fail('The voucher package was removed',409);
 const saved=store.put('subscribers',{...s,status:'active',expiresAt:Math.max(now,s.expiresAt||0)+radius.planMs(plan)},s);store.put('vouchers',{...v,status:'used',usedAt:now,usedBy:s.username},v);return {subscriber:saved,plan:plan.name};});}
function peek(store,username){const c=norm(username);if(!/^[A-Z0-9]{6,12}$/.test(c))return null;const v=find(store,c);if(!v||v.status!=='unused'||expiredBatch(store,v,Date.now()))return null;const plan=store.get('plans',v.planId);return plan?{code:c,plan}:null;}
// CSV helpers for imports: one row per line, optional header, comma or semicolon separated.
const rowsOf=csv=>String(csv||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>l.split(/[,;\t]/).map(x=>x.trim().replace(/^"|"$/g,'')));
const dayEnd=d=>{if(!d)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return NaN;const t=Date.parse(d+'T23:59:59+03:00');return Number.isFinite(t)?t:NaN;};
// Import codes printed or sold elsewhere (ISPman "Import vouchers"): code[,expiry_date YYYY-MM-DD]. Dry run first.
function importCodes(store,{planId,csv,name},user,commit=false,now=Date.now()){
 const plan=store.get('plans',String(planId||''));if(!plan||plan.service==='pppoe')fail('Choose a hotspot package');const rows=rowsOf(csv);if(rows.length&&/code/i.test(rows[0][0]))rows.shift();
 if(!rows.length)fail('Paste at least one code');if(rows.length>2000)fail('Import up to 2,000 codes at a time');const seen=new Set();
 const preview=rows.map((r,i)=>{const c=norm(r[0]),exp=dayEnd(r[1]),errors=[];if(!/^[A-Z0-9]{6,12}$/.test(c))errors.push('code must be 6–12 letters or numbers');else if(seen.has(c))errors.push('repeated in this file');else if(find(store,c))errors.push('already exists');
  if(Number.isNaN(exp))errors.push('expiry must be YYYY-MM-DD');else if(exp!==null&&exp<=now)errors.push('already expired');seen.add(c);return {line:i+1,code:c,validUntil:Number.isNaN(exp)?null:exp,errors};});
 const ok=preview.filter(r=>!r.errors.length);if(!commit)return {preview,ready:ok.length,rejected:preview.length-ok.length};
 if(!ok.length)fail('No valid codes to import');
 return store.transaction(()=>{const batch=store.put('voucherBatches',{name:String(name||'').trim().slice(0,60)||'Imported · '+plan.name,planId:plan.id,planName:plan.name,count:ok.length,length:0,createdAt:now,createdBy:user?.name||'',imported:true,validUntil:null});
  for(const r of ok){if(find(store,r.code))continue;store.put('vouchers',{code:r.code,batchId:batch.id,planId:plan.id,status:'unused',createdAt:now,...(r.validUntil?{validUntil:r.validUntil}:{})});}
  return {batch,imported:ok.length,rejected:preview.length-ok.length,preview};});}
// One voucher per phone number (ISPman "Bulk CSV phones"): phone[,package name or id]. Texting them is a separate step.
function phoneBatch(store,{csv,planId,validUntil,name},user,commit=false,now=Date.now()){
 const billing=require('./billing.cjs'),plans=store.list('plans').filter(p=>p.service!=='pppoe'),def=plans.find(p=>p.id===planId);const rows=rowsOf(csv);if(rows.length&&/phone|package/i.test(rows[0].join(',')))rows.shift();
 if(!rows.length)fail('Paste at least one phone number');if(rows.length>500)fail('Up to 500 phones at a time');const until=validUntil?dayEnd(validUntil):null;if(Number.isNaN(until)||(until!==null&&until<=now))fail('The last day to use must be a future date');
 const preview=rows.map((r,i)=>{const [a,b]=r,phoneFirst=billing.phone(a),phone=phoneFirst||billing.phone(b),pkgRaw=phoneFirst?b:a,errors=[];
  const plan=pkgRaw?plans.find(p=>p.id===pkgRaw||p.name.toLowerCase()===String(pkgRaw).toLowerCase()):def;if(!phone)errors.push('not a phone number');
  if(pkgRaw&&!plan)errors.push('unknown package "'+pkgRaw+'"');else if(!plan)errors.push('choose a default package');else if(pkgRaw&&plans.filter(p=>p.name.toLowerCase()===String(pkgRaw).toLowerCase()).length>1)errors.push('several packages have this name; use the package id');
  return {line:i+1,phone:phone||String(a||''),planId:plan?.id||'',planName:plan?.name||'',errors};});
 const ok=preview.filter(r=>!r.errors.length);if(!commit)return {preview,ready:ok.length,rejected:preview.length-ok.length};if(!ok.length)fail('No valid rows');
 return store.transaction(()=>{const batch=store.put('voucherBatches',{name:String(name||'').trim().slice(0,60)||'For '+ok.length+' phones · '+new Date(now).toISOString().slice(0,10),planId:ok[0].planId,planName:[...new Set(ok.map(r=>r.planName))].join(', '),count:ok.length,length:8,createdAt:now,createdBy:user?.name||'',phones:true,validUntil:until});const made=[];
  for(const r of ok){let c;do{c=code(8);}while(find(store,c)||made.some(m=>m.code===c));store.put('vouchers',{code:c,batchId:batch.id,planId:r.planId,status:'unused',createdAt:now,assignedPhone:r.phone});made.push({code:c,phone:r.phone,planName:r.planName});}
  return {batch,made,rejected:preview.length-ok.length};});}
// Printable voucher cards (browser Print → Save as PDF). Codes are redeemable value, so only staff who can see vouchers get here.
function printPage(store,batchId,opts={}){const b=store.get('voucherBatches',batchId);if(!b)fail('Batch not found',404);const e=x=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const ws=store.setting('workspace')||{},plans=new Map(store.list('plans').map(p=>[p.id,p])),compact=opts.layout==='compact',show=new Set(String(opts.fields||'name,package,price,validity,expiry,howto').split(','));
 const list=store.list('vouchers').filter(v=>v.batchId===batchId&&(opts.scope==='all'||v.status==='unused')).sort((a,b)=>a.code.localeCompare(b.code));
 const per=compact?Math.min(100,Math.max(18,Number(opts.perPage)||40)):Math.min(12,Math.max(2,Number(opts.perPage)||8)),cols=compact?(per>=60?5:4):(per<=2?1:per<=6?2:3),paper=opts.paper==='Letter'?'Letter':'A4';
 const dur=p=>p?`${p.durationValue} ${p.durationUnit}`:'',day=t=>t?new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Africa/Nairobi'}):'';
 const card=v=>{const p=plans.get(v.planId);return `<div class="card">${show.has('name')?`<div class="biz">${e(ws.name||'Kade Networks')}</div>`:''}${show.has('package')?`<div class="pkg">${e(p?.name||'')}</div>`:''}<div class="code">${e(v.code)}</div><div class="meta">${[show.has('price')&&p?'KSh '+Number(p.price).toLocaleString():'',show.has('validity')?dur(p):'',show.has('speed')&&p?p.downloadMbps+' Mbps':'',show.has('expiry')&&(v.validUntil||b.validUntil)?'Use by '+day(v.validUntil||b.validUntil):''].filter(Boolean).map(e).join(' · ')}</div>${show.has('howto')?'<div class="how">Connect to the WiFi, open the page and enter this code.</div>':''}</div>`;};
 const pages=[];for(let i=0;i<list.length;i+=per)pages.push(list.slice(i,i+per));
 return `<!doctype html><html><head><meta charset="utf-8"><title>Vouchers · ${e(b.name)}</title><style>@page{size:${paper};margin:10mm}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f1d2a}.bar{padding:12px;text-align:right}.bar button{background:#0032fd;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-weight:700}
.page{display:grid;grid-template-columns:repeat(${cols},1fr);gap:${compact?'0':'6mm'};page-break-after:always;padding:4mm}.card{border:${compact?'1px dashed #98a2b3':'2px solid #0032fd'};border-radius:${compact?'0':'10px'};padding:${compact?'4px 6px':'10px 12px'};text-align:center;break-inside:avoid}
.biz{font-weight:800;font-size:${compact?'9px':'14px'};color:#0032fd}.pkg{font-size:${compact?'9px':'13px'};margin-top:2px}.code{font-family:ui-monospace,Menlo,monospace;font-weight:800;letter-spacing:2px;font-size:${compact?'13px':'24px'};margin:${compact?'2px':'8px'} 0}.meta{font-size:${compact?'8px':'12px'};color:#475467}.how{font-size:${compact?'7px':'11px'};color:#667085;margin-top:4px}@media print{.bar{display:none}}</style></head>
<body><div class="bar">${list.length} voucher${list.length===1?'':'s'} · ${pages.length} page${pages.length===1?'':'s'} <button id="print">Print / Save as PDF</button></div>${pages.map(pg=>`<div class="page">${pg.map(card).join('')}</div>`).join('')||'<p style="padding:20px">No vouchers to print.</p>'}<script src="/receipt.js"></script></body></html>`;}
module.exports={applyTo,generate,batches,codes,removeBatch,redeem,peek,norm,importCodes,phoneBatch,printPage};
