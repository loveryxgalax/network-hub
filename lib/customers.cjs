'use strict';
const crypto=require('node:crypto'),net=require('node:net'),sites=require('./sites.cjs');
const SOURCES={dhcp:500,arp:500,ppp:500,hotspot:500,neighbor:128};
const categories=['Unclassified','Customer router','ONT / ONU','Wireless radio','Access point','End device','Infrastructure','Ignored'];
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const str=(value,max=150)=>{if(value==null)return '';if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))fail('Invalid discovery text');return value;};
const count=value=>{if(value===undefined||value===null||value==='')return null;const n=Number(value);if(typeof value==='boolean'||!Number.isSafeInteger(n)||n<0)fail('Invalid traffic counter');return n;};
function receive(store,router,input,pending,now=Date.now()){
 if(input.schema===1)return {...ingest(store,router,normalize(input),now),completed:true};
 if(input.schema!==2||typeof input.batchId!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(input.batchId)||!Number.isInteger(input.part)||!Number.isInteger(input.total)||input.total<1||input.total>40||input.part<0||input.part>=input.total||typeof input.data!=='string'||!input.data.length||input.data.length>40000||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))fail('Invalid discovery batch');
 let upload=pending.get(router.id);if(upload&&now-upload.started>120000){pending.delete(router.id);upload=null;}
 if(!upload||upload.id!==input.batchId){if(input.part!==0)throw Object.assign(new Error('Restart this discovery upload'),{status:409});upload={id:input.batchId,total:input.total,started:now,parts:new Map()};pending.set(router.id,upload);}
 if(upload.total!==input.total)fail('Discovery batch size changed');if(upload.parts.has(input.part)&&upload.parts.get(input.part)!==input.data)fail('Discovery batch content changed');upload.parts.set(input.part,input.data);
 if(upload.parts.size!==upload.total)return {ok:true,completed:false,receivedParts:upload.parts.size};
 const encoded=Array.from({length:upload.total},(_,i)=>upload.parts.get(i)).join(''),decoded=Buffer.from(encoded,'base64');pending.delete(router.id);if(decoded.length>1048576||decoded.toString('base64')!==encoded)fail('Invalid completed discovery upload');let value;try{value=JSON.parse(decoded.toString('utf8'));}catch{fail('Invalid discovery JSON');}
 return {...ingest(store,router,normalize(value),now),completed:true};
}
function normalize(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||![1,2].includes(input.schema)||!input.tables||typeof input.tables!=='object')fail('Invalid customer report');
 const tables={};
 for(const [source,limit]of Object.entries(SOURCES)){
  const t=input.tables[source]||(source==='hotspot'?{ok:false,truncated:false,rows:[]}:null);if(!t||typeof t.ok!=='boolean'||typeof t.truncated!=='boolean'||!Array.isArray(t.rows)||t.rows.length>limit||(!t.ok&&t.rows.length))fail('Invalid '+source+' discovery table');
  tables[source]={ok:t.ok,truncated:t.truncated,rows:t.rows.map(row=>{
   if(!row||typeof row!=='object')fail('Invalid customer row');const ip=str(row.ip,100),mac=str(row.mac,30).toUpperCase();if(ip&&!net.isIP(ip))fail('Invalid discovered IP');if(mac&&!/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac))fail('Invalid discovered MAC');
   const name=str(row.name);if(!ip&&!mac&&!(source==='ppp'&&name))fail('Customer row has no identity');
   return {ip,mac,name,status:str(row.status,50),interface:str(row.interface),platform:str(row.platform),model:str(row.model),software:str(row.software),service:str(row.service,30),uptime:str(row.uptime,80),sessionId:str(row.sessionId,80),rx:count(row.rx),tx:count(row.tx)};
  })};
 }
 const rawEvents=input.events||[];if(!Array.isArray(rawEvents)||rawEvents.length>120)fail('Report at most 120 router events');
 const events=rawEvents.map(event=>{if(!event||typeof event!=='object'||Array.isArray(event))fail('Invalid router event');return {time:str(event.time,100),topics:str(event.topics,150),message:str(event.message,500)};});
 return {schema:2,version:2,tables,events,sites:sites.normalize(input)};
}
const key=row=>row.mac?'mac:'+row.mac:row.source==='ppp'?'ppp:'+row.name:'ip:'+row.ip;
function uptimeSeconds(value){const match=/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):([0-5]\d):([0-5]\d))$/.exec(value||'');return match?Number(match[1]||0)*604800+Number(match[2]||0)*86400+Number(match[3])*3600+Number(match[4])*60+Number(match[5]):null;}
function ingest(store,router,report,now=Date.now()){
 const setting='customerDiscovery:'+router.id,previous=store.setting(setting)||{observations:[]},seen=new Map(previous.observations.map(o=>[o.key,o])),current=new Map(),complete=Object.values(report.tables).every(t=>t.ok&&!t.truncated);
 const addEvent=(observation,type,details)=>{const history=observation.history||[],last=history.at(-1);if(last?.type===type&&last.details===details&&now-last.time<120000)return;history.push({time:now,type,details});observation.history=history.slice(-200);};
 for(const [source,table]of Object.entries(report.tables))for(const raw of table.rows){const row={...raw,source},id=key(row);let storedId=id,old=seen.get(id);if(!old&&row.ip){const matches=[...seen].filter(([knownId,candidate])=>!current.has(knownId)&&candidate.snapshot?.present&&candidate.snapshot.ips?.includes(row.ip));if(matches.length===1){[storedId,old]=matches[0];}}old||={key:storedId,firstObserved:now,evidence:{}};const prior=old.evidence[source];let traffic=null;
  if(['ppp','hotspot'].includes(source)&&row.sessionId&&prior?.sessionId===row.sessionId&&row.rx!==null&&row.tx!==null&&prior.rx!==null&&prior.tx!==null&&row.rx>=prior.rx&&row.tx>=prior.tx&&(uptimeSeconds(row.uptime)!==null&&uptimeSeconds(prior.uptime)!==null&&uptimeSeconds(row.uptime)>=uptimeSeconds(prior.uptime))){const seconds=(now-prior.observedAt)/1000;if(seconds>=5&&seconds<=300)traffic={uploadMbps:(row.rx-prior.rx)*8/seconds/1e6,downloadMbps:(row.tx-prior.tx)*8/seconds/1e6};}
  old.lastObserved=now;old.evidence[source]={...row,observedAt:now,traffic};if(storedId!==id)seen.delete(storedId);seen.set(id,old);if(!current.has(id))current.set(id,[]);current.get(id).push(row);
  if(traffic){const samples=old.trafficHistory||[],last=samples.at(-1);if(!last||now-last.time>=600000){samples.push({time:now,uploadMbps:traffic.uploadMbps,downloadMbps:traffic.downloadMbps});old.trafficHistory=samples.slice(-1008);}}
 }
 for(const [id,rows]of current){const observation=seen.get(id),prior=observation.snapshot,ppp=rows.find(x=>x.source==='ppp'),hotspot=rows.find(x=>x.source==='hotspot'),session=ppp||hotspot,ips=[...new Set(rows.map(x=>x.ip).filter(Boolean))].sort(),macs=[...new Set(rows.map(x=>x.mac).filter(Boolean))].sort();
  if(!prior&&observation.firstObserved===now)addEvent(observation,'first_seen','First reported by the MikroTik');else if(prior&&!prior.present)addEvent(observation,'returned','Observed again after a complete report did not include it');
  if(complete&&prior&&JSON.stringify(ips)!==JSON.stringify(prior.ips||[]))addEvent(observation,'ip_changed',ips.length?'Reported IP: '+ips.join(', '):'No IP in current observation');
  if(complete&&prior&&JSON.stringify(macs)!==JSON.stringify(prior.macs||[]))addEvent(observation,'mac_changed',macs.length?'Reported MAC: '+macs.join(', '):'No MAC in current observation');
  if(prior?.connected&&!session&&report.tables[prior.sessionType]?.ok&&!report.tables[prior.sessionType]?.truncated)addEvent(observation,'session_ended',prior.sessionType.toUpperCase()+' session is absent from a successful current report');else if(prior&&!prior.connected&&session)addEvent(observation,'session_started',session.source.toUpperCase()+' session reported active');
  observation.snapshot={time:now,present:true,ips,macs,connected:!!session,sessionType:session?.source||null};
 }
 if(complete)for(const [id,observation]of seen){if(!current.has(id)&&observation.snapshot?.present){addEvent(observation,'not_observed','Not present in this complete MikroTik report');observation.snapshot={...observation.snapshot,time:now,present:false,connected:false};}}
 for(const observation of seen.values())if(observation.trafficHistory)observation.trafficHistory=observation.trafficHistory.filter(sample=>sample.time>now-7*86400000).slice(-1008);
 const observations=[...seen.values()].filter(o=>now-o.lastObserved<30*86400000).sort((a,b)=>b.lastObserved-a.lastObserved).slice(0,5000);
 store.setting(setting,{lastReport:now,version:1,tables:Object.fromEntries(Object.entries(report.tables).map(([s,t])=>[s,{ok:t.ok,truncated:t.truncated,count:t.rows.length}])),observations});
 ingestEvents(store,router,report.events||[],now);
 const siteResult=report.sites?sites.ingest(store,router,report.sites,now):null;
 return {ok:true,observations:observations.length,sites:siteResult,nextCheckInSeconds:120};
}
function eventClass(event){const value=(event.topics+' '+event.message).toLowerCase();if(/dns/.test(value)&&/cache full|not storing/.test(value))return {key:'dns-cache-full',title:'DNS cache is full',severity:'critical'};if(/ppp|pppoe/.test(value)&&/authenticat|login failed|user .* failed/.test(value))return {key:'ppp-auth-failed',title:'PPPoE authentication failures',severity:'warning'};if(/network hub|fetch/.test(value)&&/failed|error|timeout/.test(value))return {key:'network-hub-agent',title:'Network Hub reporting failures',severity:'warning'};if(/critical|error/.test(event.topics.toLowerCase()))return {key:'router-error',title:'Router error events',severity:'critical'};return {key:'router-warning',title:'Router warning events',severity:'warning'};}
function ingestEvents(store,router,events,now=Date.now()){
 const setting='routerEvents:'+router.id,previous=store.setting(setting)||{items:[]},known=new Set(previous.items.map(item=>item.id)),added=[];
 for(const event of events){const id=crypto.createHash('sha256').update(router.id+'\0'+event.time+'\0'+event.topics+'\0'+event.message).digest('hex');if(known.has(id))continue;known.add(id);const kind=eventClass(event);added.push({id,routerId:router.id,routerName:router.name,observedAt:now,occurredAt:event.time,topics:event.topics,message:event.message,...kind});}
 const items=[...previous.items,...added].filter(item=>now-item.observedAt<30*86400000).sort((a,b)=>b.observedAt-a.observedAt).slice(0,1000);store.setting(setting,{lastReport:now,items});
 for(const event of added){const existing=store.list('alerts').find(alert=>alert.deviceId===router.id&&alert.source==='router-log'&&alert.logKey===event.key&&alert.status!=='Resolved'),count=(existing?.eventCount||0)+1,details=`${event.message} · ${count} event${count===1?'':'s'} observed; last router time ${event.occurredAt||'unavailable'}`;if(existing)store.put('alerts',{...existing,title:event.title,details,severity:event.severity,eventCount:count,lastEventAt:now},existing);else store.put('alerts',{title:event.title,details,deviceId:router.id,severity:event.severity,status:'Open',source:'router-log',logKey:event.key,eventCount:1,lastEventAt:now});}
}
function pppoe(store,params=new URLSearchParams(),now=Date.now()){
 const routerId=params.get('routerId')||'',query=(params.get('q')||'').toLowerCase().slice(0,150),status=params.get('status')||'',annotations=new Map(store.list('customerLabels').map(x=>[x.routerId+':'+x.observationKey,x])),cpes=store.list('devices').filter(d=>d.type==='cpe'),items=[],routers=[];
 for(const router of store.list('devices').filter(d=>d.type==='router'&&(!routerId||d.id===routerId))){const report=store.setting('customerDiscovery:'+router.id),configured=!!store.secret('discovery:'+router.id),fresh=!!report&&now-report.lastReport<=300000;routers.push({id:router.id,name:router.name,configured,lastReport:report?.lastReport||null,fresh,ppp:report?.tables?.ppp||null});for(const observation of report?.observations||[]){const session=observation.evidence?.ppp;if(!session)continue;const connected=fresh&&session.observedAt===report.lastReport,sessionStatus=!configured?'Reporting disabled':!fresh?'Report stale':connected?'Connected':'Disconnected';const label=annotations.get(router.id+':'+observation.key),uptime=uptimeSeconds(session.uptime),item={id:crypto.createHash('sha256').update(router.id+':'+observation.key).digest('hex'),routerId:router.id,routerName:router.name,name:label?.name||session.name,username:session.name,ip:session.ip,mac:session.mac,status:sessionStatus,uptime:session.uptime,startedAt:connected&&uptime!==null?now-uptime*1000:null,lastObserved:session.observedAt,traffic:connected?session.traffic:null,trafficHistory:observation.trafficHistory||[]};const cpe=cpes.find(d=>d.observedViaRouterId===router.id&&((item.mac&&d.macAddress===item.mac)||(item.ip&&d.ip===item.ip)));if(cpe){item.cpeId=cpe.id;item.customer=cpe.customer||'';item.plan=cpe.speedId?store.get('speeds',cpe.speedId)?.name||'':'';}if(status&&item.status.toLowerCase()!==status.toLowerCase())continue;if(query&&!JSON.stringify([item.name,item.username,item.ip,item.mac,item.routerName,item.customer,item.plan]).toLowerCase().includes(query))continue;items.push(item);}}
 items.sort((a,b)=>(a.status==='Connected'?0:1)-(b.status==='Connected'?0:1)||b.lastObserved-a.lastObserved||a.name.localeCompare(b.name));return {items:items.slice(0,5000),total:items.length,connected:items.filter(item=>item.status==='Connected').length,disconnected:items.filter(item=>item.status==='Disconnected').length,stale:items.filter(item=>item.status==='Report stale').length,routers,sampledAt:now};
}
function routerEvents(store,params=new URLSearchParams(),now=Date.now()){
 const routerId=params.get('routerId')||'',severity=params.get('severity')||'',query=(params.get('q')||'').toLowerCase().slice(0,150),items=[];for(const router of store.list('devices').filter(d=>d.type==='router'&&(!routerId||d.id===routerId)))for(const item of store.setting('routerEvents:'+router.id)?.items||[]){if(severity&&item.severity!==severity)continue;if(query&&!JSON.stringify([item.routerName,item.title,item.topics,item.message]).toLowerCase().includes(query))continue;items.push(item);}items.sort((a,b)=>b.observedAt-a.observedAt);return {items:items.slice(0,1000),total:items.length,critical:items.filter(item=>item.severity==='critical').length,warning:items.filter(item=>item.severity==='warning').length,sampledAt:now};
}
function list(store,params=new URLSearchParams(),now=Date.now()){
 const routerId=params.get('routerId')||'',query=(params.get('q')||'').toLowerCase().slice(0,150),category=params.get('category')||'',connection=params.get('connection')||'',page=Math.max(1,Number(params.get('page'))||1),limit=50,items=[],routers=[];
 const annotations=new Map(store.list('customerLabels').map(x=>[x.routerId+':'+x.observationKey,x])),cpeRecords=store.list('devices').filter(d=>d.type==='cpe');
 for(const router of store.list('devices').filter(d=>d.type==='router'&&(!routerId||d.id===routerId))){const report=store.setting('customerDiscovery:'+router.id),configured=!!store.secret('discovery:'+router.id);routers.push({id:router.id,name:router.name,configured,lastReport:report?.lastReport||null,fresh:!!report&&now-report.lastReport<=300000,tables:report?.tables||null});
  for(const observation of report?.observations||[]){const ev=Object.values(observation.evidence),current=ev.filter(e=>now-e.observedAt<=300000&&e.observedAt===report.lastReport),ppp=current.find(e=>e.source==='ppp'),hotspot=current.find(e=>e.source==='hotspot'),arp=current.find(e=>e.source==='arp'&&e.status==='reachable'),dhcp=current.find(e=>e.source==='dhcp'&&e.status==='bound'),neighbor=current.find(e=>e.source==='neighbor');
   const evidence=ev.sort((a,b)=>b.observedAt-a.observedAt),primary=ppp||hotspot||dhcp||neighbor||evidence[0],label=annotations.get(router.id+':'+observation.key),lastPpp=observation.evidence.ppp,lastHotspot=observation.evidence.hotspot;
   let status=ppp?'PPP connected':hotspot?'Hotspot connected':arp?'ARP reachable':dhcp?'Lease bound':neighbor?'Neighbor advertised':'Previously observed';
   if(!configured)status='Reporting disabled';else if(!current.length&&now-report.lastReport>300000)status='Report stale';else if(!ppp&&!hotspot&&lastPpp&&report.tables.ppp.ok&&!report.tables.ppp.truncated&&report.lastReport>lastPpp.observedAt&&now-report.lastReport<=300000)status='PPP disconnected';else if(!ppp&&!hotspot&&lastHotspot&&report.tables.hotspot?.ok&&!report.tables.hotspot.truncated&&report.lastReport>lastHotspot.observedAt&&now-report.lastReport<=300000)status='Hotspot disconnected';
   const item={id:crypto.createHash('sha256').update(router.id+':'+observation.key).digest('hex'),key:observation.key,routerId:router.id,routerName:router.name,name:label?.name||primary.name||primary.mac||primary.ip,category:label?.category||'Unclassified',notes:label?.notes||'',mac:primary.mac,ips:[...new Set(evidence.map(e=>e.ip).filter(Boolean))],platform:neighbor?.platform||observation.evidence.neighbor?.platform||'',model:neighbor?.model||observation.evidence.neighbor?.model||'',status,firstObserved:observation.firstObserved,lastObserved:observation.lastObserved,traffic:(ppp||hotspot)?.traffic||null,trafficHistory:observation.trafficHistory||[],history:(observation.history||[]).slice(-100),evidence};
   const cpe=cpeRecords.find(d=>d.observedViaRouterId===router.id&&((item.mac&&d.macAddress===item.mac)||item.ips.includes(d.ip)));if(cpe){item.cpeId=cpe.id;item.customer=cpe.customer||'';item.linkedOnuId=cpe.linkedOnuId||'';const onu=cpe.linkedOnuId&&store.get('devices',cpe.linkedOnuId);item.linkedOnuName=onu?.type==='onu'?onu.name:'';}
   if(category&&item.category!==category)continue;if(connection==='active'&&!['PPP connected','Hotspot connected'].includes(status))continue;if(connection==='disconnected'&&!status.endsWith('disconnected'))continue;if(connection==='stale'&&status!=='Report stale')continue;if(query&&!JSON.stringify([item.name,item.mac,item.ips,item.routerName,item.platform,item.model,item.customer,evidence.map(e=>e.name)]).toLowerCase().includes(query))continue;items.push(item);
  }
 }
 items.sort((a,b)=>b.lastObserved-a.lastObserved||a.name.localeCompare(b.name));const total=items.length,pages=Math.max(1,Math.ceil(total/limit)),safePage=Math.min(pages,Math.floor(page));
 return {items:items.slice((safePage-1)*limit,safePage*limit),total,page:safePage,pages,routers,categories,sampledAt:now};
}
function annotate(store,id,input){
 let target;for(const router of store.list('devices').filter(d=>d.type==='router'))for(const o of store.setting('customerDiscovery:'+router.id)?.observations||[])if(crypto.createHash('sha256').update(router.id+':'+o.key).digest('hex')===id)target={routerId:router.id,observationKey:o.key};
 if(!target)throw Object.assign(new Error('Discovered device not found'),{status:404});if(!categories.includes(input.category))fail('Choose a device category');const value={...target,name:str(input.name,150).trim(),category:input.category,notes:str(input.notes,1000)};const existing=store.list('customerLabels').find(x=>x.routerId===target.routerId&&x.observationKey===target.observationKey);return store.put('customerLabels',value,existing);
}
function generate(origin,id,token){
 const url=new URL(origin);if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!/^[a-f0-9-]{36}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Invalid discovery enrollment');
 const sections=Object.entries(SOURCES).map(([source,limit])=>{
  const command={dhcp:'/ip dhcp-server lease print as-value',arp:'/ip arp print as-value',ppp:'/ppp active print detail as-value',hotspot:'/ip hotspot active print as-value',neighbor:'/ip neighbor print as-value'}[source];
  const values={dhcp:'"ip"=[:tostr ($row->"address")];"mac"=[:tostr ($row->"mac-address")];"name"=[:tostr ($row->"host-name")];"status"=[:tostr ($row->"status")];"interface"=[:tostr ($row->"server")]',arp:'"ip"=[:tostr ($row->"address")];"mac"=[:tostr ($row->"mac-address")];"name"="";"status"=[:tostr ($row->"status")];"interface"=[:tostr ($row->"interface")]',ppp:'"ip"=[:tostr ($row->"address")];"mac"="";"name"=[:tostr ($row->"name")];"status"="connected";"service"=[:tostr ($row->"service")];"uptime"=[:tostr ($row->"uptime")];"sessionId"=[:tostr ($row->".id")]',hotspot:'"ip"=[:tostr ($row->"address")];"mac"=[:tostr ($row->"mac-address")];"name"=[:tostr ($row->"user")];"status"="connected";"service"=[:tostr ($row->"server")];"uptime"=[:tostr ($row->"uptime")];"sessionId"=[:tostr ($row->".id")];"rx"=($row->"bytes-in");"tx"=($row->"bytes-out")',neighbor:'"ip"=[:tostr ($row->"address")];"mac"=[:tostr ($row->"mac-address")];"name"=[:tostr ($row->"identity")];"platform"=[:tostr ($row->"platform")];"model"=[:tostr ($row->"board")];"software"=[:tostr ($row->"version")];"status"="advertised";"interface"=[:tostr ($row->"interface")]' }[source];
  return `
   :do {
    :local items [:toarray ""]; :local clipped false;
    :foreach row in=[${command}] do={
     :if ([:len $items] < ${limit}) do={
      :local item {${values}};
      ${source==='ppp'?`:if (($row->"service")="pppoe") do={ :set ($item->"mac") [:tostr ($row->"caller-id")]; }
      :local iface ("<".($row->"service")."-".($row->"name").">");
      :local nic ($counters->$iface);
      :if ([:typeof $nic]="array") do={ :set ($item->"interface") $iface; :set ($item->"rx") ($nic->"rx-byte"); :set ($item->"tx") ($nic->"tx-byte"); }`:''}
      ${source==='hotspot'?`:local stats ($hotspotCounters->[:tostr ($row->".id")]);
      :if ([:typeof $stats]="array") do={ :set ($item->"rx") ($stats->"bytes-in"); :set ($item->"tx") ($stats->"bytes-out"); }`:''}
      :set items ($items,{$item});
     } else={ :set clipped true; }
    }
    :set ($tables->"${source}") {"ok"=true;"truncated"=$clipped;"rows"=$items};
   } on-error={ :set ($tables->"${source}") {"ok"=false;"truncated"=false;"rows"=[:toarray ""]}; }
  `;
 }).join('');
 return `# Network Hub customer discovery. Read-only network observations; keep private.
{
 /system scheduler remove [find where name="network-hub-discovery"];
 :local waiting 0;
 :while (([/system script job print count-only where script="network-hub-discovery"] > 0) && ($waiting < 40)) do={ :delay 500ms; :set waiting ($waiting + 1); }
 :if ([/system script job print count-only where script="network-hub-discovery"] > 0) do={ :error "Existing discovery job did not finish"; }
 /system script remove [find where name="network-hub-discovery"];
 /system script add name="network-hub-discovery" comment="Network Hub customer, event and site monitoring v4" policy=read,test,ftp source={
  :if ([/system script job print count-only where script="network-hub-discovery"] > 1) do={ :error "Discovery already running"; }
  :do {
   :local tables [:toarray ""]; :local counters [:toarray ""]; :local hotspotCounters [:toarray ""];
   :do { :foreach nic in=[/interface print stats as-value] do={ :set ($counters->($nic->"name")) $nic; } } on-error={}
   :do { :foreach stats in=[/ip hotspot active print stats as-value] do={ :set ($hotspotCounters->[:tostr ($stats->".id")]) $stats; } } on-error={}
   ${sections}
   :local events [:toarray ""];
   :do { :foreach row in=[/log print as-value] do={ :local eventTopics [:tostr ($row->"topics")]; :if ($eventTopics~"error|warning|critical") do={ :local item {"time"=[:tostr ($row->"time")];"topics"=$eventTopics;"message"=[:tostr ($row->"message")]}; :set events ($events,{$item}); :if ([:len $events] > 120) do={ :set events [:pick $events 1 [:len $events]]; } } } } on-error={}
${sites.SCRIPT}
   :local payload {"schema"=2;"tables"=$tables;"events"=$events;"dns"=$dns;"conns"=$conns};
   :local data [:serialize to=json value=$payload options=json.no-string-conversion];
   :local encoded [:convert $data to=base64];
   :local batch [:rndstr length=16 from="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
   :local parts (([:len $encoded]+39999)/40000);
   :for part from=0 to=($parts-1) do={
    :local envelope {"schema"=2;"batchId"=$batch;"part"=$part;"total"=$parts;"data"=[:pick $encoded ($part*40000) (($part+1)*40000)]};
    :local chunk [:serialize to=json value=$envelope options=json.no-string-conversion];
    :local receipt [/tool fetch url="${url.origin}/api/customer-agent/check-in/${id}" http-method=post http-header-field="Content-Type:application/json,Authorization:Bearer ${token}" http-data=$chunk check-certificate=yes http-max-redirect-count=0 output=user as-value idle-timeout=15s duration=20s];
    :local ack [:deserialize from=json value=($receipt->"data")];
    :if (($ack->"ok") != true) do={ :error "Discovery batch not acknowledged"; }
   }
  } on-error={ :log warning "Network Hub customer discovery failed; check connectivity and report validation"; }
 }
 /system scheduler add name="network-hub-discovery" comment="Network Hub customer discovery every two minutes" interval=2m start-time=startup on-event="/system script run network-hub-discovery" policy=read,test,ftp disabled=no;
 /system script run network-hub-discovery;
 :log info "Network Hub customer discovery installed without a reboot";
 /system script remove [find where name="network-hub-discovery-setup"];
}
`;
}
module.exports={normalize,ingest,receive,list,annotate,generate,pppoe,routerEvents,SOURCES,categories};
