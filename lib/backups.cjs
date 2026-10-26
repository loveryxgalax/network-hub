'use strict';
// Nightly router configuration backups: the discovery script sends `/export compact hide-sensitive` once a night.
// Stored as text, newest 21 per router, with a plain line diff against the previous one.
const crypto=require('node:crypto');
const MAX_TEXT=262144,KEEP=21;
const fail=m=>{throw Object.assign(new Error(m),{status:400});};
const clean=t=>String(t).split(/\r?\n/).filter(l=>!/^#\s*(\d{4}-\d{2}-\d{2}|[a-z]{3}\/\d{1,2}\/\d{4})/i.test(l)).join('\n').trim();
const hash=t=>crypto.createHash('sha256').update(clean(t)).digest('hex');
const SCRIPT=`
   :local backup [:toarray ""];
   :global nhbackup;
   :do { :local nowt [/system clock get time];
    :if ((($nowt >= 03:00:00) && ($nowt < 03:03:00)) || ($nhbackup = true)) do={
     /export compact hide-sensitive file="netops-backup";
     :delay 2s;
     :local txt [/file get "netops-backup.rsc" contents];
     :set backup {"name"=[/system identity get name];"text"=$txt;"size"=[:len $txt]};
     /file remove "netops-backup.rsc";
     :set nhbackup false;
    } } on-error={ :do { /file remove "netops-backup.rsc"; } on-error={} }`;
function normalize(input){
 if(input===undefined||input===null||typeof input!=='object'||Array.isArray(input)||input.text===undefined)return null;
 const text=typeof input.text==='string'?input.text.replace(/\u0000/g,''):fail('Invalid backup text');if(!text.trim()||text.length>MAX_TEXT)fail('Invalid backup size');
 if(!/^\s*#|\/[a-z]/.test(text.slice(0,2000)))fail('That does not look like a RouterOS export');
 return {name:String(input.name||'').slice(0,80),text};
}
function ingest(store,router,backup,now=Date.now()){
 if(!backup)return null;const key='routerBackups:'+router.id,doc=store.setting(key)||{items:[]},h=hash(backup.text),last=doc.items[0];
 if(last&&last.hash===h){doc.items[0]={...last,checked:now};store.setting(key,doc);return {changed:false};}
 const entry={id:crypto.randomBytes(6).toString('hex'),time:now,checked:now,hash:h,size:backup.text.length,text:backup.text,diff:last?diff(last.text,backup.text):null};
 doc.items=[entry,...doc.items].slice(0,KEEP);store.setting(key,doc);
 if(last){const open=store.list('alerts').find(a=>a.deviceId===router.id&&a.source==='router-health'&&a.logKey==='config-changed'&&a.status!=='Resolved'),d=entry.diff,details=`${d.added.length} line${d.added.length===1?'':'s'} added, ${d.removed.length} removed since the previous backup. Open Config backups to see what changed.`;
  if(open)store.put('alerts',{...open,details},open);else store.put('alerts',{title:router.name+' configuration changed',details,deviceId:router.id,severity:'info',status:'Open',source:'router-health',logKey:'config-changed'});}
 return {changed:true};
}
function diff(a,b){const A=clean(a).split('\n'),B=clean(b).split('\n'),sa=new Set(A),sb=new Set(B);return {added:B.filter(l=>!sa.has(l)).slice(0,300),removed:A.filter(l=>!sb.has(l)).slice(0,300)};}
function overview(store){return store.list('devices').filter(d=>d.type==='router').map(r=>{const doc=store.setting('routerBackups:'+r.id)||{items:[]};return {id:r.id,name:r.name,items:doc.items.map(i=>({id:i.id,time:i.time,checked:i.checked,size:i.size,added:i.diff?.added.length??null,removed:i.diff?.removed.length??null}))};});}
function get(store,routerId,id){const doc=store.setting('routerBackups:'+routerId)||{items:[]};return doc.items.find(i=>i.id===id)||null;}
module.exports={SCRIPT,normalize,ingest,overview,get,diff,clean};
