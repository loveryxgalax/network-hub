'use strict';
// PPPoE address pool (optional, off by default): netops' RADIUS gives each PPPoE customer a fixed address from one
// network, so a customer keeps the same IP across reconnects and routers. While it is off, routers hand out PPPoE
// addresses from their own pools as before.
const statics=require('./statics.cjs'),{parseCidr}=statics;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const ipInt=ip=>ip.split('.').reduce((a,b)=>a*256+Number(b),0)>>>0,intIp=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
const inNet=(n,ip)=>{const v=ipInt(ip);return v>n.base&&v<n.base+n.size-1;};
function settings(store){return {enabled:false,network:'',next:'',...(store.setting('pppoePool')||{})};}
// Addresses already used elsewhere: static customers and every router's static network.
function reserved(store){const nets=[];for(const d of store.list('devices'))if(d.type==='router'){const st=statics.settings(store,d.id);if(st?.network){try{nets.push({name:d.name,...parseCidr(st.network)});}catch{}}}return nets;}
function overlaps(a,b){return a.base<b.base+b.size&&b.base<a.base+a.size;}
function save(store,input){const cur=settings(store),network=String(input.network??cur.network).trim(),n=parseCidr(network);
 const clash=reserved(store).find(r=>overlaps(r,n));if(clash)fail(`${network} overlaps the static IP network of ${clash.name}. Choose another range.`);
 let next=String(input.next??'').trim();if(network!==cur.network&&!input.next)next=intIp(n.base+2);if(!next)next=cur.next||intIp(n.base+2);
 if(!inNet(n,next))fail('The next address must be inside '+network);
 return store.setting('pppoePool',{enabled:input.enabled===undefined?cur.enabled:input.enabled===true||input.enabled==='on',network:n.cidr,next,gateway:intIp(n.base+1)});}
function used(store,exceptId){const s=new Set();for(const x of store.list('subscribers'))if(x.id!==exceptId){if(x.pppoeIp)s.add(x.pppoeIp);if(x.staticIp)s.add(x.staticIp);}return s;}
// The customer's address: kept while it is inside the pool, otherwise the next free one from the "next" pointer.
function assign(store,s){const cfg=settings(store);if(!cfg.enabled||!cfg.network||s.staticIp)return null;const n=parseCidr(cfg.network);
 if(s.pppoeIp&&inNet(n,s.pppoeIp))return s.pppoeIp;const taken=used(store,s.id),start=cfg.next&&inNet(n,cfg.next)?ipInt(cfg.next):n.base+2,first=n.base+2,last=n.base+n.size-2;
 for(let i=0;i<=last-first;i++){const v=first+((start-first+i)%(last-first+1)),ip=intIp(v);if(!taken.has(ip)){const fresh=store.get('subscribers',s.id);store.put('subscribers',{...fresh,pppoeIp:ip},fresh);store.setting('pppoePool',{...cfg,next:intIp(v+1>last?first:v+1)});return ip;}}
 fail('The PPPoE pool '+cfg.network+' is full',409);}
// Clear every PPPoE customer's address and hand them out again from the start of the network.
function reassignAll(store){const cfg=settings(store);if(!cfg.network)fail('Set the network first');const n=parseCidr(cfg.network),list=store.list('subscribers').filter(x=>x.service==='pppoe'&&!x.staticIp).sort((a,b)=>(a.created||0)-(b.created||0));
 return store.transaction(()=>{for(const x of list)if(x.pppoeIp)store.put('subscribers',{...x,pppoeIp:''},x);store.setting('pppoePool',{...cfg,next:intIp(n.base+2)});let count=0;if(cfg.enabled)for(const x of list){assign(store,store.get('subscribers',x.id));count++;}return {cleared:list.length,assigned:count};});}
function overview(store){const cfg=settings(store),pp=store.list('subscribers').filter(x=>x.service==='pppoe');let size=0;try{size=cfg.network?parseCidr(cfg.network).size-3:0;}catch{}
 return {...cfg,assigned:pp.filter(x=>x.pppoeIp).length,customers:pp.length,size,reserved:reserved(store).map(r=>({name:r.name,network:r.cidr}))};}
