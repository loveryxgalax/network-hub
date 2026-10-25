'use strict';
const http=require('node:http');
const https=require('node:https');
const fs=require('node:fs');
function endpoint(value){let url;try{url=new URL(value);}catch{throw Object.assign(new Error('Enter an HTTPS base URL.'),{status:400});}
 // Plain HTTP only to loopback, or to private service names the operator lists (e.g. the Docker Compose service "acs").
 const trusted=String(process.env.NETWORK_TRUSTED_HTTP_HOSTS||'').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
 const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname)||trusted.includes(url.hostname.toLowerCase());
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.search||url.hash||!['/',''].includes(url.pathname))throw Object.assign(new Error('Use an HTTPS origin without a path, query or embedded credentials. HTTP is allowed only on loopback.'),{status:400});return url.origin;
}
function request(base,resource,credentials,method='GET',payload,metadata=false){
 const url=new URL(resource,base),body=payload===undefined?null:Buffer.from(JSON.stringify(payload));
 const headers={Accept:'application/json'};if(!credentials.noAuth)headers.Authorization=credentials.token?'Bearer '+credentials.token:'Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64');
 if(body){headers['Content-Type']='application/json';headers['Content-Length']=body.length;}
 return new Promise((resolve,reject)=>{const client=url.protocol==='https:'?https:http;const options={method,headers,timeout:8000};if(process.env.NETWORK_CA_FILE&&url.protocol==='https:')options.ca=fs.readFileSync(process.env.NETWORK_CA_FILE);
  const req=client.request(url,options,res=>{let bytes=0,chunks=[];res.on('data',chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)req.destroy(new Error('Response exceeds limit'));else chunks.push(chunk);});res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error(res.statusCode===401||res.statusCode===403?'Device authentication denied':`Device returned HTTP ${res.statusCode}`));try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')),serverTime=Date.parse(res.headers.date);resolve(metadata?{status:res.statusCode,body:value,serverTime:Number.isFinite(serverTime)?serverTime:null}:value);}catch{reject(new Error('Device returned invalid JSON'));}});});
  req.on('timeout',()=>req.destroy(new Error('Device connection timed out')));req.on('error',error=>reject(new Error(['ECONNREFUSED','ENOTFOUND','EHOSTUNREACH','ETIMEDOUT'].includes(error.code)?`Device unreachable (${error.code})`:error.message.includes('timed out')?'Device connection timed out':'Device connection or TLS verification failed')));if(body)req.write(body);req.end();
 });
}
const one=value=>Array.isArray(value)?value[0]:value;
const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
async function routerSnapshot(device,secret){
 const resource=one(await request(device.endpoint,'/rest/system/resource?.proplist=uptime,cpu-load,free-memory,total-memory,version,board-name',secret));
 if(!resource||finite(resource['cpu-load'])===null||typeof resource.uptime!=='string')throw new Error('Invalid RouterOS resource response');
 const interfaces=await request(device.endpoint,'/rest/interface?.proplist=.id,name,type,running,disabled,rx-byte,tx-byte',secret);
 if(!Array.isArray(interfaces))throw new Error('Invalid RouterOS interface response');
 const routes=await request(device.endpoint,'/rest/ip/route?.proplist=.id,dst-address,gateway,distance,active,disabled,comment,check-gateway',secret).catch(()=>null);
 const tunnels=await request(device.endpoint,'/rest/interface/wireguard/peers?.proplist=interface,last-handshake,current-endpoint-address,rx,tx,disabled',secret).catch(()=>null);
 const total=finite(resource['total-memory']),free=finite(resource['free-memory']);
 return {cpu:finite(resource['cpu-load']),memory:total&&free!==null?Math.round((total-free)/total*100):null,uptime:resource.uptime,version:resource.version||'',model:resource['board-name']||'',interfaces:interfaces.map(i=>({id:i['.id'],name:i.name,type:i.type,running:i.running==='true',disabled:i.disabled==='true',rx:finite(i['rx-byte']),tx:finite(i['tx-byte'])})),routes,tunnels};
}
async function gatewaySnapshot(device,secret){const result=await request(device.endpoint,`/v1/devices/${encodeURIComponent(device.externalId||device.id)}/snapshot`,secret);if(result?.online!==true||!Array.isArray(result.onus))throw new Error('Gateway must return a verified online snapshot with an onus array');const string=value=>String(value||'').slice(0,250);return {cpu:finite(result.cpu),memory:finite(result.memory),uptime:string(result.uptime),onus:result.onus.filter(o=>typeof o.serial==='string'&&typeof o.online==='boolean').map(o=>({serial:string(o.serial),name:string(o.name),pon:string(o.pon),online:o.online,power:Number.isFinite(o.power)?o.power:null,oltPower:Number.isFinite(o.oltPower)?o.oltPower:null})),unconfigured:Array.isArray(result.unconfigured)?result.unconfigured.map(o=>({serial:string(o.serial),name:string(o.name),pon:string(o.pon)})):[]};}
async function snapshot(device,secret){if(!secret)throw new Error('Credentials have not been configured');if(device.driver==='routeros-rest')return routerSnapshot(device,secret);if(device.driver==='olt-gateway')return gatewaySnapshot(device,secret);if(device.driver==='snmp')return require('./snmp.cjs').snapshot(device,secret);throw new Error('No connector has been configured');}
async function authorize(device,secret,input,key){const result=await request(device.endpoint,`/v1/devices/${encodeURIComponent(device.externalId||device.id)}/authorize`,secret,'POST',{serial:input.serial,pon:input.pon,profileId:input.profileId,profile:input.profile,idempotencyKey:key});if(result?.authorized!==true||result.serial!==input.serial)throw new Error('Gateway did not verify the requested ONU authorization');return {authorized:true,serial:result.serial};}
module.exports={endpoint,request,snapshot,authorize};
