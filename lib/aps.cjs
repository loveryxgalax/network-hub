'use strict';
// Access points. Every AP is read through an adapter with the same shape:
//   snapshot → {source, simulated?, uptime, clients, radios:[{band, clients, utilization, signal}], interfaces:[{name,rx,tx}]}
// Real adapters (Ruijie, Omada, …) are added only against a real controller. The simulated adapter below is for
// testing the dashboard end to end and is always labelled "Simulated": it never appears as real data.
const DAY=864e5;
function seed(id){let h=2166136261;for(const c of String(id))h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0)/4294967295;}
// Daily pattern: quiet at night, busy in the evening (Nairobi time).
const load=(t,phase)=>{const h=((t+3*36e5)%DAY)/36e5;return Math.max(0.05,0.5+0.45*Math.sin((h-8+phase)/24*2*Math.PI));};
// Monotonic byte counter = integral of a + b·sin(2πt/DAY): rate varies through the day, counter never goes back.
const counter=(t,a,b)=>Math.floor(a*t/1000-b*DAY/1000/(2*Math.PI)*Math.cos(2*Math.PI*t/DAY)+b*DAY/1000/(2*Math.PI));
const POOL=Array.from({length:150},(_,i)=>'02:5A:'+[i>>8,i&255,(i*37)&255,(i*91)&255].map(x=>x.toString(16).padStart(2,'0').toUpperCase()).join(':'));
// Simulated devices: each is active part of the day and sits on one simulated AP; every 20 minutes some move to another AP.
function simStations(device,now){const k=Number(device.simIndex)||0,n=Math.max(1,Number(device.simCount)||3),slot=Math.floor(now/(20*60000)),out=[];
 for(const mac of POOL){if(seed(mac+'|'+Math.floor(now/36e5))>load(now,seed(mac)*3))continue;if(Math.floor(seed(mac+'|'+slot)*n)!==k)continue;
  const sg=seed(mac+'s'),r=2e4+seed(mac+'r')*3e5;out.push({mac,band:sg>0.45?'5 GHz':'2.4 GHz',signal:Math.round(-45-sg*35),tx:counter(now,r,r*0.7),rx:counter(now,r*0.2,r*0.15)});}return out;}
function simulate(device,now=Date.now()){
 const s=seed(device.id),l=load(now,s*4),stations=simStations(device,now),clients=stations.length,cap=Math.round(20+s*40);
 const b24=stations.filter(x=>x.band==='2.4 GHz').length,b5=clients-b24,util=v=>Math.min(98,Math.round(v));
 const rate=2e5+s*6e5;// bytes/s average download
 return {source:'ap-sim',simulated:true,model:'Simulated AP',version:'sim-1',uptime:Math.floor((now%(9*DAY))/1000)+'s',cpu:Math.round(5+l*30),memory:Math.round(30+s*20),
  clients,stations,radios:[{band:'2.4 GHz',clients:b24,utilization:util(10+b24*2.2+l*20*(0.6+s*0.5)),signal:Math.round(-58-s*12-l*4)},{band:'5 GHz',clients:b5,utilization:util(6+b5*1.2+l*15*(0.5+s*0.5)),signal:Math.round(-62-s*10-l*3)}],
  interfaces:[{name:'wlan',type:'wlan',running:true,disabled:false,rx:counter(now,rate,rate*0.8),tx:counter(now,rate*0.25,rate*0.2)}]};}
