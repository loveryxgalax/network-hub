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
module.exports={settings,save,assign,reassignAll,overview};
