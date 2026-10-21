'use strict';
const crypto=require('node:crypto');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
function number(value,label,max=1e20){if(value===null||value===''||value===undefined||typeof value==='boolean')fail('Missing '+label);const n=Number(value);if(!Number.isFinite(n)||n<0||n>max)fail('Invalid '+label);return n;}
function text(value,label,limit=250){if(typeof value!=='string'||!value.trim()||value.length>limit||/[\u0000-\u001F]/.test(value))fail('Invalid '+label);return value.trim();}
function boolean(value,label){if(typeof value!=='boolean')fail('Invalid '+label);return value;}
function normalize(input){
 if(input.schema!==1)fail('Unsupported telemetry schema');
 const cpu=number(input.cpu,'CPU',100),total=number(input.memoryTotal,'total memory',1e15),free=number(input.memoryFree,'free memory',1e15);if(!total||free>total)fail('Invalid memory observations');
 if(!Array.isArray(input.interfaces)||input.interfaces.length>64)fail('Report at most 64 interfaces');
 const names=new Set(),interfaces=input.interfaces.map(i=>{if(!i||typeof i!=='object')fail('Invalid interface');const name=text(i.name,'interface name');if(names.has(name))fail('Duplicate interface name');names.add(name);return {name,type:text(i.type||'unknown','interface type',100),running:boolean(i.running,'interface state'),disabled:boolean(i.disabled,'interface enabled state'),rx:number(i.rx,'receive counter'),tx:number(i.tx,'transmit counter')};});
 if(input.routes!==undefined&&(!Array.isArray(input.routes)||input.routes.length>32))fail('Report at most 32 default routes');
 const routes=(input.routes||[]).map(r=>({'dst-address':text(r.destination,'route destination',100),gateway:text(r.gateway||'unknown','route gateway'),distance:number(r.distance,'route distance',255),active:boolean(r.active,'route state')?'true':'false',disabled:boolean(r.disabled,'route enabled state')?'true':'false','check-gateway':typeof r.checkGateway==='string'?r.checkGateway.slice(0,50):''}));
 return {source:'routeros-script',identity:text(input.identity,'router identity'),version:text(input.version,'RouterOS version',100),model:text(input.model,'router model',128),architecture:text(input.architecture,'architecture',100),uptime:text(input.uptime,'uptime',100),cpu,memory:Math.round((total-free)/total*100),interfaces,interfacesTruncated:input.interfacesTruncated===true,routes,tunnels:null};
}
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
function validToken(token,secret){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||!secret?.tokenHash||!/^[a-f0-9]{64}$/.test(secret.tokenHash))return false;return crypto.timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(secret.tokenHash,'hex'));}
function generate(origin,id,token){
 const url=new URL(origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^[a-z0-9.-]+$/.test(url.hostname))fail('Configure an HTTPS public origin before generating a router script');
 if(!/^[a-f0-9-]{36}$/.test(id)||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Invalid script enrollment');
 const endpoint=url.origin+'/api/router-agent/check-in/'+id;
 return `# Network Hub HTTPS monitoring agent - RouterOS 7.16 or later
# Paste this entire block into the router terminal as an administrator.
# Installs only network-hub-agent script/scheduler. Keep this file private.
# Reports identity, resources, interface counters and IPv4 default routes.
{
 :do { :local probe [:serialize to=json value={"probe"=true}]; } on-error={ :error "Network Hub requires RouterOS 7.16 or later with JSON serialization"; }
 /system scheduler remove [find where name="network-hub-agent"];
 /system script remove [find where name="network-hub-agent"];
 /system script add name="network-hub-agent" comment="Network Hub HTTPS monitoring" policy=read,test,ftp source={
  :if ([/system script job print count-only where script="network-hub-agent"] > 1) do={ :error "Network Hub check-in is already running"; }
  :do {
   :local nics [:toarray ""];
   :local truncated false;
   :foreach row in=[/interface print stats as-value] do={
    :if ([:len $nics] < 64) do={
     :local interfaceId ($row->".id");
     :local item {"name"=($row->"name");"type"=[/interface get $interfaceId type];"running"=[/interface get $interfaceId running];"disabled"=[/interface get $interfaceId disabled];"rx"=($row->"rx-byte");"tx"=($row->"tx-byte")};
     :set nics ($nics, {$item});
    } else={ :set truncated true; }
   }
   :local defaults [:toarray ""];
   :foreach row in=[/ip route print as-value where dst-address="0.0.0.0/0"] do={
    :if ([:len $defaults] < 32) do={
     :local item {"destination"="0.0.0.0/0";"gateway"=[:tostr ($row->"gateway")];"distance"=($row->"distance");"active"=(($row->"active")=true);"disabled"=(($row->"disabled")=true);"checkGateway"=[:tostr ($row->"check-gateway")]};
     :set defaults ($defaults, {$item});
    }
   }
   :local payload {"schema"=1;"identity"=[/system identity get name];"version"=[/system resource get version];"model"=[/system resource get board-name];"architecture"=[/system resource get architecture-name];"uptime"=[:tostr [/system resource get uptime]];"cpu"=[/system resource get cpu-load];"memoryTotal"=[/system resource get total-memory];"memoryFree"=[/system resource get free-memory];"interfaces"=$nics;"interfacesTruncated"=$truncated;"routes"=$defaults};
   :local data [:serialize to=json value=$payload options=json.no-string-conversion];
   :local receipt [/tool fetch url="${endpoint}" http-method=post http-header-field="Content-Type:application/json,Authorization:Bearer ${token}" http-data=$data check-certificate=yes http-max-redirect-count=0 output=user as-value idle-timeout=10s duration=20s];
   :local ack [:deserialize from=json value=($receipt->"data")];
   :if (($ack->"ok") != true) do={ :error "Network Hub did not acknowledge the check-in"; }
  } on-error={ :log warning "Network Hub check-in failed; check Internet access, router time, trusted certificates and the current enrollment script"; }
 }
 /system scheduler add name="network-hub-agent" comment="Network Hub every 30 seconds" interval=30s start-time=startup on-event="/system script run network-hub-agent" policy=read,test,ftp disabled=no;
 /system script run network-hub-agent;
 :put "Network Hub agent installed. Check the router in your dashboard after 30 seconds.";
}
`;
}
module.exports={normalize,hash,validToken,generate};