// Comparison over a period, from the stored measurements only (concurrent clients, not total sessions).
function compare(store,now=Date.now(),days=7){const since=now-days*DAY;
 return store.list('devices').filter(d=>d.type==='ap').map(d=>{const h=store.history(d.id,since).filter(m=>m.source&&Number.isFinite(m.clients));
  const n=h.length,avg=k=>n?h.reduce((a,m)=>a+k(m),0)/n:null,radioMax=m=>Math.max(0,...(m.radios||[]).map(r=>r.utilization||0)),sig=m=>{const r=(m.radios||[]).filter(r=>Number.isFinite(r.signal));return r.length?r.reduce((a,x)=>a+x.signal,0)/r.length:null;};
  const sigs=h.map(sig).filter(v=>v!=null),busy=n?h.filter(m=>radioMax(m)>=70).length/n:null;  const peak=n?Math.max(...h.map(m=>m.clients)):null,last=d.metrics||{};
  return {id:d.id,name:d.name,simulated:!!last.simulated||d.driver==='ap-sim',status:d.status||'unknown',lastSeen:d.lastSeen||null,samples:n,clientsNow:Number.isFinite(last.clients)?last.clients:null,
   avgClients:avg(m=>m.clients),peakClients:peak,avgUtilization:avg(radioMax),congestedShare:busy,avgSignal:sigs.length?sigs.reduce((a,b)=>a+b,0)/sigs.length:null,
   rxMbps:last.traffic?.rxMbps??null,txMbps:last.traffic?.txMbps??null,source:last.source||d.driver,driver:d.driver,sector:d.sector||'',uplinkPort:d.uplinkPort||'',ip:d.ip||'',parentId:d.parentId||'',sessions:(store.setting('apVisits')||{})[d.id]||0,...paidCount(store,d.id)};})
  .map(a=>({...a,score:a.samples?Math.round(((a.avgUtilization||0)*0.5+(a.congestedShare||0)*100*0.3+Math.min(100,(a.avgClients||0)*2)*0.2)):null}))
  .sort((a,b)=>(b.score??-1)-(a.score??-1));}
function paidCount(store,apId){const st=store.setting('apStations:'+apId);if(!st?.list?.length)return {paidNow:0,unpaidNow:0};const who=customersByMac(store,st.list.map(x=>x.mac)),subs=new Map(store.list('subscribers').map(x=>[x.id,x]));let p=0;for(const x of st.list){const c=who.get(normMac(x.mac));if(c&&paidNow(subs.get(c.id)))p++;}return {paidNow:p,unpaidNow:st.list.length-p};}
// ---- Devices on each AP, moves between APs, customer and revenue attribution, congestion alerts ----
const normMac=m=>String(m||'').replace(/[^0-9a-fA-F]/g,'').toUpperCase(),fmtMac=h=>h.match(/../g)?.join(':')||'';
const MAX_MACS=3000,MAX_HIST=20,SLACK=15*60000;
// Called after each AP report: who is connected now, and per device which AP it was on and when (moves = roaming).
function track(store,device,stations,now=Date.now()){if(!Array.isArray(stations))return;
 const prev=store.setting('apStations:'+device.id)||{at:0,list:[]},pm=new Map((prev.list||[]).map(x=>[x.mac,x])),el=(now-(prev.at||now))/1000;
 const n=v=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v):null;
 const list=stations.slice(0,500).map(x=>{const mac=fmtMac(normMac(x.mac)),p=pm.get(mac),rx=n(x.rx),tx=n(x.tx);
  // Speed: as reported, else from the change in the station's byte counters since the last report.
  let down=n(x.downMbps),up=n(x.upMbps);if(down==null&&tx!=null&&p?.tx!=null&&tx>=p.tx&&el>=5&&el<=900)down=Math.round((tx-p.tx)*8/el/1e4)/100;if(up==null&&rx!=null&&p?.rx!=null&&rx>=p.rx&&el>=5&&el<=900)up=Math.round((rx-p.rx)*8/el/1e4)/100;
  return {mac,band:x.band||'',signal:Number.isFinite(x.signal)?x.signal:null,ip:String(x.ip||'').slice(0,45),name:String(x.name||'').slice(0,60),rx,tx,down,up,since:p?.since||now,loggedIn:x.loggedIn};}).filter(x=>x.mac.length===17);
 store.setting('apStations:'+device.id,{at:now,list});
 // Data used per device per hour (from counter changes), kept 7 days, for the "usage over time" chart.
 const use=store.setting('apUsage')||{},hk=Math.floor(now/36e5);
 for(const x of list){const p=pm.get(x.mac);let b=0;if(x.tx!=null&&p?.tx!=null&&x.tx>=p.tx)b+=x.tx-p.tx;if(x.rx!=null&&p?.rx!=null&&x.rx>=p.rx)b+=x.rx-p.rx;if(!b&&x.down!=null&&p&&el>0&&el<=900)b=Math.round(((x.down||0)+(x.up||0))*1e6/8*el);if(!b)continue;
  const u=use[x.mac]||(use[x.mac]={t:now,h:{}});u.h[hk]=(u.h[hk]||0)+b;u.t=now;for(const k of Object.keys(u.h))if(Number(k)<hk-24*7)delete u.h[k];}
 {const ks=Object.keys(use);if(ks.length>MAX_MACS)for(const k of ks.sort((a,b)=>use[a].t-use[b].t).slice(0,ks.length-MAX_MACS))delete use[k];}store.setting('apUsage',use);
 const seen=store.setting('apSeen')||{};let moves=store.setting('apMoves')||[];const visits=store.setting('apVisits')||{};
 for(const x of list){const r=seen[x.mac]||{h:[]},last=r.h.at(-1);
  if(last&&last.ap===device.id&&now-last.to<=SLACK)last.to=now;
  else{if(last&&last.ap!==device.id&&now-last.to<=SLACK)moves.push({mac:x.mac,from:last.ap,to:device.id,time:now});r.h.push({ap:device.id,from:now,to:now});visits[device.id]=(visits[device.id]||0)+1;if(r.h.length>MAX_HIST)r.h=r.h.slice(-MAX_HIST);}
  r.t=now;seen[x.mac]=r;}
 const keys=Object.keys(seen);if(keys.length>MAX_MACS)for(const k of keys.sort((a,b)=>seen[a].t-seen[b].t).slice(0,keys.length-MAX_MACS))delete seen[k];
 if(moves.length>500)moves=moves.slice(-500);store.setting('apSeen',seen);store.setting('apMoves',moves);store.setting('apVisits',visits);}
