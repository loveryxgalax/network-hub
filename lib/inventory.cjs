'use strict';
// Device Management: one inventory for routers, OLTs, ONTs, access points, switches and customer routers, with what
// Kade Cloud can really do with each one (capability matrix). Nothing is guessed: a value Kade Cloud does not get
// from the device is "Not supported" or empty, and simulated equipment is always marked.
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s});};
const CAPS=[['status','Online status'],['uptime','Uptime'],['cpu','CPU & memory'],['interfaces','Interfaces & traffic'],['clients','Connected clients'],['optical','Optical power'],['radio','Radio use & signal'],['alarms','Events & logs'],['backup','Config backup'],['reboot','Remote reboot'],['wifi','Wi-Fi settings']];
// yes = Kade Cloud reads it now · approval = can do it, only when an admin confirms · sim = simulated data only · no = not supported
const BY_DRIVER={
 'routeros-script':{status:'yes',uptime:'yes',cpu:'yes',interfaces:'yes',clients:'yes',optical:'no',radio:'no',alarms:'yes',backup:'yes',reboot:'approval',wifi:'no'},
 'routeros-rest':{status:'yes',uptime:'yes',cpu:'yes',interfaces:'yes',clients:'yes',optical:'no',radio:'no',alarms:'no',backup:'no',reboot:'no',wifi:'no'},
 snmp:{status:'yes',uptime:'yes',cpu:'no',interfaces:'yes',clients:'yes',optical:'yes',radio:'no',alarms:'no',backup:'no',reboot:'no',wifi:'no'},
 'olt-gateway':{status:'yes',uptime:'no',cpu:'no',interfaces:'no',clients:'yes',optical:'yes',radio:'no',alarms:'no',backup:'no',reboot:'approval',wifi:'no'},
 'ap-acs':{status:'yes',uptime:'no',cpu:'no',interfaces:'no',clients:'yes',optical:'no',radio:'no',alarms:'no',backup:'no',reboot:'no',wifi:'no'},
 'ap-port':{status:'yes',uptime:'no',cpu:'no',interfaces:'no',clients:'yes',optical:'no',radio:'no',alarms:'no',backup:'no',reboot:'no',wifi:'no'},
 'ap-controller':{status:'yes',uptime:'no',cpu:'no',interfaces:'no',clients:'yes',optical:'no',radio:'yes',alarms:'no',backup:'no',reboot:'no',wifi:'no'},
 'ap-sim':{status:'sim',uptime:'sim',cpu:'sim',interfaces:'sim',clients:'sim',optical:'no',radio:'sim',alarms:'no',backup:'no',reboot:'no',wifi:'no'}};
const PREFIX={HWTC:'Huawei',ZTEG:'ZTE',ALCL:'Nokia',TPLG:'TP-Link',VSOL:'V-SOL',FHTT:'FiberHome',GPON:'Generic',DSNW:'DASAN',CDTC:'C-Data',BDCM:'BDCOM',RTKG:'Realtek'};
function caps(d,acs){if(d.type==='onu'){const c=Object.fromEntries(CAPS.map(([k])=>[k,'no']));c.status='yes';c.optical='yes';if(acs){c.wifi='approval';c.reboot='approval';c.uptime='yes';}return c;}
 if(d.type==='cpe')return Object.fromEntries(CAPS.map(([k])=>[k,acs?(['status','uptime','wifi','reboot'].includes(k)?(['wifi','reboot'].includes(k)?'approval':'yes'):'no'):'no']));
 return {...Object.fromEntries(CAPS.map(([k])=>[k,'no'])),...(BY_DRIVER[d.driver]||{})};}
