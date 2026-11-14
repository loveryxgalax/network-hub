'use strict';
// Ruijie / Reyee access points: found automatically in what the routers already report (DHCP leases, ARP and
// MNDP/LLDP neighbours) and added to Devices, linked to the router they were seen on. A Ruijie MAC prefix (from the
// IEEE registry) or a neighbour that calls itself Ruijie or Reyee is enough. Nothing here touches the AP itself.
// Prefixes registered to Ruijie Networks Co.,LTD (IEEE MA-L, plus two MA-M/MA-S blocks).
const OUI=new Set('541651 800588 0011AD 00749C 105F02 10823D 14144B 28D0F5 300D9E 4881D4 4C4968 5423E3 58696C 58B4BB 7042D3 70856C 7085C4 7408AA 78ECB5 8CDD30 984A6B 9C2BA6 9CCE88 C0A476 C0B8E6 C470AB C4B25B C8CD55 D43127 D8332A E05D54 ECB970 F0748D FC599F'.split(' '));
const LONG=['2486251','D09686B','F43AFA2'];
const hex=mac=>String(mac||'').toUpperCase().replace(/[^0-9A-F]/g,'');
const isRuijieMac=mac=>{const h=hex(mac);return h.length===12&&(OUI.has(h.slice(0,6))||LONG.some(p=>h.startsWith(p)));};
const WORD=/ruijie|reyee|\brg-[a-z]/i;
const isRuijie=n=>isRuijieMac(n?.mac)||WORD.test([n?.name,n?.platform,n?.model,n?.software].filter(Boolean).join(' '));
const fmt=mac=>{const h=hex(mac);return h.length===12?h.match(/.{2}/g).join(':'):'';};
// One pass over a router's fresh observations: create a device for each new Ruijie AP, keep known ones up to date.
function sync(store,router,observations,now=Date.now()){const out={created:[],updated:[]};
 const devices=store.list('devices');
 for(const o of observations||[]){if(o.lastObserved!==now)continue;const ev=o.evidence||{};
  // A Ruijie router dialling PPPoE is a customer's router: the customer-router link handles it.
  if(ev.ppp||ev.hotspot)continue;
  const n=ev.neighbor||{},mac=fmt(n.mac||ev.dhcp?.mac||ev.arp?.mac||(String(o.key).startsWith('mac:')?o.key.slice(4):''));
  const probe={mac,name:n.name||ev.dhcp?.name||'',platform:n.platform||'',model:n.model||'',software:n.software||''};
  if(!mac||!isRuijie(probe))continue;
  const ip=n.ip||ev.dhcp?.ip||ev.arp?.ip||'',model=n.model||n.platform||'',name=(n.name||ev.dhcp?.name||'').trim();
  const cur=devices.find(d=>String(d.macAddress||'').toUpperCase()===mac);
  if(cur){const patch={};if(ip&&cur.ip!==ip)patch.ip=ip;if(cur.observedViaRouterId!==router.id)patch.observedViaRouterId=router.id;if(!cur.parentId)patch.parentId=router.id;if(model&&!cur.model)patch.model=model;if(!cur.vendor)patch.vendor='Ruijie';
   if(!cur.lastSeen||now-cur.lastSeen>10*60000)patch.lastSeen=now;
   if(Object.keys(patch).length){store.put('devices',{...cur,...patch},cur);out.updated.push(cur.id);}continue;}
  const d=store.put('devices',{name:name||('Ruijie AP '+mac.slice(-5).replace(':','')),type:'cpe',cpeCategory:'Wi-Fi access point',vendor:'Ruijie',model,ip,macAddress:mac,
   parentId:router.id,observedViaRouterId:router.id,location:router.location||'',managementMethod:'Vendor controller',onboardingStatus:'Observed',status:'online',lastSeen:now,autoDetected:'ruijie',
   notes:`Detected automatically on ${router.name}${n.interface||ev.dhcp?.interface||ev.arp?.interface?' ('+(n.interface||ev.dhcp?.interface||ev.arp?.interface)+')':''} on ${new Date(now+3*36e5).toISOString().slice(0,10)} from its Ruijie MAC address${n.name?' and neighbour report':''}.`});
  devices.push(d);out.created.push(d.id);store.audit({id:'system'},`Found a Ruijie access point (${mac}) on ${router.name} and added it to Devices`,d.id);}
 return out;}
// Every Ruijie AP netops knows, with where it was last seen.
function list(store,now=Date.now()){const routers=new Map(store.list('devices').filter(d=>d.type==='router').map(r=>[r.id,r]));
 return store.list('devices').filter(d=>d.type!=='router'&&(d.vendor==='Ruijie'||isRuijieMac(d.macAddress))).map(d=>({id:d.id,name:d.name,mac:d.macAddress||'',ip:d.ip||'',model:d.model||'',router:routers.get(d.observedViaRouterId||d.parentId)?.name||'',lastSeen:d.lastSeen||null,online:!!d.lastSeen&&now-d.lastSeen<15*60000,auto:d.autoDetected==='ruijie'}));}
module.exports={sync,list,isRuijie,isRuijieMac};
