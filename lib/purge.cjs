'use strict';
// Forget a router completely (netops database only; nothing is sent to the router). Used before re-linking a test
// router from scratch. Preview first: it lists what would go. Payments and the ledger are never deleted (money
// history stays); customers assigned to the router go to Recently deleted (restorable for 90 days) only if asked.
const SETTINGS=['customerDiscovery','customerDiscoveryError','discovery','jobsPoll','onlineSeries','routerBackups','routerEvents','routerHealth','routerHealthHistory','routerPortal','siteDays','siteLive','siteRecent','siteStats','staticSettings'];
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
function names(store,r){const peer=store.list('wgPeers').find(p=>p.routerId===r.id);return new Set([r.name,r.ip,r.tunnelIp,peer?.address].filter(Boolean).map(v=>String(v).toLowerCase()));}
function plan(store,routerId,{customers=false}={}){
 const r=store.get('devices',String(routerId||''));if(!r||r.type!=='router')fail('Router not found',404);
 const nm=names(store,r),isMine=v=>nm.has(String(v||'').toLowerCase());
 const settingKeys=SETTINGS.map(k=>k+':'+r.id).filter(k=>store.db.prepare('SELECT 1 FROM settings WHERE key=?').get(k));
 const secrets=store.db.prepare('SELECT device_id FROM secrets').all().map(x=>x.device_id).filter(k=>[r.id,'agent:'+r.id,'discovery:'+r.id,'jobs:'+r.id].includes(k)||(k.startsWith('provbundle:')&&store.secret(k)?.routerId===r.id));
 const recs={customerLabels:store.list('customerLabels').filter(x=>x.routerId===r.id),routerJobs:store.list('routerJobs').filter(x=>x.routerId===r.id),wgPeers:store.list('wgPeers').filter(x=>x.routerId===r.id),alerts:store.list('alerts').filter(x=>x.deviceId===r.id)};
 const sessions=store.db.prepare("SELECT id,json_extract(body,'$.nasName') n,json_extract(body,'$.nas') ip FROM records WHERE kind='radiusSessions'").all().filter(x=>isMine(x.n)||isMine(x.ip)).map(x=>x.id);
 const measurements=store.db.prepare('SELECT count(*) n FROM measurements WHERE device_id=?').get(r.id).n;
 let hslog=0;try{hslog=store.db.prepare("SELECT body FROM hslog").all().filter(x=>{const b=JSON.parse(x.body);return isMine(b.router)||isMine(b.nas)||isMine(b.nasName)||b.routerId===r.id;}).length;}catch{}
 const plans=store.list('plans').filter(p=>(p.routerIds||[]).includes(r.id));
 const subs=store.list('subscribers').filter(s=>s.routerId===r.id);
 return {router:{id:r.id,name:r.name},settingKeys,secrets,records:Object.fromEntries(Object.entries(recs).map(([k,v])=>[k,v.map(x=>x.id)])),sessions,measurements,hslog,
  plans:plans.map(p=>({id:p.id,name:p.name})),customers:subs.map(s=>({id:s.id,name:s.name,username:s.username})),deleteCustomers:customers===true,
  summary:{settings:settingKeys.length,credentials:secrets.length,labels:recs.customerLabels.length,routerJobs:recs.routerJobs.length,wireguardPeers:recs.wgPeers.length,alerts:recs.alerts.length,radiusSessions:sessions.length,measurements,hotspotLogs:hslog,packagesLimitedToIt:plans.length,customersOnIt:subs.length}};
}
function run(store,routerId,{customers=false,confirm=''},user){
 const p=plan(store,routerId,{customers});if(String(confirm).trim()!==p.router.name)fail(`Type the router name (${p.router.name}) to confirm`);
 const r=store.get('devices',p.router.id),nm=names(store,r),isMine=v=>nm.has(String(v||'').toLowerCase());
 store.transaction(()=>{
  for(const k of p.settingKeys)store.db.prepare('DELETE FROM settings WHERE key=?').run(k);
  for(const k of p.secrets)store.db.prepare('DELETE FROM secrets WHERE device_id=?').run(k);
  for(const [kind,ids] of Object.entries(p.records))for(const id of ids)store.remove(kind,id);
  for(const id of p.sessions)store.remove('radiusSessions',id);
  store.db.prepare('DELETE FROM measurements WHERE device_id=?').run(r.id);
  try{for(const x of store.db.prepare('SELECT id,body FROM hslog').all()){const b=JSON.parse(x.body);if(isMine(b.router)||isMine(b.nas)||isMine(b.nasName)||b.routerId===r.id)store.db.prepare('DELETE FROM hslog WHERE id=?').run(x.id);}}catch{}
  for(const key of ['radiusAuthLog','radiusAcctLog','roamingLog']){const l=store.setting(key);if(l?.items)store.setting(key,{...l,items:l.items.filter(i=>!isMine(i.nas)&&!isMine(i.nasName)&&!isMine(i.from)&&!isMine(i.to))});}
  for(const pl of store.list('plans').filter(x=>(x.routerIds||[]).includes(r.id)))store.put('plans',{...pl,routerIds:pl.routerIds.filter(id=>id!==r.id)},pl);
  if(customers===true){const trash=require('./trash.cjs');for(const c of p.customers){const s=store.get('subscribers',c.id);if(s)trash.remove(store,s,user);}}
  else for(const c of p.customers){const s=store.get('subscribers',c.id);if(s)store.put('subscribers',{...s,routerId:''},s);}
  store.remove('devices',r.id);
  store.audit(user,`Forgot router ${r.name} and its data${customers?' (customers moved to Recently deleted)':''}`,r.id);
 });
 return p;
}
module.exports={plan,run};
