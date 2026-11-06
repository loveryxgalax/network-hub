'use strict';
// Short links for this site: https://<site>/s/Ab3dE7kQ9x instead of a long account link. Only paths on this site can be
// shortened (no open redirect), codes are random and unguessable (10 characters, about 59 bits), and a link stops
// working when the page it points to would have expired. The same target reuses its live code.
const crypto=require('node:crypto');
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s});};
const ABC='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789',DAY=864e5,CODE=/^[A-Za-z0-9]{10}$/;
const newCode=()=>{const b=crypto.randomBytes(10);return [...b].map(x=>ABC[x%ABC.length]).join('');};
// A path on this site, from a full URL on our own origin or a path.
let SITE=process.env.NETWORK_PUBLIC_ORIGIN||'';
function setOrigin(o){if(o)SITE=String(o).replace(/\/$/,'');}
function path(target,origin,external=false){if(external){let u;try{u=new URL(String(target||'').trim());}catch{fail('That is not a valid link');}if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.href.length>2000)fail('That is not a valid link');return u.href;}const s=String(target||'').trim();if(!s)fail('Enter the link to shorten');let u;try{u=new URL(s,origin||'http://site.invalid');}catch{fail('That is not a valid link');}
 if(origin&&u.origin!==new URL(origin).origin)fail('Only links on this site can be shortened');if(!/^https?:$/.test(u.protocol))fail('That is not a valid link');
 const p=u.pathname+u.search+u.hash;if(!p.startsWith('/')||p.startsWith('//')||p.length>2000)fail('That is not a valid link');return p;}
function create(store,target,{origin,expiresAt,now=Date.now(),by,external=false}={}){const p=path(target,origin,external),exp=Number(expiresAt)||now+90*DAY;
 const live=store.list('shortLinks').find(x=>x.target===p&&(x.expiresAt||0)>now+DAY);if(live)return {code:live.code,url:(origin||'')+'/s/'+live.code,expiresAt:live.expiresAt};
 // Keep the table small: forget links that expired more than a week ago.
 for(const x of store.list('shortLinks'))if((x.expiresAt||0)<now-7*DAY)store.remove('shortLinks',x.id);
 let code;do{code=newCode();}while(store.get('shortLinks',code));
 store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('shortLinks',?,?,?,?)").run(code,JSON.stringify({code,target:p,expiresAt:exp,hits:0,by:by||''}),now,now);
 return {code,url:(origin||'')+'/s/'+code,expiresAt:exp};}
function resolve(store,code,now=Date.now()){if(!CODE.test(String(code||'')))return null;const x=store.get('shortLinks',code);if(!x||(x.expiresAt||0)<=now)return null;
 store.put('shortLinks',{...x,hits:(x.hits||0)+1,lastUsed:now},x);return x.target;}
// Every link in a message to a customer is replaced by a short one (this site's links and outside links alike), so an
// SMS stays short and a long token never breaks across lines. Links already short, or with no public address set, stay.
function shortenText(store,text,now=Date.now()){const o=SITE;if(!o||!text)return text;let host;try{host=new URL(o).origin;}catch{return text;}
 return String(text).replace(/https?:\/\/[^\s<>"']+/g,m=>{let link=m,tail='';while(/[.,;:!?)\]}]$/.test(link)){tail=link.slice(-1)+tail;link=link.slice(0,-1);}
  try{const u=new URL(link);if(u.origin===host&&/^\/s\/[A-Za-z0-9]{10}$/.test(u.pathname))return m;if(link.length<=34)return m;
   const r=u.origin===host?create(store,link,{origin:host,now,by:'auto'}):create(store,link,{external:true,now,by:'auto'});return host+'/s/'+r.code+tail;}catch{return m;}});}
module.exports={create,resolve,path,setOrigin,shortenText};
