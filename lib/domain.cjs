'use strict';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const fields={
 devices:{name:'required',type:['router','olt','onu','cpe'],payRefLogin:['inherit','off','sharing','migration'],subscriberId:'text',model:'text',location:'text',ip:'text',serial:'text',customer:'text',phone:'text',address:'text',parentId:'text',zoneId:'text',odbId:'text',odbPort:'port',presetId:'text',speedId:'text',pon:'text',latitude:'latitude',longitude:'longitude',driver:['none','routeros-rest','routeros-script','snmp','olt-gateway'],snmpPort:'port',snmpMapping:'long',endpoint:'text',externalId:'text',signalThreshold:'number',vendor:'text',firmware:'text',macAddress:'text',cpeCategory:['Customer router','ONT / ONU','Wi-Fi access point','Other CPE'],observedViaRouterId:'text',linkedOnuId:'text',managementMethod:['Unknown','TR-069 / GenieACS','Vendor controller','Customer managed','Local access only','Unsupported'],onboardingStatus:['Observed','Needs installation','Awaiting customer or technician','Ready for enrollment','Managed / check-in observed','Unsupported'],identityVerified:'boolean',locationVerified:'boolean',installationVerified:'boolean',customerHandoff:'boolean',remoteEnrollmentVerified:'boolean',notes:'long'},
 jobs:{title:'required',type:['Installation','Repair / no internet','Fibre signal','TR-069 setup','Relocation','Other'],priority:['Normal','Urgent'],deviceId:'text',oltId:'text',customer:'text',phone:'text',address:'text',details:'long',assigneeId:'text',due:'date',status:['Open','In progress','Done']},
 tickets:{title:'required',category:['Billing & wallet','MikroTik','OLT','TR-069','Load balancing','Account & login','Something else'],details:'long',priority:['Normal','Low','High','Urgent'],status:['Open','In progress','Pending','Resolved','Closed'],assigneeId:'text',customer:'text',subscriberId:'text'},
 zones:{name:'required',description:'long',latitude:'latitude',longitude:'longitude'},
 odbs:{name:'required',zoneId:'text',capacity:'positive',address:'text',latitude:'latitude',longitude:'longitude',notes:'long'},
 speeds:{name:'required',download:'positive',fixedUpstream:'nonnegative',notes:'long'},
 presets:{name:'required',zoneId:'text',odbId:'text',namePattern:'text',notes:'long'},
 cables:{name:'required',cableType:['Backbone','Feeder','Distribution','Drop','Other'],fromId:'text',toId:'text',fromPon:'text',cores:'positive',length:'number',route:'long',status:['Planned','Installed','Damaged']},
 closures:{name:'required',closureType:['Splice closure','FAT / terminal box','Joint box','Manhole','Pole','ODF','Other'],trays:'nonnegative',zoneId:'text',address:'text',latitude:'latitude',longitude:'longitude',details:'long'},
 splices:{name:'required',closureId:'required',fromCableId:'required',fromCore:'positive',toCableId:'required',toCore:'positive',loss:'number'},
 stock:{name:'required',sku:'text',category:['ONUs / routers for customers','MikroTik / routers','OLTs and cards','SFP modules','Fibre cable','Splitters','Closures / FATs / ODBs','Patch cords / pigtails','Connectors / sleeves','Tools','Other'],unit:'text',minimum:'nonnegative',unitCost:'nonnegative',location:'text',notes:'long'},
 profiles:{name:'required',vendor:'required',vlan:'positive',download:'positive',upload:'positive',tr069Url:'text',description:'long'},
 alerts:{title:'required',details:'long',deviceId:'text',severity:['info','warning','critical'],status:['Open','Acknowledged','Resolved']},
 invoices:{name:'required',customer:'text',subscriberId:'text',amount:'positive',due:'date',status:['Unpaid','Paid','Cancelled'],reference:'text',items:'long',taxRate:'nonnegative',notes:'long'},
 stockMoves:{stockId:'required',quantity:'nonzero',reason:'required'},
 payments:{invoiceId:'text',amount:'positive',reference:'required',description:'required'}
};
function validate(kind,input,existing,store){
 const spec=fields[kind];if(!spec)fail('Unknown collection');if(!input||typeof input!=='object'||Array.isArray(input))fail('Expected an object');const result={...existing};
 for(const [key,type]of Object.entries(spec)){const raw=input[key]??existing?.[key];
  if(kind==='devices'&&(input.type??existing?.type)!=='cpe'&&['vendor','firmware','macAddress','cpeCategory','observedViaRouterId','linkedOnuId','managementMethod','onboardingStatus','identityVerified','locationVerified','installationVerified','customerHandoff','remoteEnrollmentVerified','notes'].includes(key))continue;
  if(Array.isArray(type)){const value=raw??type[0];if(!type.includes(value))fail('Invalid '+key);result[key]=value;continue;}
  if(type==='boolean'){result[key]=raw===true||raw==='on';continue;}
  if(['number','positive','nonzero','nonnegative','port','latitude','longitude'].includes(type)){if(raw===undefined||raw===''||raw===null){if(['positive','nonzero'].includes(type))fail(key+' is required');result[key]=type==='nonnegative'?0:null;continue;}const n=Number(raw);if(!Number.isFinite(n)||Math.abs(n)>1e12||(type==='positive'&&n<=0)||(type==='nonnegative'&&n<0)||(type==='port'&&(!Number.isInteger(n)||n<1))||(type==='nonzero'&&n===0)||(type==='latitude'&&Math.abs(n)>90)||(type==='longitude'&&Math.abs(n)>180))fail('Invalid '+key);result[key]=n;continue;}
  const value=String(raw??'').trim();if(type==='required'&&!value)fail(key+' is required');if(value.length>(type==='long'?6000:250))fail(key+' is too long');if(type==='date'&&value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))))fail('Invalid date');result[key]=value;
 }
 for(const [key,target]of Object.entries({deviceId:'devices',parentId:'devices',observedViaRouterId:'devices',linkedOnuId:'devices',oltId:'devices',zoneId:'zones',odbId:'odbs',presetId:'presets',speedId:'speeds',closureId:'closures',fromCableId:'cables',toCableId:'cables',stockId:'stock',invoiceId:'invoices',subscriberId:'subscribers'}))if(result[key]&&!store.get(target,result[key]))fail(key+' does not exist');
 if(kind==='invoices'&&result.items){let list;try{list=JSON.parse(result.items);}catch{fail('Invalid line items');}if(!Array.isArray(list)||list.length>30)fail('Up to 30 line items');
  let sub=0;const clean=list.map(x=>{const d=String(x?.d||'').trim().slice(0,120),q=Number(x?.q),p=Number(x?.p);if(!d||!(q>0&&q<=100000)||!(p>=0&&p<=1e8))fail('Each line needs a description, a quantity and a unit price');sub+=q*p;return {d,q,p};});
  const tax=Number(result.taxRate)||0;if(tax>100)fail('Tax rate is 0–100%');const total=Math.round(sub*(1+tax/100)*100)/100;if(clean.length){result.items=JSON.stringify(clean);result.amount=total;}}
 if(['tickets','invoices'].includes(kind)&&result.subscriberId)result.customer=store.get('subscribers',result.subscriberId).name;
 if(kind==='invoices'&&!String(result.customer||'').trim())fail('Choose the customer account or type a customer name');
 if(result.assigneeId&&!store.db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(result.assigneeId))fail('Assignee does not exist');
 if(kind==='devices'){
  if(result.type==='cpe'&&result.driver!=='none')fail('Customer CPEs stay inventory-only here; connect them through the TR-069 or vendor controller page');if(result.type==='cpe'&&result.onboardingStatus==='Managed / check-in observed'&&(!result.remoteEnrollmentVerified||!['TR-069 / GenieACS','Vendor controller'].includes(result.managementMethod)))fail('Mark management as verified only after a successful TR-069 or vendor-controller check-in');if(result.type==='cpe'&&result.remoteEnrollmentVerified&&result.onboardingStatus!=='Managed / check-in observed')fail('Set onboarding status to Managed / check-in observed with a verified remote check-in');if(result.observedViaRouterId&&store.get('devices',result.observedViaRouterId).type!=='router')fail('Observation source must be a MikroTik router');if(result.linkedOnuId){const onu=store.get('devices',result.linkedOnuId);if(onu.type!=='onu'||!onu.parentId||!onu.serial)fail('Associated ONU must have a serial and an OLT association');}
  if(result.type!=='router'&&result.driver==='routeros-script')fail('RouterOS scripts require a router');if(result.type!=='olt'&&result.driver==='olt-gateway')fail('The gateway requires an OLT');if(result.type!=='router'&&result.driver==='routeros-rest')fail('RouterOS REST requires a router');if(['routeros-rest','olt-gateway'].includes(result.driver)&&!result.endpoint)fail('Connector endpoint is required');if(result.driver==='snmp'){if(result.type!=='olt')fail('SNMP collection currently requires an OLT');const net=require('node:net');if(!net.isIP(result.ip)&&!/^(?=.{1,253}$)[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(result.ip))fail('Enter a valid SNMP host or IP');if(result.snmpPort>65535)fail('Invalid SNMP port');try{require('./snmp.cjs').profile(result.snmpMapping);}catch(error){fail(error.message);}}if(result.parentId&&result.parentId===existing?.id)fail('Device cannot be its own parent');
  if(result.parentId&&store.get('devices',result.parentId).type!=='olt')fail('Parent must be an OLT');
  if(result.serial&&result.type==='onu'&&store.list('devices').some(d=>d.id!==existing?.id&&d.type==='onu'&&d.parentId===result.parentId&&d.serial===result.serial))fail('This ONU serial is already registered on the OLT');
  if(result.odbId&&result.type==='onu'&&store.list('devices').filter(d=>d.id!==existing?.id&&d.odbId===result.odbId&&d.type==='onu').length>=store.get('odbs',result.odbId).capacity)fail('The ODB is full');
  if(result.odbPort&&!result.odbId)fail('Choose an ODB before its port');
  if(result.odbId&&result.odbPort){if(result.odbPort>store.get('odbs',result.odbId).capacity)fail('Port exceeds ODB capacity');if(store.list('devices').some(d=>d.id!==existing?.id&&d.odbId===result.odbId&&d.odbPort===result.odbPort))fail('This ODB port is occupied');}
 }
 if(kind==='splices'){
  for(const side of ['from','to'])if(!Number.isInteger(result[side+'Core'])||result[side+'Core']>store.get('cables',result[side+'CableId']).cores)fail('Core exceeds cable capacity');
  if(result.fromCableId===result.toCableId&&result.fromCore===result.toCore)fail('A core cannot splice to itself');const ends=[[result.fromCableId,result.fromCore],[result.toCableId,result.toCore]];
  if(store.list('splices').some(s=>s.id!==existing?.id&&ends.some(([c,n])=>(s.fromCableId===c&&s.fromCore===n)||(s.toCableId===c&&s.toCore===n))))fail('A core already has a splice');
 }
 if(kind==='odbs'&&(!Number.isInteger(result.capacity)||result.capacity>4096))fail('Capacity must be an integer from 1 to 4096');
 if(kind==='odbs'&&existing&&store.list('devices').some(d=>d.odbId===existing.id&&d.odbPort>result.capacity))fail('Capacity cannot remove an occupied port');
 if(kind==='odbs'&&existing&&store.list('devices').filter(d=>d.odbId===existing.id&&d.type==='onu').length>result.capacity)fail('Capacity cannot be below the assigned ONU count');
 if(kind==='cables'&&(!Number.isInteger(result.cores)||result.cores>4096))fail('Cores must be an integer from 1 to 4096');
 if(kind==='cables'&&existing&&store.list('splices').some(s=>(s.fromCableId===existing.id&&s.fromCore>result.cores)||(s.toCableId===existing.id&&s.toCore>result.cores)))fail('Core count cannot remove an allocated splice');
 if((kind==='cables'&&result.length<0)||(kind==='stock'&&result.minimum<0))fail('Lengths and stock minimums cannot be negative');
 if(kind==='cables')for(const key of ['fromId','toId'])if(result[key]&&!['zones','odbs','closures','devices'].some(k=>store.get(k,result[key])))fail('Cable endpoint does not exist');
 if(kind==='closures'&&!Number.isInteger(result.trays))fail('Splice trays must be a whole number');
 if(kind==='presets'&&[...result.namePattern.matchAll(/\{([^}]+)\}/g)].some(m=>!['zone','odb','pon','onu'].includes(m[1])))fail('Name patterns support {zone}, {odb}, {pon} and {onu}');
 if(kind==='profiles'&&(!Number.isInteger(result.vlan)||result.vlan>4094))fail('VLAN must be an integer from 1 to 4094');
 if(kind==='stock'&&result.sku&&store.list('stock').some(s=>s.id!==existing?.id&&s.sku?.toLowerCase()===result.sku.toLowerCase()))fail('SKU already exists');
 if(kind==='stockMoves'&&store.list('stockMoves').filter(m=>m.stockId===result.stockId).reduce((n,m)=>n+m.quantity,0)+result.quantity<0)fail('Insufficient stock');
 if(['invoices','payments'].includes(kind)&&Math.abs(result.amount*100-Math.round(result.amount*100))>0.00001)fail('Amounts must have at most two decimal places');
 if(kind==='invoices'){result.status=existing?.status||'Unpaid';if(input.status&&input.status!==result.status)fail('Record a payment to settle an invoice');if(existing&&store.list('payments').some(p=>p.invoiceId===existing.id)&&result.amount!==existing.amount)fail('An invoice with payments cannot change its amount');}
 if(kind==='jobs'){result.verification=existing?.verification||'Not checked';}
 return Object.fromEntries(Object.entries(result).filter(([key])=>!['id','version','created','updated'].includes(key)));
}
function applyPreset(store,input,preset,{auto=false,useNamePattern=true}={}){
 const result={...input,presetId:preset.id};if(preset.zoneId)result.zoneId=preset.zoneId;
 if(preset.odbId&&preset.odbId!==input.odbId){const odb=store.get('odbs',preset.odbId),used=store.list('devices').filter(d=>d.id!==input.id&&d.odbId===preset.odbId);const port=Array.from({length:odb.capacity},(_,i)=>i+1).find(n=>!used.some(d=>d.odbPort===n));if(port&&used.length<odb.capacity){result.odbId=odb.id;result.odbPort=port;}else if(!auto)fail('The preset ODB is full');}
 if(useNamePattern&&preset.namePattern){const parts={zone:store.get('zones',result.zoneId)?.name||'',odb:store.get('odbs',result.odbId)?.name||'',pon:result.pon||'',onu:result.serial||input.id||''};const name=preset.namePattern.replace(/\{(zone|odb|pon|onu)\}/g,(_,key)=>parts[key]).slice(0,250).trim();if(name)result.name=name;}
 return result;
}
module.exports={fields,validate,applyPreset};
