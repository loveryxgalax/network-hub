'use strict';
// Router health beyond traffic: temperatures and voltage, link speed and errors per port, SFP optics, disk, clock,
// firewall counters, queues, DHCP pools, WAN reachability. Read-only: every value comes from `print`/`get`/`monitor`.
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const str=(v,max=120)=>v==null||typeof v==='object'?'':String(v).replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,max);
const num=v=>{const m=/^-?\d+(?:\.\d+)?/.exec(str(v,40));return m?Number(m[0]):null;};
const int=v=>{const n=num(v);return n===null||!Number.isFinite(n)?null:Math.round(n);};
const HIST_EVERY=300000,HIST_KEEP=2016;
const SCRIPT=`
   :local health [:toarray ""];
   :do { :local h [/system health print as-value]; :local sensors [:toarray ""];
    :foreach row in=$h do={ :if ([:typeof $row]="array") do={ :set sensors ($sensors,{{"name"=[:tostr ($row->"name")];"value"=[:tostr ($row->"value")]}}); } }
    :foreach k in={"temperature";"cpu-temperature";"board-temperature1";"board-temperature2";"voltage";"fan1-speed";"fan2-speed";"power-consumption";"psu1-state";"psu2-state"} do={ :if ([:typeof ($h->$k)]!="nothing") do={ :set sensors ($sensors,{{"name"=$k;"value"=[:tostr ($h->$k)]}}); } }
    :set ($health->"sensors") $sensors; } on-error={}
   :do { :set ($health->"hdd") {"free"=[:tostr [/system resource get free-hdd-space]];"total"=[:tostr [/system resource get total-hdd-space]];"bad"=[:tostr [/system resource get bad-blocks]]}; } on-error={}
   :do { :set ($health->"clock") {"date"=[:tostr [/system clock get date]];"time"=[:tostr [/system clock get time]];"zone"=[:tostr [/system clock get time-zone-name]]}; } on-error={}
   :do { :set ($health->"ntp") [:tostr [/system ntp client get enabled]]; } on-error={}
   :local eth [:toarray ""];
   :do { :foreach id in=[/interface ethernet find] do={ :if ([:len $eth] < 32) do={ :do {
     :local n [/interface ethernet get $id name];
     :local m [/interface ethernet monitor $id once as-value];
     :local item {"name"=$n;"status"=[:tostr ($m->"status")];"rate"=[:tostr ($m->"rate")];"duplex"=[:tostr ($m->"full-duplex")];"sfpPresent"=[:tostr ($m->"sfp-module-present")];"sfpType"=[:tostr ($m->"sfp-type")];"sfpVendor"=[:tostr ($m->"sfp-vendor-name")];"sfpRx"=[:tostr ($m->"sfp-rx-power")];"sfpTx"=[:tostr ($m->"sfp-tx-power")];"sfpTemp"=[:tostr ($m->"sfp-temperature")];"sfpVolt"=[:tostr ($m->"sfp-supply-voltage")]};
     :do { :foreach st in=[/interface ethernet print stats as-value where name=$n] do={ :set ($item->"rxFcs") [:tostr ($st->"rx-fcs-error")]; :set ($item->"rxAlign") [:tostr ($st->"rx-align-error")]; :set ($item->"rxDrop") [:tostr ($st->"rx-drop")]; :set ($item->"txDrop") [:tostr ($st->"tx-drop")]; :set ($item->"txColl") [:tostr ($st->"tx-collision")]; } } on-error={}
     :set eth ($eth,{$item});
    } on-error={} } } } on-error={}
   :set ($health->"ethernet") $eth;
   :local fw [:toarray ""];
   :do { :foreach row in=[/ip firewall filter print stats as-value where packets>0] do={ :if ([:len $fw] < 60) do={ :set fw ($fw,{{"kind"="filter";"chain"=[:tostr ($row->"chain")];"action"=[:tostr ($row->"action")];"comment"=[:tostr ($row->"comment")];"packets"=[:tostr ($row->"packets")];"bytes"=[:tostr ($row->"bytes")]}}); } } } on-error={}
   :do { :foreach row in=[/ip firewall nat print stats as-value where packets>0] do={ :if ([:len $fw] < 90) do={ :set fw ($fw,{{"kind"="nat";"chain"=[:tostr ($row->"chain")];"action"=[:tostr ($row->"action")];"comment"=[:tostr ($row->"comment")];"packets"=[:tostr ($row->"packets")];"bytes"=[:tostr ($row->"bytes")]}}); } } } on-error={}
   :set ($health->"firewall") $fw;
   :local qs [:toarray ""];
   :do { :foreach row in=[/queue simple print stats as-value] do={ :if ([:len $qs] < 60) do={ :set qs ($qs,{{"name"=[:tostr ($row->"name")];"target"=[:tostr ($row->"target")];"rate"=[:tostr ($row->"rate")];"bytes"=[:tostr ($row->"bytes")];"maxLimit"=[:tostr ($row->"max-limit")]}}); } } } on-error={}
   :set ($health->"queues") $qs;
   :local pools [:toarray ""];
   :do { :foreach row in=[/ip pool print as-value] do={ :if ([:len $pools] < 16) do={ :local pn ($row->"name"); :set pools ($pools,{{"name"=$pn;"ranges"=[:tostr ($row->"ranges")];"used"=[:len [/ip pool used find where pool=$pn]]}}); } } } on-error={}
   :set ($health->"pools") $pools;
   :local routes [:toarray ""];
   :do { :foreach row in=[/ip route print as-value where dst-address="0.0.0.0/0" and active] do={ :if ([:len $routes] < 8) do={ :set routes ($routes,{{"gateway"=[:tostr ($row->"gateway")];"distance"=[:tostr ($row->"distance")];"interface"=[:tostr ($row->"immediate-gw")]}}); } } } on-error={}
   :set ($health->"routes") $routes;
   :local pings [:toarray ""];
   :foreach target in={"1.1.1.1";"8.8.8.8"} do={ :do { :local sent 0; :local got 0; :local total 0;
     :foreach row in=[/ping address=$target count=3 interval=300ms as-value] do={ :set sent ($sent+1); :if ([:typeof ($row->"time")]="time") do={ :set got ($got+1); :set total ($total + ([:tonsec ($row->"time")] / 1000)); } }
     :local avg 0; :if ($got > 0) do={ :set avg ($total / $got); }
     :set pings ($pings,{{"target"=$target;"sent"=$sent;"received"=$got;"avgUs"=$avg}}); } on-error={} }
   :set ($health->"pings") $pings;
   :local hss [:toarray ""];
   :do { :foreach row in=[/ip hotspot print as-value] do={ :if ([:len $hss] < 16) do={ :set hss ($hss,{{"name"=[:tostr ($row->"name")];"interface"=[:tostr ($row->"interface")];"profile"=[:tostr ($row->"profile")];"addressPool"=[:tostr ($row->"address-pool")];"disabled"=[:tostr ($row->"disabled")]}}); } } } on-error={}
   :set ($health->"hotspots") $hss;
   :local ssids [:toarray ""];
   :do { :foreach row in=[/interface wireless print as-value] do={ :if ([:len $ssids] < 16) do={ :set ssids ($ssids,{{"interface"=[:tostr ($row->"name")];"ssid"=[:tostr ($row->"ssid")];"disabled"=[:tostr ($row->"disabled")]}}); } } } on-error={}
   :do { :foreach row in=[/interface wifi print as-value] do={ :if ([:len $ssids] < 16) do={ :set ssids ($ssids,{{"interface"=[:tostr ($row->"name")];"ssid"=[:tostr ($row->"configuration.ssid")];"disabled"=[:tostr ($row->"disabled")]}}); } } } on-error={}
   :set ($health->"ssids") $ssids;`;
