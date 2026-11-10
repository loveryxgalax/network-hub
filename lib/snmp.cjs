'use strict';
const snmp=require('net-snmp');
const net=require('node:net');
function profile(text){
 let p;try{p=text?JSON.parse(text):{};}catch{throw new Error('The SNMP mapping must be valid JSON');}
 if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('The SNMP mapping must be an object');
 const result={};for(const key of ['serialOid','statusOid','ponOid','nameOid','rxPowerOid','txPowerOid'])if(p[key]){const value=String(p[key]).replace(/^\./,'');if(!/^[0-2](?:\.\d+){2,40}$/.test(value))throw new Error('Invalid '+key);result[key]=value;}
 if(Object.keys(result).length&&!result.serialOid)throw new Error('A serialOid column is required to identify ONUs');
 if(result.serialOid&&!result.statusOid)throw new Error('A statusOid column is required to verify ONU state');
 result.onlineValues=p.onlineValues??[1];if(!Array.isArray(result.onlineValues)||!result.onlineValues.length||result.onlineValues.length>16||result.onlineValues.some(v=>!['string','number'].includes(typeof v)))throw new Error('onlineValues must list the vendor online states');
 result.powerScale=p.powerScale??1;result.powerOffset=p.powerOffset??0;for(const k of ['powerScale','powerOffset'])if(!Number.isFinite(result[k])||Math.abs(result[k])>1000000)throw new Error('Invalid '+k);
 result.serialEncoding=p.serialEncoding??'utf8';if(!['utf8','hex'].includes(result.serialEncoding))throw new Error('serialEncoding must be utf8 or hex');return result;
}
async function snapshot(device,secret){
 if(!secret)throw new Error('SNMP credentials have not been configured');const mapping=profile(device.snmpMapping),options={port:device.snmpPort||161,retries:0,timeout:2500,transport:net.isIP(device.ip)===6?'udp6':'udp4'};
 const session=secret.version==='2c'?snmp.createSession(device.ip,secret.community,{...options,version:snmp.Version2c}):snmp.createV3Session(device.ip,{name:secret.username,level:snmp.SecurityLevel.authPriv,authProtocol:secret.authProtocol==='sha'?snmp.AuthProtocols.sha:snmp.AuthProtocols.sha256,authKey:secret.authKey,privProtocol:snmp.PrivProtocols.aes,privKey:secret.privKey},options);
 let overall;const failed=()=>new Error('SNMP collection failed. Check reachability, credentials and the vendor MIB mapping.');
 const get=oids=>new Promise((resolve,reject)=>session.get(oids,(error,values)=>{if(error||values.some(snmp.isVarbindError))return reject(failed());resolve(values);}));
 const walk=oid=>new Promise((resolve,reject)=>{const values=new Map();let invalid=false;session.subtree(oid,20,binds=>{for(const b of binds){if(snmp.isVarbindError(b)||!b.oid.startsWith(oid+'.')){invalid=true;return true;}if(values.size>=5000){invalid=true;return true;}values.set(b.oid.slice(oid.length+1),b.value);}},error=>error||invalid?reject(failed()):resolve(values));});
 session.on('error',()=>{});
 try{return await Promise.race([(async()=>{
  const system=await get(['1.3.6.1.2.1.1.1.0','1.3.6.1.2.1.1.3.0']);const model=String(system[0].value).slice(0,250),seconds=Number(system[1].value)/100;if(!Number.isFinite(seconds))throw failed();
  const result={model,uptime:Math.floor(seconds/86400)+'d '+Math.floor(seconds/3600)%24+'h '+Math.floor(seconds/60)%60+'m',source:'snmp',onuCoverage:mapping.serialOid?'configured':'MIB mapping not configured'};
  if(!mapping.serialOid)return result;
  const columns={};for(const key of ['serialOid','statusOid','ponOid','nameOid','rxPowerOid','txPowerOid'])if(mapping[key])columns[key]=await walk(mapping[key]);
  result.onus=[];for(const [index,value]of columns.serialOid){const serial=(Buffer.isBuffer(value)?value.toString(mapping.serialEncoding):String(value)).replace(/\0/g,'').trim().slice(0,250);if(!serial)continue;
   const state=columns.statusOid?.get(index);if(state===undefined)continue;const power=key=>{const raw=columns[key]?.get(index);if(raw===undefined||raw===null||raw==='')return null;const number=Number(Buffer.isBuffer(raw)?raw.toString():raw);const scaled=number*mapping.powerScale+mapping.powerOffset;return Number.isFinite(scaled)&&scaled>=-100&&scaled<=20?Math.round(scaled*1000)/1000:null;};
   result.onus.push({serial,name:String(columns.nameOid?.get(index)||serial).slice(0,250),pon:String(columns.ponOid?.get(index)||index).slice(0,250),online:mapping.onlineValues.some(v=>String(v)===String(state)),power:power('rxPowerOid'),oltPower:power('txPowerOid')});
  }return result;
 })(),new Promise((_,reject)=>overall=setTimeout(()=>reject(new Error('SNMP collection exceeded 15 seconds')),15000))]);}finally{clearTimeout(overall);session.close();}
}
// ---- Set-up helper: find or test the ONU table on an OLT (read-only GET/WALK) --------------------------------------
function open(device,secret){if(!secret)throw new Error('SNMP credentials have not been configured');const options={port:device.snmpPort||161,retries:1,timeout:3000,transport:net.isIP(device.ip)===6?'udp6':'udp4'};
 return secret.version==='2c'?snmp.createSession(device.ip,secret.community,{...options,version:snmp.Version2c}):snmp.createV3Session(device.ip,{name:secret.username,level:snmp.SecurityLevel.authPriv,authProtocol:secret.authProtocol==='sha'?snmp.AuthProtocols.sha:snmp.AuthProtocols.sha256,authKey:secret.authKey,privProtocol:snmp.PrivProtocols.aes,privKey:secret.privKey},options);}
