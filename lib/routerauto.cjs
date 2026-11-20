'use strict';
// Router automation (owner's choice: automate everything). Runs every minute from the collector.
//  * Moves routers' customer logins to netops RADIUS by itself, one router at a time, only in the quiet hours, and only
//    when every customer online on that router has a netops account. It then watches for 15 minutes: if the router's
//    logins or accounting do not reach netops, it moves the router back (radius-rollback) and raises an alert.
//  * Live routers (already serving customers) may get a new hotspot / PPPoE server on free ports from the router page;
//    the job script itself still refuses anything that would touch ports, bridges or networks already in use.
// Nothing here can run on a router without the job runner (that one-time paste is the only manual step).
const jobs=require('./jobs.cjs');
const NAIROBI=3*36e5,WATCH=15*60000,AUTO={id:'system',name:'Automatic',role:'admin'};
function settings(store){return {radiusMove:true,liveSetup:true,quietFrom:2,quietTo:5,...(store.setting('routerAutomation')||{})};}
function save(store,input){const cur=settings(store),h=(v,d)=>{const n=Math.round(Number(v));return Number.isInteger(n)&&n>=0&&n<=23?n:d;};
 return store.setting('routerAutomation',{radiusMove:input.radiusMove===undefined?cur.radiusMove:input.radiusMove===true,liveSetup:input.liveSetup===undefined?cur.liveSetup:input.liveSetup===true,quietFrom:h(input.quietFrom,cur.quietFrom),quietTo:h(input.quietTo,cur.quietTo)});}
const quiet=(s,now)=>{const h=new Date(now+NAIROBI).getUTCHours();return s.quietFrom<=s.quietTo?h>=s.quietFrom&&h<s.quietTo:h>=s.quietFrom||h<s.quietTo;};
const names=(store,r)=>{const wg=store.list('wgPeers').find(p=>p.routerId===r.id&&p.kind==='router');return new Set([r.name,r.ip,r.metrics?.identity,wg&&String(wg.address).split('/')[0]].filter(Boolean).map(x=>String(x).toLowerCase()));};
// Has this router already been moved (by a person or by automation)?
function moved(store,r){const last=store.list('routerJobs').filter(j=>j.routerId===r.id&&(j.type==='radius-rollback'||(j.type==='radius-move'&&j.params?.mode==='all'))&&j.status==='succeeded').sort((a,b)=>(b.finishedAt||0)-(a.finishedAt||0))[0];return !!last&&last.type==='radius-move';}
// Why a router cannot be moved now (empty = it can).
function blockers(store,r,now=Date.now()){const out=[];
 if(!store.secret('jobs:'+r.id))out.push('job runner not installed');
 const wg=store.list('wgPeers').find(p=>p.routerId===r.id&&p.kind==='router');if(!wg)out.push('no WireGuard tunnel');
 const rep=store.setting('customerDiscovery:'+r.id);if(!rep||now-(rep.lastReport||0)>30*60000)out.push('no recent customer report');
 else{const radius=require('./radius.cjs');let missing=0;for(const o of rep.observations||[])for(const k of ['ppp','hotspot']){const e=o.evidence?.[k];if(e?.name&&now-(e.observedAt||0)<36e5){const u=radius.stripRealm(store,String(e.name));if(!/^free-/.test(u)&&!store.subscriberByUsername(u))missing++;}}
  if(missing)out.push(missing+' customer(s) online without a netops account');}
 if(store.list('routerJobs').some(j=>j.routerId===r.id&&['radius-move','radius-rollback'].includes(j.type)&&['queued','sent'].includes(j.status)))out.push('a RADIUS change is already waiting');
 const st=store.setting('radiusAuto:'+r.id);if(st?.stage==='rolled-back')out.push('moved back after a failed check: needs a person to look first');
 return out;}
