'use strict';
// One search box for the whole workspace: customers, live sessions, routers and devices, ONUs, payments, vouchers, packages,
// tickets, work orders, alerts, invoices, onboarding leads, stock and sites. Matching runs in SQLite first (LIKE on the stored
// record) and is then confirmed on a fixed list of visible fields, so passwords and secrets inside a record can never be
// searched for. Phone numbers match in any form (07…, 2547…, +254 7…).
const esc=s=>s.replace(/[\\%_]/g,m=>'\\'+m);
const digits=s=>String(s||'').replace(/\D/g,'');
const tail=s=>{const d=digits(s);return d.length>=9?d.slice(-9):'';};
const macHex=s=>String(s||'').toLowerCase().replace(/[^0-9a-f]/g,'');
const pick=(r,...k)=>k.map(x=>r[x]).find(v=>v!==undefined&&v!==null&&v!=='');
const money=n=>'KSh '+Number(n||0).toLocaleString('en-KE');
const day=t=>t?new Date(t+3*36e5).toISOString().slice(0,10):'';

// kind → which fields may match, how a hit is titled, and where it opens.
const KINDS={
 subscribers:{label:'Customers',fields:['name','username','phone','email','account','accountNumber','address','location','mac','macAddress','ip','staticIp','idNumber','notes'],
  title:r=>r.name||r.username,sub:r=>[r.username,r.service==='pppoe'?'PPPoE':r.service==='hotspot'?'Hotspot':r.service==='static'?'Static IP':r.service,r.phone].filter(Boolean).join(' · '),go:r=>({hash:'customer?id='+r.id})},
 radiusSessions:{label:'Live sessions',live:true,fields:['username','ip','mac','nasName'],
  title:r=>r.username,sub:r=>[r.ip,r.mac,r.nasName].filter(Boolean).join(' · '),go:(r,store)=>{const s=store.subscriberByUsername(r.username);return s?{hash:'customer?id='+s.id}:{hash:r.service==='pppoe'?'pp-sessions':'hs-sessions'};}},
 devices:{label:'Routers & devices',fields:['name','serial','macAddress','mac','ip','model','vendor','customer','location','identity','firmware','equipmentSerial','gponSerial'],
  title:r=>r.name||r.serial,sub:r=>[r.type==='onu'?'ONU':r.type==='olt'?'OLT':r.type==='cpe'?'Customer router':r.type==='router'?'Router':r.type,r.vendor,r.model,r.serial,r.ip].filter(Boolean).join(' · '),
  go:r=>r.type==='router'&&(r.driver==='routeros'||/mikrotik/i.test(r.vendor||'')||r.wgPeerId)?{hash:'router-profile?id='+r.id}:r.type==='cpe'&&r.subscriberId?{hash:'customer?id='+r.subscriberId}:{open:'devices',id:r.id}},
 subscriberPayments:{label:'Payments',money:true,fields:['reference','phone','name','username','method','note'],
  title:r=>`${money(r.amount)} · ${r.name||r.username||''}`,sub:r=>[r.reference,r.method,day(r.created)].filter(Boolean).join(' · '),go:r=>r.subscriberId?{hash:'customer?id='+r.subscriberId}:{hash:'pay-reports'}},
 portalPayments:{label:'Portal payments',money:true,fields:['reference','receipt','mpesaReceipt','phone','checkoutId','accountReference'],
  title:r=>`${money(r.amount)} · ${r.phone||''}`,sub:r=>[pick(r,'receipt','mpesaReceipt','reference'),r.status,day(r.created)].filter(Boolean).join(' · '),go:()=>({hash:'pay-reports'})},
 payments:{label:'Billing payments',money:true,fields:['reference','customer','method','note'],title:r=>`${money(r.amount)} · ${r.customer||''}`,sub:r=>[r.reference,day(r.created)].filter(Boolean).join(' · '),go:r=>({open:'payments',id:r.id})},
 invoices:{label:'Invoices',money:true,fields:['number','reference','customer','status'],title:r=>r.number||r.reference||'Invoice',sub:r=>[r.customer,r.status,r.amount!=null?money(r.amount):''].filter(Boolean).join(' · '),go:r=>({open:'invoices',id:r.id})},
 vouchers:{label:'Vouchers',fields:['code','assignedName','assignedPhone','usedBy','mac'],title:r=>r.code,sub:r=>[r.status,r.assignedName,r.assignedPhone].filter(Boolean).join(' · '),go:()=>({hash:'hs-vouchers'})},
 plans:{label:'Packages',fields:['name','description'],title:r=>r.name,sub:r=>[r.service==='pppoe'?'PPPoE':r.service==='hotspot'?'Hotspot':r.service,r.price!=null?money(r.price):'',r.downloadMbps?r.downloadMbps+' Mbps':''].filter(Boolean).join(' · '),go:r=>({hash:r.service==='pppoe'?'pp-packages':'hs-packages'})},
 tickets:{label:'Support tickets',fields:['title','reference','customer','phone','details','category'],title:r=>r.title,sub:r=>[r.reference,r.status,r.priority].filter(Boolean).join(' · '),go:r=>({open:'tickets',id:r.id})},
 jobs:{label:'Work orders',installer:true,fields:['title','reference','customer','phone','address','details','type'],title:r=>r.title,sub:r=>[r.type,r.status,r.due].filter(Boolean).join(' · '),go:r=>({open:'jobs',id:r.id})},
 alerts:{label:'Alerts',fields:['title','details','source'],title:r=>r.title,sub:r=>[r.severity,r.status,day(r.created)].filter(Boolean).join(' · '),go:()=>({hash:'notifications'})},
 onboarding:{label:'Onboarding',fields:['name','phone','location','notes','stage'],title:r=>r.name||r.phone,sub:r=>[r.stage,r.phone,r.location].filter(Boolean).join(' · '),go:()=>({hash:'ops-onboarding'})},
 stock:{label:'Stock',installer:true,fields:['name','sku','serial','category','location'],title:r=>r.name,sub:r=>[r.category,r.serial,r.quantity!=null?'Qty '+r.quantity:''].filter(Boolean).join(' · '),go:r=>({open:'stock',id:r.id})},
 sites:{label:'Sites',fields:['name','location','address','notes'],title:r=>r.name,sub:r=>r.location||r.address||'',go:()=>({hash:'sites'})},
 zones:{label:'Zones',fields:['name','notes'],title:r=>r.name,sub:()=>'',go:r=>({open:'zones',id:r.id})},
 odbs:{label:'ODBs',fields:['name','location','notes'],title:r=>r.name,sub:r=>r.location||'',go:r=>({open:'odbs',id:r.id})},
 closures:{label:'Closures',fields:['name','location','notes'],title:r=>r.name,sub:r=>r.location||'',go:r=>({open:'closures',id:r.id})},
 cables:{label:'Cables',fields:['name','notes'],title:r=>r.name,sub:()=>'',go:r=>({open:'cables',id:r.id})},
};
const MONEY_ROLES=new Set(['admin','manager','operator']);

