'use strict';
// Links a PPPoE customer to their router/ONT (CPE) and prepares it for TR-069.
//  * autoLink: on a customer's login, remember the device MAC the line came from (Calling-Station-Id) on a CPE inventory entry.
//  * register: the installer types/scans the serial + MAC from the label; the CPE entry is created or updated, marked
//    "Ready for enrollment", and the exact ACS settings / enrolment command are returned.
//  * verify: a CPE whose serial has checked in to the ACS is marked "Managed / check-in observed".
// allow() writes the ACS allow-list when the hub shares the ACS private volume; otherwise the enrol command is shown.
const radius=()=>require('./radius.cjs');
const fail=m=>{throw Object.assign(new Error(m),{status:400});};
const mac=v=>{const h=String(v||'').toLowerCase().replace(/[^0-9a-f]/g,'');return h.length===12?h.match(/../g).join(':'):'';};
const serial=v=>{const s=String(v||'').trim();return /^[A-Za-z0-9_.:-]{3,100}$/.test(s)?s:'';};
const enabled=store=>radius().settings(store).autoLinkCpe!==false;
const cpeOf=(store,sub)=>store.list('devices').filter(d=>d.type==='cpe'&&d.subscriberId===sub.id);
function base(sub,m){return {name:`${sub.name||sub.username} router`,type:'cpe',driver:'none',cpeCategory:'Customer router',customer:sub.name||sub.username,phone:sub.phone||'',subscriberId:sub.id,macAddress:m};}

// First PPPoE login: record the device MAC. Never overwrites a MAC the installer or admin already set.
function autoLink(store,username,callingStation,now=Date.now()){
 if(!enabled(store)||process.env.NETWORK_PASSIVE==='1')return {skipped:'off'};
 const m=mac(callingStation);if(!m)return {skipped:'no mac'};
 const sub=store.subscriberByUsername(username);if(!sub||sub.service!=='pppoe')return {skipped:'not pppoe'};
 const mine=cpeOf(store,sub);
 if(mine.some(d=>d.macAddress===m))return {skipped:'already linked'};
 const free=mine.find(d=>!d.macAddress);
 if(free){store.put('devices',{...free,macAddress:m,notes:((free.notes||'')+`\nMAC filled from the customer's login on ${new Date(now).toISOString().slice(0,10)}.`).trim()},free);store.audit({id:'system'},`Filled the MAC ${m} on ${free.name} from ${sub.username}'s login`,sub.id);return {updated:free.id};}
 if(mine.length)return {skipped:'has other device'};     // a different MAC on a customer who already has a CPE: do not guess
 const dup=store.list('devices').find(d=>d.type==='cpe'&&d.macAddress===m);if(dup)return {skipped:'mac used by another customer'};
 const d=store.put('devices',{...base(sub,m),managementMethod:'Unknown',onboardingStatus:'Observed',notes:`Detected automatically from ${sub.username}'s first PPPoE login on ${new Date(now).toISOString().slice(0,10)}. Add the serial number to enrol it on TR-069.`});
 store.audit({id:'system'},`Linked a router (${m}) to ${sub.username} from their first login`,sub.id);return {created:d.id};
}

