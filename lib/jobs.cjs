'use strict';
// Router jobs: an opt-in runner script on the router asks netops for work every minute over HTTPS, runs one job
// from a fixed whitelist, and reports the result. Netops never connects in to a router, never runs free-form
// commands, and the risky jobs (reboot, RouterOS upgrade) need the operator to type the router's name and are
// never retried automatically.
const crypto=require('node:crypto');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const SAFE=/^[A-Za-z0-9._@:\- ]{1,64}$/,MACRE=/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/,IPRE=/^(\d{1,3}\.){3}\d{1,3}$/,CIDR=/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const q=v=>`"${v}"`;// every value is validated against a whitelist pattern before it is quoted
const TYPES={
 disconnect:{label:'Disconnect customer',risky:false,retry:true,params:{username:SAFE},script:p=>`:local n 0; :foreach i in=[/ppp active find where name=${q(p.username)}] do={ /ppp active remove $i; :set n ($n+1) }; :do { :foreach i in=[/ip hotspot active find where user=${q(p.username)}] do={ /ip hotspot active remove $i; :set n ($n+1) } } on-error={}; :return ("removed " . $n . " session(s)")`},
 'reset-device':{label:'Reset hotspot device',risky:false,retry:true,params:{mac:MACRE},script:p=>`:local n 0; :do { :foreach i in=[/ip hotspot active find where mac-address=${q(p.mac)}] do={ /ip hotspot active remove $i; :set n ($n+1) }; :foreach i in=[/ip hotspot cookie find where mac-address=${q(p.mac)}] do={ /ip hotspot cookie remove $i }; :foreach i in=[/ip hotspot host find where mac-address=${q(p.mac)}] do={ /ip hotspot host remove $i } } on-error={}; :return ("reset " . $n . " session(s)")`},
 connect:{label:'Connect hotspot device',risky:false,retry:true,params:{username:SAFE,password:/^[A-Za-z0-9._@\-]{1,64}$/,mac:MACRE,ip:IPRE},script:p=>`/ip hotspot active login user=${q(p.username)} password=${q(p.password)} mac-address=${p.mac} ip=${p.ip}; :return "connected"`},
 'backup-now':{label:'Take a config backup now',risky:false,retry:true,params:{},script:()=>`:global nhbackup true; /system script run network-hub-discovery; :return "backup requested"`},
 'push-design':{label:'Push hotspot login and status pages',risky:false,retry:true,params:{origin:/^https:\/\/[a-z0-9.-]+$/,folder:/^[A-Za-z0-9_-]{1,40}$/},script:p=>`/tool fetch url=${q(p.origin+'/portal/api/router/login.html')} dst-path=${q(p.folder+'/login.html')} check-certificate=yes; /tool fetch url=${q(p.origin+'/portal/api/router/status.html')} dst-path=${q(p.folder+'/status.html')} check-certificate=yes; :return "pages updated"`},
 'static-apply':{label:'Apply static IP customer',risky:false,retry:true,params:{ip:IPRE,mac:/^$|^([0-9A-F]{2}:){5}[0-9A-F]{2}$/,iface:/^[A-Za-z0-9._-]{1,40}$/,name:SAFE,rate:/^\d+(\.\d+)?[kM]\/\d+(\.\d+)?[kM]$/,enabled:/^(yes|no)$/},script:p=>`:do { /ip arp remove [find where comment=${q('netops:'+p.name)}] } on-error={}; ${p.mac?`/ip arp add address=${p.ip} mac-address=${p.mac} interface=${q(p.iface)} comment=${q('netops:'+p.name)} disabled=${p.enabled==='yes'?'no':'yes'};`:''} :do { /queue simple remove [find where name=${q('netops-'+p.name)}] } on-error={}; /queue simple add name=${q('netops-'+p.name)} target=${p.ip}/32 max-limit=${p.rate} disabled=${p.enabled==='yes'?'no':'yes'}; :do { /ip firewall address-list remove [find where list="netops-static-off" and address=${p.ip}] } on-error={}; ${p.enabled==='yes'?'':`/ip firewall address-list add list="netops-static-off" address=${p.ip} comment=${q('netops:'+p.name)};`} :return "static customer applied"`},
 'static-remove':{label:'Remove static IP customer',risky:false,retry:true,params:{ip:IPRE,name:SAFE},script:p=>`:do { /ip arp remove [find where comment=${q('netops:'+p.name)}] } on-error={}; :do { /queue simple remove [find where name=${q('netops-'+p.name)}] } on-error={}; :do { /ip firewall address-list remove [find where list="netops-static-off" and address=${p.ip}] } on-error={}; :return "removed"`},
 'set-speed':{label:'Change a live session speed',risky:false,retry:false,params:{username:SAFE,rate:/^\d+(\.\d+)?[kM]\/\d+(\.\d+)?[kM]$/},script:p=>`:local n 0; :do { :foreach i in=[/queue simple find where name=${q('<pppoe-'+p.username+'>')}] do={ /queue simple set $i max-limit=${p.rate}; :set n ($n+1) } } on-error={}; :return ("updated " . $n . " queue(s)")`},
 // Link a MikroTik: PPPoE/Hotspot on a new router. The spec was validated by provision.cjs; the script checks the
 // router first and returns "STOPPED: …" without changing anything if it already serves customers.
 'provision-services':{label:'Set up PPPoE / Hotspot (new router)',risky:true,retry:false,params:{spec:/^[A-Za-z0-9_-]{20,4000}$/,origin:/^https:\/\/[a-z0-9.-]+$/},script:p=>{const pv=require('./provision.cjs');return pv.servicesBody(pv.decodeSpec(p.spec),p.origin);}},
 reboot:{label:'Reboot router',risky:true,retry:false,params:{},script:()=>`:execute ":delay 5s; /system reboot"; :return "rebooting in 5 seconds"`},
 upgrade:{label:'Upgrade RouterOS',risky:true,retry:false,params:{channel:/^(stable|long-term)$/},script:p=>`/system package update set channel=${p.channel}; /system package update check-for-updates; :delay 15s; :local s [/system package update get status]; :if ($s ~ "New version") do={ :execute ":delay 5s; /system package update install"; :return ("installing: " . $s) } else={ :return ("no install: " . $s) }`}
};
const MAX_ATTEMPTS=4,SENT_TIMEOUT=5*60000;
function create(store,{routerId,type,params={},confirm='',subscriberId=null,user},now=Date.now()){
 const t=TYPES[type];if(!t)fail('Unknown job');const router=store.get('devices',String(routerId||''));if(!router||router.type!=='router')fail('Router not found',404);
 if(!store.secret('jobs:'+router.id))fail(`${router.name} does not have the job runner installed. Install it from Router jobs first.`,409);
 if(t.risky&&String(confirm).trim()!==router.name)fail(`Type the router name (${router.name}) to confirm`);
 const clean={};for(const [k,re] of Object.entries(t.params)){const v=String(params[k]??'').trim();if(!re.test(v))fail('Invalid '+k);clean[k]=k==='mac'?v.toUpperCase():v;}
 return store.put('routerJobs',{routerId:router.id,routerName:router.name,type,label:t.label,params:clean,subscriberId,status:'queued',attempts:0,maxAttempts:t.retry?MAX_ATTEMPTS:1,nextAttemptAt:now,createdAt:now,createdBy:user?.name||'',output:'',error:''});
}
// Called by the router's runner: hand over the oldest due job (one at a time per router).
function next(store,routerId,now=Date.now()){
 sweep(store,now);const jobs=store.list('routerJobs').filter(j=>j.routerId===routerId);
 if(jobs.some(j=>j.status==='sent'))return null;
 const j=jobs.filter(x=>x.status==='queued'&&x.nextAttemptAt<=now).sort((a,b)=>a.createdAt-b.createdAt)[0];if(!j)return null;
 const saved=store.put('routerJobs',{...j,status:'sent',sentAt:now,attempts:j.attempts+1},j);
 return {id:saved.id,script:TYPES[j.type].script(j.params)};
}
function settle(store,j,ok,detail,now){
 const retry=!ok&&j.attempts<j.maxAttempts,status=ok?'succeeded':retry?'queued':'failed';
 const saved=store.put('routerJobs',{...j,status,finishedAt:ok||!retry?now:null,nextAttemptAt:retry?now+Math.min(30*60000,60000*2**j.attempts):j.nextAttemptAt,output:ok?detail:j.output,error:ok?'':detail},j);
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
function enroll(store,routerId){const r=store.get('devices',routerId);if(!r||r.type!=='router')fail('Router not found',404);const token=crypto.randomBytes(32).toString('base64url');store.secret('jobs:'+r.id,{tokenHash:hash(token),issuedAt:Date.now()});return {router:r,token};}
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
module.exports={TYPES,create,next,result,sweep,cancel,retry,overview,enroll,validToken,runnerScript};
