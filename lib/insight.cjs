'use strict';
// One customer at a glance for the admin profile: lifetime value with a trend, the lifecycle timeline, a year of daily
// activity for the heatmap, package history, tickets and the account's own activity log. All read with SQL lookups on
// this customer only, so it stays quick on large networks.
const DAY=864e5,TZ=3*36e5; // Africa/Nairobi, no daylight saving
const dayKey=t=>new Date(Number(t)+TZ).toISOString().slice(0,10);
function rows(store,kind,path,val){return store.db.prepare(`SELECT * FROM records WHERE kind=? AND json_extract(body,'$.${path}')=?`).all(kind,val).map(r=>store.unpack(r));}
function build(store,sub,now=Date.now()){
 const pays=rows(store,'subscriberPayments','subscriberId',sub.id).filter(p=>!p.reversedAt).map(p=>({...p,t:p.time||p.created})).sort((a,b)=>a.t-b.t);
 const sum=list=>Math.round(list.reduce((n,p)=>n+(Number(p.amount)||0),0));
 const last30=sum(pays.filter(p=>p.t>=now-30*DAY)),prev30=sum(pays.filter(p=>p.t>=now-60*DAY&&p.t<now-30*DAY));
 const total=sum(pays),months=Math.max(1,(now-(sub.created||now))/(30*DAY));
 const trend=prev30?Math.round((last30-prev30)/prev30*100):last30?100:0;
 // Sessions for a year (and the first one ever, which may be older).
 const since=now-365*DAY,ses=store.sessionsOf(sub.username,since);
 const first=store.db.prepare("SELECT MIN(COALESCE(json_extract(body,'$.startedAt'),updated)) t FROM records WHERE kind='radiusSessions' AND json_extract(body,'$.username')=?").get(String(sub.username))?.t||null;
 const days=new Map();for(const x of ses){const t=x.startedAt||x.updatedAt;if(!t||t<since)continue;const k=dayKey(t),d=days.get(k)||{sessions:0,bytes:0,minutes:0};
  d.sessions++;d.bytes+=(Number(x.downloadBytes)||0)+(Number(x.uploadBytes)||0);d.minutes+=Math.max(0,Math.round(((x.stoppedAt||x.updatedAt||t)-t)/60000));days.set(k,d);}
 const lastSes=ses.reduce((m,x)=>Math.max(m,x.stoppedAt||x.updatedAt||0),0)||sub.lastSeen||null;
 const timeline=[{key:'created',label:'Account created',at:sub.created||null},
  {key:'firstPayment',label:'First payment',at:pays[0]?.t||null,detail:pays[0]?`KES ${pays[0].amount}${pays[0].planName?' · '+pays[0].planName:''}`:''},
  {key:'firstSession',label:'First session',at:first},{key:'lastSession',label:'Last session',at:lastSes},
  ...(sub.status==='suspended'?[{key:'deactivated',label:'Deactivated',at:sub.deactivatedAt||sub.updated||null,detail:sub.deactivatedReason||''}]:[]),
  ...(sub.banned?[{key:'banned',label:'Banned',at:sub.banned.at,detail:sub.banned.reason||''}]:[]),{key:'today',label:'Today',at:now}];
 // Package history: what each payment bought, collapsed into runs of the same package, newest first.
 const pk=[];for(const p of pays){const name=p.planName||'';if(!name)continue;const l=pk[pk.length-1];
  if(l&&l.name===name){l.until=p.t;l.payments++;l.amount+=Number(p.amount)||0;}else pk.push({name,from:p.t,until:p.t,payments:1,amount:Number(p.amount)||0});}
 const tickets=rows(store,'tickets','subscriberId',sub.id).map(t=>({id:t.id,title:t.title,status:t.status,priority:t.priority,created:t.created,rating:t.rating||null})).sort((a,b)=>b.created-a.created).slice(0,100);
 const names=new Map(store.db.prepare('SELECT id,name,email FROM users').all().map(u=>[u.id,u.name||u.email]));
 const log=store.db.prepare('SELECT time,user_id,action FROM audit WHERE target=? ORDER BY id DESC LIMIT 200').all(sub.id)
  .map(a=>({time:a.time,by:names.get(a.user_id)||(['collector','system'].includes(a.user_id)?'System':'Customer'),action:a.action}));
 return {lifetime:{total,last30,prev30,trend,payments:pays.length,perMonth:Math.round(total/months),since:pays[0]?.t||null},
  timeline,activity:{from:dayKey(since),to:dayKey(now),days:Object.fromEntries(days),activeDays:days.size},
  packages:pk.reverse(),tickets,log,points:Number(sub.points)||0,notes:sub.notes||''};}
module.exports={build,dayKey};
