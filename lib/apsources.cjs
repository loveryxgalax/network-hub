'use strict';
// Real sources for access points: which phones are on each AP, with their data counters and speeds.
//  (a) ap-acs        a Huawei EchoLife (or any TR-069 CPE) used as an AP: its connected-devices list from GenieACS.
//  (b) ap-port       an AP on its own MikroTik port, VLAN or hotspot server: phones the router reports on that interface.
//  (c) ap-controller an AP managed by an Omada or Ruijie Cloud controller: the controller's client list for that AP.
// All three give the same snapshot shape as the simulated AP, so the rest of Kade Cloud does not care which is used.
// Nothing here changes an AP, a router or a controller: every call only reads.
const crypto=require('node:crypto');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const normMac=m=>{const h=String(m||'').replace(/[^0-9a-fA-F]/g,'').toUpperCase();return h.length===12?h.match(/../g).join(':'):'';};
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
const shape=(source,stations)=>{const rx=stations.reduce((a,s)=>a+(s.rx||0),0),tx=stations.reduce((a,s)=>a+(s.tx||0),0);
 return {source,clients:stations.length,stations,radios:[],interfaces:[{name:'clients',type:'wlan',running:true,disabled:false,rx,tx}]};};
// ---------- (a) TR-069 (GenieACS) ----------
const HOSTS=['Device.Hosts.Host','InternetGatewayDevice.LANDevice.1.Hosts.Host'];
const val=x=>x&&typeof x==='object'&&'_value' in x?x._value:x;
function parseHosts(row){const out=[];for(const root of HOSTS){let o=row;for(const k of root.split('.'))o=o?.[k];if(!o||typeof o!=='object')continue;
 for(const [k,h] of Object.entries(o)){if(!/^\d+$/.test(k)||!h)continue;const mac=normMac(val(h.PhysAddress)||val(h.MACAddress));if(!mac)continue;const active=val(h.Active);if(active===false||active==='false'||active===0||active==='0')continue;
  const ifType=String(val(h.InterfaceType)||val(h.Layer1Interface)||'');out.push({mac,ip:String(val(h.IPAddress)||''),name:String(val(h.HostName)||''),band:/802\.11|wlan|wifi|ssid/i.test(ifType)?'Wi-Fi':ifType?'Cable':'',signal:null,rx:null,tx:null});}}
 return out;}
async function acsSnapshot(store,device,{request=require('./connectors.cjs').request,now=Date.now()}={}){
 const settings=store.setting('acs'),secret=store.secret('integration:acs');if(!settings||!secret)fail('Connect the TR-069 (GenieACS) server first');
 const serial=String(device.serial||'').trim();if(!serial)fail('Enter the AP\'s serial number (as on its label)');
 const q=encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':serial}));
 const r=await request(settings.origin,`/devices/?query=${q}&projection=${encodeURIComponent(['_id','_lastInform',...HOSTS].join(','))}`,secret,'GET',undefined,true);
 const row=Array.isArray(r.body)?r.body[0]:null;if(!row)fail('The TR-069 server has no device with serial '+serial+'. Check that the AP is set to inform Kade Cloud.');
 // Ask the AP to refresh its list (at most every 5 minutes); the values read now are from its last refresh.
 const due=store.setting('apAcsDue')||{};if(!due[device.id]||now-due[device.id]>5*60000){due[device.id]=now;store.setting('apAcsDue',due);
  for(const root of HOSTS)try{await request(settings.origin,'/devices/'+encodeURIComponent(row._id)+'/tasks?connection_request',secret,'POST',{name:'refreshObject',objectName:root+'.'},true);}catch{}}
 const last=Date.parse(row._lastInform);if(Number.isFinite(last)&&now-last>60*60000)fail('The AP has not contacted the TR-069 server for over an hour');
 return shape('tr069',parseHosts(row));}
