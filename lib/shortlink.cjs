'use strict';
// Short links for this site: https://<site>/s/Ab3dE7kQ9x instead of a long account link. Only paths on this site can be
// shortened (no open redirect), codes are random and unguessable (10 characters, about 59 bits), and a link stops
// working when the page it points to would have expired. The same target reuses its live code.
const crypto=require('node:crypto');
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s});};
const ABC='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789',DAY=864e5,CODE=/^[A-Za-z0-9]{10}$/;
const newCode=()=>{const b=crypto.randomBytes(10);return [...b].map(x=>ABC[x%ABC.length]).join('');};
// A path on this site, from a full URL on our own origin or a path.
function path(target,origin){const s=String(target||'').trim();if(!s)fail('Enter the link to shorten');let u;try{u=new URL(s,origin||'http://site.invalid');}catch{fail('That is not a valid link');}
 if(origin&&u.origin!==new URL(origin).origin)fail('Only links on this site can be shortened');if(!/^https?:$/.test(u.protocol))fail('That is not a valid link');
 const p=u.pathname+u.search+u.hash;if(!p.startsWith('/')||p.startsWith('//')||p.length>2000)fail('That is not a valid link');return p;}
function create(store,target,{origin,expiresAt,now=Date.now(),by}={}){const p=path(target,origin),exp=Number(expiresAt)||now+90*DAY;
 const live=store.list('shortLinks').find(x=>x.target===p&&(x.expiresAt||0)>now+DAY);if(live)return {code:live.code,url:(origin||'')+'/s/'+live.code,expiresAt:live.expiresAt};
 // Keep the table small: forget links that expired more than a week ago.
 for(const x of store.list('shortLinks'))if((x.expiresAt||0)<now-7*DAY)store.remove('shortLinks',x.id);
 let code;do{code=newCode();}while(store.get('shortLinks',code));
 store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('shortLinks',?,?,?,?)").run(code,JSON.stringify({code,target:p,expiresAt:exp,hits:0,by:by||''}),now,now);
 return {code,url:(origin||'')+'/s/'+code,expiresAt:exp};}
function resolve(store,code,now=Date.now()){if(!CODE.test(String(code||'')))return null;const x=store.get('shortLinks',code);if(!x||(x.expiresAt||0)<=now)return null;
 store.put('shortLinks',{...x,hits:(x.hits||0)+1,lastUsed:now},x);return x.target;}
module.exports={create,resolve,path};
