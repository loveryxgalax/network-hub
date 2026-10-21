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
module.exports={profile,snapshot};