// ---------- (b) MikroTik port / VLAN / hotspot server ----------
// The router's customer report (Customers → discovery) already says, per phone: its hotspot server, the DHCP server and
// ARP interface it was seen on, and (newer report script) the bridge port. An AP is matched by any of those names.
function portSnapshot(store,device,{now=Date.now()}={}){
 const router=device.parentId?store.get('devices',device.parentId):null;if(!router)fail('Choose the router this AP is plugged into');
 const keys=String(device.apMatch||'').split(/[,;\n]+/).map(s=>s.trim().toLowerCase()).filter(Boolean);if(!keys.length)fail('Enter the port, VLAN or hotspot server name this AP uses (e.g. ether4, vlan40, hotspot-ap4)');
 const rep=store.setting('customerDiscovery:'+router.id);if(!rep?.lastReport)fail(router.name+' has not sent a customer report yet (Customers → discovery)');
 if(now-rep.lastReport>10*60000)fail(router.name+' has not reported for '+Math.round((now-rep.lastReport)/60000)+' minutes');
 const stations=[];
 for(const o of rep.observations||[]){const ev=o.evidence||{},fresh=e=>e&&e.observedAt===rep.lastReport;const hs=fresh(ev.hotspot)?ev.hotspot:null,dh=fresh(ev.dhcp)?ev.dhcp:null,ar=fresh(ev.arp)?ev.arp:null,br=fresh(ev.bridge)?ev.bridge:null;
  if(!hs&&!dh&&!ar&&!br)continue;const names=[hs?.service,dh?.interface,ar?.interface,br?.interface].filter(Boolean).map(s=>String(s).toLowerCase());if(!names.some(n=>keys.includes(n)))continue;
  const mac=normMac(hs?.mac||dh?.mac||ar?.mac||br?.mac);if(!mac)continue;
  stations.push({mac,ip:hs?.ip||dh?.ip||ar?.ip||'',name:hs?.name||dh?.name||'',band:'',signal:null,rx:num(hs?.rx),tx:num(hs?.tx),downMbps:hs?.traffic?.downloadMbps??null,upMbps:hs?.traffic?.uploadMbps??null,loggedIn:!!hs});}
 return shape('router-port',stations);}
// ---------- (c) controllers ----------
function controllers(store){return store.list('apControllers').map(c=>({...c,configured:!!store.secret('apctl:'+c.id)}));}
function saveController(store,input,id=null){const cur=id?store.get('apControllers',id):null;if(id&&!cur)fail('Controller not found',404);
 const type=['omada','ruijie'].includes(input.type)?input.type:cur?.type;if(!type)fail('Choose Omada or Ruijie');
 const name=String(input.name??cur?.name??'').trim().slice(0,60);if(!name)fail('Enter a name');
 let url;try{url=new URL(String(input.url??cur?.url??'').trim());}catch{fail('Enter the controller address, starting with https://');}if(url.protocol!=='https:'||url.username||url.password)fail('The controller address must start with https://');
 const site=String(input.site??cur?.site??'').trim().slice(0,80);if(!site)fail(type==='omada'?'Enter the Omada site ID':'Enter the Ruijie group ID');
 const saved=store.put('apControllers',{name,type,url:url.origin+url.pathname.replace(/\/$/,''),site,omadacId:type==='omada'?String(input.omadacId??cur?.omadacId??'').trim().slice(0,80):''},cur||undefined);
 const sec=store.secret('apctl:'+saved.id)||{},id1=String(input.clientId||'').trim(),s1=String(input.clientSecret||'').trim();
 if(id1||s1){if(!id1||!s1)fail('Enter both the client/app ID and the secret');store.secret('apctl:'+saved.id,{clientId:id1,clientSecret:s1});}else if(!sec.clientId)fail('Enter the client/app ID and the secret');
 if(type==='omada'&&!saved.omadacId)fail('Enter the Omada controller ID (omadacId)');
 return {...saved,configured:true};}
