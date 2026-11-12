'use strict';
// Router jobs: an opt-in runner script on the router asks netops for work every minute over HTTPS, runs one job
// from a fixed whitelist, and reports the result. Netops never connects in to a router, never runs free-form
// commands, and the risky jobs (reboot, RouterOS upgrade) need the operator to type the router's name and are
// never retried automatically.
const crypto=require('node:crypto');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const SAFE=/^[A-Za-z0-9._@:\- ]{1,64}$/,MACRE=/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/,IPRE=/^(\d{1,3}\.){3}\d{1,3}$/,CIDR=/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const HSNAME=/^[A-Za-z0-9._\- ]{1,40}$/;
const q=v=>`"${v}"`;// every value is validated against a whitelist pattern before it is quoted
const TYPES={
 'hotspot-expiry-refresh':{label:'Refresh hotspot expiry',risky:false,retry:true,params:{usernames:/^[A-Za-z0-9._@:\- ]{1,64}(,[A-Za-z0-9._@:\- ]{1,64}){0,99}$/,expiresAt:/^\d{1,16}$/},script:p=>`:local n 0; ${p.usernames.split(',').map(u=>`:foreach i in=[/ip hotspot active find where user=${q(u)}] do={ /ip hotspot active remove $i; :set n ($n+1) };`).join(' ')} :return ("refreshed " . $n . " hotspot session(s)")`},
 disconnect:{label:'Disconnect customer',risky:false,retry:true,params:{username:SAFE},script:p=>`:local n 0; :foreach i in=[/ppp active find where name=${q(p.username)}] do={ /ppp active remove $i; :set n ($n+1) }; :do { :foreach i in=[/ip hotspot active find where user=${q(p.username)}] do={ /ip hotspot active remove $i; :set n ($n+1) } } on-error={}; :return ("removed " . $n . " session(s)")`},
 'reset-device':{label:'Reset hotspot device',risky:false,retry:true,params:{mac:MACRE},script:p=>`:local n 0; :do { :foreach i in=[/ip hotspot active find where mac-address=${q(p.mac)}] do={ /ip hotspot active remove $i; :set n ($n+1) }; :foreach i in=[/ip hotspot cookie find where mac-address=${q(p.mac)}] do={ /ip hotspot cookie remove $i }; :foreach i in=[/ip hotspot host find where mac-address=${q(p.mac)}] do={ /ip hotspot host remove $i } } on-error={}; :return ("reset " . $n . " session(s)")`},
 connect:{label:'Connect hotspot device',risky:false,retry:true,params:{username:SAFE,password:/^[A-Za-z0-9._@\-]{1,64}$/,mac:MACRE,ip:IPRE},script:p=>`/ip hotspot active login user=${q(p.username)} password=${q(p.password)} mac-address=${p.mac} ip=${p.ip}; :return "connected"`},
 'backup-now':{label:'Take a config backup now',risky:false,retry:true,params:{},script:()=>`:global nhbackup true; /system script run network-hub-discovery; :return "backup requested"`},
 'push-design':{label:'Push hotspot login and status pages',risky:false,retry:true,params:{origin:/^https:\/\/[a-z0-9.-]+$/,folder:/^[A-Za-z0-9_-]{1,40}$/},script:p=>`/tool fetch url=${q(p.origin+'/portal/api/router/login.html')} dst-path=${q(p.folder+'/login.html')} check-certificate=yes; /tool fetch url=${q(p.origin+'/portal/api/router/status.html')} dst-path=${q(p.folder+'/status.html')} check-certificate=yes; /tool fetch url=${q(p.origin+'/portal/api/router/logout.html')} dst-path=${q(p.folder+'/logout.html')} check-certificate=yes; :return "pages updated"`},
 'static-apply':{label:'Apply static IP customer',risky:false,retry:true,params:{ip:IPRE,mac:/^$|^([0-9A-F]{2}:){5}[0-9A-F]{2}$/,iface:/^[A-Za-z0-9._-]{1,40}$/,name:SAFE,rate:/^\d+(\.\d+)?[kM]\/\d+(\.\d+)?[kM]$/,enabled:/^(yes|no)$/},script:p=>`:do { /ip arp remove [find where comment=${q('netops:'+p.name)}] } on-error={}; ${p.mac?`/ip arp add address=${p.ip} mac-address=${p.mac} interface=${q(p.iface)} comment=${q('netops:'+p.name)} disabled=${p.enabled==='yes'?'no':'yes'};`:''} :do { /queue simple remove [find where name=${q('netops-'+p.name)}] } on-error={}; /queue simple add name=${q('netops-'+p.name)} target=${p.ip}/32 max-limit=${p.rate} disabled=${p.enabled==='yes'?'no':'yes'}; :do { /ip firewall address-list remove [find where list="netops-static-off" and address=${p.ip}] } on-error={}; ${p.enabled==='yes'?'':`/ip firewall address-list add list="netops-static-off" address=${p.ip} comment=${q('netops:'+p.name)};`} :return "static customer applied"`},
 'static-remove':{label:'Remove static IP customer',risky:false,retry:true,params:{ip:IPRE,name:SAFE},script:p=>`:do { /ip arp remove [find where comment=${q('netops:'+p.name)}] } on-error={}; :do { /queue simple remove [find where name=${q('netops-'+p.name)}] } on-error={}; :do { /ip firewall address-list remove [find where list="netops-static-off" and address=${p.ip}] } on-error={}; :return "removed"`},
 'set-speed':{label:'Change a live session speed',risky:false,retry:false,params:{username:SAFE,rate:/^\d+(\.\d+)?[kM]\/\d+(\.\d+)?[kM]$/},script:p=>`:local n 0; :do { :foreach i in=[/queue simple find where name=${q('<pppoe-'+p.username+'>')}] do={ /queue simple set $i max-limit=${p.rate}; :set n ($n+1) } } on-error={}; :return ("updated " . $n . " queue(s)")`},
 // Hotspot servers: remove one by name, or create one on an existing interface / profile / address pool. Both are admin-only
 // (typed router-name confirmation). A removed server disconnects its customers until a server exists again.
 'hotspot-server-remove':{label:'Delete hotspot server',risky:true,retry:false,params:{name:HSNAME},script:p=>`:local n 0; :foreach i in=[/ip hotspot find where name=${q(p.name)}] do={ /ip hotspot remove $i; :set n ($n+1) }; :return ("removed ".$n)`},
 'hotspot-server-create':{label:'Create hotspot server',risky:true,retry:false,params:{name:HSNAME,iface:HSNAME,profile:HSNAME,pool:HSNAME},script:p=>`:if ([:len [/ip hotspot find where name=${q(p.name)}]]>0) do={ :return "already exists" }; /ip hotspot add name=${q(p.name)} interface=${q(p.iface)} address-pool=${q(p.pool)} profile=${q(p.profile)} disabled=no; :return "created"`},
 // Link a MikroTik: PPPoE/Hotspot on a new router. The spec was validated by provision.cjs; the script checks the
 // router first and returns "STOPPED: …" without changing anything if it already serves customers.
 'provision-services':{label:'Set up PPPoE / Hotspot (new router)',risky:true,retry:false,params:{spec:/^[A-Za-z0-9_-]{20,4000}$/,origin:/^https:\/\/[a-z0-9.-]+$/},script:p=>{const pv=require('./provision.cjs');return pv.servicesBody(pv.decodeSpec(p.spec),p.origin);}},
 // Neighbour discovery with LLDP, so access points (Ruijie, Ubiquiti, switches) show their own name and model.
 // Queued once for every router with the job runner; harmless to run again.
 'neighbor-discovery':{label:'Turn on neighbour discovery (LLDP)',risky:false,retry:true,params:{},script:()=>`:local r "on"; :do { /ip neighbor discovery-settings set protocol=cdp,lldp,mndp } on-error={ :set r "on (RouterOS 6 includes LLDP)" }; :do { :if (([/ip neighbor discovery-settings get discover-interface-list]="none") && ([/interface list print count-only where name="LAN"]>0)) do={ /ip neighbor discovery-settings set discover-interface-list=LAN; :set r ($r.", LAN ports") } } on-error={}; :return ("neighbour discovery ".$r)`},
 // Move a router that already serves customers (e.g. from ISPman) onto netops RADIUS. Other RADIUS entries are disabled and
 // tagged, not deleted, so "radius-rollback" puts them back. The secret is read when the job is sent, never stored in the job.
 'radius-move':{label:'Move logins to netops RADIUS',risky:true,retry:false,params:{src:/^$|^(\d{1,3}\.){3}\d{1,3}$/,mode:/^(all|test)$/,realm:/^$|^[a-z0-9.-]{1,40}$/},script:p=>{if(!/^[A-Za-z0-9_-]{8,80}$/.test(RADIUS_SECRET))fail('The RADIUS secret is not set on the server');
  const realm=p.mode==='test'?p.realm:'';
  return `:local n [/radius find where comment="netops RADIUS"]; :if ([:len $n]=0) do={ /radius add address=10.99.0.1 secret=${q(RADIUS_SECRET)} service=ppp,hotspot${p.src?' src-address='+p.src:''} timeout=3s comment="netops RADIUS"${realm?' realm='+realm:''} } else={ /radius set $n secret=${q(RADIUS_SECRET)} service=ppp,hotspot disabled=no realm="${realm}"${p.src?' src-address='+p.src:''} }; `+
   (p.mode==='all'?`:local off 0; :foreach i in=[/radius find where disabled=no and !(comment~"netops")] do={ /radius set $i disabled=yes comment=("netops-moved: ".[/radius get $i comment]); :set off ($off+1) }; `:`:local off 0; `)+
   `/ppp aaa set use-radius=yes accounting=yes interim-update=5m; :do { :foreach h in=[/ip hotspot profile find where use-radius=yes] do={ /ip hotspot profile set $h radius-interim-update=5m radius-accounting=yes } } on-error={}; `+
   `:return ("${p.mode==='all'?'all logins now use netops RADIUS':'test logins (@'+realm+') use netops RADIUS'}, ".$off." other RADIUS server(s) turned off")`;}},
 'radius-rollback':{label:'Undo the move to netops RADIUS',risky:true,retry:false,params:{},script:()=>`:local on 0; :foreach i in=[/radius find where comment~"^netops-moved: "] do={ :local c [/radius get $i comment]; /radius set $i disabled=no comment=[:pick $c 14 [:len $c]]; :set on ($on+1) }; :foreach i in=[/radius find where comment="netops RADIUS"] do={ /radius set $i disabled=yes }; :return ("netops RADIUS turned off, ".$on." earlier RADIUS server(s) back on")`},
 // The netops WiFi login and status pages, into every hotspot profile's own folder, and the portal allowed before login.
 'push-design-auto':{label:'Put the netops WiFi pages on this router',risky:false,retry:true,params:{origin:/^https:\/\/[a-z0-9.-]+$/,host:/^[a-z0-9.-]{3,120}$/},script:p=>`:local done 0; :foreach h in=[/ip hotspot profile find] do={ :local d [/ip hotspot profile get $h html-directory]; :if ([:len $d]>0) do={ /tool fetch url=${q(p.origin+'/portal/api/router/login.html')} dst-path=($d."/login.html") check-certificate=yes; /tool fetch url=${q(p.origin+'/portal/api/router/status.html')} dst-path=($d."/status.html") check-certificate=yes; /tool fetch url=${q(p.origin+'/portal/api/router/logout.html')} dst-path=($d."/logout.html") check-certificate=yes; :set done ($done+1) } }; :if ($done=0) do={ :return "no hotspot on this router, nothing to do" }; :if ([/ip hotspot walled-garden print count-only where dst-host=${q(p.host)}]=0) do={ /ip hotspot walled-garden add dst-host=${q(p.host)} comment="netops portal" }; :if ([/ip hotspot walled-garden ip print count-only where dst-host=${q(p.host)}]=0) do={ /ip hotspot walled-garden ip add dst-host=${q(p.host)} action=accept comment="netops portal (https)" }; :return ("netops pages in ".$done." hotspot profile(s)")`},
 'dns-flush':{label:'Flush the DNS cache',risky:false,retry:true,params:{},script:()=>`/ip dns cache flush; :return "DNS cache flushed"`},
 reboot:{label:'Reboot router',risky:true,retry:false,params:{},script:()=>`:execute ":delay 5s; /system reboot"; :return "rebooting in 5 seconds"`},
 upgrade:{label:'Upgrade RouterOS',risky:true,retry:false,params:{channel:/^(stable|long-term)$/},script:p=>`/system package update set channel=${p.channel}; /system package update check-for-updates; :delay 15s; :local s [/system package update get status]; :if ($s ~ "New version") do={ :execute ":delay 5s; /system package update install"; :return ("installing: " . $s) } else={ :return ("no install: " . $s) }`}
};
let RADIUS_SECRET='';const setRadiusSecret=v=>{RADIUS_SECRET=String(v||'');};
const MAX_ATTEMPTS=4,SENT_TIMEOUT=5*60000;
function create(store,{routerId,type,params={},confirm='',subscriberId=null,user,runAt=null},now=Date.now()){
 const t=TYPES[type];if(!t)fail('Unknown job');const router=store.get('devices',String(routerId||''));if(!router||router.type!=='router')fail('Router not found',404);
 if(!store.secret('jobs:'+router.id))fail(`${router.name} does not have the job runner installed. Install it from Router jobs first.`,409);
 if(t.risky&&String(confirm).trim()!==router.name)fail(`Type the router name (${router.name}) to confirm`);
 const clean={};for(const [k,re] of Object.entries(t.params)){const v=String(params[k]??'').trim();if(!re.test(v))fail('Invalid '+k);clean[k]=k==='mac'?v.toUpperCase():v;}
 // Optional start time ("run at"): the job waits in the queue and the router picks it up on its first check-in after it.
 let start=now;if(runAt!==null&&runAt!==undefined&&runAt!==''){start=typeof runAt==='number'?runAt:Date.parse(runAt);if(!Number.isFinite(start))fail('Invalid start time');if(start<now-6e4)fail('The start time is in the past');if(start>now+60*864e5)fail('Schedule at most 60 days ahead');}
 return store.put('routerJobs',{routerId:router.id,routerName:router.name,type,label:t.label,params:clean,subscriberId,status:'queued',attempts:0,maxAttempts:t.retry?MAX_ATTEMPTS:1,nextAttemptAt:start,runAt:start>now?start:null,createdAt:now,createdBy:user?.name||'',output:'',error:''});
}
// Called by the router's runner: hand over the oldest due job (one at a time per router).
// Once per router, half an hour after its job runner is installed (or after startup for routers that already have one), so it
// never gets ahead of the work an operator queues first: turn on LLDP neighbour discovery, so access points are named in Devices.
function autoJob(store,routerId,now){if(store.setting('ndisc:'+routerId))return null;const r=store.get('devices',routerId);if(!r||r.type!=='router')return null;
 store.setting('ndisc:'+routerId,{queuedAt:now});return store.put('routerJobs',{routerId:r.id,routerName:r.name,type:'neighbor-discovery',label:TYPES['neighbor-discovery'].label,params:{},subscriberId:null,status:'queued',attempts:0,maxAttempts:MAX_ATTEMPTS,nextAttemptAt:now+30*60000,runAt:now+30*60000,createdAt:now+30*60000,createdBy:'Automatic',output:'',error:''});}