function search(store,q,user,{limit=8,now=Date.now()}={}){
 q=String(q||'').trim().slice(0,80);if(q.length<2)return {q,groups:[],total:0};
 const role=user?.role||'support',ql=q.toLowerCase(),qt=tail(q),qm=macHex(q),isMac=qm.length>=4&&/^[0-9a-f:.\-]+$/i.test(q)&&/[:.\-]/.test(q);
 let scope=null;try{scope=require('./access.cjs').scope(store,user);}catch{}
 const like='%'+esc(ql)+'%',likes=[like];
 if(qt)likes.push('%'+esc(qt)+'%');                      // phone typed as 07… finds 2547… and back
 if(isMac)likes.push('%'+qm.match(/../g)?.join('%')+'%');  // AA-BB-CC finds aa:bb:cc
 const hit=(r,fields)=>fields.some(f=>{const v=r[f];if(v==null||typeof v==='object')return false;const s=String(v).toLowerCase();
  if(s.includes(ql))return true;if(qt&&tail(s)===qt)return true;if(isMac&&macHex(s).includes(qm))return true;return false;});
 const groups=[];let total=0;
 for(const [kind,k] of Object.entries(KINDS)){
  if(role==='installer'&&!k.installer&&kind!=='devices')continue;
  if(k.money&&!MONEY_ROLES.has(role))continue;
  const where=likes.map(()=>'lower(body) LIKE ? ESCAPE \'\\\'').join(' OR ');
  const extra=k.live?" AND json_extract(body,'$.stoppedAt') IS NULL AND updated>="+(now-15*60000):'';
  const rows=store.db.prepare(`SELECT * FROM records WHERE kind=?${extra} AND (${where}) ORDER BY updated DESC LIMIT 400`).all(kind,...likes).map(r=>store.unpack(r));
  const items=[];let count=0;
  for(const r of rows){if(!hit(r,k.fields))continue;
   if(scope&&kind==='devices'&&r.type==='router'&&!scope.has(r.id))continue;
   if(scope&&kind==='subscribers'&&r.routerId&&!scope.has(r.routerId))continue;
   count++;if(items.length<limit)items.push({id:r.id,title:String(k.title(r)||'').slice(0,120),sub:String(k.sub(r)||'').slice(0,160),...k.go(r,store),
    rank:String(k.title(r)||'').toLowerCase()===ql?0:String(k.title(r)||'').toLowerCase().startsWith(ql)?1:2});}
  if(!count)continue;items.sort((a,b)=>a.rank-b.rank);for(const i of items)delete i.rank;
  groups.push({kind,label:k.label,count,items});total+=count;}
 return {q,groups,total};
}
module.exports={search,KINDS};