function list(v,max,fn){if(v===undefined||v===null)return [];if(!Array.isArray(v)||v.length>max)fail('Invalid health list');return v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).map(fn);}
function normalize(input){
 if(input===undefined||input===null)return null;if(typeof input!=='object'||Array.isArray(input))fail('Invalid health report');
 const sensors={};for(const s of list(input.sensors,24,x=>x)){const name=str(s.name,40).toLowerCase(),value=num(s.value);if(name&&value!==null)sensors[name]=value;}
 const h=input.hdd||{},c=input.clock||{};
 return {sensors,hdd:{free:int(h.free),total:int(h.total),bad:int(h.bad)},clock:{date:str(c.date,20),time:str(c.time,20),zone:str(c.zone,60)},ntp:str(input.ntp,10),
  ethernet:list(input.ethernet,32,e=>({name:str(e.name,40),status:str(e.status,30),rate:str(e.rate,20),duplex:str(e.duplex,10),sfpPresent:str(e.sfpPresent,10)==='true',sfpType:str(e.sfpType,40),sfpVendor:str(e.sfpVendor,40),sfpRx:num(e.sfpRx),sfpTx:num(e.sfpTx),sfpTemp:num(e.sfpTemp),sfpVolt:num(e.sfpVolt),rxFcs:int(e.rxFcs),rxAlign:int(e.rxAlign),rxDrop:int(e.rxDrop),txDrop:int(e.txDrop),txColl:int(e.txColl)})),
  firewall:list(input.firewall,90,f=>({kind:f.kind==='nat'?'nat':'filter',chain:str(f.chain,30),action:str(f.action,30),comment:str(f.comment,100),packets:int(f.packets)||0,bytes:int(f.bytes)||0})),
  queues:list(input.queues,60,q=>({name:str(q.name,80),target:str(q.target,80),rate:str(q.rate,40),bytes:str(q.bytes,40),maxLimit:str(q.maxLimit,40)})),
  pools:list(input.pools,16,p=>({name:str(p.name,60),ranges:str(p.ranges,200),used:int(p.used)||0})),
  routes:list(input.routes,8,r=>({gateway:str(r.gateway,60),distance:str(r.distance,10),interface:str(r.interface,60)})),
  hotspots:list(input.hotspots,16,x=>({name:str(x.name,60),interface:str(x.interface,60),profile:str(x.profile,60),addressPool:str(x.addressPool,60),disabled:str(x.disabled,10)==='true'})).filter(x=>x.name),
  ssids:list(input.ssids,16,x=>({interface:str(x.interface,60),ssid:str(x.ssid,64),disabled:str(x.disabled,10)==='true'})).filter(x=>x.ssid),
  pings:list(input.pings,4,p=>({target:str(p.target,40),sent:int(p.sent)||0,received:int(p.received)||0,avgMs:Math.round((int(p.avgUs)||0)/100)/10}))};
}
const ipInt=ip=>ip.split('.').reduce((a,b)=>a*256+Number(b),0);
function poolSize(ranges){let n=0;for(const part of String(ranges).split(',')){const m=/^(\d+\.\d+\.\d+\.\d+)(?:-(\d+\.\d+\.\d+\.\d+))?$/.exec(part.trim());if(m)n+=m[2]?Math.max(0,ipInt(m[2])-ipInt(m[1])+1):1;}return n;}
const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function tzOffset(zone,at){try{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}).formatToParts(new Date(at)).map(x=>[x.type,x.value]));return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(at/1000)*1000;}catch{return 0;}}
// The router's own clock in epoch ms, from "oct/26/2026" or "2026-10-26" plus "06:27:08" in its time zone.
function routerEpoch(clock){let y,m,d,x;if((x=/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i.exec(clock.date))){y=+x[3];m=MONTHS[x[1].toLowerCase()];d=+x[2];}else if((x=/^(\d{4})-(\d{2})-(\d{2})$/.exec(clock.date))){y=+x[1];m=+x[2]-1;d=+x[3];}else return null;
 const t=/^(\d{1,2}):(\d{2}):(\d{2})$/.exec(clock.time);if(!t||m===undefined)return null;const guess=Date.UTC(y,m,d,+t[1],+t[2],+t[3]);return guess-tzOffset(clock.zone||'UTC',guess);}
