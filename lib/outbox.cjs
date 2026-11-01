'use strict';
// Event outbox for the Phoenix live view: a short, ordered list of things that just happened (alert opened,
// router down, payment received, customer connected…). Phoenix reads it with a cursor (`after=seq`), so it can
// catch up after a restart. Node stays the only writer; bodies carry display fields only, never secrets.
const KEEP=48*36e5,MAX_PAGE=500;
function ensure(store){if(store._outbox)return;store.db.exec(`CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,type TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS outbox_time ON outbox(time);`);store._outbox=true;}
let writes=0;
// admin: only shown to admins (money).
function emit(store,type,body,{admin=false,now=Date.now()}={}){
 ensure(store);const r=store.db.prepare('INSERT INTO outbox(time,type,admin,body) VALUES(?,?,?,?)').run(now,String(type).slice(0,40),admin?1:0,JSON.stringify(body||{}));
 if(++writes%500===0)prune(store,now);return Number(r.lastInsertRowid);
}
function prune(store,now=Date.now()){ensure(store);store.db.prepare('DELETE FROM outbox WHERE time<?').run(now-KEEP);}
function last(store){ensure(store);return store.db.prepare('SELECT COALESCE(MAX(seq),0) seq FROM outbox').get().seq;}
const row=r=>({seq:r.seq,time:r.time,type:r.type,admin:!!r.admin,...JSON.parse(r.body)});
// Without a cursor: the latest `limit` events (what a fresh viewer or a restarted Phoenix starts from).
function since(store,after,limit=200){
 ensure(store);limit=Math.max(0,Math.min(MAX_PAGE,Math.floor(Number(limit))||0));const top=last(store);
 const oldest=store.db.prepare('SELECT COALESCE(MIN(seq),0) seq FROM outbox').get().seq;
 if(after==null||after===''||!Number.isFinite(Number(after))){const events=store.db.prepare('SELECT * FROM outbox ORDER BY seq DESC LIMIT ?').all(Math.min(limit||50,MAX_PAGE)).reverse().map(row);return {events,last:top,reset:false};}
 after=Math.floor(Number(after));
 // The cursor is ahead of the outbox (the database was restored or replaced) or behind what is kept: start again.
 if(after>top||(oldest&&after<oldest-1)){const events=store.db.prepare('SELECT * FROM outbox ORDER BY seq DESC LIMIT 50').all().reverse().map(row);return {events,last:top,reset:true};}
 const events=store.db.prepare('SELECT * FROM outbox WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit||MAX_PAGE).map(row);
 return {events,last:top,reset:false};
}
// Record changes as events: hooked into store.put so every code path that saves these records is covered.
function watch(store){
 ensure(store);(store.hooks||(store.hooks=[])).push((kind,saved,existing)=>{
  if(kind==='alerts'){
   if(!existing&&saved.status!=='Resolved')emit(store,'alert.opened',{id:saved.id,title:saved.title,severity:saved.severity||'warning'});
   else if(existing&&existing.status!=='Resolved'&&saved.status==='Resolved')emit(store,'alert.resolved',{id:saved.id,title:saved.title});
  }else if(kind==='devices'&&saved.type==='router'&&existing&&existing.status!==saved.status&&['online','offline'].includes(saved.status)){
   emit(store,saved.status==='online'?'router.up':'router.down',{id:saved.id,name:saved.name});
  }else if(kind==='subscriberPayments'&&!existing){
   emit(store,'payment.received',{name:saved.name||saved.username,amount:saved.amount,method:saved.method},{admin:true});
  }else if(kind==='subscriberPayments'&&existing&&!existing.reversedAt&&saved.reversedAt){
   emit(store,'payment.reversed',{name:saved.name||saved.username,amount:saved.amount},{admin:true});
  }else if(kind==='tickets'&&!existing){
   emit(store,'ticket.opened',{id:saved.id,title:saved.title,priority:saved.priority||'Normal'});
  }else if(kind==='subscribers'&&!existing){
   emit(store,'customer.added',{name:saved.name,service:saved.service});
  }
 });
}
module.exports={emit,since,last,prune,watch,ensure};
