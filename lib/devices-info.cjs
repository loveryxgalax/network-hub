'use strict';
// What customers connect with: operating system, browser and device model from the portal visit, by MAC.
// Also counts portal visits per hour for the reports. Nothing here identifies a person beyond the MAC.
const os=ua=>/Android/i.test(ua)?'Android':/iPhone|iPad|iPod/i.test(ua)?'iOS':/Windows/i.test(ua)?'Windows':/Mac OS X|Macintosh/i.test(ua)?'macOS':/CrOS/i.test(ua)?'ChromeOS':/Linux/i.test(ua)?'Linux':'Other';
const browser=ua=>/SamsungBrowser/i.test(ua)?'Samsung Internet':/OPR\/|Opera/i.test(ua)?'Opera':/Edg\//i.test(ua)?'Edge':/Firefox\//i.test(ua)?'Firefox':/CriOS|Chrome\//i.test(ua)?'Chrome':/Safari\//i.test(ua)?'Safari':'Other';
function device(ua){const m=/Android [\d.]+; (?:[a-z]{2}-[a-z]{2}; )?([^;)]+?)(?: Build|\))/i.exec(ua);if(m&&!/^wv$/i.test(m[1].trim()))return m[1].trim().slice(0,40);if(/iPhone/i.test(ua))return 'iPhone';if(/iPad/i.test(ua))return 'iPad';if(/Windows|Macintosh|Linux/i.test(ua))return 'Computer';return 'Unknown';}
const norm=m=>{const v=String(m||'').toUpperCase().replace(/[^0-9A-F]/g,'');return v.length===12?v.match(/.{2}/g).join(':'):null;};
function record(store,macRaw,ua,now=Date.now()){
 ua=String(ua||'').slice(0,300);if(!ua)return null;const mac=norm(macRaw),info={os:os(ua),browser:browser(ua),device:device(ua)};
 const v=store.setting('portalVisits')||{days:{}},day=new Date(now+3*36e5).toISOString().slice(0,10),h=new Date(now+3*36e5).getUTCHours(),d=v.days[day]||(v.days[day]={hours:Array(24).fill(0),os:{},device:{}});
 d.hours[h]++;d.os[info.os]=(d.os[info.os]||0)+1;const dev=info.device==='Unknown'?info.os:info.device;d.device[dev]=(d.device[dev]||0)+1;
 for(const k of Object.keys(v.days))if(k<new Date(now-60*864e5).toISOString().slice(0,10))delete v.days[k];store.setting('portalVisits',v);
 if(mac){const di=store.setting('deviceInfo')||{byMac:{}},cur=di.byMac[mac];di.byMac[mac]={...info,ua,first:cur?.first||now,last:now,count:(cur?.count||0)+1};const keys=Object.keys(di.byMac);if(keys.length>5000)for(const k of keys.sort((a,b)=>di.byMac[a].last-di.byMac[b].last).slice(0,keys.length-5000))delete di.byMac[k];store.setting('deviceInfo',di);}
 return {...info,mac};
}
function lookup(store,mac){const m=norm(mac);return m?(store.setting('deviceInfo')?.byMac?.[m]||null):null;}
function stats(store,from,to){const v=store.setting('portalVisits')||{days:{}},hours=Array(24).fill(0),osC={},devC={};let total=0;
 for(const [day,d] of Object.entries(v.days)){const t=Date.parse(day+'T00:00:00+03:00');if(t<from||t>=to)continue;d.hours.forEach((n,i)=>{hours[i]+=n;total+=n;});for(const [k,n] of Object.entries(d.os))osC[k]=(osC[k]||0)+n;for(const [k,n] of Object.entries(d.device))devC[k]=(devC[k]||0)+n;}
 const list=o=>Object.entries(o).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);return {total,hours,os:list(osC),devices:list(devC).slice(0,15)};}
module.exports={record,lookup,stats,parse:ua=>({os:os(ua),browser:browser(ua),device:device(ua)})};