// Where the netops WiFi pages come from (set at startup from the public address).
const PAGES={origin:'',host:''};function setPages(origin){try{const u=new URL(origin);PAGES.origin=u.origin;PAGES.host=u.hostname;}catch{}}
function queuePages(store,routerId,now=Date.now(),delay=0){if(!PAGES.origin||!store.secret('jobs:'+routerId))return null;
 if(store.list('routerJobs').some(x=>x.routerId===routerId&&x.type==='push-design-auto'&&['queued','sent'].includes(x.status)))return null;
 const r=store.get('devices',routerId);if(!r)return null;
 return store.put('routerJobs',{routerId:r.id,routerName:r.name,type:'push-design-auto',label:TYPES['push-design-auto'].label,params:{origin:PAGES.origin,host:PAGES.host},subscriberId:null,status:'queued',attempts:0,maxAttempts:MAX_ATTEMPTS,nextAttemptAt:now+delay,runAt:delay?now+delay:null,createdAt:now+delay,createdBy:'Automatic',output:'',error:''});}
function next(store,routerId,now=Date.now()){
 sweep(store,now);
 const jobs=store.list('routerJobs').filter(j=>j.routerId===routerId);
 if(jobs.some(j=>j.status==='sent'))return null;
 let j=jobs.filter(x=>x.status==='queued'&&x.nextAttemptAt<=now).sort((a,b)=>a.createdAt-b.createdAt)[0];if(!j)return null;
 if(j.type==='hotspot-expiry-refresh'){
  const names=require('./expirychange.cjs').currentNames(store,j);
  if(!names.length){store.put('routerJobs',{...j,status:'cancelled',finishedAt:now,output:'Expiry changed or account no longer owns these logins'},j);return next(store,routerId,now);}
  j.params={...j.params,usernames:names.join(',')};
 }
 const saved=store.put('routerJobs',{...j,status:'sent',sentAt:now,attempts:j.attempts+1},j);
 let script;try{script=TYPES[j.type].script(j.params);}catch(e){settle(store,saved,false,e.message,now);return null;}
 return {id:saved.id,script};
}
function settle(store,j,ok,detail,now){
 const retry=!ok&&j.attempts<j.maxAttempts,status=ok?'succeeded':retry?'queued':'failed';
 const saved=store.put('routerJobs',{...j,status,finishedAt:ok||!retry?now:null,nextAttemptAt:retry?now+Math.min(30*60000,60000*2**j.attempts):j.nextAttemptAt,output:ok?detail:j.output,error:ok?'':detail},j);
 if(ok&&j.type==='radius-move'&&j.params?.mode==='all'&&PAGES.origin){try{queuePages(store,j.routerId,now);}catch{}}
 if(j.subscriberId){const s=store.get('subscribers',j.subscriberId);if(s&&(ok||!retry))store.put('subscribers',{...s,provisioning:{status:ok?'ok':'failed',jobId:j.id,type:j.type,error:ok?'':detail,time:now}},s);}
 return saved;
}
function result(store,routerId,jobId,input,now=Date.now()){
 const j=store.get('routerJobs',jobId);if(!j||j.routerId!==routerId)fail('Job not found',404);if(j.status!=='sent')return j;
 // A job may refuse on the router ("STOPPED: …"): that is a failure, with the router's reason.
 const out=String(input.output??input.error??'').slice(0,500);return settle(store,j,input.ok===true&&!/^STOPPED:/.test(out),out,now);
}
// A job handed out but never answered (router lost power, script error) is retried or failed.
function sweep(store,now=Date.now()){for(const j of store.list('routerJobs'))if(j.status==='sent'&&now-j.sentAt>SENT_TIMEOUT)settle(store,j,false,'No answer from the router within 5 minutes',now);}
function cancel(store,id){const j=store.get('routerJobs',id);if(!j)fail('Job not found',404);if(!['queued'].includes(j.status))fail('Only waiting jobs can be cancelled',409);return store.put('routerJobs',{...j,status:'cancelled',finishedAt:Date.now()},j);}
function retry(store,id){const j=store.get('routerJobs',id);if(!j)fail('Job not found',404);if(j.status!=='failed')fail('Only failed jobs can be retried',409);if(TYPES[j.type].risky)fail('Risky jobs are never re-run automatically; create a new one');return store.put('routerJobs',{...j,status:'queued',attempts:0,maxAttempts:MAX_ATTEMPTS,nextAttemptAt:Date.now(),error:''},j);}
function overview(store,now=Date.now()){sweep(store,now);const routers=store.list('devices').filter(d=>d.type==='router').map(r=>{const sec=store.secret('jobs:'+r.id);return {id:r.id,name:r.name,enrolled:!!sec,lastPoll:store.setting('jobsPoll:'+r.id)?.time||null};});
 return {routers,jobs:store.list('routerJobs').sort((a,b)=>b.createdAt-a.createdAt).slice(0,300),types:Object.entries(TYPES).map(([k,t])=>({type:k,label:t.label,risky:t.risky}))};}
