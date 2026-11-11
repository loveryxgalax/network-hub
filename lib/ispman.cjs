'use strict';
const crypto=require('node:crypto');
const KEY='ispmanMirror',MAX_BYTES=4*1024*1024,MAX_ROWS=5000;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const norm=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
const fields={externalId:['payment wallet','wallet ref','external id','customer id'],username:['username','pppoe username','login'],name:['name','customer name','full name'],phone:['phone number','phone','mobile'],email:['email','e-mail'],package:['package','package name','plan'],balanceText:['balance','wallet balance'],expiryText:['expires at','expires','expiry','expiry date'],status:['status','account status']};
const snapshot=store=>store.setting(KEY)||{revision:0,items:[],lastImport:null};
// Parse one delimiter consistently; punctuation inside quoted fields stays intact.
function parse(csv){
 if(typeof csv!=='string'||Buffer.byteLength(csv)>MAX_BYTES)fail('Choose a CSV file smaller than 4 MiB');
 const text=csv.replace(/^\uFEFF/,'');if(!text.trim())fail('The file is empty');
 const first=text.split(/\r?\n/,1)[0];let quote=false,counts={',':0,';':0,'\t':0};
 for(let i=0;i<first.length;i++){const c=first[i];if(c==='"'){if(quote&&first[i+1]==='"')i++;else quote=!quote;}else if(!quote&&c in counts)counts[c]++;}
 const delimiter=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
 let rows=[],row=[],field='',quoted=false,closed=false;
 const cell=()=>{if(field.length>1000)fail('A cell exceeds 1,000 characters');row.push(field);field='';closed=false;};
 const line=()=>{cell();if(row.some(c=>c.trim()))rows.push(row);row=[];if(rows.length>MAX_ROWS+1)fail('Import at most 5,000 customers at a time');};
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
  else if(c===delimiter)cell();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;line();}
  else if(c==='"'){if(field||closed)fail('Invalid CSV quoting');quoted=true;}
  else{if(closed&&!/\s/.test(c))fail('Invalid text after a quoted field');if(!closed)field+=c;}}
 if(quoted)fail('The CSV has an unclosed quote');line();
 if(rows.length<2)fail('Include a header and at least one customer');
 const headers=rows.shift().map(norm);if(new Set(headers).size!==headers.length)fail('Duplicate column headings');
 if(headers.some(h=>/password|secret|token|api.?key|auth.?key/.test(h)))fail('Remove password, secret and credential columns before uploading');
 const columns={};for(const [field,names]of Object.entries(fields)){const matches=headers.map((h,i)=>names.includes(h)?i:-1).filter(i=>i>=0);if(matches.length>1)fail('More than one column maps to '+field);if(matches.length)columns[field]=matches[0];}
 if(columns.username===undefined)fail('Include a Username column');
 if(columns.package===undefined)fail('Include a Package column');
 return {headers,columns,rows};
}
function amount(text){if(!text)return null;const clean=text.replace(/^(?:KES|KSH)\s*:?\s*/i,'').replace(/,/g,'').trim();if(!/^-?\d+(?:\.\d{1,2})?$/.test(clean))return null;const n=Math.round(Number(clean)*100);return Number.isSafeInteger(n)?n:null;}
function expiry(text){if(!text||/^(no expiry|never|unlimited|none|—|-)$/i.test(text))return null;
 if(!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text))return null;
 const date=text.slice(0,10),check=new Date(date+'T00:00:00Z');if(!Number.isFinite(+check)||check.toISOString().slice(0,10)!==date)return null;
 const full=text.length===10?text+'T23:59:59+03:00':text.replace(' ','T')+(/(?:Z|[+-]\d{2}:\d{2})$/.test(text)?'':'+03:00');const n=Date.parse(full);return Number.isFinite(n)?n:null;
}
const same=(a,b)=>Object.keys(b).every(k=>JSON.stringify(a[k])===JSON.stringify(b[k]));
function planImport(store,input){
 if(!['pppoe','hotspot'].includes(input.service))fail('Choose PPPoE or Hotspot for this export');
 const {columns,headers,rows}=parse(input.csv),saved=snapshot(store),items=[],seenUsers=new Set(),seenIds=new Set(),seenTargets=new Set(),errors=[],warnings=[];
 const subscribers=store.list('subscribers');let creates=0,updates=0,unchanged=0;
 for(const [index,row]of rows.entries()){
  const line=index+2;const serviceCol=headers.findIndex(h=>['service','connection type'].includes(h));if(serviceCol>=0&&row[serviceCol]?.trim()&&norm(row[serviceCol]).replace(/[^a-z]/g,'')!==input.service){errors.push({line,message:'Service in this row does not match the chosen export service'});continue;}if(row.length!==headers.length){errors.push({line,message:'Column count does not match the header'});continue;}
  const data={service:input.service};for(const [key,col]of Object.entries(columns))data[key]=row[col].trim();
  for(const key of Object.keys(fields))data[key]??='';
  if(!data.username||!data.package){errors.push({line,message:'Username and Package must be filled in'});continue;}
  const userKey=data.service+':'+norm(data.username),externalKey=data.externalId?data.service+':'+norm(data.externalId):'';
  if(seenUsers.has(userKey)||(externalKey&&seenIds.has(externalKey))){errors.push({line,message:'Duplicate customer in this file'});continue;}
  seenUsers.add(userKey);if(externalKey)seenIds.add(externalKey);
  const byId=externalKey?saved.items.filter(x=>x.service===data.service&&norm(x.externalId)===norm(data.externalId)):[];
  const byUser=saved.items.filter(x=>x.service===data.service&&norm(x.username)===norm(data.username));
  const candidates=[...new Map([...byId,...byUser].map(x=>[x.id,x])).values()];
  if(candidates.length>1||(byUser.length&&data.externalId&&byUser[0].externalId&&norm(byUser[0].externalId)!==norm(data.externalId))){errors.push({line,message:'Customer identifiers conflict with an earlier import'});continue;}
  const existing=candidates[0];if(existing&&seenTargets.has(existing.id)){errors.push({line,message:'More than one row targets the same imported customer'});continue;}if(existing)seenTargets.add(existing.id);if(existing)for(const key of Object.keys(fields))if(columns[key]===undefined)data[key]=existing[key]||'';if(existing&&!data.externalId)data.externalId=existing.externalId;
  data.balanceMinor=amount(data.balanceText);data.expiresAt=expiry(data.expiryText);
  if(data.balanceText&&data.balanceMinor===null)warnings.push({line,message:'Balance kept as source text; it is not a single numeric amount'});
  if(data.expiryText&&data.expiresAt===null&&!/^(no expiry|never|unlimited|none|—|-)$/i.test(data.expiryText))warnings.push({line,message:'Expiry kept as source text; date format was not inferred'});
  // Matching is informational. No subscriber, password, ledger or router is ever written here.
  const matches=subscribers.filter(s=>s.service===data.service&&norm(s.username)===norm(data.username));
  const match=matches.length===1?{id:matches[0].id,name:matches[0].name}:null;
  const action=!existing?'create':same(existing,data)?'unchanged':'update';if(action==='create')creates++;else if(action==='update')updates++;else unchanged++;
  items.push({line,action,data,existing,match,ambiguousMatch:matches.length>1});
 }
 if(saved.items.length+creates>MAX_ROWS)fail('The overview supports at most 5,000 saved customers');
 const digest=crypto.createHash('sha256').update(input.service+'\0'+input.csv+'\0'+saved.revision).digest('hex');
 return {saved,items,summary:{revision:saved.revision,digest,total:rows.length,creates,updates,unchanged,errors,warnings,rows:items.map(x=>({line:x.line,action:x.action,...x.data,match:x.match,ambiguousMatch:x.ambiguousMatch}))}};
}
function preview(store,input){return planImport(store,input).summary;}
function commit(store,input,user,now=Date.now()){
 return store.transaction(()=>{
  const plan=planImport(store,input),s=plan.summary;
  if(input.revision!==s.revision||input.digest!==s.digest)fail('The preview changed. Preview the file again before importing',409);
  if(s.errors.length)fail('Fix the preview errors before importing');
  const map=new Map(plan.saved.items.map(x=>[x.id,x]));for(const row of plan.items){const ex=row.existing,id=ex?.id||crypto.randomUUID();map.set(id,{...ex,...row.data,id,firstImportedAt:ex?.firstImportedAt||now,lastImportedAt:now});}
  const lastImport={at:now,service:input.service,total:s.total,creates:s.creates,updates:s.updates,unchanged:s.unchanged,warnings:s.warnings.length};
  store.setting(KEY,{revision:s.revision+1,items:[...map.values()],lastImport});
  store.audit(user,`Imported ISPman overview: ${s.creates} new, ${s.updates} updated, ${s.unchanged} unchanged`,'ispman');
  return {committed:true,...lastImport};
 });
}
function overview(store,query={}){
 const saved=snapshot(store),q=norm(query.q),service=['pppoe','hotspot'].includes(query.service)?query.service:'';
 const items=saved.items.filter(x=>(!service||x.service===service)&&(!q||[x.username,x.name,x.phone,x.email,x.package,x.externalId].some(v=>norm(v).includes(q)))).sort((a,b)=>a.username.localeCompare(b.username));
 const page=Math.max(1,Math.min(Math.ceil(items.length/50)||1,Number.parseInt(query.page,10)||1));
 const subs=store.list('subscribers'),counts={pppoe:saved.items.filter(x=>x.service==='pppoe').length,hotspot:saved.items.filter(x=>x.service==='hotspot').length};
 return {revision:saved.revision,lastImport:saved.lastImport,counts,total:items.length,page,pages:Math.ceil(items.length/50)||1,items:items.slice((page-1)*50,page*50).map(x=>{const matches=subs.filter(s=>s.service===x.service&&norm(s.username)===norm(x.username));return {...x,match:matches.length===1?{id:matches[0].id,name:matches[0].name}:null,ambiguousMatch:matches.length>1};})};
}
module.exports={preview,commit,overview,MAX_BYTES};
