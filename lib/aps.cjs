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
function simulate(device,now=Date.now()){
 const s=seed(device.id),cap=Math.round(20+s*40),l=load(now,s*4),clients=Math.max(0,Math.round(cap*l));
 const b24=Math.round(clients*0.45),b5=clients-b24,util=v=>Math.min(98,Math.round(v));
 const rate=2e5+s*6e5;// bytes/s average download
 return {source:'ap-sim',simulated:true,model:'Simulated AP',version:'sim-1',uptime:Math.floor((now%(9*DAY))/1000)+'s',cpu:Math.round(5+l*30),memory:Math.round(30+s*20),
  clients,radios:[{band:'2.4 GHz',clients:b24,utilization:util(15+l*70*(0.6+s*0.5)),signal:Math.round(-58-s*12-l*4)},{band:'5 GHz',clients:b5,utilization:util(8+l*55*(0.5+s*0.5)),signal:Math.round(-62-s*10-l*3)}],
  interfaces:[{name:'wlan',type:'wlan',running:true,disabled:false,rx:counter(now,rate,rate*0.8),tx:counter(now,rate*0.25,rate*0.2)}]};}
// Comparison over a period, from the stored measurements only (concurrent clients, not total sessions).
function compare(store,now=Date.now(),days=7){const since=now-days*DAY;
 return store.list('devices').filter(d=>d.type==='ap').map(d=>{const h=store.history(d.id,since).filter(m=>m.source&&Number.isFinite(m.clients));
  const n=h.length,avg=k=>n?h.reduce((a,m)=>a+k(m),0)/n:null,radioMax=m=>Math.max(0,...(m.radios||[]).map(r=>r.utilization||0)),sig=m=>{const r=(m.radios||[]).filter(r=>Number.isFinite(r.signal));return r.length?r.reduce((a,x)=>a+x.signal,0)/r.length:null;};
  const sigs=h.map(sig).filter(v=>v!=null),busy=n?h.filter(m=>radioMax(m)>=70).length/n:null;  const peak=n?Math.max(...h.map(m=>m.clients)):null,last=d.metrics||{};
  return {id:d.id,name:d.name,simulated:!!last.simulated||d.driver==='ap-sim',status:d.status||'unknown',lastSeen:d.lastSeen||null,samples:n,clientsNow:Number.isFinite(last.clients)?last.clients:null,
   avgClients:avg(m=>m.clients),peakClients:peak,avgUtilization:avg(radioMax),congestedShare:busy,avgSignal:sigs.length?sigs.reduce((a,b)=>a+b,0)/sigs.length:null,
   rxMbps:last.traffic?.rxMbps??null,txMbps:last.traffic?.txMbps??null,source:last.source||d.driver};})
  .map(a=>({...a,score:a.samples?Math.round(((a.avgUtilization||0)*0.5+(a.congestedShare||0)*100*0.3+Math.min(100,(a.avgClients||0)*2)*0.2)):null}))
  .sort((a,b)=>(b.score??-1)-(a.score??-1));}
module.exports={simulate,compare,counter,load};
