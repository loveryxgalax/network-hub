#!/usr/bin/env node
'use strict';
// Read-only check for sessions hit by the old accounting bugs (delayed Interim lowering usage, Stop without counters
// zeroing usage, a repeated Stop moving the stop time). Evidence: the per-packet accounting log (kept 7 days).
// Nothing is changed. For each session where the packets prove a better value, it prints what the packets show.
//   NETWORK_DATA_DIR=/data node scripts/accounting-audit.cjs
const path=require('node:path'),{Store}=require(path.join(__dirname,'..','lib','store.cjs'));
function audit(store){const rows=(()=>{try{return store.db.prepare("SELECT time,body FROM hslog WHERE kind='acct' ORDER BY time").all();}catch{return [];}})();
 const ev=new Map();for(const r of rows){let b;try{b=JSON.parse(r.body);}catch{continue;}if(!b.sessionId)continue;const k=(b.nas||'')+'\0'+b.sessionId,e=ev.get(k)||{down:0,up:0,stops:[]};e.down=Math.max(e.down,Number(b.download)||0);e.up=Math.max(e.up,Number(b.upload)||0);if(b.status==='stop')e.stops.push(r.time);ev.set(k,e);}
 const out=[];for(const s of store.list('radiusSessions')){const e=ev.get((s.nas||'')+'\0'+s.sessionId);if(!e)continue;const f={};
  if(e.down>(s.downloadBytes||0))f.download={stored:s.downloadBytes||0,packetsShow:e.down};if(e.up>(s.uploadBytes||0))f.upload={stored:s.uploadBytes||0,packetsShow:e.up};
  if(s.stoppedAt&&e.stops.length>1&&Math.min(...e.stops)<s.stoppedAt)f.stoppedAt={stored:s.stoppedAt,firstStop:Math.min(...e.stops)};
  if(Object.keys(f).length)out.push({session:s.sessionId,router:s.nasName||s.nas,username:s.username,...f});}
 return {checkedPackets:rows.length,affected:out};}
if(require.main===module){const st=new Store(path.resolve(process.env.NETWORK_DATA_DIR||'/data')),r=audit(st);
 console.log('Accounting packets checked (last 7 days):',r.checkedPackets);console.log('Sessions the packets show were recorded wrongly:',r.affected.length);
 for(const a of r.affected)console.log(JSON.stringify(a));console.log('Read-only. No session was changed.');}
module.exports={audit};
