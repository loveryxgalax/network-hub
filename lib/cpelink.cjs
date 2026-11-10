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
function base(sub,m){return {name:`${sub.name||sub.username} router`,type:'cpe',driver:'none',cpeCategory:'Customer router',customer:sub.name||sub.username,phone:sub.phone||'',subscriberId:sub.id,macAddress:m,...(require('./ruijie.cjs').isRuijieMac(m)?{vendor:'Ruijie',name:`${sub.name||sub.username} Ruijie router`}:{})};}

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
function allow(store,ser,label,migrate=false){const pub=radius().settings(store).acsPublicUrl||process.env.NETWORK_ACS_PUBLIC_URL||'';
 const dir=process.env.NETWORK_ACS_PRIVATE_DIR;if(!dir)return {allowed:false,why:'The hub has no access to the ACS credentials folder (NETWORK_ACS_PRIVATE_DIR).'};
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),file=path.join(dir,'cpes.json');
 try{const data=JSON.parse(fs.readFileSync(file,'utf8'));data.devices??={};let e=data.devices[ser];
  if(e&&e.enabled===false)return {allowed:false,why:'This serial was disabled on the ACS; enable it deliberately first.'};
  if(!e){const fresh=crypto.randomBytes(32).toString('base64url');e={label,enabled:true,password:fresh,connectionRequestPassword:crypto.randomBytes(32).toString('base64url'),createdAt:new Date().toISOString()};
   // A device that arrived on the shared bootstrap login keeps it until its own login has been delivered to it.
   if(migrate&&data.bootstrap?.enabled&&data.bootstrap.password){e.next=fresh;e.password=data.bootstrap.password;}}
  // A device pinned to its own ACS address (e.g. the non-SNI endpoint for a Cambium) keeps it; others record the global one.
  e.label=String(label).slice(0,100);if(pub&&!e.acsUrlPinned)e.acsUrl=pub;data.devices[ser]=e;
  const tmp=file+'.new';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);
  return {allowed:true,password:e.next||e.password,pending:!!e.next,crUser:ser+'-cr',crPassword:e.connectionRequestPassword,acsUrl:e.acsUrlPinned?e.acsUrl:''};
 }catch(err){return {allowed:false,why:'Could not update the ACS allow-list: '+err.message};}
}
// What the installer or admin enters on the device's TR-069 page.
function acsInfo(store,ser,label,migrate=false){
 const a=allow(store,ser,label,migrate),url=a.acsUrl||radius().settings(store).acsPublicUrl||process.env.NETWORK_ACS_PUBLIC_URL||'';
 return {pending:!!a.pending,url,username:ser,interval:'60 s',allowed:a.allowed,password:a.password||'',crUser:a.crUser||'',crPassword:a.crPassword||'',
  command:`node deployment/acs/enroll-cpe.cjs ${ser} "${String(label).replace(/"/g,'')}" <HTTPS_ACS_URL> <PRIVATE_OUTPUT_FILE>`,note:[a.why,url?'':'Enter your ACS address in Settings → RADIUS → Live changes to show it here.'].filter(Boolean).join(' ')};
}

// Per-device ACS address: pin one serial to a different HTTPS ACS URL (for example https://acs.example/cwmp/ for a CPE that
// cannot send SNI), or clear the pin (url empty) so it follows the global address again. netops never writes this address
// into the device itself; it is what installers are shown and what is kept on record for that serial.
function pinAcsUrl(store,serialValue,url,user){const ser=serial(serialValue);if(!ser)fail('Enter the serial number exactly as printed on the device');
 let clean='';if(url){let u;try{u=new URL(String(url).trim());}catch{fail('The ACS address must be a full https:// address');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!/^\/cwmp(\/|$)/.test(u.pathname))fail('Use an https:// address ending in /cwmp/ with no login, query or fragment');clean=u.href;}
 const dir=process.env.NETWORK_ACS_PRIVATE_DIR;if(!dir)fail('The hub has no access to the ACS credentials folder (NETWORK_ACS_PRIVATE_DIR).',409);
 const fs=require('node:fs'),path=require('node:path'),file=path.join(dir,'cpes.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));data.devices??={};const e=data.devices[ser];
 if(!e)fail('This serial is not on the ACS allow-list yet. Register the device first.',404);
 if(clean){e.acsUrl=clean;e.acsUrlPinned=true;}else{delete e.acsUrlPinned;e.acsUrl=radius().settings(store).acsPublicUrl||process.env.NETWORK_ACS_PUBLIC_URL||'';}
 const tmp=file+'.new';fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);
 store.audit(user||{id:'system'},clean?`Pinned ${ser} to ACS address ${clean}`:`Cleared the ACS address pin for ${ser}`,ser);return {serial:ser,acsUrl:e.acsUrl,pinned:!!clean};}

