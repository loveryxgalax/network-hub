'use strict';
// HOTSPOT section views (ISPman parity): filterable, paginated logs kept for 7 days, live sessions, per-session
// accounting, hotspot servers per router and the manual-connect / expiry-change audit. Read-only towards the routers.
const DAY=864e5,KEEP=7*DAY,PER=50,LIVE=30*60000;
const KINDS=['auth','acct','request'];
const low=v=>String(v??'').toLowerCase();
const macOf=v=>{const m=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');return m.length===12?m.match(/.{2}/g).join(':'):String(v||'').toUpperCase().slice(0,40);};
function ensure(store){
 if(store._hslog)return;
 store.db.exec(`CREATE TABLE IF NOT EXISTS hslog(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,time INTEGER NOT NULL,service TEXT NOT NULL DEFAULT '',username TEXT NOT NULL DEFAULT '',mac TEXT NOT NULL DEFAULT '',ip TEXT NOT NULL DEFAULT '',body TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS hslog_kind_time ON hslog(kind,time);`);
 store._hslog=true;
 // First run after the upgrade: carry over the recent auth and accounting entries kept in the old settings blobs.
 if(!store.db.prepare('SELECT 1 FROM hslog LIMIT 1').get()&&!store.setting('hslogBackfilled')){const since=Date.now()-KEEP,ins=store.db.prepare('INSERT INTO hslog(kind,time,service,username,mac,ip,body) VALUES(?,?,?,?,?,?,?)');
  for(const [kind,key] of [['auth','radiusAuthLog'],['acct','radiusAcctLog']])for(const e of (store.setting(key)?.items||[]).slice().reverse())if(e&&e.time>=since){const u=kind==='auth'?String(e.username||'').split('@')[0]:e.username;ins.run(kind,e.time,String(e.service||''),low(u).slice(0,80),macOf(e.mac),String(e.ip||'').slice(0,45),JSON.stringify({...e,username:u}));}
  store.setting('hslogBackfilled',{at:Date.now()});}
}
let writes=0;
function add(store,kind,entry,now=Date.now()){
 if(!KINDS.includes(kind))throw new Error('Unknown log kind');ensure(store);
 const e={...entry,time:entry.time||now};
 store.db.prepare('INSERT INTO hslog(kind,time,service,username,mac,ip,body) VALUES(?,?,?,?,?,?,?)').run(kind,e.time,String(e.service||''),low(e.username).slice(0,80),macOf(e.mac),String(e.ip||'').slice(0,45),JSON.stringify(e));
 if(++writes%500===0)prune(store,now);
}
function prune(store,now=Date.now()){ensure(store);store.db.prepare('DELETE FROM hslog WHERE time<?').run(now-KEEP);}
// Customer lookup: subscribers by username and by every MAC they used.
function people(store){
 const byUser=new Map(),byMac=new Map();
 for(const s of store.list('subscribers')){const c={id:s.id,name:s.name,phone:s.phone||'',username:s.username,service:s.service};byUser.set(low(s.username),c);for(const m of [s.boundMac,s.lastMac])if(m)byMac.set(macOf(m),c);}
 return {byUser,byMac,find:(u,m)=>byUser.get(low(u).split('@')[0])||(m&&byMac.get(macOf(m)))||null};
}
function customerMatch(store,q){
 q=low(q).trim();if(!q)return null;const users=[],macs=[];
 for(const s of store.list('subscribers'))if([s.name,s.phone,s.username,s.email].some(v=>low(v).includes(q))){users.push(low(s.username));for(const m of [s.boundMac,s.lastMac])if(m)macs.push(macOf(m));}
 return {users,macs,q};
}
function page(params){return Math.max(1,Math.floor(Number(params.get('page'))||1));}
function range(params,now){const f=Date.parse(params.get('from')||''),t=Date.parse(params.get('to')||'');return {from:Number.isFinite(f)?Math.max(f,now-KEEP):now-KEEP,to:Number.isFinite(t)?t+DAY:now+60000};}
// Auth, accounting-event and connect-request logs.
function query(store,kind,params=new URLSearchParams(),now=Date.now()){
 if(!KINDS.includes(kind))throw Object.assign(new Error('Not found'),{status:404});ensure(store);
 const where=['kind=?','time>=?','time<?'],args=[kind],{from,to}=range(params,now);args.push(from,to);
 const svc=params.get('service');if(svc&&['hotspot','pppoe'].includes(svc)){where.push('service=?');args.push(svc);}
 for(const [k,col] of [['username','username'],['mac','mac'],['ip','ip']]){const v=params.get(k);if(v){where.push(`instr(${col},?)>0`);args.push(k==='mac'?String(v).toUpperCase().trim():k==='username'?low(v).trim():String(v).trim());}}
 const reply=params.get('reply');if(reply==='accept'||reply==='reject'){where.push("json_extract(body,'$.result')=?");args.push(reply);}
 const cm=customerMatch(store,params.get('customer'));
 if(cm){const parts=['instr(username,?)>0'],a=[cm.q];if(cm.users.length){parts.push(`username IN (${cm.users.map(()=>'?').join(',')})`);a.push(...cm.users);}if(cm.macs.length){parts.push(`mac IN (${cm.macs.map(()=>'?').join(',')})`);a.push(...cm.macs);}where.push('('+parts.join(' OR ')+')');args.push(...a);}
 const sql=' FROM hslog WHERE '+where.join(' AND ');
 const total=store.db.prepare('SELECT count(*) n'+sql).get(...args).n,pages=Math.max(1,Math.ceil(total/PER)),p=Math.min(page(params),pages);
 const pl=people(store);
 const items=store.db.prepare('SELECT id,body'+sql+' ORDER BY time DESC,id DESC LIMIT ? OFFSET ?').all(...args,PER,(p-1)*PER).map(r=>{const e=JSON.parse(r.body);return {...e,logId:r.id,customer:pl.find(e.username,e.mac)};});
 return {items,total,page:p,pages,keepDays:7};
}
function uptimeSeconds(value){const v=String(value||'');let m=/^(?:(\d+)w)?(?:(\d+)d)?(\d+):([0-5]\d):([0-5]\d)$/.exec(v);if(m)return (+m[1]||0)*604800+(+m[2]||0)*86400+(+m[3])*3600+(+m[4])*60+(+m[5]);m=/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);return m&&v?(+m[1]||0)*604800+(+m[2]||0)*86400+(+m[3]||0)*3600+(+m[4]||0)*60+(+m[5]||0):null;}
const has=(v,q)=>!q||low(v).includes(low(q).trim());
function routersById(store){return new Map(store.list('devices').filter(d=>d.type==='router').map(d=>[d.id,d]));}
// Active sessions: RADIUS sessions not stopped and updated in the last 30 minutes, plus sessions the routers report
// directly (hotspot/PPP active tables) that RADIUS does not know about, e.g. while ISPman's RADIUS still serves a router.
function sessions(store,params=new URLSearchParams(),now=Date.now()){
 const svc=params.get('service')==='pppoe'?'pppoe':'hotspot',pl=people(store),out=[],seen=new Set();
 for(const s of store.sessionsSince(now-LIVE)){if(s.stoppedAt||now-s.updatedAt>LIVE||s.service!==svc)continue;const k=low(s.username)+'|'+macOf(s.mac);seen.add(k);seen.add(low(s.username));
  out.push({source:'radius',username:s.username,ip:s.ip||'',mac:s.mac?macOf(s.mac):'',router:s.nasName||s.nas||'',startedAt:s.startedAt,updatedAt:s.updatedAt,uploadBytes:s.uploadBytes||0,downloadBytes:s.downloadBytes||0,sessionId:s.sessionId,customer:pl.find(s.username,s.mac)});}
 const src=svc==='pppoe'?'ppp':'hotspot';
 for(const r of routersById(store).values()){const rep=store.setting('customerDiscovery:'+r.id);if(!rep||now-rep.lastReport>LIVE)continue;
  for(const o of rep.observations||[]){const e=o.evidence?.[src];if(!e||e.observedAt!==rep.lastReport)continue;const u=e.name||'';if(seen.has(low(u))||seen.has(low(u)+'|'+macOf(e.mac)))continue;
   const up=uptimeSeconds(e.uptime);out.push({source:'router',username:u,ip:e.ip||'',mac:e.mac?macOf(e.mac):'',router:r.name,startedAt:up!=null?rep.lastReport-up*1000:null,updatedAt:rep.lastReport,uploadBytes:e.rx||0,downloadBytes:e.tx||0,server:e.service||'',customer:pl.find(u,e.mac)});}}
 const f={customer:params.get('customer'),username:params.get('username'),ip:params.get('ip'),mac:params.get('mac')};
 const rows=out.filter(x=>has(x.username,f.username)&&has(x.ip,f.ip)&&has(x.mac,f.mac)&&(!f.customer||has([x.customer?.name,x.customer?.phone,x.username].join(' '),f.customer))).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
 const pages=Math.max(1,Math.ceil(rows.length/PER)),p=Math.min(page(params),pages);
 return {items:rows.slice((p-1)*PER,p*PER),total:rows.length,page:p,pages,sampledAt:now};
}
// Accounting per session (Start…Stop) for the last 7 days.
function acctSessions(store,params=new URLSearchParams(),now=Date.now()){
 const svc=params.get('service')==='pppoe'?'pppoe':'hotspot',{from,to}=range(params,now),where=["kind='radiusSessions'","updated>=?","json_extract(body,'$.service')=?","COALESCE(json_extract(body,'$.startedAt'),created)<?"],args=[from,svc,to];
 for(const [k,f] of [['username','username'],['ip','ip']]){const v=params.get(k);if(v){where.push(`instr(lower(COALESCE(json_extract(body,'$.${f}'),'')),?)>0`);args.push(low(v).trim());}}
 const cm=customerMatch(store,params.get('customer'));if(cm){const parts=["instr(lower(COALESCE(json_extract(body,'$.username'),'')),?)>0"],a=[cm.q];if(cm.users.length){parts.push(`lower(json_extract(body,'$.username')) IN (${cm.users.map(()=>'?').join(',')})`);a.push(...cm.users);}where.push('('+parts.join(' OR ')+')');args.push(...a);}
 const sql=' FROM records WHERE '+where.join(' AND '),total=store.db.prepare('SELECT count(*) n'+sql).get(...args).n,pages=Math.max(1,Math.ceil(total/PER)),p=Math.min(page(params),pages),pl=people(store);
 const items=store.db.prepare('SELECT body'+sql+" ORDER BY COALESCE(json_extract(body,'$.startedAt'),created) DESC LIMIT ? OFFSET ?").all(...args,PER,(p-1)*PER).map(r=>{const s=JSON.parse(r.body);return {username:s.username,ip:s.ip||'',mac:s.mac||'',router:s.nasName||s.nas||'',sessionId:s.sessionId,startedAt:s.startedAt,stoppedAt:s.stoppedAt||null,updatedAt:s.updatedAt,uploadBytes:s.uploadBytes||0,downloadBytes:s.downloadBytes||0,cause:s.cause||'',open:!s.stoppedAt&&now-s.updatedAt<=LIVE,customer:pl.find(s.username,s.mac)};});
 return {items,total,page:p,pages,keepDays:7};
}
// Hotspot servers on each router. Exact definitions (interface, profile, enabled) come with discovery script v9;
// before that, server names are taken from the hotspot sessions each router reports.
function servers(store,now=Date.now()){
 const out=[];
 for(const r of routersById(store).values()){const rep=store.setting('customerDiscovery:'+r.id),hl=store.setting('routerHealth:'+r.id),defs=hl?.hotspots||[],ssids=hl?.ssids||[],active=new Map();
  for(const o of rep?.observations||[]){const e=o.evidence?.hotspot;if(e&&rep&&e.observedAt===rep.lastReport&&now-rep.lastReport<=300000)active.set(e.service||'',(active.get(e.service||'')||0)+1);}
  const fresh=!!rep&&now-rep.lastReport<=300000,ip=r.tunnelIp||r.ip||store.list('wgPeers').find(p=>p.routerId===r.id&&p.kind==='router')?.address||'';
  if(defs.length){for(const d of defs)out.push({routerId:r.id,router:r.name,routerIp:ip,name:d.name,interface:d.interface||'',profile:d.profile||'',addressPool:d.addressPool||'',enabled:!d.disabled,ssids:ssids.filter(s=>!s.disabled).map(s=>s.ssid).filter(Boolean),connected:active.get(d.name)||0,source:'router',fresh});}
  else{const names=new Set([...active.keys()].filter(Boolean));for(const o of rep?.observations||[]){const e=o.evidence?.hotspot;if(e?.service&&now-e.observedAt<=7*DAY)names.add(e.service);}
   for(const n of names)out.push({routerId:r.id,router:r.name,routerIp:ip,name:n,interface:'',profile:'',addressPool:'',enabled:fresh?(active.get(n)||0)>0||null:null,ssids:ssids.filter(s=>!s.disabled).map(s=>s.ssid).filter(Boolean),connected:active.get(n)||0,source:'sessions',fresh});}}
 return {items:out.sort((a,b)=>a.router.localeCompare(b.router)||a.name.localeCompare(b.name)),total:out.length,sampledAt:now};
}
// Staff changes to a customer's paid-until (manual connect, renew, edit, bulk): who, before, after.
function expiryChange(store,user,before,after,how,now=Date.now()){
 if(!before||!after||(before.expiresAt??null)===(after.expiresAt??null))return null;
 const plan=store.get('plans',after.planId);
 return store.put('expiryChanges',{subscriberId:after.id,username:after.username,name:after.name,service:after.service,planName:plan?.name||'',before:before.expiresAt??null,after:after.expiresAt??null,how:String(how||'').slice(0,80),by:user?.email||'system',time:now});
}
function manual(store,params=new URLSearchParams()){
 const has2=(v,q)=>!q||low(v).includes(low(q).trim()),t=k=>{const v=Date.parse(params.get(k)||'');return Number.isFinite(v)?v:null;};
 const cf=params.get('customer'),pf=params.get('package'),bf=params.get('by'),pFrom=t('from'),pTo=t('to');
 const inRange=(x,v)=>(pFrom==null||(v!=null&&v>=pFrom))&&(pTo==null||(v!=null&&v<pTo+DAY));
 const connects=store.list('manualConnects').filter(x=>has2([x.name,x.username].join(' '),cf)&&has2(x.planName,pf)&&has2(x.by,bf)&&inRange(x,x.after)).sort((a,b)=>b.time-a.time);
 const changes=store.list('expiryChanges').filter(x=>has2([x.name,x.username].join(' '),cf)&&has2(x.planName,pf)&&has2(x.by,bf)&&inRange(x,x.time)).sort((a,b)=>b.time-a.time);
 return {connects:connects.slice(0,500),changes:changes.slice(0,500),totals:{connects:connects.length,changes:changes.length}};
}
module.exports={KINDS,add,prune,query,sessions,acctSessions,servers,expiryChange,manual,uptimeSeconds,macOf,ensure};