async function probe(device,secret,{preset:wanted}={}){const P=require('./oltpresets.cjs'),session=open(device,secret);session.on('error',()=>{});
 const get=oids=>new Promise((resolve,reject)=>session.get(oids,(e,v)=>e?reject(new Error('The OLT did not answer SNMP. Check its IP, port, credentials and that SNMP is allowed from netops.')):resolve(v)));
 const walk=(oid,max,ms)=>new Promise(resolve=>{const out=[],t0=Date.now();session.subtree(oid,25,binds=>{for(const b of binds){if(snmp.isVarbindError(b))continue;out.push({oid:b.oid,value:b.value});}if(out.length>=max||Date.now()-t0>ms)return true;},()=>resolve(out));});
 try{const sys=await get(['1.3.6.1.2.1.1.1.0','1.3.6.1.2.1.1.2.0']),descr=String(sys[0].value||'').slice(0,250),objectId=String(sys[1].value||'');
  const detected=P.presetFromSysObjectId(objectId),key=wanted||detected,preset=P.PRESETS[key],out={sysDescr:descr,sysObjectID:objectId,detected,preset:key||null,brand:preset?.brand||''};
  if(preset?.mapping){const m=preset.mapping,serials=await walk(m.serialOid,5000,15000),states=await walk(m.statusOid,5000,15000);const counts={};
   for(const s of states){const v=String(s.value);counts[v]=(counts[v]||0)+1;}
   const sample=serials.slice(0,5).map(s=>P.ident(s.value)?.serial||String(s.value));
   if(serials.length)return {...out,ok:true,source:'preset',mapping:m,onus:serials.length,sample,states:[{oid:m.statusOid,values:counts}],online:states.filter(s=>m.onlineValues.some(v=>String(v)===String(s.value))).length};}
  const ent=objectId.replace(/^\./,'').match(/^1\.3\.6\.1\.4\.1\.\d+/)?.[0]||(preset?'1.3.6.1.4.1.'+preset.enterprise:null);
  if(!ent)return {...out,ok:false,error:'The OLT did not report a vendor (sysObjectID). Enter the mapping by hand.'};
  const a=P.analyse(await walk(ent,40000,30000));
  if(!a.found)return {...out,ok:false,source:'search',error:'No column of ONU serials (GPON) or MACs (EPON) was found under '+ent+'. The OLT may expose ONUs only after they are authorised, or under another MIB.'};
  const st=a.states[0],guess=st?(Object.keys(st.values).includes('1')?[1]:[Number(Object.entries(st.values).sort((x,y)=>y[1]-x[1])[0][0])]):[1];
  return {...out,ok:true,source:'search',onus:a.onus,sample:a.sample,states:a.states,kind:a.kind,others:a.others,
   mapping:{serialOid:a.serialOid,...(st?{statusOid:st.oid}:{}),...(a.nameOid?{nameOid:a.nameOid}:{}),onlineValues:guess,powerScale:1,powerOffset:0,serialEncoding:a.serialEncoding},
   confirm:st?'Check which state value means online before saving: the value most ONUs have right now is usually “online”.':'No state column was found next to the serials; add statusOid by hand.'};}
 finally{session.close();}}
module.exports={profile,snapshot,probe};
