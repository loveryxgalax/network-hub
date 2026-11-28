'use strict';
// Who is on the captive portal right now: each open portal page pings every 10 seconds with the view it shows.
// Kept in memory only (nothing stored); a visitor drops off 30 seconds after their last ping.
const crypto=require('node:crypto');
const TTL=30000,MAX=5000,PAGES=['Packages','Purchase Package','PPPoE Package','Account','Paying','Connected','Free access'];
const seen=new Map();
function ping(input,{ip='',ua=''}={},now=Date.now()){
 const mac=/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i.test(String(input.mac||''))?String(input.mac).toUpperCase():'';
 const key=crypto.createHash('sha256').update(mac||ip+'\0'+ua+'\0'+String(input.tab||'').slice(0,40)).digest('hex').slice(0,24);
 if(!seen.has(key)&&seen.size>=MAX)prune(now);if(!seen.has(key)&&seen.size>=MAX)return {ok:false};
 seen.set(key,{at:now,page:PAGES.includes(input.page)?input.page:'Packages',service:input.service==='pppoe'?'pppoe':'hotspot',device:String(input.nas||'').replace(/[^\w ().@-]/g,'').trim().slice(0,40)});
 return {ok:true};}
function leave(input,meta,now=Date.now()){ping({...input,page:'Packages'},meta,now-TTL-1);}
function prune(now){for(const [k,v] of seen)if(now-v.at>TTL)seen.delete(k);}
function now(at=Date.now()){prune(at);const out={total:0,hotspot:0,pppoe:0,pages:{},devices:{}};
 for(const v of seen.values()){out.total++;out[v.service]++;out.pages[v.page]=(out.pages[v.page]||0)+1;const d=v.device||'Unknown router';out.devices[d]=(out.devices[d]||0)+1;}
 return out;}
const reset=()=>seen.clear();
module.exports={ping,leave,now,reset,TTL};
