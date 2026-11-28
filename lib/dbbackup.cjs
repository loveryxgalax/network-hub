'use strict';
// The hub's own safety copies of its database, and what it knows about the off-site backup.
//  * Every night (and before each deploy, see scripts/autodeploy.sh) a consistent copy is written inside the data volume
//    and then test-restored: opened, checked by SQLite, its customers / payments / ledger counted against the live
//    database, and its encrypted secrets confirmed readable with the master key. Seven nightly copies are kept.
//  * These copies sit on the same disk as the database: they protect against a bad change, not against losing the
//    server. The off-site backup (deployment/docker/backup.sh) reports each upload here so the Health page can show
//    its age and warn when it is missing or old.
const fs=require('node:fs'),path=require('node:path');
const DAY=864e5,KEEP=7,KINDS=['subscribers','subscriberPayments','ledger','plans'];
const dirOf=store=>path.join(store.dir,'backups','nightly');
function verify(store,file){const {DatabaseSync}=require('node:sqlite');const out={file:path.basename(file),ok:false,checks:[]};let c=null;
 try{c=new DatabaseSync(file,{readOnly:true});
  const integ=c.prepare('PRAGMA integrity_check').get().integrity_check;out.checks.push(['Database opens and passes its integrity check',integ==='ok']);
  for(const k of KINDS){const a=store.db.prepare('SELECT count(*) n FROM records WHERE kind=?').get(k).n,b=c.prepare('SELECT count(*) n FROM records WHERE kind=?').get(k).n;out.checks.push([`${k}: ${b} in the copy, ${a} live`,b<=a&&a-b<=Math.max(5,a*0.01)]);}
  const secrets=c.prepare('SELECT device_id,encrypted FROM secrets LIMIT 3').all();let readable=true;
  for(const s of secrets){const live=store.db.prepare('SELECT encrypted FROM secrets WHERE device_id=?').get(s.device_id);if(live&&live.encrypted===s.encrypted){try{if(store.secret(s.device_id)==null)readable=false;}catch{readable=false;}}}
  out.checks.push([`Encrypted secrets readable with the master key (${secrets.length} checked)`,readable]);
  out.checks.push(['master.key is present beside the database',fs.existsSync(path.join(store.dir,'master.key'))]);
  out.ok=out.checks.every(x=>x[1]);}
 catch(e){out.checks.push(['Copy could not be opened: '+String(e.message).slice(0,100),false]);}
 finally{try{c?.close();}catch{}}
 return out;}
function nightly(store,now=Date.now()){const dir=dirOf(store);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'nightly-'+new Date(now).toISOString().slice(0,10)+'.sqlite');try{fs.rmSync(file,{force:true});}catch{}
 store.db.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);const v=verify(store,file);
 if(!v.ok){try{fs.rmSync(file,{force:true});}catch{}}
 else for(const f of fs.readdirSync(dir).filter(f=>/^nightly-.*\.sqlite$/.test(f)).sort().slice(0,-KEEP))fs.rmSync(path.join(dir,f),{force:true});
 const rec={time:now,ok:v.ok,file:v.ok?v.file:null,checks:v.checks,bytes:v.ok?fs.statSync(file).size:0};store.setting('dbBackup:last',rec);
 if(!v.ok){try{store.audit({id:'system'},'Nightly database copy FAILED its restore test: '+v.checks.filter(x=>!x[1]).map(x=>x[0]).join('; '),'backup');}catch{}}
 return rec;}
// Run when due (called from a timer): once a day.
function tick(store,now=Date.now()){const last=store.setting('dbBackup:last');if(last&&now-last.time<DAY-600000)return null;return nightly(store,now);}
// The off-site script leaves a small note in the data volume after each successful upload (name, size and time only).
const offsiteFile=store=>path.join(store.dir,'backups','offsite.json');
function offsite(store){try{const j=JSON.parse(fs.readFileSync(offsiteFile(store),'utf8'));return {time:Number(j.time)||0,name:String(j.name||'').slice(0,120),size:String(j.size||'').slice(0,20)};}catch{return null;}}
function status(store,now=Date.now()){const last=store.setting('dbBackup:last')||null,off=offsite(store);
 const list=d=>{try{return fs.readdirSync(d).filter(f=>f.endsWith('.sqlite')).sort().reverse().slice(0,10).map(f=>({name:f,bytes:fs.statSync(path.join(d,f)).size,time:fs.statSync(path.join(d,f)).mtimeMs}));}catch{return [];}};
 let disk=null;try{const s=fs.statfsSync(store.dir);disk={freeBytes:Number(s.bavail)*Number(s.bsize),totalBytes:Number(s.blocks)*Number(s.bsize)};}catch{}
 const problems=[];
 if(!last)problems.push('No nightly copy has been made yet (the first is made within an hour of starting).');else if(!last.ok)problems.push('The last nightly copy failed its restore test.');else if(now-last.time>2*DAY)problems.push('The last good nightly copy is more than two days old.');
 if(!off)problems.push('No off-site backup has ever reported in. If this server is lost, the data is lost. Set it up with deployment/docker/install-backup.sh.');else if(now-off.time>2*DAY)problems.push('The last off-site backup is more than two days old.');
 if(disk&&disk.totalBytes&&disk.freeBytes/disk.totalBytes<0.1)problems.push('Less than 10% of the disk is free.');
 // Memory against the container's limit (a restart for lack of memory stops logins for a few seconds).
 let memory=null;try{const rss=process.memoryUsage().rss;let lim=0;for(const f of ['/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory/memory.limit_in_bytes']){try{const v=Number(fs.readFileSync(f,'utf8').trim());if(v>0&&v<1e13){lim=v;break;}}catch{}}memory={rssBytes:rss,limitBytes:lim||null};if(lim&&rss/lim>0.85)problems.push('The hub is using more than 85% of its memory limit. Raise HUB_MEMORY in the server .env.');}catch{}
 return {memory,uptimeSeconds:Math.round(process.uptime()),nightly:last,nightlyCopies:list(dirOf(store)),predeployCopies:list(path.join(store.dir,'predeploy')),offsite:off,disk,problems,ok:!problems.length};}
module.exports={verify,nightly,tick,status,offsite};
