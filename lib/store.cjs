'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
class Store {
 constructor(directory){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path.join(directory,'network.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(kind,id));
   CREATE TABLE IF NOT EXISTS secrets(device_id TEXT PRIMARY KEY,encrypted TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS measurements(id INTEGER PRIMARY KEY,device_id TEXT NOT NULL,time INTEGER NOT NULL,online INTEGER NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS measurements_device_time ON measurements(device_id,time);
   CREATE INDEX IF NOT EXISTS records_kind_updated ON records(kind,updated);
   CREATE INDEX IF NOT EXISTS subscribers_username ON records(json_extract(body,'$.username')) WHERE kind='subscribers';
   CREATE INDEX IF NOT EXISTS sessions_username ON records(json_extract(body,'$.username'),updated) WHERE kind='radiusSessions';
   CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time INTEGER NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,amount INTEGER NOT NULL,description TEXT NOT NULL,time INTEGER NOT NULL);
  `);
  const keyPath=path.join(directory,'master.key');
  if(!fs.existsSync(keyPath)){
   if(this.db.prepare('SELECT count(*) n FROM secrets').get().n)throw new Error('Missing master.key: restore it with the database; refusing to replace it');
   fs.writeFileSync(keyPath,crypto.randomBytes(32),{mode:0o600,flag:'wx'});
  }
  this.key=fs.readFileSync(keyPath);if(this.key.length!==32)throw new Error('Invalid master.key');
 }
 // Re-entrant: a transaction started inside another one joins it (all or nothing together).
 transaction(fn){if(this.inTransaction)return fn();this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}finally{this.inTransaction=false;}}
 setting(key,value){if(value===undefined){const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null;}this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));return value;}
 list(kind){return this.db.prepare('SELECT * FROM records WHERE kind=? ORDER BY created DESC,id').all(kind).map(row=>this.unpack(row));}
 // RADIUS sessions grow with every connection, so read only what is needed (both use indexes).
 sessionsSince(since){return this.db.prepare("SELECT * FROM records WHERE kind='radiusSessions' AND updated>=? ORDER BY updated DESC").all(since).map(row=>this.unpack(row));}
 sessionsOf(username,since=0){return this.db.prepare("SELECT * FROM records WHERE kind='radiusSessions' AND json_extract(body,'$.username')=? AND updated>=? ORDER BY updated DESC").all(String(username),since).map(row=>this.unpack(row));}
 // The same sessions as plain fields extracted by SQLite (no per-row JSON parsing in JavaScript), for reports.
 sessionFieldsSince(since){return this.db.prepare("SELECT json_extract(body,'$.username') username,json_extract(body,'$.service') service,json_extract(body,'$.nasName') nasName,json_extract(body,'$.nas') nas,json_extract(body,'$.mac') mac,json_extract(body,'$.startedAt') startedAt,json_extract(body,'$.stoppedAt') stoppedAt,json_extract(body,'$.updatedAt') updatedAt,json_extract(body,'$.downloadBytes') downloadBytes,json_extract(body,'$.uploadBytes') uploadBytes FROM records WHERE kind='radiusSessions' AND updated>=?").all(since);}
 subscriberByUsername(username){return this.unpack(this.db.prepare("SELECT * FROM records WHERE kind='subscribers' AND json_extract(body,'$.username')=?").get(String(username)));}
 recentStopped(limit){return this.db.prepare("SELECT * FROM records WHERE kind='radiusSessions' AND json_extract(body,'$.stoppedAt') IS NOT NULL ORDER BY updated DESC LIMIT ?").all(limit).map(row=>this.unpack(row));}
 // Last router name each customer connected through (latest session per username).
 lastNasByUser(since=0){const out=new Map();for(const r of this.db.prepare("SELECT json_extract(body,'$.username') u,json_extract(body,'$.nasName') n,json_extract(body,'$.nas') ip,MAX(updated) t FROM records WHERE kind='radiusSessions' AND updated>=? GROUP BY u").all(since))out.set(r.u,{nasName:r.n||'',nas:r.ip||''});return out;}
 unpack(row){return row?{...JSON.parse(row.body),id:row.id,version:row.version,created:row.created,updated:row.updated}:null;}
 get(kind,id){return this.unpack(this.db.prepare('SELECT * FROM records WHERE kind=? AND id=?').get(kind,id));}
 put(kind,body,existing){const now=Date.now(),id=existing?.id||crypto.randomUUID();const payload={...body};for(const key of ['id','version','created','updated'])delete payload[key];
  if(existing){const r=this.db.prepare('UPDATE records SET body=?,version=version+1,updated=? WHERE kind=? AND id=? AND version=?').run(JSON.stringify(payload),now,kind,id,existing.version);if(!r.changes)throw Object.assign(new Error('This record changed. Reload and try again.'),{status:409});}
  else this.db.prepare('INSERT INTO records(kind,id,body,created,updated) VALUES(?,?,?,?,?)').run(kind,id,JSON.stringify(payload),now,now);
  const saved=this.get(kind,id);
  // Change listeners (the live-view outbox). A failing listener never fails the save.
  if(this.hooks)for(const h of this.hooks){try{h(kind,saved,existing||null);}catch{}}
  return saved;
 }
 remove(kind,id){this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
 audit(user,action,target){this.db.prepare('INSERT INTO audit(time,user_id,action,target) VALUES(?,?,?,?)').run(Date.now(),user?.id||'collector',action,target);}
 encrypt(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
 secret(id,value){if(value===undefined){const row=this.db.prepare('SELECT encrypted FROM secrets WHERE device_id=?').get(id);if(!row)return null;const b=Buffer.from(row.encrypted,'base64'),decipher=crypto.createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString());}this.db.prepare('INSERT INTO secrets VALUES(?,?) ON CONFLICT(device_id) DO UPDATE SET encrypted=excluded.encrypted').run(id,this.encrypt(value));}
 measure(id,online,body){this.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,?,?)').run(id,Date.now(),online?1:0,JSON.stringify(body));}
 history(id,since=Date.now()-30*86400000){return this.db.prepare('SELECT time,online,body FROM measurements WHERE device_id=? AND time>=? ORDER BY time').all(id,since).map(row=>({...JSON.parse(row.body),time:row.time,online:!!row.online}));}
 availability(){const row=this.db.prepare(`WITH intervals AS (SELECT time,online,LEAD(time) OVER(PARTITION BY device_id ORDER BY time,id) next_time FROM measurements WHERE time>=?) SELECT COALESCE(SUM(CASE WHEN next_time-time BETWEEN 1 AND 120000 THEN next_time-time ELSE 0 END),0) observed,COALESCE(SUM(CASE WHEN next_time-time BETWEEN 1 AND 120000 AND online=1 THEN next_time-time ELSE 0 END),0) online FROM intervals`).get(Date.now()-30*86400000);return {...row,percent:row.observed?row.online/row.observed*100:null};}
 prune(){this.db.prepare('DELETE FROM measurements WHERE time<?').run(Date.now()-30*86400000);this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());}
 close(){this.db.close();}
}
function hashPassword(password){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(password,salt,64).toString('hex');}
function checkPassword(password,hash){const [salt,hex]=hash.split(':');const actual=crypto.scryptSync(password,salt,64),expected=Buffer.from(hex,'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}
module.exports={Store,hashPassword,checkPassword};
