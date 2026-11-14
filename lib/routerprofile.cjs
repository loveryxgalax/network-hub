'use strict';
// Everything one MikroTik's page needs, in one read-only call: device facts, health checks, backups, WireGuard
// address, per-router portal settings, hotspot servers and who is connected through it right now.
const portal=require('./portal.cjs'),pppoepool=require('./pppoepool.cjs'),radius=require('./radius.cjs');
const low=v=>String(v||'').toLowerCase();
function profile(store,id,now=Date.now()){
 const r=store.get('devices',id);if(!r||r.type!=='router'){const e=new Error('Router not found');e.status=404;throw e;}
 const hs=require('./hotspot.cjs'),m=r.metrics||{},peer=store.list('wgPeers').find(p=>p.routerId===r.id&&p.kind==='router')||null;
 const audit=require('./audit-routers.cjs').audit(store,now).find(x=>x.id===r.id||x.routerId===r.id)||null;
 const bk=(require('./backups.cjs').overview(store).find(x=>x.id===r.id)||{items:[]}).items;
 const names=new Set([r.name,m.identity].filter(Boolean).map(low));
 const active=svc=>{const out=[];for(let p=1;p<=6;p++){const q=new URLSearchParams({service:svc,page:String(p)}),res=hs.sessions(store,q,now);for(const x of res.items)if(names.has(low(x.router)))out.push({username:x.username,name:x.customer?.name||'',ip:x.ip,mac:x.mac,since:x.startedAt,down:x.downloadBytes,up:x.uploadBytes,server:x.server||''});if(p>=res.pages)break;}return out;};
 const free=radius.settings(store).freeMode,pp=pppoepool.settings(store),hp=pppoepool.overview?pppoepool.overview(store):null;
 const total=Number(m.memoryTotal)||0,freeMem=Number(m.memoryFree)||0;
 return {id:r.id,name:r.name,status:r.status,lastSeen:r.lastSeen||null,location:r.location||'',ip:r.ip||'',
  info:{identity:m.identity||r.name,model:m.model||r.model||'',version:m.version||'',architecture:m.architecture||'',uptime:m.uptime||'',cpu:m.cpu??null,
   memoryTotalMb:total?Math.round(total/1048576):null,memoryFreeMb:total?Math.round(freeMem/1048576):null,memoryUsedPct:total?Math.round((total-freeMem)/total*100):null,
   cpuCount:m.cpuCount??null,cpuFrequency:m.cpuFrequency??null,freeHdd:m.freeHdd??null,totalHdd:m.totalHdd??null,serial:r.serial||'',interfaces:(m.interfaces||[]).length,
   wans:(m.routes||[]).map(x=>({gateway:x.gateway,distance:x.distance,active:!!x.active}))},
  wg:peer?{address:peer.address,enabled:peer.enabled!==false}:null,
  credentials:{agent:!!store.secret('agent:'+r.id),jobs:!!store.secret('jobs:'+r.id)},
  portal:portal.routerPortal(store,r.id),
  freeMode:{enabled:!!(free&&free.enabled&&now<free.until)},
  pppoe:{enabled:!!pp.enabled,network:pp.network||'',next:pp.next||''},
  audit:audit?{checks:audit.checks||[],ok:(audit.checks||[]).every(c=>c.ok)}:null,
  backups:bk.slice(0,5),backupCount:bk.length,
  servers:hs.servers(store,now).items.filter(x=>x.routerId===r.id),
  hotspotActive:active('hotspot'),pppoeActive:active('pppoe')};
}
module.exports={profile};