const paidNow=(s,now=Date.now())=>!!s&&s.status==='active'&&(s.expiresAt==null||s.expiresAt>now);
function usage(store,mac,now=Date.now()){const m=fmtMac(normMac(mac)),u=(store.setting('apUsage')||{})[m];const hk=Math.floor(now/36e5),pts=[];for(let k=hk-24*7+1;k<=hk;k++)pts.push([k*36e5,u?.h?.[k]||0]);return {mac:m,points:pts,total:pts.reduce((a,p)=>a+p[1],0)};}
// Which AP is this customer's phone on now? Phone number, account number or MAC.
function find(store,q,now=Date.now()){const raw=String(q||'').trim();if(!raw)return {found:false};const billing=require('./billing.cjs'),ph=billing.phone(raw),subs=store.list('subscribers');
 let sub=subs.find(s=>String(s.username).toLowerCase()===raw.toLowerCase())||(ph?subs.find(s=>billing.phone(s.phone)===ph):null);let macs=[];
 if(normMac(raw).length===12)macs=[fmtMac(normMac(raw))];
 else if(sub){const rows=store.sessionsOf(sub.username,now-30*864e5);macs=[...new Set(rows.map(r=>fmtMac(normMac(r.mac))).filter(m=>m.length===17))];}
 if(!macs.length)return {found:false,customer:sub?{id:sub.id,name:sub.name,username:sub.username}:null,reason:sub?'No device of this customer has been seen yet':'No customer with that phone or account number'};
 const seen=store.setting('apSeen')||{},hits=macs.map(m=>({mac:m,last:seen[m]?.h?.at(-1)})).filter(x=>x.last).sort((a,b)=>b.last.to-a.last.to);
 if(!hits.length)return {found:false,customer:sub?{id:sub.id,name:sub.name,username:sub.username}:null,reason:'This customer\'s devices have not been seen on any access point'};
 const h=hits[0],ap=store.get('devices',h.last.ap);return {found:true,customer:sub?{id:sub.id,name:sub.name,username:sub.username}:null,mac:h.mac,apId:h.last.ap,apName:ap?.name||'Removed AP',since:h.last.from,lastSeen:h.last.to,current:now-h.last.to<=SLACK};}
// Customer behind a device MAC: only with evidence — a RADIUS session from that MAC (the login names the customer).
function customersByMac(store,macs){const want=[...new Set(macs.map(normMac).filter(m=>m.length===12))];if(!want.length||!store.db)return new Map();
 const rows=store.db.prepare(`SELECT body FROM records WHERE kind='radiusSessions' AND upper(replace(replace(json_extract(body,'$.mac'),'-',''),':','')) IN (${want.map(()=>'?').join(',')})`).all(...want);
 const subs=new Map(store.list('subscribers').map(x=>[x.username,x])),out=new Map();
 for(const r of rows){const b=JSON.parse(r.body),m=normMac(b.mac),sub=subs.get(b.username),t=b.updatedAt||b.startedAt||0;if(!sub)continue;const cur=out.get(m);if(!cur||t>cur.time)out.set(m,{id:sub.id,name:sub.name,username:sub.username,service:sub.service,time:t,evidence:'RADIUS login from this device'});}
 return out;}
