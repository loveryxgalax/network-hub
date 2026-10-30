'use strict';
// Static IP service: customers with a fixed address on a router network. Per-router settings hold the network,
// gateway and LAN interface. The router is configured through the opt-in job runner (ARP pin, queue, and an
// address-list that blocks expired customers); "save only" keeps settings without touching the router.
const net=require('node:net');
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const ipInt=ip=>ip.split('.').reduce((a,b)=>a*256+Number(b),0)>>>0,intIp=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
function parseCidr(c){const m=/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(String(c||'').trim());if(!m||net.isIP(m[1])!==4)fail('Network must look like 10.50.0.0/24');const bits=Number(m[2]);if(bits<16||bits>30)fail('Use a network between /16 and /30');const mask=bits===0?0:(~0<<(32-bits))>>>0,base=(ipInt(m[1])&mask)>>>0;return {cidr:intIp(base)+'/'+bits,base,size:2**(32-bits),bits};}
function settings(store,routerId){return store.setting('staticSettings:'+routerId)||null;}
function saveSettings(store,routerId,input){const r=store.get('devices',routerId);if(!r||r.type!=='router')fail('Router not found',404);
 const n=parseCidr(input.network),gw=String(input.gateway||'').trim();if(net.isIP(gw)!==4||!inNet(n,gw))fail('The gateway must be inside the network');
 const iface=String(input.iface||'').trim();if(!/^[A-Za-z0-9._-]{1,40}$/.test(iface))fail('Enter the LAN interface or bridge name, e.g. bridge-lan');
 return store.setting('staticSettings:'+routerId,{network:n.cidr,gateway:gw,iface,arpPinning:input.arpPinning!==false});}
const inNet=(n,ip)=>{const v=ipInt(ip);return v>n.base&&v<n.base+n.size-1;};
// Every address already in use on any service, so a static IP can never collide with another customer.
function used(store,exceptId){const s=new Set();for(const x of store.list('subscribers'))if(x.staticIp&&x.id!==exceptId)s.add(x.staticIp);return s;}
function allocate(store,routerId,exceptId){const st=settings(store,routerId);if(!st)fail('Set up the static network for this router first');const n=parseCidr(st.network),taken=used(store,exceptId);taken.add(st.gateway);
 for(let v=n.base+1;v<n.base+n.size-1;v++){const ip=intIp(v);if(!taken.has(ip))return ip;}fail('No free addresses left in '+st.network);}
function validate(store,s,input,existing={}){
 const routerId=String(input.routerId??existing.routerId??'');if(!store.get('devices',routerId))fail('Choose the router this customer is connected to');
 const st=settings(store,routerId);if(!st)fail('Set up the static network for this router first (Static IP → Settings)');
 let ip=String(input.staticIp??'').trim();if(!ip)ip=existing.staticIp&&existing.routerId===routerId?existing.staticIp:allocate(store,routerId,existing.id);
 if(net.isIP(ip)!==4||!inNet(parseCidr(st.network),ip)||ip===st.gateway)fail('That address is not usable in '+st.network);if(used(store,existing.id).has(ip))fail(ip+' is already assigned to another customer',409);
 const mac=String(input.mac??existing.staticMac??'').toUpperCase().replace(/-/g,':');if(mac&&!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac))fail('Invalid MAC address');
 return {routerId,staticIp:ip,staticMac:mac};
}
// Desired router state for a static customer; a job is queued only when it changes.
function desired(store,s,stateOf){const p=store.get('plans',s.planId),m=v=>v>=1?Math.round(v*100)/100+'M':Math.round(v*1000)+'k';return {ip:s.staticIp,mac:s.staticMac||'',name:s.username.replace(/[^A-Za-z0-9._@:-]/g,'-'),rate:p?m(p.uploadMbps)+'/'+m(p.downloadMbps):'1M/1M',enabled:stateOf(s)==='active'?'yes':'no'};}
function sync(store,jobs,stateOf,user=null,now=Date.now()){const queued=[];
 for(const s of store.list('subscribers')){if(s.service!=='static'||!s.routerId||!s.staticIp)continue;const st=settings(store,s.routerId);if(!st)continue;
  const want={...desired(store,s,stateOf),iface:st.iface};if(!st.arpPinning)want.mac='';const key=JSON.stringify(want);if(s.staticApplied===key)continue;
  if(!store.secret('jobs:'+s.routerId)){if(s.provisioning?.status!=='pending')store.put('subscribers',{...s,provisioning:{status:'pending',error:'Job runner not installed on this router',time:now}},s);continue;}
  try{jobs.create(store,{routerId:s.routerId,type:'static-apply',params:want,subscriberId:s.id,user},now);const fresh=store.get('subscribers',s.id);store.put('subscribers',{...fresh,staticApplied:key},fresh);queued.push(s.id);}catch(e){store.put('subscribers',{...s,provisioning:{status:'failed',error:e.message,time:now}},s);}}
 return queued;
}
function overview(store,stateOf,now=Date.now()){const routers=store.list('devices').filter(d=>d.type==='router').map(r=>({id:r.id,name:r.name,settings:settings(store,r.id),runner:!!store.secret('jobs:'+r.id)}));
 // Last time each router reported the address in its ARP/DHCP/active lists.
 const seen=new Map();for(const r of routers)for(const o of store.setting('customerDiscovery:'+r.id)?.observations||[])for(const ip of o.snapshot?.ips||[]){const k=r.id+'|'+ip;if((o.lastObserved||0)>(seen.get(k)||0))seen.set(k,o.lastObserved);}
 const plans=new Map(store.list('plans').map(p=>[p.id,p.name]));
 const items=store.list('subscribers').filter(s=>s.service==='static').map(s=>{const st=stateOf(s,now),pv=s.provisioning?.status;
  // Connected = the router has the customer's entries enabled; Disconnected = blocked because the package lapsed.
  const connection=pv==='failed'?'failed':!pv||pv==='pending'?'pending':st==='active'?'connected':'disconnected';
  return {id:s.id,name:s.name,username:s.username,phone:s.phone,ip:s.staticIp,mac:s.staticMac||'',routerId:s.routerId,state:st,expiresAt:s.expiresAt,provisioning:s.provisioning||null,planId:s.planId,plan:plans.get(s.planId)||'',connection,lastSeen:seen.get(s.routerId+'|'+s.staticIp)||s.lastSeen||null};});
 // The same address given to two customers (possible after an import): the router can only serve one of them.
 const byIp=new Map();for(const i of items)if(i.ip)byIp.set(i.ip,[...(byIp.get(i.ip)||[]),i]);
 const duplicates=[...byIp].filter(([,l])=>l.length>1).map(([ip,l])=>({ip,customers:l.map(i=>({id:i.id,name:i.name,routerId:i.routerId}))}));
 return {routers,items,duplicates,expiring:items.filter(i=>i.state==='active'&&i.expiresAt&&i.expiresAt-now<7*864e5)};}
module.exports={parseCidr,settings,saveSettings,allocate,validate,sync,overview};