// Allow the serial on the private ACS: writes the same file the ACS container reads (shared volume NETWORK_ACS_PRIVATE_DIR).
// Existing credentials are reused, a disabled serial is never re-enabled automatically.
function allow(store,ser,label){const pub=radius().settings(store).acsPublicUrl||process.env.NETWORK_ACS_PUBLIC_URL||'';
 const dir=process.env.NETWORK_ACS_PRIVATE_DIR;if(!dir)return {allowed:false,why:'The hub has no access to the ACS credentials folder (NETWORK_ACS_PRIVATE_DIR).'};
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),file=path.join(dir,'cpes.json');
 try{const data=JSON.parse(fs.readFileSync(file,'utf8'));data.devices??={};let e=data.devices[ser];
  if(e&&e.enabled===false)return {allowed:false,why:'This serial was disabled on the ACS; enable it deliberately first.'};
  if(!e){e={label,enabled:true,password:crypto.randomBytes(32).toString('base64url'),connectionRequestPassword:crypto.randomBytes(32).toString('base64url'),createdAt:new Date().toISOString()};}
  e.label=String(label).slice(0,100);if(pub)e.acsUrl=pub;data.devices[ser]=e;
  const tmp=file+'.new';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);
  return {allowed:true,password:e.password,crUser:ser+'-cr',crPassword:e.connectionRequestPassword};
 }catch(err){return {allowed:false,why:'Could not update the ACS allow-list: '+err.message};}
}
// What the installer or admin enters on the device's TR-069 page.
function acsInfo(store,ser,label){
 const url=radius().settings(store).acsPublicUrl||process.env.NETWORK_ACS_PUBLIC_URL||'',a=allow(store,ser,label);
 return {url,username:ser,interval:'60 s',allowed:a.allowed,password:a.password||'',crUser:a.crUser||'',crPassword:a.crPassword||'',
  command:`node deployment/acs/enroll-cpe.cjs ${ser} "${String(label).replace(/"/g,'')}" <HTTPS_ACS_URL> <PRIVATE_OUTPUT_FILE>`,note:[a.why,url?'':'Enter your ACS address in Settings → RADIUS → Live changes to show it here.'].filter(Boolean).join(' ')};
}

function register(store,input,user){
 const sub=store.get('subscribers',String(input.subscriberId||''));if(!sub)fail('Choose the customer');
 const ser=serial(input.serial);if(!ser)fail('Enter the serial number exactly as printed on the device (letters, numbers, - _ . :)');
 const m=input.mac?mac(input.mac):'';if(input.mac&&!m)fail('That MAC address is not valid (12 hex digits)');
 const other=store.list('devices').find(d=>d.type==='cpe'&&d.serial===ser&&d.subscriberId!==sub.id);if(other)fail(`This serial is already registered to ${other.customer||'another customer'}`);
 if(m){const dm=store.list('devices').find(d=>d.type==='cpe'&&d.macAddress===m&&d.subscriberId&&d.subscriberId!==sub.id);if(dm)fail(`This MAC belongs to ${dm.customer||'another customer'}`);}
 const mine=cpeOf(store,sub),cur=mine.find(d=>d.serial===ser)||mine.find(d=>!d.serial)||null;
 const rec={...(cur||base(sub,m)),...base(sub,m||cur?.macAddress||''),serial:ser,vendor:input.vendor?String(input.vendor).slice(0,60):(cur?.vendor||''),model:input.model?String(input.model).slice(0,60):(cur?.model||''),
  managementMethod:'TR-069 / GenieACS',onboardingStatus:cur?.onboardingStatus==='Managed / check-in observed'?cur.onboardingStatus:'Ready for enrollment'};
 const d=store.put('devices',rec,cur||undefined);
 store.audit(user,`Registered router ${ser}${m?' ('+m+')':''} for ${sub.username} and prepared it for TR-069`,sub.id);
 return {device:d,acs:acsInfo(store,ser,rec.name)};
}

// Compare registered CPEs with what the ACS has seen; mark the ones that have checked in.
function verify(store,acsDevices,now=Date.now()){
 const seen=new Map((acsDevices||[]).map(a=>[String(a.serial||'').trim(),a]));const done=[];
 for(const d of store.list('devices')){
  if(d.type!=='cpe'||!d.serial||d.onboardingStatus==='Managed / check-in observed')continue;const a=seen.get(d.serial);if(!a)continue;
  store.put('devices',{...d,onboardingStatus:'Managed / check-in observed',managementMethod:'TR-069 / GenieACS',remoteEnrollmentVerified:true,vendor:d.vendor||a.manufacturer||'',model:d.model||a.model||a.productClass||'',firmware:d.firmware||a.software||''},d);
  store.audit({id:'system'},`${d.serial} checked in to the ACS; marked as managed`,d.subscriberId||d.id);done.push(d.serial);}
 return done;
}
module.exports={mac,serial,enabled,autoLink,register,verify,acsInfo,allow};
