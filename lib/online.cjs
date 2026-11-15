'use strict';
// Who is connected right now, one rule for every page (dashboard, live view, router profile, hotspot pages, customer
// profile). Nothing here writes to the database or changes accounting records.
//
// Unit: a CONNECTION is one login session of one device (one row in a router's PPP/hotspot active table, or one RADIUS
// accounting session). One customer account can have several connections (several devices on a shared account).
//
// Evidence, merged without double counting:
//  * Router reports (customer discovery): the rows of the router's latest report, if that report is newer than STALE.
//    A router whose latest report is older is listed under `stale` and its rows are not counted.
//  * Netops RADIUS accounting: a session is active when it has no Stop, was updated within STALE (the accounting
//    policy in radius.cjs) and was not replaced by a newer session from the same device (a reconnect whose Stop never
//    arrived). Stop times are never invented: such sessions are reported as `unclosed` or `replaced`.
//  * A RADIUS session and a router row are the same connection when they are on the same router, for the same service
//    and username, and their MAC addresses match (or one side has no MAC).
const STALE=15*60000;
const low=v=>String(v??'').trim().toLowerCase();
const macOf=v=>{const h=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');return h.length===12?h.match(/../g).join(':'):'';};

// State of every accounting session in `rows` (any mix of usernames): active, stopped, unclosed (no Stop and no update
// within STALE) or replaced (no Stop, and the same device on the same router started a newer session afterwards).
function sessionStates(rows,now=Date.now()){
 const groups=new Map();for(const s of rows){const m=macOf(s.mac);if(!m)continue;const k=low(s.nas||s.nasName)+'|'+low(s.username)+'|'+m;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s);}
 const replaced=new Set();
 for(const list of groups.values()){if(list.length<2)continue;list.sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
  for(let i=0;i<list.length;i++){const s=list[i];if(s.stoppedAt)continue;
   // A newer session from this device that started after this one last reported means this one has ended.
   if(list.slice(i+1).some(n=>(n.startedAt||0)>=(s.updatedAt||s.startedAt||0)&&(n.startedAt||0)>(s.startedAt||0)))replaced.add(s);}}
 const out=new Map();for(const s of rows)out.set(s,s.stoppedAt?'stopped':replaced.has(s)?'replaced':now-(s.updatedAt||0)<STALE?'active':'unclosed');
 return out;}
const stateOf=(s,rows,now)=>sessionStates(rows||[s],now).get(s);

// Routers and how a RADIUS session's NAS maps to one (same rule as radius.routerOf: identity name or address).
function routers(store){return store.list('devices').filter(d=>d.type==='router');}
function matcher(list){const by=new Map();for(const d of list)for(const n of [d.name,d.metrics?.identity,d.ip,d.tunnelIp,d.host])if(n&&!by.has(low(n)))by.set(low(n),d);
 return s=>by.get(low(s.nasName))||by.get(low(s.nas))||null;}

function accountState(sub,now){if(!sub)return 'unmatched';if(sub.banned||sub.status!=='active')return 'deactivated';if(sub.expiresAt!=null&&sub.expiresAt<=now)return 'expired';return 'active';}

