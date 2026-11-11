'use strict';
// One register of everyone and everything that is kept off the network, all stored in the database:
//  * Banned accounts: permanent. Login refused, no renewals or purchases (even if they pay), and every device the account
//    has used is blocked too. Only an admin or manager can lift a ban.
//  * Blocked devices (MAC addresses): refused on every account. Kept in the RADIUS settings with who, when and why.
//  * Deactivated accounts: temporary. Login refused until someone activates the account again. Nothing is deleted.
//  * Deleted accounts: in the recycle bin for 90 days (restorable), then gone for good.
// IP addresses are not blocked: hotspot and PPPoE customers get a new address from the router's pool on every login, so
// an IP block would hit whoever gets that address next. Block the device (MAC) or ban the account instead.
const radius=()=>require('./radius.cjs');
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s});};
const macOf=v=>{const h=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');return h.length===12?h.match(/../g).join(':'):'';};
// Every MAC the account is known to have used: bound/last MAC and its recent sessions.
function macsOf(store,sub,now=Date.now()){const out=new Set([macOf(sub.boundMac),macOf(sub.lastMac)]);
 try{for(const x of store.sessionsOf(sub.username,now-90*864e5))out.add(macOf(x.mac||x.callingStationId));}catch{}
 out.delete('');return [...out].slice(0,50);}
function ban(store,id,{reason='',unban=false,user,now=Date.now()}={}){const sub=store.get('subscribers',String(id||''));if(!sub)fail('Customer not found',404);
 const cfg=radius().settings(store),tag='ban:'+sub.id;let list=cfg.blockedMacs||[];
 if(unban){if(!sub.banned)fail('This account is not banned',409);const freed=list.filter(b=>b.ban===tag).map(b=>b.mac);
  radius().updateSettings(store,{blockedMacs:list.filter(b=>b.ban!==tag)});const {banned,...rest}=sub;const saved=store.put('subscribers',rest,sub);
  store.audit(user||{id:'system'},`Lifted the ban on ${sub.username}${freed.length?' and unblocked '+freed.length+' device(s)':''}`,sub.id);return {subscriber:saved,unblocked:freed};}
 const why=String(reason||'').trim();if(why.length<3)fail('Say why the account is banned');if(sub.banned)fail('This account is already banned',409);
 const macs=macsOf(store,sub,now),added=[];for(const m of macs)if(!list.some(b=>b.mac===m)){list=[...list,{mac:m,reason:('Banned account '+sub.username+': '+why).slice(0,120),by:user?.email||'system',at:now,ban:tag}];added.push(m);}
 if(added.length)radius().updateSettings(store,{blockedMacs:list});
 const saved=store.put('subscribers',{...sub,banned:{at:now,by:user?.email||'system',byName:user?.name||'',reason:why.slice(0,200)}},sub);
 store.audit(user||{id:'system'},`Banned ${sub.username} permanently (${why.slice(0,80)})${added.length?'; blocked '+added.length+' device(s)':''}`,sub.id);
 return {subscriber:saved,blocked:added};}
function list(store){const subs=store.list('subscribers'),byId=new Map(subs.map(s=>[s.id,s])),cfg=radius().settings(store),plan=new Map(store.list('plans').map(p=>[p.id,p.name]));
 const row=s=>({id:s.id,name:s.name,username:s.username,service:s.service,phone:s.phone||'',plan:plan.get(s.planId)||''});
 const banned=subs.filter(s=>s.banned).map(s=>({...row(s),at:s.banned.at,by:s.banned.byName||s.banned.by,reason:s.banned.reason})).sort((a,b)=>b.at-a.at);
 const deactivated=subs.filter(s=>!s.banned&&s.status==='suspended').map(s=>({...row(s),at:s.deactivatedAt||s.updated,reason:s.deactivatedReason||''})).sort((a,b)=>(b.at||0)-(a.at||0));
 const devices=(cfg.blockedMacs||[]).map(b=>{const sid=String(b.ban||'').replace(/^ban:/,''),s=sid?byId.get(sid):null,owner=s||subs.find(x=>macOf(x.lastMac)===b.mac||macOf(x.boundMac)===b.mac);
  return {mac:b.mac,reason:b.reason||'',by:b.by||'',at:b.at||null,viaBan:!!b.ban,customer:owner?{id:owner.id,name:owner.name,username:owner.username}:null};}).sort((a,b)=>(b.at||0)-(a.at||0));
 let deleted=[];try{deleted=require('./trash.cjs').list(store).map(t=>({id:t.id,name:t.name,username:t.username,service:t.service,phone:t.phone,at:t.deletedAt,by:t.deletedByName||t.deletedBy}));}catch{}
 return {banned,deactivated,devices,deleted,counts:{banned:banned.length,deactivated:deactivated.length,devices:devices.length,deleted:deleted.length}};}
module.exports={ban,list,macsOf};
