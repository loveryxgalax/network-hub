'use strict';
// Seamless sharing code (ISPman captive feature): a hotspot customer whose package allows more than one device gets
// a permanent code. A friend types it on the WiFi page and their device takes one of the free slots on that package.
// The code logs in as itself (username = password = the code) and RADIUS counts it with the owner's devices.
// Off unless the owner turns it on (WiFi page settings). Shown to the customer only after their phone/PIN check.
const crypto=require('node:crypto');
const ALPHA='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function enabled(store){return require('./landing.cjs').get(store).show?.shareCode===true;}
function devicesOf(store,s){const p=store.get('plans',s.planId);return Math.max(1,Number(s.maxDevices||p?.devices||1));}
// The owner's code, made the first time it is needed. 8 characters, starting with S so it never looks like a voucher.
function codeOf(store,s){if(!s||s.service!=='hotspot'||s.parentId||devicesOf(store,s)<2)return null;if(s.shareCode)return s.shareCode;
 const taken=new Set(store.list('subscribers').map(x=>x.shareCode).filter(Boolean));let c;do{c='S'+Array.from(crypto.randomBytes(7),b=>ALPHA[b%ALPHA.length]).join('');}while(taken.has(c)||store.subscriberByUsername(c.toLowerCase()));
 const fresh=store.get('subscribers',s.id);store.put('subscribers',{...fresh,shareCode:c},fresh);return c;}
function owner(store,code){const c=String(code||'').trim().toUpperCase();if(!/^S[A-Z0-9]{7}$/.test(c))return null;return store.list('subscribers').find(x=>x.shareCode===c)||null;}
// What a friend sees after typing the code: only first name, package and until when, never the owner's details.
function preview(store,code,now=Date.now()){if(!enabled(store))return null;const o=owner(store,code);if(!o)return null;const p=store.get('plans',o.planId);
 const active=o.status==='active'&&o.expiresAt&&o.expiresAt>now;return {share:true,code:o.shareCode,owner:String(o.name||'').split(' ')[0],plan:p?.name||'',devices:devicesOf(store,o),active,expiresAt:o.expiresAt||null};}
function regenerate(store,id){const s=store.get('subscribers',id);if(!s)return null;const cur=store.put('subscribers',{...s,shareCode:null},s);return codeOf(store,cur);}
module.exports={enabled,codeOf,owner,preview,regenerate,devicesOf};