// Did netops hear from this router's customers since `from`? (logins accepted or accounting received)
function heard(store,r,from){const n=names(store,r);let ok=0,bad=0;
 for(const e of store.setting('radiusAuthLog')?.items||[]){if(e.time<from)break;if(!n.has(String(e.nas||'').toLowerCase()))continue;if(e.result==='authorized')ok++;else bad++;}
 const acct=store.sessionFieldsSince?store.sessionFieldsSince(from).filter(x=>n.has(String(x.nasName||'').toLowerCase())||n.has(String(x.nas||'').toLowerCase())).length:0;
 return {ok,bad,acct};}
function alert(store,r,title,details,severity){try{store.put('alerts',{title,details,deviceId:r.id,severity,status:'Open',source:'router-automation'});}catch{}}
function tick(store,now=Date.now()){const s=settings(store),routers=store.list('devices').filter(d=>d.type==='router');
 // 1. Follow routers already in progress.
 for(const r of routers){const st=store.setting('radiusAuto:'+r.id);if(!st||!['queued','watching'].includes(st.stage))continue;const j=store.get('routerJobs',st.jobId);
  if(st.stage==='queued'){if(!j||j.status==='failed'||j.status==='cancelled'){store.setting('radiusAuto:'+r.id,{...st,stage:'failed',at:now});alert(store,r,r.name+': automatic move to netops RADIUS did not run',j?.error||'The job did not finish. Nothing was changed by netops after it.','warning');}
   else if(j.status==='succeeded')store.setting('radiusAuto:'+r.id,{...st,stage:'watching',movedAt:j.finishedAt||now});continue;}
  if(now-st.movedAt<WATCH)continue;const h=heard(store,r,st.movedAt);
  if(h.ok>0||h.acct>0){store.setting('radiusAuto:'+r.id,{...st,stage:'done',at:now,check:h});alert(store,r,r.name+' now uses netops RADIUS','Moved automatically. In the first 15 minutes: '+h.ok+' logins accepted, '+h.acct+' sessions reporting.','info');}
  else{let jb=null;try{jb=jobs.create(store,{routerId:r.id,type:'radius-rollback',params:{},confirm:r.name,user:AUTO},now);}catch{}
   store.setting('radiusAuto:'+r.id,{...st,stage:'rolled-back',at:now,check:h,rollbackJob:jb?.id||null});
   alert(store,r,r.name+' was moved back to its earlier RADIUS','After the automatic move netops heard no logins or accounting from it for 15 minutes ('+h.bad+' rejected). It was switched back automatically. Check the router before trying again.','critical');}}
 // 2. Start the next router: one at a time, quiet hours only.
 if(!s.radiusMove||!quiet(s,now))return null;
 if(routers.some(r=>['queued','watching'].includes(store.setting('radiusAuto:'+r.id)?.stage)))return null;
 for(const r of routers){if(moved(store,r)||blockers(store,r,now).length)continue;
  const wg=store.list('wgPeers').find(p=>p.routerId===r.id&&p.kind==='router');
  const j=jobs.create(store,{routerId:r.id,type:'radius-move',params:{src:String(wg.address).split('/')[0],mode:'all',realm:''},confirm:r.name,user:AUTO},now);
  store.setting('radiusAuto:'+r.id,{stage:'queued',jobId:j.id,at:now});try{store.audit(AUTO,'Automatic move to netops RADIUS queued for '+r.name,r.id);}catch{}return j.id;}
 return null;}
// For the settings page: every router and where it stands.
function overview(store,now=Date.now()){return {settings:settings(store),routers:store.list('devices').filter(d=>d.type==='router').map(r=>{const st=store.setting('radiusAuto:'+r.id);
 return {id:r.id,name:r.name,runner:!!store.secret('jobs:'+r.id),onNetops:moved(store,r),stage:st?.stage||'',blockers:moved(store,r)?[]:blockers(store,r,now)};})};}
module.exports={settings,save,tick,overview,blockers,heard,quiet};
