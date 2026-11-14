'use strict';
// Network topology summary (ISPman's tiles above the map): equipment from the neighbour map, customers online per
// service from what routers report, and the kinds of devices customers used in the last 24 hours (from portal visits).
const STALE=15*60000,DAY=864e5;
function summary(store,map,now=Date.now()){
 const routers=map.nodes.filter(n=>n.kind==='router'),others=map.nodes.filter(n=>n.kind!=='router');
 let pppoe=0,hotspot=0;for(const r of routers){const pt=store.setting('onlineSeries:'+r.id)?.points?.at(-1);if(pt&&now-pt[0]<=STALE){pppoe+=pt[1]||0;hotspot+=pt[2]||0;}}
 const statics=store.list('subscribers').filter(s=>s.service==='static'&&s.status!=='inactive'&&(!s.expiresAt||s.expiresAt>now)).length;
 const kinds={phones:0,tablets:0,computers:0,other:0};
 for(const d of Object.values(store.setting('deviceInfo')?.byMac||{})){if(now-(d.last||0)>DAY)continue;
  const k=d.device==='iPad'||/tablet|SM-T|Tab/i.test(d.device||'')?'tablets':d.device==='Computer'||['Windows','macOS','Linux','ChromeOS'].includes(d.os)?'computers':d.os==='Android'||d.os==='iOS'?'phones':'other';kinds[k]++;}
 return {routers:routers.length,mikrotiks:routers.length+others.filter(n=>n.kind==='MikroTik').length,neighbours:others.length,accessPoints:others.filter(n=>n.kind==='Ubiquiti radio'||n.kind==='Switch / AP').length,olts:others.filter(n=>n.kind==='OLT').length,
  statics,hotspot,pppoe,...kinds};}
module.exports={summary};
