'use strict';
// One router's log: events the router reported (its own log lines forwarded by the monitoring script, configuration
// changes, health), the jobs Kade Cloud ran on it (with secrets masked) and system-log problems that name it. Newest first.
const jobs=require('./jobs.cjs');
function forRouter(store,id,{q='',level='',kind='',from='',to='',limit=500}={},now=Date.now()){
 const r=store.get('devices',id);if(!r||r.type!=='router'){const e=new Error('Router not found');e.status=404;throw e;}
 const out=[];
 for(const l of store.setting('routerSyslog:'+r.id)?.items||[])out.push({time:l.time,level:l.level==='critical'?'error':l.level==='error'?'error':l.level==='warning'?'warning':'info',kind:'router',title:l.topics||'log',message:l.message});
 if(!(store.setting('routerSyslog:'+r.id)?.items||[]).length)for(const e of store.setting('routerEvents:'+r.id)?.items||[])out.push({time:e.observedAt||Date.parse(e.time)||0,level:/critical|error/.test(e.topics||'')?'error':'warning',kind:'router',title:e.topics||'log',message:e.message||''});
 for(const a of store.list('alerts'))if(a.deviceId===r.id&&a.source!=='router-log')out.push({time:a.lastEventAt||a.updated||a.created,level:a.severity==='critical'||a.severity==='high'?'error':a.severity==='warning'||a.severity==='medium'?'warning':'info',kind:a.source==='router-log'?'router':'health',title:a.title,message:String(a.details||'').slice(0,400),count:a.eventCount||1,status:a.status||''});
 for(const j of store.list('routerJobs').filter(j=>j.routerId===r.id).map(jobs.redact))out.push({time:j.finishedAt||j.updatedAt||j.createdAt,level:j.status==='failed'?'error':j.status==='ok'?'info':'notice',kind:'job',title:j.label||j.type,message:[j.status,j.error,j.output].filter(Boolean).join(' · ').slice(0,400),by:j.createdBy||''});
 try{for(const e of require('./syslog.cjs').entries(store,now))if(e.details?.router===r.name||e.principal?.id===r.id)out.push({time:e.time,level:e.level,kind:'system',title:e.title,message:e.message});}catch{}
 const ql=String(q).toLowerCase(),f0=from?Date.parse(from):0,t0=to?Date.parse(to)+(String(to).length<=10?864e5:0):Infinity;
 return {router:{id:r.id,name:r.name},items:out.filter(x=>x.time&&x.time>=(f0||0)&&x.time<t0&&(!level||x.level===level)&&(!kind||x.kind===kind)&&(!ql||(x.title+' '+x.message).toLowerCase().includes(ql))).sort((a,b)=>b.time-a.time).slice(0,Math.min(1000,Number(limit)||300))};
}
module.exports={forRouter};