// IP conflicts (read-only): two accounts reserving the same address, a reservation inside a router's static network
// or outside the pool, and an online session using an address reserved for someone else.
function conflicts(store,now=Date.now()){const cfg=settings(store),out=[],by=new Map();let n=null;try{n=cfg.network?parseCidr(cfg.network):null;}catch{}
 const subs=store.list('subscribers'),nets=reserved(store);
 for(const x of subs){for(const [k,label] of [['pppoeIp','PPPoE'],['staticIp','Static']]){const ip=x[k];if(!ip)continue;if(!by.has(ip))by.set(ip,[]);by.get(ip).push({id:x.id,name:x.name,username:x.username,kind:label});}
  if(x.pppoeIp){const v=ipInt(x.pppoeIp),inStatic=nets.find(r=>v>=r.base&&v<r.base+r.size);if(inStatic)out.push({type:'In a static network',ip:x.pppoeIp,detail:`${x.username} (PPPoE) is inside ${inStatic.name}'s static network ${inStatic.cidr}`,ids:[x.id]});
   if(n&&!inNet(n,x.pppoeIp))out.push({type:'Outside the pool',ip:x.pppoeIp,detail:`${x.username} has ${x.pppoeIp}, outside ${n.cidr}; reassign to fix`,ids:[x.id]});}}
 for(const [ip,list] of by)if(list.length>1)out.push({type:'Same address twice',ip,detail:list.map(l=>`${l.username} (${l.kind})`).join(', '),ids:list.map(l=>l.id)});
 const owner=new Map([...by].map(([ip,l])=>[ip,l[0]]));
 for(const x of store.sessionsSince(now-10*60000))if(!x.stoppedAt&&x.ip&&owner.has(x.ip)&&owner.get(x.ip).username!==x.username)out.push({type:'Used by someone else',ip:x.ip,detail:`${x.username} is online with ${x.ip}, reserved for ${owner.get(x.ip).username}`,ids:[owner.get(x.ip).id]});
 return {checked:subs.length,items:out};}
// Public IP pool (handoff screenshots 241–242): public addresses the ISP owns, handed to chosen PPPoE customers as
// their fixed address (sent as Framed-IP-Address at their next login). IPv4 only; one customer per address.
const IPV4=/^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/;
function isPrivate(ip){const [a,b]=ip.split('.').map(Number);return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a===0||a>=224;}
function publicList(store){return (store.setting('publicIps')||{}).items||[];}
function publicOverview(store){const subs=store.list('subscribers');return publicList(store).map(x=>{const u=subs.find(s=>s.staticIp===x.ip);return {...x,usedBy:u?{id:u.id,name:u.name,username:u.username}:null};});}
function addPublic(store,input){const ip=String(input.ip||'').trim(),note=String(input.note||'').trim().slice(0,80);if(!IPV4.test(ip))fail('Enter an IPv4 address like 41.90.10.5');if(isPrivate(ip))fail(ip+' is a private address, not a public one');
 const items=publicList(store);if(items.some(x=>x.ip===ip))fail(ip+' is already in the pool',409);items.push({ip,note,added:Date.now()});store.setting('publicIps',{items});return publicOverview(store);}
function removePublic(store,ip){if(publicOverview(store).find(x=>x.ip===ip)?.usedBy)fail('Release it from the customer first',409);store.setting('publicIps',{items:publicList(store).filter(x=>x.ip!==ip)});return publicOverview(store);}
function assignPublic(store,ip,subscriberId){const x=publicOverview(store).find(p=>p.ip===ip);if(!x)fail('Not in the pool',404);if(x.usedBy)fail(ip+' is already used by '+x.usedBy.username,409);
 const s=store.get('subscribers',String(subscriberId||''));if(!s||s.service!=='pppoe')fail('Choose a PPPoE customer');if(s.staticIp)fail(s.username+' already has the fixed address '+s.staticIp+'; release it first',409);
 store.put('subscribers',{...s,staticIp:ip},s);return publicOverview(store);}
function releasePublic(store,ip){const s=store.list('subscribers').find(x=>x.staticIp===ip);if(s)store.put('subscribers',{...s,staticIp:''},s);return publicOverview(store);}
module.exports={settings,save,assign,reassignAll,overview,conflicts,publicOverview,addPublic,removePublic,assignPublic,releasePublic};
