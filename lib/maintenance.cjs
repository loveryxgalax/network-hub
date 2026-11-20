'use strict';
// Scheduled maintenance: one-time or weekly windows when some routers (or all) may be offline. During a window the
// WiFi login page shows the notice, and open alerts for those routers are not escalated by SMS/email (they still
// show in Alerts). Nothing is sent to the routers.
const fail=(m,status=400)=>{throw Object.assign(new Error(m),{status});};
const crypto=require('node:crypto');
function list(store){return (store.setting('maintenance')||{}).items||[];}
function save(store,input,user){const items=list(store),id=input.id&&items.some(x=>x.id===input.id)?input.id:crypto.randomUUID();
 const title=String(input.title||'').trim().slice(0,80);if(!title)fail('Give the maintenance a title');const message=String(input.message||'').trim().slice(0,240);
 const repeat=input.repeat==='weekly'?'weekly':'once';let w;
 if(repeat==='once'){const from=typeof input.from==='number'?input.from:Date.parse(input.from),to=typeof input.to==='number'?input.to:Date.parse(input.to);if(!Number.isFinite(from)||!Number.isFinite(to))fail('Choose a start and end');if(to<=from)fail('The end must be after the start');if(to-from>7*864e5)fail('A window can last at most 7 days');w={from,to};}
 else{const day=Math.round(Number(input.day));const hm=v=>{const m=String(v||'').match(/^([01]\d|2[0-3]):([0-5]\d)$/);if(!m)fail('Times look like 02:00');return Number(m[1])*60+Number(m[2]);};if(!(day>=0&&day<=6))fail('Choose a day');const start=hm(input.start),end=hm(input.end);if(end===start)fail('Start and end cannot be the same');w={day,start,end};}
 const routerIds=[...new Set((Array.isArray(input.routerIds)?input.routerIds:[]).map(String))];for(const r of routerIds){const d=store.get('devices',r);if(!d||d.type!=='router')fail('Router not found');}
 const item={id,title,message,repeat,...w,routerIds,quietAlerts:input.quietAlerts!==false,createdBy:user?.name||'',updated:Date.now()};
 store.setting('maintenance',{items:[...items.filter(x=>x.id!==id),item].slice(-50)});return item;}
function remove(store,id){store.setting('maintenance',{items:list(store).filter(x=>x.id!==id)});}
// Weekly windows use the server's local time (set TZ=Africa/Nairobi on the server).
function activeOne(m,now){if(m.repeat==='once')return now>=m.from&&now<m.to;const d=new Date(now),mins=d.getDay()*1440+d.getHours()*60+d.getMinutes(),a=m.day*1440+m.start,b=m.day*1440+m.end+(m.end<m.start?1440:0);
 return [mins,mins+7*1440].some(x=>x>=a&&x<b);}
function active(store,now=Date.now()){return list(store).filter(m=>activeOne(m,now));}
function quiet(store,deviceId,now=Date.now()){return active(store,now).some(m=>m.quietAlerts&&(!m.routerIds.length||m.routerIds.includes(deviceId)));}
// What the WiFi page shows: the first active window that covers the router the visitor is on (or all routers).
function notice(store,routerId,now=Date.now()){const m=active(store,now).find(x=>!x.routerIds.length||!routerId||x.routerIds.includes(routerId));if(!m)return null;
 return {title:m.title,message:m.message||'We are working on the network. Service may be interrupted for a short time.',until:m.repeat==='once'?m.to:null};}
module.exports={list,save,remove,active,quiet,notice,activeOne};