const cache=new Map();// controller id → {at, list} for 50 seconds, so one poll per controller serves every AP on it
async function jsonFetch(fetchImpl,url,opts={}){const r=await fetchImpl(url,{...opts,signal:AbortSignal.timeout(15000)});const t=await r.text();let d=null;try{d=JSON.parse(t);}catch{}if(!r.ok)fail('Controller answered HTTP '+r.status+(d?.msg?': '+d.msg:''),502);if(!d)fail('Controller did not answer with JSON',502);return d;}
async function omadaClients(c,sec,fetchImpl){
 const tok=await jsonFetch(fetchImpl,`${c.url}/openapi/authorize/token?grant_type=client_credentials`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({omadacId:c.omadacId,client_id:sec.clientId,client_secret:sec.clientSecret})});
 if(tok.errorCode!==0||!tok.result?.accessToken)fail('Omada refused the login: '+(tok.msg||'check the client ID and secret'),502);
 const out=[];for(let page=1;page<=10;page++){const d=await jsonFetch(fetchImpl,`${c.url}/openapi/v1/${encodeURIComponent(c.omadacId)}/sites/${encodeURIComponent(c.site)}/clients?page=${page}&pageSize=1000`,{headers:{Authorization:'AccessToken='+tok.result.accessToken}});
  if(d.errorCode!==0)fail('Omada: '+(d.msg||'could not list clients'),502);const rows=d.result?.data||[];
  for(const x of rows)out.push({ap:normMac(x.apMac),mac:normMac(x.mac),ip:x.ip||'',name:x.name||x.hostName||'',band:x.radioId===1?'5 GHz':x.radioId===0?'2.4 GHz':(x.ssid?'Wi-Fi':''),signal:num(x.rssi),rx:num(x.trafficUp),tx:num(x.trafficDown),downMbps:x.activity!=null?num(x.activity)*8/1e6:null,upMbps:x.uploadActivity!=null?num(x.uploadActivity)*8/1e6:null});
  if(rows.length<1000)break;}
 return out;}
async function ruijieClients(c,sec,fetchImpl){
 const tok=await jsonFetch(fetchImpl,`${c.url}/service/api/oauth20/client/access_token?token=d63dss0a81e4415a889ac5b78fsc904a`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appid:sec.clientId,secret:sec.clientSecret})});
 const token=tok.accessToken||tok.access_token||tok.data?.accessToken;if(!token)fail('Ruijie Cloud refused the login: '+(tok.msg||'check the app ID and secret'),502);
 const out=[];for(let page=1;page<=10;page++){const d=await jsonFetch(fetchImpl,`${c.url}/service/api/open/v1/dev/user/current-user?group_id=${encodeURIComponent(c.site)}&page=${page}&per_page=500&access_token=${encodeURIComponent(token)}`);
  if(d.code!=null&&String(d.code)!=='0')fail('Ruijie Cloud: '+(d.msg||'could not list clients'),502);const rows=d.list||d.data?.list||[];
  for(const x of rows)out.push({ap:String(x.sn||x.apSn||x.deviceSn||'').toUpperCase(),apMac:normMac(x.apMac||x.deviceMac),mac:normMac(x.mac||x.userMac),ip:x.ip||x.userIp||'',name:x.userName||x.hostName||'',band:x.band?String(x.band):x.ssid?'Wi-Fi':'',signal:num(x.rssi),rx:num(x.upFlow??x.upstream),tx:num(x.downFlow??x.downstream),downMbps:null,upMbps:null});
  if(rows.length<500)break;}
 return out;}
async function controllerClients(store,c,fetchImpl=fetch,now=Date.now()){const hit=cache.get(c.id);if(hit&&now-hit.at<50000)return hit.list;
 const sec=store.secret('apctl:'+c.id);if(!sec)fail('The controller login is not saved');
 const list=c.type==='omada'?await omadaClients(c,sec,fetchImpl):await ruijieClients(c,sec,fetchImpl);cache.set(c.id,{at:now,list});return list;}
async function controllerSnapshot(store,device,{fetchImpl=fetch,now=Date.now()}={}){const c=device.controllerId?store.get('apControllers',device.controllerId):null;if(!c)fail('Choose the controller this AP belongs to');
 const key=String(device.apKey||'').trim().toUpperCase();if(!key)fail(c.type==='omada'?'Enter the AP\'s MAC address':'Enter the AP\'s serial number (or MAC)');
 const keyMac=normMac(key),list=await controllerClients(store,c,fetchImpl,now);
 return shape(c.type,list.filter(x=>(keyMac&&(x.ap===keyMac||x.apMac===keyMac))||x.ap===key).filter(x=>x.mac).map(({ap,apMac,...s})=>s));}
async function snapshot(store,device,opts={}){if(device.driver==='ap-acs')return acsSnapshot(store,device,opts);if(device.driver==='ap-port')return portSnapshot(store,device,opts);if(device.driver==='ap-controller')return controllerSnapshot(store,device,opts);fail('Unknown access point source');}
async function test(store,device,opts){const s=await snapshot(store,device,opts);return {ok:true,clients:s.clients,sample:s.stations.slice(0,5).map(x=>x.mac)};}
module.exports={snapshot,test,parseHosts,portSnapshot,acsSnapshot,controllerSnapshot,controllers,saveController,normMac,_cache:cache};