const rateMbps=r=>{const m=/^([\d.]+)\s*([GMK])bps$/i.exec(String(r||''));if(!m)return null;return Number(m[1])*({G:1000,M:1,K:.001}[m[2].toUpperCase()]);};
function raise(store,router,key,active,severity,title,details){
 const open=store.list('alerts').find(a=>a.deviceId===router.id&&a.source==='router-health'&&a.logKey===key&&a.status!=='Resolved');
 if(active){if(open){if(open.details!==details||open.severity!==severity)store.put('alerts',{...open,title,details,severity},open);}else store.put('alerts',{title,details,deviceId:router.id,severity,status:'Open',source:'router-health',logKey:key});}
 else if(open)store.put('alerts',{...open,status:'Resolved'},open);
}
function ingest(store,router,h,now=Date.now()){
 if(!h)return null;const prevState=store.setting('routerHealth:'+router.id),prev=prevState?.ethernet||[],ports={...(prevState?.ports||{})};
 const drift=(()=>{const e=routerEpoch(h.clock);return e===null?null:Math.round((e-now)/1000);})();
 for(const e of h.ethernet){const rate=rateMbps(e.rate);if(rate&&e.status==='link-ok')ports[e.name]=Math.max(ports[e.name]||0,rate);}
 const latest={time:now,drift,...h,ports};store.setting('routerHealth:'+router.id,latest);
 // history for charts
 const hk='routerHealthHistory:'+router.id,hist=store.setting(hk)||{points:[]},last=hist.points.at(-1);
 if(!last||now-last[0]>=HIST_EVERY){const s=h.sensors,ping=h.pings[0],worstRx=h.ethernet.filter(e=>e.sfpRx!==null).reduce((m,e)=>m===null||e.sfpRx<m?e.sfpRx:m,null);
  hist.points.push([now,s.temperature??s['board-temperature1']??null,s['cpu-temperature']??null,s.voltage??null,ping?.received?ping.avgMs:null,ping&&ping.sent?Math.round((1-ping.received/ping.sent)*100):null,worstRx]);hist.points=hist.points.slice(-HIST_KEEP);store.setting(hk,hist);}
 // alerts
 const name=router.name,s=h.sensors,temp=Math.max(s.temperature??-1,s['board-temperature1']??-1,s['board-temperature2']??-1),cpuT=s['cpu-temperature']??-1;
 raise(store,router,'temperature',temp>=75||cpuT>=85,temp>=85||cpuT>=95?'critical':'warning',name+' is running hot',`Board ${temp>=0?temp+'°C':'—'}${cpuT>=0?', CPU '+cpuT+'°C':''}. Check ventilation and dust.`);
 const hdd=h.hdd;raise(store,router,'disk',!!hdd.total&&hdd.free!==null&&hdd.free/hdd.total<0.1,'warning',name+' is low on storage',`${hdd.free!==null?Math.round(hdd.free/1048576*10)/10:'?'} MB free of ${hdd.total!==null?Math.round(hdd.total/1048576*10)/10:'?'} MB.`);
 raise(store,router,'clock',drift!==null&&Math.abs(drift)>120,'warning',name+' clock is wrong',`The router clock differs from netops by ${drift} seconds${h.ntp==='false'?'. NTP client is off.':'.'} Logs and certificates depend on the right time.`);
 for(const e of h.ethernet){const rate=rateMbps(e.rate),best=ports[e.name]||0,before=prev.find(x=>x.name===e.name);
  raise(store,router,'link:'+e.name,e.status==='link-ok'&&!!rate&&best>=1000&&rate<best,'warning',`${name} ${e.name} link is slow`,`Negotiated ${e.rate} but this port has run at ${best>=1000?best/1000+'Gbps':best+'Mbps'}. Check the cable and the device at the other end.`);
  const errs=(e.rxFcs||0)+(e.rxAlign||0),was=before?(before.rxFcs||0)+(before.rxAlign||0):errs;
  raise(store,router,'errors:'+e.name,errs-was>=100,'warning',`${name} ${e.name} is receiving errors`,`${errs-was} new receive errors since the last report (FCS ${e.rxFcs||0}, alignment ${e.rxAlign||0}). A bad cable or SFP is the usual cause.`);
  if(e.sfpPresent&&e.sfpRx!==null){raise(store,router,'sfp-rx:'+e.name,e.sfpRx<-24,e.sfpRx<-27?'critical':'warning',`${name} ${e.name} SFP receive power is low`,`${e.sfpRx} dBm received${e.sfpVendor?' ('+e.sfpVendor+')':''}. Clean the fibre connectors or check the link.`);}
  if(e.sfpPresent&&e.sfpTemp!==null)raise(store,router,'sfp-temp:'+e.name,e.sfpTemp>=75,'warning',`${name} ${e.name} SFP is hot`,`${e.sfpTemp}°C module temperature.`);}
 for(const p of h.pools){const size=poolSize(p.ranges);raise(store,router,'pool:'+p.name,size>0&&p.used/size>=0.9,'warning',`${name} address pool ${p.name} is nearly full`,`${p.used} of ${size} addresses in use. New customers will fail to get an address when it runs out.`);}
 const bad=p=>p.sent>0&&(p.received/p.sent<0.67||p.avgMs>250),bothBad=h.pings.length>=2&&h.pings.every(bad);
 raise(store,router,'wan-quality',bothBad,'warning',name+' internet connection is poor',h.pings.map(p=>`${p.target}: ${p.received}/${p.sent} replies${p.received?', '+p.avgMs+' ms':''}`).join(' · ')+'. Both test targets are affected, so it is the uplink and not one site.');
 return latest;
}
// What the Health page shows: the latest report per router plus the chart history.
function overview(store,now=Date.now()){
 const routers=store.list('devices').filter(d=>d.type==='router').map(r=>{const h=store.setting('routerHealth:'+r.id),hist=store.setting('routerHealthHistory:'+r.id)?.points||[];
  const topFw=(h?.firewall||[]).slice().sort((a,b)=>b.packets-a.packets).slice(0,12),qs=(h?.queues||[]).filter(q=>q.rate&&q.rate!=='0/0').slice(0,30);
  return {id:r.id,name:r.name,status:r.status,reportedAt:h?.time||null,fresh:!!h&&now-h.time<600000,health:h?{...h,firewall:topFw,queues:qs,pools:(h.pools||[]).map(p=>({...p,size:poolSize(p.ranges)}))}:null,history:hist.filter(p=>now-p[0]<7*864e5)};});
 const alerts=store.list('alerts').filter(a=>a.source==='router-health'&&a.status!=='Resolved').map(a=>({id:a.id,deviceId:a.deviceId,title:a.title,details:a.details,severity:a.severity,time:a.updated||a.created}));
 return {routers,alerts};
}
module.exports={raise,SCRIPT,normalize,ingest,overview,poolSize,routerEpoch,rateMbps};
