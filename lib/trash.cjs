'use strict';
// Recently deleted customers: deleting keeps a copy (with their password and PIN, still encrypted) for 90 days, so a
// customer deleted by mistake can be restored with the same account, history and payments.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const KEEP=90*864e5;
function remove(store,s,user,now=Date.now()){store.transaction(()=>{
 store.put('deletedSubscribers',{subscriber:{...s},subscriberId:s.id,name:s.name,username:s.username,service:s.service,phone:s.phone||'',routerId:s.routerId||'',deletedAt:now,deletedBy:user?.email||'system',deletedByName:user?.name||''});
 store.remove('subscribers',s.id);});}
function restore(store,trashId,user,now=Date.now()){return store.transaction(()=>{const t=store.get('deletedSubscribers',trashId);if(!t)fail('Not found (restored already, or older than 90 days)',404);const s=t.subscriber;
 if(store.get('subscribers',s.id))fail('This customer already exists',409);if(store.list('subscribers').some(x=>x.username===s.username))fail(`The username ${s.username} is now used by another customer. Rename that customer first.`,409);
 if(s.staticIp&&store.list('subscribers').some(x=>x.staticIp===s.staticIp))fail(`${s.staticIp} is now given to another customer. Change that first.`,409);
 const {id,version,created,updated,...body}=s;
 // Same id as before, so payments, ledger and tickets that point at it line up again. Router entries are re-sent.
 store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('subscribers',?,?,?,?)").run(id,JSON.stringify({...body,staticApplied:'',restoredAt:now,restoredBy:user?.email||null}),created||now,now);
 store.remove('deletedSubscribers',trashId);return store.get('subscribers',id);});}
function list(store){return store.list('deletedSubscribers').sort((a,b)=>b.deletedAt-a.deletedAt).map(({subscriber,...t})=>({...t,plan:subscriber?.planId?store.get('plans',subscriber.planId)?.name||'':'',staticIp:subscriber?.staticIp||''}));}
// Daily: forget deletions older than 90 days, including the kept password and PIN.
function purge(store,now=Date.now()){let n=0;for(const t of store.list('deletedSubscribers'))if(now-t.deletedAt>KEEP){store.transaction(()=>{store.db.prepare('DELETE FROM secrets WHERE device_id IN (?,?)').run('subscriber:'+t.subscriberId,'pin:'+t.subscriberId);store.remove('deletedSubscribers',t.id);});n++;}return n;}
module.exports={remove,restore,list,purge,KEEP};
