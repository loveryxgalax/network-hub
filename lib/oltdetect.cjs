'use strict';
// Finds OLTs (and other non-MikroTik gear) that the routers can see on their ports, from the neighbour reports the
// discovery script already sends (MNDP / CDP / LLDP). Read-only: nothing here touches a router or an OLT.
const VENDORS=[
 ['Huawei',/huawei|smartax|\bma5[0-9]{3}|\bea5[0-9]{3}|\bmd5[0-9]{3}/i],['ZTE',/\bzte\b|zxa10|\bc[36][0-9]{2}\b|zxan/i],['VSOL',/v-?sol|vsol/i],['Hioso',/hioso/i],['BDCOM',/bdcom/i],
 ['FiberHome',/fiberhome|\ban[56][0-9]{3}/i],['C-Data',/c-?data|fd11[0-9]{2}/i],['Nokia',/nokia|alcatel|\bisam\b|\bfx-?[0-9]/i],['Syrotech',/syrotech/i],['Ubiquiti UFiber',/ufiber|uf-?olt|uf-?nano/i],['Tibit / TBS',/tibit|\btbs\b/i]
];
const OLT_WORD=/\bolt\b|gpon|epon|xgs-?pon|\bpon\b/i;
function classify(n){const text=[n.name,n.platform,n.model,n.software].filter(Boolean).join(' ');
 for(const [vendor,re] of VENDORS)if(re.test(text))return {vendor,confidence:OLT_WORD.test(text)||/olt|ma5|zxa10|an5|c[36]\d\d/i.test(text)?'high':'possible'};
 if(OLT_WORD.test(text))return {vendor:'',confidence:'high'};
 return null;}
const isMikrotik=n=>/mikrotik|routeros/i.test([n.platform,n.software].filter(Boolean).join(' '))||/^(rb|ccr|crs|cloud|hex|hap|cap|wap|sxt|lhg|netmetal|netbox|ltap|map)\b|^(rb|ccr|crs)\d/i.test(String(n.model||'').trim());
const KINDS=[['Ubiquiti radio',/nanostation|nanobeam|litebeam|powerbeam|airgrid|rocket|loco|nanobridge|airmax|ubiquiti/i],['Ruijie',/ruijie|reyee/i],['Switch / AP',/switch|\bap\b|access point|tp-?link|tenda|d-?link|cisco|netgear/i]];
const kindOf=n=>{const t=[n.name,n.platform,n.model,n.software].filter(Boolean).join(' ');return (KINDS.find(([,re])=>re.test(t))||[''])[0];};
function detect(store,now=Date.now()){
 const routers=store.list('devices').filter(d=>d.type==='router'),known=store.list('devices').filter(d=>d.type==='olt'),olts=[],others=[],silent=[];
 const have=n=>known.some(o=>(n.mac&&String(o.macAddress||'').toUpperCase()===n.mac)||(n.ip&&o.ip===n.ip));
 for(const r of routers){const rep=store.setting('customerDiscovery:'+r.id);if(!rep){silent.push({router:r.name,reason:'Discovery is not enabled on this router'});continue;}
  for(const o of rep.observations||[]){const n=o.evidence?.neighbor;if(!n)continue;
   const item={routerId:r.id,router:r.name,key:o.key,mac:String(n.mac||o.mac||'').toUpperCase(),ip:n.ip||'',name:n.name||'',platform:n.platform||'',model:n.model||'',software:n.software||'',port:n.interface||'',lastSeen:n.observedAt||o.lastObserved||null,added:false};
   item.added=have(item);const c=!isMikrotik(item)&&classify(item);
   if(c)olts.push({...item,...c});else if(!isMikrotik(item))others.push({...item,kind:kindOf(item)});}}
 const rank={high:0,possible:1};olts.sort((a,b)=>rank[a.confidence]-rank[b.confidence]||String(a.name).localeCompare(b.name));
 return {olts,others:others.slice(0,200),silent,sampledAt:now};
}
// Nodes and links for the neighbour map: each router with what it hears on its ports.
function map(store,now=Date.now()){
 const routers=store.list('devices').filter(d=>d.type==='router'),byName=new Map(routers.map(r=>[r.name.toLowerCase(),r])),nodes=routers.map(r=>({id:r.id,name:r.name,kind:'router',status:r.status,model:r.metrics?.model||''})),links=[],seenPair=new Set();
 for(const r of routers){const rep=store.setting('customerDiscovery:'+r.id);if(!rep)continue;
  for(const o of rep.observations||[]){const n=o.evidence?.neighbor;if(!n||now-(n.observedAt||0)>30*60000)continue;
   const item={name:n.name||'',platform:n.platform||'',model:n.model||'',software:n.software||''},mt=isMikrotik(item),peer=mt&&byName.get(String(n.name||'').toLowerCase());
   if(peer&&peer.id!==r.id){const k=[r.id,peer.id].sort().join('|');if(!seenPair.has(k)){seenPair.add(k);links.push({from:r.id,to:peer.id,port:n.interface||'',kind:'router'});}continue;}
   if(peer)continue;
   const olt=!mt&&classify(item),kind=mt?'MikroTik':olt?'OLT':kindOf(item)||'Device',id=r.id+'|'+o.key;
   nodes.push({id,name:n.name||n.mac||'Unnamed',kind,mac:String(n.mac||'').toUpperCase(),ip:n.ip||'',model:n.model||n.platform||'',vendor:olt?.vendor||''});links.push({from:r.id,to:id,port:n.interface||'',kind:'neighbour'});}}
 return {nodes,links};
}
module.exports={detect,classify,isMikrotik,map};
