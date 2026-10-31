'use strict';
// Branding API for the ISP's own website: business details, theme and the packages on sale, read with a secret key
// (Authorization: Bearer <key>). The key is shown once and stored only as a hash. Read-only; no customer data.
const crypto=require('node:crypto');
const hash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
function status(store){const k=store.secret('brandApi');return k?{enabled:true,createdAt:k.createdAt,last4:k.last4}:{enabled:false};}
function generate(store){const key='kn_'+crypto.randomBytes(24).toString('base64url');store.secret('brandApi',{hash:hash(key),createdAt:Date.now(),last4:key.slice(-4)});return {key,...status(store)};}
function revoke(store){store.secret('brandApi',null);return status(store);}
function check(store,header){const k=store.secret('brandApi'),m=/^Bearer\s+(\S{10,200})$/.exec(String(header||''));if(!k||!m)return false;const a=Buffer.from(hash(m[1]),'hex'),b=Buffer.from(k.hash,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function isp(store,landing){const ws=store.setting('workspace')||{},c=landing.get(store);
 return {name:ws.name||c.brandName||'',description:ws.description||'',address:ws.address||'',country:ws.country||'Kenya',currency:ws.currency||'KES',email:ws.email||c.email||'',phone:ws.phone||c.phone||'',whatsapp:c.whatsapp||'',theme:{name:c.theme,brandColor:c.brandColor},accountPrefix:c.accountPrefix||''};}
function packages(store,service){return store.list('plans').filter(p=>p.active!==false&&!p.hidden&&(service==='pppoe'?p.service==='pppoe':p.service!=='pppoe')).sort((a,b)=>(a.order||0)-(b.order||0)||a.price-b.price)
 .map(p=>({id:p.id,name:p.name,price:p.price,currency:'KES',downloadMbps:p.downloadMbps,uploadMbps:p.uploadMbps,validity:{value:p.durationValue,unit:p.durationUnit},devices:p.devices||1,popular:!!p.popular,features:p.features||[]}));}
module.exports={status,generate,revoke,check,isp,packages};