function vendor(d){if(d.vendor)return d.vendor;if(/^routeros/.test(d.driver||'')||d.type==='router')return 'MikroTik';if(d.driver==='ap-sim')return 'Simulated';const p=String(d.serial||'').slice(0,4).toUpperCase();return PREFIX[p]||'';}
const KIND={router:'Router',olt:'OLT',onu:'ONT / ONU',cpe:'Customer router',ap:'Access point',switch:'Switch'};
const MGMT={'routeros-script':'RouterOS script check-in','routeros-rest':'RouterOS REST API',snmp:'SNMP','olt-gateway':'OLT gateway','ap-sim':'Simulated adapter','ap-acs':'TR-069 connected devices','ap-port':'Router port / VLAN','ap-controller':'Omada / Ruijie controller',none:'Inventory only'};
function list(store,now=Date.now()){const devs=store.list('devices'),byId=new Map(devs.map(d=>[d.id,d])),sites=new Map((store.list('sites')||[]).map(s=>[s.id,s.name]));
 const acsSerials=new Set((store.setting('acsDevices')?.items||[]).map(x=>String(x.serial||'').toUpperCase()));
 return devs.map(d=>{const m=d.metrics||{},acs=!!d.cpeManaged||acsSerials.has(String(d.serial||'').toUpperCase());const pt=d.type==='router'?store.setting('onlineSeries:'+d.id)?.points?.at(-1):null;
  const clients=d.type==='router'?(pt&&now-pt[0]<15*60000?(pt[1]||0)+(pt[2]||0):null):d.type==='olt'?devs.filter(o=>o.type==='onu'&&o.parentId===d.id&&o.status==='online').length:Number.isFinite(m.clients)?m.clients:null;
  const parent=d.parentId?byId.get(d.parentId):null,last=d.lastSeen||d.lastCheck||null;
  return {id:d.id,name:d.name,kind:d.type,kindLabel:KIND[d.type]||d.type,vendor:vendor(d),model:d.model||m.model||'',serial:d.serial||'',mac:d.macAddress||'',firmware:d.firmware||m.version||'',
   management:MGMT[d.driver||'none']||d.driver,address:d.ip||'',site:sites.get(d.siteId||d.zoneId)||'',location:d.location||'',parentId:d.parentId||'',parent:parent?.name||'',port:d.uplinkPort||d.pon||'',
   status:d.status||(d.driver==='none'?'not monitored':'unknown'),uptime:m.uptime||'',lastContact:last,stale:last?now-last>15*60000:true,clients,simulated:d.driver==='ap-sim'||!!m.simulated,
   pollSeconds:Number(d.pollSeconds)||null,apCapacity:Number(d.apCapacity)||null,sector:d.sector||'',maxUsers:Number(d.maxUsers)||null,apMatch:d.apMatch||'',controllerId:d.controllerId||'',apKey:d.apKey||'',driver:d.driver||'none',capabilities:caps(d,acs)};});}
// Manual correction of where a device hangs in the network (parent device and port) and its polling interval.
function setLink(store,id,input){const d=store.get('devices',id);if(!d)fail('Device not found',404);const next={...d};
 if(input.parentId!==undefined){const p=String(input.parentId||'');if(p&&!store.get('devices',p))fail('Choose an existing parent device');if(p===id)fail('A device cannot be its own parent');
  let x=p,guard=0;while(x&&guard++<50){if(x===id)fail('That would make a loop');x=store.get('devices',x)?.parentId||'';}next.parentId=p;}
 if(input.port!==undefined)next.uplinkPort=String(input.port||'').trim().slice(0,40);
 if(input.sector!==undefined)next.sector=String(input.sector||'').trim().slice(0,40);
 if(input.maxUsers!==undefined){const v=Number(input.maxUsers);if(input.maxUsers!==''&&input.maxUsers!==null&&!(v>=1&&v<=100000))fail('User limit must be 1 to 100000');next.maxUsers=input.maxUsers===''||input.maxUsers===null?undefined:Math.round(v);}
 if(input.pollSeconds!==undefined){const v=Number(input.pollSeconds);if(input.pollSeconds!==''&&input.pollSeconds!==null&&!(v>=30&&v<=3600))fail('Polling must be between 30 and 3600 seconds');next.pollSeconds=input.pollSeconds===''||input.pollSeconds===null?undefined:Math.round(v);}
 if(input.apCapacity!==undefined){const v=Number(input.apCapacity);if(input.apCapacity!==''&&input.apCapacity!==null&&!(v>=1&&v<=1000))fail('Capacity must be 1 to 1000 clients');next.apCapacity=input.apCapacity===''||input.apCapacity===null?undefined:Math.round(v);}
 return store.put('devices',next,d);}
function csv(rows){const q=v=>{const s=v==null?'':String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 const head=['Name','Type','Vendor','Model','Serial','MAC','Firmware','Management','Address','Site','Parent','Port','Status','Uptime','Last contact','Clients',...CAPS.map(c=>c[1])];
 return [head.join(','),...rows.map(r=>[r.name,r.kindLabel,r.vendor,r.model,r.serial,r.mac,r.firmware,r.management+(r.simulated?' (simulated)':''),r.address,r.site,r.parent,r.port,r.status,r.uptime,r.lastContact?new Date(r.lastContact).toISOString():'',r.clients??'',...CAPS.map(([k])=>({yes:'Yes',approval:'With approval',sim:'Simulated',no:'Not supported'})[r.capabilities[k]])].map(q).join(','))].join('\n');}
module.exports={CAPS,list,caps,setLink,csv,vendor};