function register(store,input,user,migrate=false){
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
 return {device:d,acs:acsInfo(store,ser,rec.name,migrate)};
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

// ---- Automatic enrolment of unknown routers ------------------------------------------------------------------
// With the shared "bootstrap" login enabled, a router that has never been registered can still reach the ACS. Each time the ACS
// list is read, an unknown serial is matched to a customer by (1) the PPPoE username it reports, else (2) its WAN IP equal to a
// live PPPoE session's IP. Only a single, unambiguous match is registered; everything else is listed for a person to review.
const priv=()=>{const d=process.env.NETWORK_ACS_PRIVATE_DIR;return d?require('node:path').join(d,'cpes.json'):null;};
function readFile(){const f=priv();if(!f)return null;try{return JSON.parse(require('node:fs').readFileSync(f,'utf8'));}catch{return null;}}
function writeFile(d){const fs=require('node:fs'),f=priv(),t=f+'.new';fs.writeFileSync(t,JSON.stringify(d,null,2)+'\n',{mode:0o600});fs.renameSync(t,f);}
function bootstrap(store,enable,user){
 const d=readFile();if(!d)throw Object.assign(new Error('The hub cannot reach the ACS credentials folder (NETWORK_ACS_PRIVATE_DIR).'),{status:400});
 const crypto=require('node:crypto');d.bootstrap={enabled:enable===true,password:d.bootstrap?.password||crypto.randomBytes(32).toString('base64url')};writeFile(d);
 store.audit(user,enable?'Turned on the shared ACS bootstrap login (new routers may connect)':'Turned off the shared ACS bootstrap login','acs');return status(store);}
function status(store){const d=readFile(),s=radius().settings(store);return {available:!!d,bootstrap:!!d?.bootstrap?.enabled,password:d?.bootstrap?.enabled?d.bootstrap.password:'',autoRegister:s.acsAutoRegister===true,url:s.acsPublicUrl||process.env.NETWORK_ACS_PUBLIC_URL||''};}
function commit(ser){const d=readFile();const e=d?.devices?.[ser];if(e?.next){e.password=e.next;delete e.next;writeFile(d);return true;}return false;}
function match(store,row,now){
 const subs=store.list('subscribers').filter(x=>x.service==='pppoe');const names=(row.ppp||[]).map(p=>String(p.username||'').toLowerCase()).filter(Boolean);
 const byName=[...new Set(names.map(n=>{try{return radius().stripRealm(store,n);}catch{return n;}}))].map(n=>subs.find(x=>x.username===n)).filter(Boolean);
 if(byName.length===1)return {sub:byName[0],how:'PPPoE username '+byName[0].username};if(byName.length>1)return null;
 if(!row.wanIp)return null;const live=store.list('radiusSessions').filter(x=>!x.stoppedAt&&now-(x.updatedAt||0)<15*60000&&x.ip===row.wanIp);
 const users=[...new Set(live.map(x=>x.username))].map(n=>subs.find(x=>x.username===n)).filter(Boolean);
 return users.length===1?{sub:users[0],how:'IP '+row.wanIp+' of a live PPPoE session'}:null;}
async function autoRegister(store,rows,acs,now=Date.now()){
 const out={registered:[],unmatched:[]};if(process.env.NETWORK_PASSIVE==='1'||radius().settings(store).acsAutoRegister!==true||!readFile()?.bootstrap?.enabled)return out;
 const known=new Set(store.list('devices').filter(d=>d.type==='cpe'&&d.serial).map(d=>d.serial));
 for(const row of rows||[]){const ser=String(row.serial||'').trim();if(!serial(ser)||known.has(ser))continue;
  const m=match(store,row,now);if(!m){out.unmatched.push(ser);if(acs?.askPppLogin&&!(row.ppp||[]).length&&!row.wanIp){try{await acs.askPppLogin(store,row,now);}catch{}}continue;}
  const mine=cpeOf(store,m.sub);if(mine.some(d=>d.serial&&d.serial!==ser)){out.unmatched.push(ser);continue;}   // never take over a customer who already has a different registered router
  try{const r=register(store,{subscriberId:m.sub.id,serial:ser,vendor:row.manufacturer,model:row.model||row.productClass},{id:'system'},true);
   store.audit({id:'system'},`Registered ${ser} automatically for ${m.sub.username} (matched by ${m.how})`,m.sub.id);out.registered.push(ser);
   if(r.acs.pending&&acs){try{const t=await acs.task(store,row.id,'credentials',{username:ser,password:r.acs.password,crUser:r.acs.crUser,crPassword:r.acs.crPassword});if(t.status==='Executed by ACS'){commit(ser);store.audit({id:'system'},`${ser} now uses its own ACS login`,m.sub.id);}}catch{/* stays on the shared login until it can be moved */}}
  }catch{out.unmatched.push(ser);}}
 return out;}
module.exports={pinAcsUrl,mac,serial,enabled,autoLink,register,verify,acsInfo,allow,bootstrap,status,autoRegister,commit,match};
