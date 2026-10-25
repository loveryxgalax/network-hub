'use strict';
// Sites & traffic: per-subscriber DNS lookups (which sites) and a Torch-style snapshot of the busiest live
// connections, both reported by the MikroTik discovery script. Stored per router; DNS kept as daily counts
// for 30 days plus a rolling list of the latest lookups; live connections keep only the newest snapshot.
const crypto=require('node:crypto'),net=require('node:net');
const DAY=86400000,KEEP_DAYS=30,MAX_DNS=3000,MAX_CONNS=400,RECENT=1000,SEEN=8000;
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const text=(value,max)=>{if(value==null)return '';if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))fail('Invalid site report text');return value;};
// RouterOS dns log line: "query from 10.0.0.5: #54 www.google.com. A"
const QUERY=/query from ([0-9a-fA-F:.]+):\s*#\d+\s+(\S+?)\.?\s+([A-Za-z0-9]+)\s*$/;
function parseQuery(message){const m=QUERY.exec(message);if(!m||!net.isIP(m[1]))return null;const domain=m[2].toLowerCase();if(!/^[a-z0-9_.-]{1,253}$/.test(domain)||!domain.includes('.'))return null;return {client:m[1],domain,type:m[3].toUpperCase()};}
// "1.2.3.4:443" or "[2001:db8::1]:443" -> {ip,port}
function endpoint(value){const m=/^\[?([0-9a-fA-F:.]+?)\]?(?::(\d{1,5}))?$/.exec(value||'');if(!m||!net.isIP(m[1]))return null;return {ip:m[1],port:m[2]?Number(m[2]):null};}
// RouterOS rates may arrive as numbers (bits/s) or text such as "1.2Mbps" / "800kbps".
function bps(value){if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return value;const m=/^([\d.]+)\s*([kKmMgG]?)bps$/.exec(String(value||'').trim());if(!m)return null;return Number(m[1])*({'':1,k:1e3,m:1e6,g:1e9}[m[2].toLowerCase()]);}
const num=value=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:0;};
function normalize(input){
 const dns=input.dns===undefined?[]:input.dns,conns=input.conns===undefined?null:input.conns;
 if(!Array.isArray(dns)||dns.length>MAX_DNS)fail('Report at most '+MAX_DNS+' DNS log lines');
 if(conns!==null&&(!Array.isArray(conns)||conns.length>MAX_CONNS))fail('Report at most '+MAX_CONNS+' connections');
 return {
  dns:dns.map(row=>{if(!row||typeof row!=='object')fail('Invalid DNS log line');return {time:text(row.time,100),message:text(row.message,500)};}),
  conns:conns===null?null:conns.map(row=>{if(!row||typeof row!=='object')fail('Invalid connection row');const src=endpoint(text(row.src,80)),dst=endpoint(text(row.dst,80));if(!src||!dst)return null;return {src,dst,proto:text(row.proto,20),bytes:num(row.bytes),upBps:bps(row.origRate),downBps:bps(row.replRate)};}).filter(Boolean)
 };
}
const dayKey=time=>new Date(time).toISOString().slice(0,10);
function ingest(store,router,report,now=Date.now()){
 const seenKey='siteSeen:'+router.id,seen=store.setting(seenKey)||{ids:[]},known=new Set(seen.ids),fresh=[];
 for(const line of report.dns){const id=crypto.createHash('sha256').update(line.time+'\0'+line.message).digest('base64url').slice(0,22);if(known.has(id))continue;known.add(id);seen.ids.push(id);const q=parseQuery(line.message);if(q)fresh.push({...q,routerTime:line.time,at:now});}
 seen.ids=seen.ids.slice(-SEEN);store.setting(seenKey,seen);
 if(fresh.length){
  const key='siteStats:'+router.id+':'+dayKey(now),day=store.setting(key)||{domains:{},clients:{}};
  for(const q of fresh){day.domains[q.domain]=(day.domains[q.domain]||0)+1;const c=day.clients[q.client]||(day.clients[q.client]={});c[q.domain]=(c[q.domain]||0)+1;}
  store.setting(key,day);
  const recentKey='siteRecent:'+router.id,recent=store.setting(recentKey)||{items:[]};recent.items=[...fresh.reverse(),...recent.items].slice(0,RECENT);store.setting(recentKey,recent);
 }
 if(report.conns)store.setting('siteLive:'+router.id,{time:now,rows:report.conns});
 const index='siteDays:'+router.id,days=new Set(store.setting(index)?.days||[]);days.add(dayKey(now));
 for(const d of [...days])if(now-Date.parse(d+'T00:00:00Z')>KEEP_DAYS*DAY){days.delete(d);store.setting('siteStats:'+router.id+':'+d,null);}
 store.setting(index,{days:[...days].sort()});
 return {dnsAdded:fresh.length,connections:report.conns?report.conns.length:null};
}
// Who is behind an address: PPPoE username, Hotspot user or DHCP host name from the latest discovery report.
function people(store,router){const map=new Map();for(const o of store.setting('customerDiscovery:'+router.id)?.observations||[])for(const [source,e] of Object.entries(o.evidence||{})){if(!e.ip)continue;const current=map.get(e.ip),rank={ppp:3,hotspot:2,dhcp:1}[source]||0;if(!current||rank>current.rank)map.set(e.ip,{name:e.name||e.mac||e.ip,source,mac:e.mac||'',rank});}return map;}
function report(store,params=new URLSearchParams(),now=Date.now()){
 const range=[1,7,30].includes(Number(params.get('range')))?Number(params.get('range')):1,routerId=params.get('routerId')||'',client=params.get('client')||'',query=(params.get('q')||'').toLowerCase().slice(0,150);
 const domains=new Map(),clients=new Map(),recent=[],live=[],routers=[];let lookups=0;
 for(const router of store.list('devices').filter(d=>d.type==='router'&&(!routerId||d.id===routerId))){
  const who=people(store,router),label=ip=>who.get(ip)?.name||ip,days=store.setting('siteDays:'+router.id)?.days||[],from=dayKey(now-(range-1)*DAY);
  const liveSnap=store.setting('siteLive:'+router.id);
  routers.push({id:router.id,name:router.name,days:days.length,lastLive:liveSnap?.time||null});
  for(const d of days){if(d<from)continue;const day=store.setting('siteStats:'+router.id+':'+d);if(!day)continue;
   for(const [ip,sites] of Object.entries(day.clients)){const id=router.id+'|'+ip,c=clients.get(id)||{id,routerId:router.id,routerName:router.name,ip,name:label(ip),source:who.get(ip)?.source||'',mac:who.get(ip)?.mac||'',lookups:0,sites:new Map()};
    for(const [domain,n] of Object.entries(sites)){if(client&&client!==id)continue;c.lookups+=n;c.sites.set(domain,(c.sites.get(domain)||0)+n);lookups+=n;const t=domains.get(domain)||{domain,lookups:0,clients:new Set()};t.lookups+=n;t.clients.add(id);domains.set(domain,t);}
    if(c.lookups)clients.set(id,c);}
  }
  for(const q of store.setting('siteRecent:'+router.id)?.items||[]){if(now-q.at>range*DAY)continue;const id=router.id+'|'+q.client;if(client&&client!==id)continue;recent.push({...q,clientId:id,name:label(q.client),routerName:router.name});}
  if(liveSnap&&now-liveSnap.time<=600000)for(const r of liveSnap.rows){const local=who.has(r.src.ip)?r.src:who.has(r.dst.ip)?r.dst:r.src,remote=local===r.src?r.dst:r.src,id=router.id+'|'+local.ip;if(client&&client!==id)continue;live.push({clientId:id,name:label(local.ip),local:local.ip,remote:remote.ip,port:remote.port,proto:r.proto,bytes:r.bytes,upBps:r.upBps,downBps:r.downBps,routerName:router.name,observedAt:liveSnap.time});}
 }
 const match=(...values)=>!query||values.join(' ').toLowerCase().includes(query);
 const topSites=[...domains.values()].filter(t=>match(t.domain)).map(t=>({domain:t.domain,lookups:t.lookups,clients:t.clients.size})).sort((a,b)=>b.lookups-a.lookups);
 const topClients=[...clients.values()].filter(c=>match(c.name,c.ip,c.mac,...c.sites.keys())).map(c=>({id:c.id,routerName:c.routerName,ip:c.ip,name:c.name,source:c.source,mac:c.mac,lookups:c.lookups,uniqueSites:c.sites.size,sites:[...c.sites].sort((a,b)=>b[1]-a[1]).map(([domain,lookups])=>({domain,lookups}))})).sort((a,b)=>b.lookups-a.lookups);
 recent.sort((a,b)=>b.at-a.at);live.sort((a,b)=>b.bytes-a.bytes);
 return {range,lookups,uniqueSites:domains.size,activeClients:clients.size,liveConnections:live.length,topSites,topClients,recent:recent.filter(q=>match(q.domain,q.name,q.client)).slice(0,1000),live:live.filter(r=>match(r.name,r.local,r.remote,r.proto)),routers,sampledAt:now};
}
// RouterOS script section that collects DNS lookups and the busiest connections (the router filters connections itself, so large tables stay cheap) (requires DNS logging; see Sites & traffic setup).
const SCRIPT=`
   :local dns [:toarray ""];
   :do { :foreach row in=[/log print as-value where topics~"dns"] do={ :local msg [:tostr ($row->"message")]; :if ($msg~"^query from") do={ :set dns ($dns,{{"time"=[:tostr ($row->"time")];"message"=$msg}}); } }
    :if ([:len $dns] > ${MAX_DNS}) do={ :set dns [:pick $dns ([:len $dns]-${MAX_DNS}) [:len $dns]]; } } on-error={}
   :local conns [:toarray ""];
   :do { :foreach id in=[/ip firewall connection find where (orig-bytes>131072 or repl-bytes>131072)] do={ :if ([:len $conns] < ${MAX_CONNS}) do={ :do {
     :local c [/ip firewall connection get $id];
     :local ob [:tonum ($c->"orig-bytes")]; :if ([:typeof $ob]!="num") do={ :set ob 0; }
     :local rb [:tonum ($c->"repl-bytes")]; :if ([:typeof $rb]!="num") do={ :set rb 0; }
     :if (($ob+$rb) > 262144) do={ :set conns ($conns,{{"src"=[:tostr ($c->"src-address")];"dst"=[:tostr ($c->"dst-address")];"proto"=[:tostr ($c->"protocol")];"bytes"=($ob+$rb);"origRate"=[:tostr ($c->"orig-rate")];"replRate"=[:tostr ($c->"repl-rate")]}}); }
   } on-error={} } } } on-error={}`;
// One-time router settings that turn on DNS query logging. Shown to the operator; never sent automatically.
const SETUP=['/system logging action set memory memory-lines=5000','/system logging add topics=dns action=memory','/ip dns set allow-remote-requests=yes'];
module.exports={normalize,ingest,report,parseQuery,SCRIPT,SETUP,MAX_DNS,MAX_CONNS};