const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
function enroll(store,routerId){const r=store.get('devices',routerId);if(!r||r.type!=='router')fail('Router not found',404);const token=crypto.randomBytes(32).toString('base64url');store.secret('jobs:'+r.id,{tokenHash:hash(token),issuedAt:Date.now()});try{autoJob(store,r.id,Date.now());}catch{}return {router:r,token};}
function validToken(store,routerId,token){const sec=store.secret('jobs:'+routerId);if(!sec||typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return false;return crypto.timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(sec.tokenHash,'hex'));}
function runnerScript(origin,routerId,token){
 return `# Network Hub job runner (opt-in). Lets netops run whitelisted jobs you confirm in the dashboard
# (disconnect a customer, reset a hotspot device, backup, push portal pages, static IP, and - only after you type
# the router name - reboot or RouterOS upgrade). Remove it any time:
#   /system scheduler remove [find where name="network-hub-jobs"]; /system script remove [find where name="network-hub-jobs"]
{
 /system scheduler remove [find where name="network-hub-jobs"];
 /system script remove [find where name="network-hub-jobs"];
 /system script add name="network-hub-jobs" comment="Network Hub job runner" policy=read,write,test,ftp,reboot,policy,sensitive source={
  :if ([/system script job print count-only where script="network-hub-jobs"] > 1) do={ :error "already running" }
  :do {
   :local r [/tool fetch url="${origin}/api/router-jobs/next/${routerId}" http-header-field="Authorization:Bearer ${token}" check-certificate=yes http-max-redirect-count=0 output=user as-value idle-timeout=10s duration=20s];
   :local j [:deserialize from=json value=($r->"data")];
   :if ([:typeof ($j->"id")] = "str") do={
    :local ok true; :local out "";
    :do { :local f [:parse ($j->"script")]; :set out [:tostr [$f]] } on-error={ :set ok false; :set out "job failed on the router" }
    :local body [:serialize to=json value={"ok"=$ok;"output"=$out}];
    /tool fetch url=("${origin}/api/router-jobs/result/${routerId}/" . ($j->"id")) http-method=post http-header-field="Content-Type:application/json,Authorization:Bearer ${token}" http-data=$body check-certificate=yes http-max-redirect-count=0 output=none idle-timeout=10s duration=20s;
   }
  } on-error={ :log warning "Network Hub job runner could not reach netops" }
 }
 /system scheduler add name="network-hub-jobs" comment="Network Hub job runner every minute" interval=1m start-time=startup on-event="/system script run network-hub-jobs" policy=read,write,test,ftp,reboot,policy,sensitive disabled=no;
 :put "Network Hub job runner installed."
}
`;}
// Routers with the job runner that have not had neighbour discovery turned on yet.
function autoNeighbor(store,now=Date.now()){const out=[];for(const r of store.list('devices'))if(r.type==='router'&&store.secret('jobs:'+r.id)){const j=autoJob(store,r.id,now);if(j)out.push(j.id);}return out;}
module.exports={setRadiusSecret,setPages,queuePages,autoNeighbor,TYPES,create,next,result,sweep,cancel,retry,overview,enroll,validToken,runnerScript};
