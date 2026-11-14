'use strict';
// RouterOS version tracker: compares each router with MikroTik's newest published version (read from their public
// update server and cached). Netops never upgrades a router; it lists the commands for you to run.
const CHANNELS={stable:'NEWESTa7.stable','long-term':'NEWESTa7.long-term',testing:'NEWESTa7.testing'};
const cache=new Map();
const parse=v=>{const m=/(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v||''));return m?[+m[1],+m[2],+(m[3]||0)]:null;};
const cmp=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0;};
async function latest(channel,fetchImpl=fetch,now=Date.now()){
 const hit=cache.get(channel);if(hit&&now-hit.at<6*3600000)return hit.version;
 try{const r=await fetchImpl('https://upgrade.mikrotik.com/routeros/'+(CHANNELS[channel]||CHANNELS.stable),{signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error('HTTP '+r.status);const t=(await r.text()).trim().split(/\s+/)[0];if(!parse(t))throw new Error('Unexpected reply');cache.set(channel,{at:now,version:t});return t;}
 catch{return hit?.version||null;}
}
async function overview(store,channel='stable',fetchImpl=fetch,now=Date.now()){
 channel=CHANNELS[channel]?channel:'stable';const newest=await latest(channel,fetchImpl,now),nv=parse(newest);
 const routers=store.list('devices').filter(d=>d.type==='router').map(r=>{const cur=r.metrics?.version||r.version||'',cv=parse(cur),behind=nv&&cv?cmp(cv,nv)<0:null;return {id:r.id,name:r.name,model:r.metrics?.model||r.model||'',version:cur,status:r.status,behind,uptime:r.metrics?.uptime||'',lastSeen:r.lastSeen||null};});
 // Least critical first: small boards, then the core router last.
 const weight=m=>/ccr|crs|rb4011|rb5009/i.test(m)?3:/hex|rb760|rb750/i.test(m)?2:1;
 routers.sort((a,b)=>weight(a.model)-weight(b.model)||a.name.localeCompare(b.name));
 return {channel,newest,routers,commands:['/export compact hide-sensitive file=before-upgrade','/system backup save name=before-upgrade',`/system package update set channel=${channel}`,'/system package update check-for-updates','/system package update download','/system reboot']};
}
module.exports={overview,latest,parse,cmp};
