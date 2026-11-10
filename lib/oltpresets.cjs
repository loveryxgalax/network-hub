'use strict';
// Read-only SNMP mappings for the ONU table of common OLT brands, and a finder for brands without one.
// Monitoring only: netops reads the ONU list, state and optical power. It never writes to an OLT.
//
// verified:true  = taken from the vendor's published MIB for that OLT family.
// verified:false = commonly used on that family but differs between firmware; netops tests it against your OLT first and
//                  falls back to the automatic finder, which looks for a column of GPON serials / EPON MACs itself.
const gpon=require('./gpon.cjs');
const PRESETS={
 huawei:{brand:'Huawei',family:'MA5600T / MA5608T / MA5683T / MA5800 (GPON)',enterprise:2011,verified:true,
  mapping:{serialOid:'1.3.6.1.4.1.2011.6.128.1.1.2.43.1.3',statusOid:'1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15',nameOid:'1.3.6.1.4.1.2011.6.128.1.1.2.43.1.9',
   rxPowerOid:'1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4',onlineValues:[1],powerScale:0.01,powerOffset:0,serialEncoding:'hex'},
  notes:'ONT run state 1 = online, 2 = offline. Optical power is in 0.01 dBm.'},
 zte:{brand:'ZTE',family:'C300 / C320 / C600 (GPON)',enterprise:3902,verified:true,
  mapping:{serialOid:'1.3.6.1.4.1.3902.1012.3.28.1.1.5',statusOid:'1.3.6.1.4.1.3902.1012.3.28.2.1.4',nameOid:'1.3.6.1.4.1.3902.1012.3.28.1.1.2',onlineValues:[4],powerScale:1,powerOffset:0,serialEncoding:'hex'},
  notes:'ONU phase state 4 = working (online); 1 logging, 2 LOS, 3 syncMib, 5 dying gasp, 6 auth failed, 7 offline. Optical power is on a separately indexed table and is not read.'},
 vsol:{brand:'V-SOL',family:'V1600 series (GPON / EPON)',enterprise:37950,verified:false,mapping:null,notes:'Use “Find the ONU table”: V-SOL tables differ between V1600D, G and GM firmware.'},
 cdata:{brand:'C-Data',family:'FD11xx / FD15xx / FD16xx',enterprise:17409,verified:false,mapping:null,notes:'Use “Find the ONU table”: C-Data tables differ between EPON and GPON models.'},
 fiberhome:{brand:'FiberHome',family:'AN5516 / AN6000',enterprise:5875,verified:false,mapping:null,notes:'Use “Find the ONU table”.'},
 bdcom:{brand:'BDCOM',family:'P3310 / P3608 / GP3600 (EPON / GPON)',enterprise:3320,verified:false,mapping:null,notes:'Use “Find the ONU table”.'},
};
const ENTERPRISE=Object.fromEntries(Object.entries(PRESETS).map(([k,p])=>[p.enterprise,k]));
function list(){return Object.entries(PRESETS).map(([id,p])=>({id,brand:p.brand,family:p.family,verified:p.verified,hasMapping:!!p.mapping,notes:p.notes}));}
function presetFromSysObjectId(oid){const m=String(oid||'').replace(/^\./,'').match(/^1\.3\.6\.1\.4\.1\.(\d+)/);return m?ENTERPRISE[m[1]]||null:null;}

// What an ONU identifier looks like in an SNMP value: 8 bytes whose first 4 are a vendor ID (GPON), 6 bytes (EPON MAC),
// or text in either form.
function ident(value){
 if(Buffer.isBuffer(value)){if(value.length===8){const g=gpon.canon(value.toString('hex'));if(g)return {kind:'gpon',serial:g.serial,encoding:'hex'};}
  if(value.length===6&&value.some(b=>b<0x20||b>0x7e))return {kind:'epon',serial:value.toString('hex').match(/../g).join(':').toUpperCase(),encoding:'hex'};
  value=value.toString('latin1');}
 const s=String(value??'').trim();const g=gpon.canon(s);if(g)return {kind:'gpon',serial:g.serial,encoding:'utf8'};
 if(/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s))return {kind:'epon',serial:s.toUpperCase(),encoding:'utf8'};
 return null;}