// All current connections with their evidence.
function connections(store,now=Date.now()){
 const devs=routers(store),match=matcher(devs),rows=[],stale=[],reports=new Map();
 for(const d of devs){const rep=store.setting('customerDiscovery:'+d.id);if(!rep?.lastReport)continue;
  const current=[];for(const o of rep.observations||[])for(const src of ['ppp','hotspot']){const e=o.evidence?.[src];if(e&&e.observedAt===rep.lastReport)current.push({source:'router',routerId:d.id,router:d.name,service:src==='ppp'?'pppoe':'hotspot',username:e.name||'',mac:macOf(e.mac),ip:e.ip||'',server:src==='hotspot'?(e.service||''):'',uptime:e.uptime||'',rx:e.rx||0,tx:e.tx||0,reportedAt:rep.lastReport,sessionId:e.sessionId||''});}
  const fresh=now-rep.lastReport<STALE,tb=rep.tables||{};reports.set(d.id,{fresh,reportedAt:rep.lastReport,tables:tb,complete:{pppoe:fresh&&tb.ppp?.ok===true&&!tb.ppp.truncated,hotspot:fresh&&tb.hotspot?.ok===true&&!tb.hotspot.truncated}});
  if(fresh)rows.push(...current);else stale.push({id:d.id,name:d.name,reportedAt:rep.lastReport,lastCount:current.length});}
 // Router rows indexed by service and username, so merging stays quick with thousands of connections.
 const byUser=new Map();for(const r of rows){const k=r.service+'|'+low(r.username);if(!byUser.has(k))byUser.set(k,[]);byUser.get(k).push(r);}
 const recent=store.sessionsSince(now-STALE),states=sessionStates(recent,now);
 for(const s of recent){if(states.get(s)!=='active')continue;const d=match(s),service=s.service==='hotspot'?'hotspot':'pppoe',mac=macOf(s.mac);
  // One device = same MAC and same IP (when both sides know them); a shared username alone never pairs two rows.
  const same=r=>r.source==='router'&&(!r.mac||!mac||r.mac===mac)&&(!r.ip||!s.ip||r.ip===s.ip),cands=(byUser.get(service+'|'+low(s.username))||[]).filter(same);
  // Same router (by identity or address). A session with no NAS identity at all is matched only when exactly one
  // fresh router row fits, never guessed between routers.
  let twin=cands.find(r=>d?r.routerId===d.id:(s.nasName||s.nas)&&low(r.router)===low(s.nasName||s.nas));
  if(!twin&&!d&&!s.nasName&&!s.nas&&cands.length===1)twin=cands[0];
  // The router's own complete list, newer than this session's last accounting update, does not have this device: it is
  // not connected (e.g. an old session of a reconnected device whose Stop never came). Its record is left as it is.
  if(!twin&&d&&reports.get(d.id)?.complete?.[service]&&reports.get(d.id).reportedAt>(s.updatedAt||0))continue;
  if(twin){twin.radius=s;twin.source='both';if(!twin.server&&s.server)twin.server=s.server;if(!twin.mac&&mac)twin.mac=mac;continue;}
  rows.push({source:'radius',routerId:d?.id||'',router:d?.name||s.nasName||s.nas||'Unknown router',service,username:s.username||'',mac,ip:s.ip||'',server:service==='hotspot'?(s.server||''):'',reportedAt:s.updatedAt,startedAt:s.startedAt,sessionId:s.sessionId,radius:s});}
 return {rows,stale,reports};}

// Counts for the dashboard and live view. Every breakdown adds up to `total` (connections).
function summary(store,now=Date.now(),conn=null){
 const {rows,stale}=conn||connections(store,now),subs=new Map(store.list('subscribers').map(s=>[low(s.username),s]));
 const sub=u=>subs.get(low(u))||subs.get(low(u).split('@')[0])||null;
 const byService={hotspot:0,pppoe:0},byStatus={active:0,expired:0,deactivated:0,unmatched:0},bySource={router:0,radius:0,both:0},byRouter=new Map(),customers=new Set();
 let oldest=null;
 for(const r of rows){byService[r.service]++;const s=sub(r.username),st=accountState(s,now);byStatus[st]++;bySource[r.source]++;customers.add(s?'id:'+s.id:'u:'+low(r.username||r.mac||r.ip));
  const k=r.routerId||'nas:'+low(r.router),e=byRouter.get(k)||{id:r.routerId||'',name:r.router,hotspot:0,pppoe:0,total:0};e[r.service]++;e.total++;byRouter.set(k,e);
  if(r.reportedAt&&(oldest==null||r.reportedAt<oldest))oldest=r.reportedAt;}
 return {at:now,unit:'connections',freshWithinMinutes:STALE/60000,total:rows.length,customers:customers.size,byService,byStatus,bySource,
  byRouter:[...byRouter.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name)),stale,oldestEvidence:oldest};}

// Hotspot servers: connections per server name. A connection is attributed to a server only when the router row names
// it, RADIUS sent it (Called-Station-Id), or the router has exactly one hotspot server. Otherwise it is counted as
// "server not known" for that router, never guessed.
function hotspotByServer(store,now=Date.now()){
 const {rows,reports}=connections(store,now),out=new Map();
 for(const d of routers(store)){const defs=(store.setting('routerHealth:'+d.id)?.hotspots||[]).filter(x=>x.name),rep=reports.get(d.id),mine=rows.filter(r=>r.routerId===d.id&&r.service==='hotspot');
  const only=defs.length===1?defs[0].name:'',counts=new Map();let unknown=0;
  for(const r of mine){const n=r.server||only;if(n)counts.set(n,(counts.get(n)||0)+1);else unknown++;}
  const viaRadius=mine.some(r=>r.source!=='router');
  out.set(d.id,{counts,unknown,fresh:!!rep?.fresh,reportedAt:rep?.reportedAt||null,radius:viaRadius,evidence:rep?.fresh?(viaRadius?'router report and RADIUS':'router report'):viaRadius?'RADIUS only':'none'});}
 return out;}

module.exports={STALE,sessionStates,stateOf,connections,summary,hotspotByServer,accountState,macOf};
