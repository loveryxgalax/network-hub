'use strict';
// Two-step sign-in for staff: time-based one-time codes (RFC 6238, 6 digits, 30 seconds, SHA-1), the kind every
// authenticator app produces. The key is kept encrypted with the other secrets. A code works once (replays are refused),
// one step of clock drift either way is allowed, and ten single-use recovery codes cover a lost phone.
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32=buf=>{let bits='',out='';for(const b of buf)bits+=b.toString(2).padStart(8,'0');for(let i=0;i<bits.length;i+=5)out+=B32[parseInt(bits.slice(i,i+5).padEnd(5,'0'),2)];return out;};
const unb32=s=>{let bits='';for(const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g,''))bits+=B32.indexOf(c).toString(2).padStart(5,'0');const out=[];for(let i=0;i+8<=bits.length;i+=8)out.push(parseInt(bits.slice(i,i+8),2));return Buffer.from(out);};
function codeAt(secret,step){const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(step));const h=crypto.createHmac('sha1',unb32(secret)).update(msg).digest(),o=h[h.length-1]&15;
 return String(((h[o]&127)<<24|h[o+1]<<16|h[o+2]<<8|h[o+3])%1000000).padStart(6,'0');}
const hash=c=>crypto.createHash('sha256').update(String(c)).digest('hex');
const get=(store,userId)=>store.secret('totp:'+userId)||null;
const enabled=(store,userId)=>!!get(store,userId)?.enabled;
// Step 1: make a key and show it. Nothing is required at sign-in until a code from the app has been confirmed.
function start(store,user,issuer='Kade Networks Kade Cloud'){if(enabled(store,user.id))fail('Two-step sign-in is already on',409);const secret=b32(crypto.randomBytes(20));store.secret('totp:'+user.id,{secret,enabled:false,lastStep:0,recovery:[]});
 return {secret,uri:`otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`};}
// Check a 6-digit code (or a recovery code). Returns true and records its use, inside one transaction so two requests
// cannot both spend the same code.
function check(store,userId,given,now=Date.now()){return store.transaction(()=>{const t=get(store,userId);if(!t?.secret)return false;const g=String(given||'').replace(/[\s-]/g,'');
 if(/^\d{6}$/.test(g)){const step=Math.floor(now/30000);for(const s of [step,step-1,step+1]){if(s<=t.lastStep)continue;const want=Buffer.from(codeAt(t.secret,s)),got=Buffer.from(g);if(want.length===got.length&&crypto.timingSafeEqual(want,got)){store.secret('totp:'+userId,{...t,lastStep:s});return true;}}return false;}
 if(/^[a-z0-9]{10}$/i.test(g)){const h=hash(g.toLowerCase()),i=(t.recovery||[]).indexOf(h);if(i<0)return false;const left=t.recovery.slice();left.splice(i,1);store.secret('totp:'+userId,{...t,recovery:left});return true;}
 return false;});}
// Step 2: the first correct code switches it on and returns the recovery codes (shown once).
function enable(store,user,code,now=Date.now()){const t=get(store,user.id);if(!t?.secret)fail('Start the set-up first');if(t.enabled)fail('Two-step sign-in is already on',409);
 if(!check(store,user.id,code,now))fail('That code is not right. Check the time on your phone and try the newest code.');
 const codes=Array.from({length:10},()=>crypto.randomBytes(8).toString('base64url').replace(/[^a-z0-9]/gi,'').toLowerCase().padEnd(10,'x').slice(0,10));
 store.secret('totp:'+user.id,{...get(store,user.id),enabled:true,recovery:codes.map(hash),enabledAt:now});return {enabled:true,recovery:codes};}
function disable(store,userId){const t=get(store,userId);if(!t)return {enabled:false};store.secret('totp:'+userId,{secret:'',enabled:false,lastStep:0,recovery:[]});return {enabled:false};}
const status=(store,userId)=>{const t=get(store,userId);return {enabled:!!t?.enabled,recoveryLeft:t?.enabled?(t.recovery||[]).length:0};};
module.exports={start,enable,disable,check,enabled,status,codeAt};