const smallInt=v=>{const n=typeof v==='number'?v:Buffer.isBuffer(v)?NaN:Number(v);return Number.isInteger(n)&&n>=0&&n<=32?n:null;};
const printable=v=>{const s=Buffer.isBuffer(v)?v.toString('utf8'):typeof v==='string'?v:'';return s&&/^[\x20-\x7e]{1,64}$/.test(s)?s:null;};

// Finds the ONU table in a walk of the OLT's enterprise subtree: [{oid,value}] → suggested serial column, the sibling
// columns that look like a state (few small integers) with their value counts, and a name column. A person confirms
// which state value means online; nothing is guessed silently.
// A table column OID ends in <entry 1>.<column number>.
const entryCol=col=>{const p=col.split('.');return p.at(-2)==='1'&&Number(p.at(-1))<200?1:0;};
function analyse(varbinds){
 const cols=new Map();
 for(const {oid,value} of varbinds){const id=ident(value);if(!id)continue;const parts=String(oid).replace(/^\./,'').split('.');
  for(let k=1;k<=4&&k<parts.length-6;k++){const col=parts.slice(0,-k).join('.'),idx=parts.slice(-k).join('.'),c=cols.get(col)||{col,k,rows:new Map(),kinds:new Set(),enc:new Set()};c.rows.set(idx,id.serial);c.kinds.add(id.kind);c.enc.add(id.encoding);cols.set(col,c);}}
 // The real column is the shortest prefix that still holds every row once (one index per ONU).
 const candidates=[...cols.values()].filter(c=>c.rows.size>=1&&new Set(c.rows.values()).size===c.rows.size)
  .sort((a,b)=>entryCol(b.col)-entryCol(a.col)||b.rows.size-a.rows.size||a.k-b.k).filter((c,i,arr)=>!arr.slice(0,i).some(o=>o.rows.size===c.rows.size&&c.col.startsWith(o.col+'.')));
 const best=candidates[0];if(!best)return {found:false,candidates:[]};
 const table=best.col.split('.').slice(0,-1).join('.'),indexes=new Set(best.rows.keys()),siblings=new Map();
 for(const {oid,value} of varbinds){const o=String(oid).replace(/^\./,'');if(!o.startsWith(table+'.')||o.startsWith(best.col+'.'))continue;const parts=o.split('.'),idx=parts.slice(-best.k).join('.'),col=parts.slice(0,-best.k).join('.');
  if(!indexes.has(idx)||col.split('.').length!==best.col.split('.').length)continue;const s=siblings.get(col)||{col,ints:new Map(),text:0,n:0};s.n++;const n=smallInt(value);if(n!==null)s.ints.set(n,(s.ints.get(n)||0)+1);else if(printable(value))s.text++;siblings.set(col,s);}
 const sib=[...siblings.values()];
 const states=sib.filter(s=>s.ints.size>=1&&s.ints.size<=8&&[...s.ints.values()].reduce((a,b)=>a+b,0)===s.n&&s.n>=indexes.size*0.9).map(s=>({oid:s.col,values:Object.fromEntries([...s.ints].sort((a,b)=>a[0]-b[0]))}));
 const names=sib.filter(s=>s.text>=indexes.size*0.9).map(s=>s.col);
 return {found:true,serialOid:best.col,kind:[...best.kinds][0],serialEncoding:best.enc.has('hex')?'hex':'utf8',onus:best.rows.size,sample:[...best.rows.values()].slice(0,5),states,nameOid:names[0]||null,
  others:candidates.slice(1,4).map(c=>({oid:c.col,onus:c.rows.size}))};}
module.exports={PRESETS,list,presetFromSysObjectId,analyse,ident};
