'use strict';
// Polling scheduler for devices Kade Cloud reaches itself (API, SNMP, controller). Routers that check in by script are
// not polled here. It keeps collection away from request handlers and safe for slow or dead devices:
//  * per-device interval (device.pollSeconds, 30–3600 s, default 60)
//  * at most LIMIT polls at the same time, each with a time limit
//  * back-off after failures: 2×, 4×, … the interval, at most 15 minutes, back to normal after one success
//  * counters: a drop is a router reboot / counter reset (no negative rates); 32-bit wraps are detected
//  * old measurements thinned: raw for 2 days, then one per 15 minutes (the 30-day limit stays in store.prune)
const LIMIT=4,TIMEOUT=25000,MAX_BACKOFF=15*60000,MIN=30,MAX=3600,DEFAULT=60;
const state=new Map();// deviceId -> {next, failures, running, lastError, lastOk}
const interval=d=>Math.min(MAX,Math.max(MIN,Number(d.pollSeconds)||DEFAULT))*1000;
function due(devices,now=Date.now()){return devices.filter(d=>{const s=state.get(d.id);return !s||(!s.running&&now>=s.next);});}
function backoff(d,failures){return Math.min(MAX_BACKOFF,interval(d)*2**Math.min(failures,6));}
function withTimeout(p,ms){let t;return Promise.race([p,new Promise((_,rej)=>{t=setTimeout(()=>rej(new Error('No answer within '+Math.round(ms/1000)+' s')),ms);})]).finally(()=>clearTimeout(t));}
// Run every due device through poll(), LIMIT at a time. A failure never stops the others.
async function run(devices,poll,{now=Date.now(),limit=LIMIT,timeout=TIMEOUT}={}){
 const queue=due(devices,now);const done={ok:0,failed:0,skipped:devices.length-queue.length};
 async function worker(){for(let d=queue.shift();d;d=queue.shift()){const s=state.get(d.id)||{failures:0};s.running=true;state.set(d.id,s);
  try{await withTimeout(Promise.resolve().then(()=>poll(d)),timeout);s.failures=0;s.lastOk=Date.now();s.lastError='';s.next=Date.now()+interval(d);done.ok++;}
  catch(e){s.failures++;s.lastError=String(e?.message||e).slice(0,200);s.next=Date.now()+backoff(d,s.failures);done.failed++;}
  finally{s.running=false;}}}
 await Promise.all(Array.from({length:Math.max(1,Math.min(limit,queue.length))},worker));return done;}
function status(id){const s=state.get(id);return s?{next:s.next,failures:s.failures,lastError:s.lastError||'',lastOk:s.lastOk||null,running:!!s.running}:null;}
function reset(id){if(id)state.delete(id);else state.clear();}
// Bytes per second between two counter readings. Handles a 32-bit wrap; a reset (reboot) gives null, never negative.
function rate(prev,cur,seconds){if(prev==null||cur==null||!(seconds>0))return null;const a=Number(prev),b=Number(cur);if(!Number.isFinite(a)||!Number.isFinite(b))return null;
 if(b>=a)return (b-a)/seconds;const wrapped=2**32-a+b;if(a<2**32&&a>2**31&&wrapped/seconds<1.25e9)return wrapped/seconds;return null;}
// Thin measurements older than `keepRawMs`: keep the first one per device per 15 minutes.
function downsample(store,now=Date.now(),keepRawMs=2*864e5,bucketMs=15*60000){const db=store.db;if(!db)return 0;const before=now-keepRawMs;
 const r=db.prepare(`DELETE FROM measurements WHERE time<? AND id NOT IN (SELECT MIN(id) FROM measurements WHERE time<? GROUP BY device_id, time/${bucketMs|0})`).run(before,before);return r.changes||0;}
module.exports={run,due,status,reset,rate,downsample,interval,backoff,LIMIT,TIMEOUT};