function clients(store,apId){const st=store.setting('apStations:'+apId)||{at:0,list:[]},who=customersByMac(store,st.list.map(x=>x.mac));
 const byId=new Map(store.list('devices').map(d=>[d.id,d.name])),moves=(store.setting('apMoves')||[]).filter(m=>m.from===apId||m.to===apId).slice(-40).reverse();
 const subs=new Map(store.list('subscribers').map(x=>[x.id,x]));return {at:st.at,stations:st.list.map(x=>{const c=who.get(normMac(x.mac))||null;return {...x,customer:c,paid:c?paidNow(subs.get(c.id)):false};}),moves:moves.map(m=>({...m,fromName:byId.get(m.from)||'Removed AP',toName:byId.get(m.to)||'Removed AP',customer:who.get(normMac(m.mac))||null}))};}
// Revenue per AP, proven only: a payment counts for an AP when the paying customer's device (matched by a RADIUS
// login from the same MAC) was on exactly that one AP within 15 minutes of the payment. Everything else is unattributed.
function revenue(store,now=Date.now(),days=7){const since=now-days*DAY,pays=store.list('subscriberPayments').filter(p=>(p.time||0)>=since&&p.amount>0&&!p.reversed);
 const seen=store.setting('apSeen')||{},aps=store.list('devices').filter(d=>d.type==='ap'),res=new Map(aps.map(a=>[a.id,{id:a.id,name:a.name,simulated:a.driver==='ap-sim',amount:0,payments:0,customers:new Set()}]));let un={amount:0,payments:0};
 const macsOf=new Map();if(store.db)for(const r of store.db.prepare(`SELECT body FROM records WHERE kind='radiusSessions' AND COALESCE(json_extract(body,'$.updatedAt'),0)>=?`).all(since-DAY)){const b=JSON.parse(r.body),m=normMac(b.mac);if(m.length!==12)continue;if(!macsOf.has(b.username))macsOf.set(b.username,new Set());macsOf.get(b.username).add(fmtMac(m));}
 for(const p of pays){const hits=new Set();for(const mac of macsOf.get(p.username)||[])for(const h of seen[mac]?.h||[])if(p.time>=h.from-SLACK&&p.time<=h.to+SLACK)hits.add(h.ap);
  const only=hits.size===1?res.get([...hits][0]):null;if(only){only.amount+=p.amount;only.payments++;only.customers.add(p.subscriberId);}else{un.amount+=p.amount;un.payments++;}}
 return {days,aps:[...res.values()].map(r=>({...r,customers:r.customers.size})).sort((a,b)=>b.amount-a.amount),unattributed:un};}
// Congestion: busiest radio ≥ 80 % or clients ≥ 90 % of the AP's capacity for 3 reports in a row opens one alert;
// 3 calm reports in a row close it.
function alerts(store,device,snap,now=Date.now()){
 // Simulated APs carry made-up data: they never raise alerts, and any alert they raised before is closed.
 if(device.driver==='ap-sim'){for(const a of store.list('alerts'))if(a.deviceId===device.id&&a.status!=='Resolved')store.put('alerts',{...a,status:'Resolved',resolvedAt:now,resolvedBy:null},a);return;}const cap=Number(device.apCapacity)||50,util=Math.max(0,...(snap.radios||[]).map(r=>r.utilization||0)),busy=util>=80||(Number(snap.clients)||0)>=cap*0.9;
 const k='apCongest:'+device.id,st=store.setting(k)||{busy:0,calm:0};if(busy){st.busy++;st.calm=0;}else{st.calm++;st.busy=0;}store.setting(k,st);
 const open=store.list('alerts').find(a=>a.deviceId===device.id&&a.source==='ap-capacity'&&a.status!=='Resolved');
 if(busy&&st.busy>=3&&!open)store.put('alerts',{title:device.name+' is congested',deviceId:device.id,source:'ap-capacity',severity:'warning',status:'Open',details:`Busiest radio ${util}% used, ${snap.clients||0} clients (capacity ${cap}). Consider another AP nearby or a different channel.`});
 if(!busy&&st.calm>=3&&open)store.put('alerts',{...open,status:'Resolved',resolvedAt:now,resolvedBy:null},open);}
module.exports={usage,find,paidNow,simulate,compare,counter,load,track,clients,revenue,alerts,customersByMac,normMac};
