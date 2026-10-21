'use strict';
// Run as root in NetworkHub-ACS. Credential-bearing output must remain private.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [serial,label,origin,output]=process.argv.slice(2);
if(process.platform!=='linux'||process.getuid()!==0)throw new Error('Run this helper as root inside the dedicated ACS environment.');
if(!/^[A-Za-z0-9_.:-]{3,100}$/.test(serial||'')||!label||label.length>100||!output)throw new Error('Usage: enroll-cpe.cjs SERIAL LABEL HTTPS_ACS_URL PRIVATE_OUTPUT_FILE');
const url=new URL(origin);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Use an HTTPS ACS URL without embedded credentials.');
const file='/etc/network-hub-acs/cpes.json',stat=fs.statSync(file),data=JSON.parse(fs.readFileSync(file,'utf8'));
data.devices??={};let entry=data.devices[serial];
if(!entry){entry={label,enabled:true,password:crypto.randomBytes(32).toString('base64url'),connectionRequestPassword:crypto.randomBytes(32).toString('base64url'),createdAt:new Date().toISOString()};data.devices[serial]=entry;}
if(!entry.enabled)throw new Error('This serial was disabled. Review it before enabling enrollment.');
entry.label=label;entry.acsUrl=url.href;
const temporary=file+'.new';
fs.writeFileSync(temporary,JSON.stringify(data,null,2)+'\n',{mode:0o640});fs.chownSync(temporary,stat.uid,stat.gid);fs.chmodSync(temporary,0o640);fs.renameSync(temporary,file);
const literal=s=>'"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\$/g,'\\$')+'"';
const script=`# Network Hub TR-069 enrollment for the intended router only. Keep private.
{
 :if ([/system routerboard get serial-number] != ${literal(serial)}) do={ :error "This enrollment belongs to another router"; }
 :local currentUrl [/tr069-client get acs-url];
 :if (([:len $currentUrl] > 0) && ($currentUrl != ${literal(url.href)})) do={ :error "An existing ACS is configured; review migration before replacing it"; }
 /tr069-client set acs-url=${literal(url.href)} username=${literal(serial)} password=${literal(entry.password)} connection-request-username=${literal(serial+'-cr')} connection-request-password=${literal(entry.connectionRequestPassword)} periodic-inform-enabled=yes periodic-inform-interval=1m enabled=yes;
 :log info "Network Hub TR-069 enrollment enabled; verify an authenticated Inform in the dashboard";
 /system script remove [find where name="network-hub-tr069-setup"];
}
`;
if(!fs.existsSync(path.dirname(output)))throw new Error('Create the private output directory first.');
fs.writeFileSync(output,script,{mode:0o600});
console.log(JSON.stringify({serial,label,acsUrl:url.href,username:serial,privateOutput:output,intervalSeconds:60,credentials:'kept private; existing credentials are reused on repeat generation'}));
