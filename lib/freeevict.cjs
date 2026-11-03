'use strict';
// Evict free users (ISPman "Evict free users"): end free-mode sessions once free mode is off. Free sessions use their
// own login (free-xxxxxxxxxxxx), so customers who also hold a paid package keep that paid session. Each session gets
// one disconnect job on its router (routers without the job runner are listed so staff can act by hand).
const FREE=/^free-[0-9a-f]{12}$/,STALE=10*60000;
function freeSessions(store,now=Date.now()){return store.sessionsSince(now-STALE).filter(x=>!x.stoppedAt&&now-x.updatedAt<STALE&&FREE.test(x.username||''));}
function evict(store,jobs,radius,user,now=Date.now()){const out={queued:0,already:0,noRunner:[],sessions:0};const done=store.setting('freeEvicted')||{keys:[]},seen=new Set(done.keys);
 for(const x of freeSessions(store,now)){out.sessions++;const key=x.username+':'+x.sessionId;if(seen.has(key)){out.already++;continue;}
  const routerId=radius.routerOf(store,{'NAS-IP-Address':x.nas,'NAS-Identifier':x.nasName}),r=routerId&&store.get('devices',routerId);
  if(!r||!store.secret('jobs:'+r.id)){out.noRunner.push(r?.name||x.nasName||x.nas||'unknown router');continue;}
  try{jobs.create(store,{routerId:r.id,type:'disconnect',params:{username:x.username},user},now);out.queued++;seen.add(key);}catch(e){out.noRunner.push(r.name+': '+e.message);}}
 store.setting('freeEvicted',{keys:[...seen].slice(-2000)});out.noRunner=[...new Set(out.noRunner)];return out;}
// Called every minute: when free mode is off (or ended) and automatic eviction is on, end the free sessions.
function auto(store,jobs,radius,now=Date.now()){const f=radius.settings(store).freeMode;if(f&&f.autoEvict===false)return null;if(radius.freeMode(store,null,now)||(f&&f.enabled&&now<f.until))return null;if(!freeSessions(store,now).length)return null;return evict(store,jobs,radius,null,now);}
module.exports={freeSessions,evict,auto,FREE};
