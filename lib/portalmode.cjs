'use strict';
// Which customer experience a portal request belongs to:
//   hotspot: the router's own WiFi pages (login.html / buy.html on wifi.kadenetworks.com). Those pages are plain http
//            (a captive portal cannot be https), so their requests to the central backend carry an http:// Origin/Referer.
//   pppoe:   pages on the customer address (my.kadenetworks.com, https). PPPoE only.
//   any:     no browser page at all (M-Pesa/Paystack callbacks, server-to-server, older API clients): unchanged.
// A router whose WiFi pages are older than the current ones still sends phones to the customer address with its router
// details in the link; those phones get a signed, short-lived "hotspot pass" so their captive login keeps working until
// staff press "Update WiFi pages" (Router jobs). Nothing else on the customer address shows hotspot workflows.
const crypto=require('node:crypto');
const PASS_MS=2*3600000;
const key=store=>require('./selfservice.cjs').key(store);
function sign(store,body){return crypto.createHmac('sha256',key(store)).update('portal-pass|'+body).digest('base64url').slice(0,22);}
function pass(store,nas,now=Date.now()){const body=(now+PASS_MS).toString(36)+'.'+Buffer.from(String(nas||'').slice(0,60)).toString('base64url');return body+'.'+sign(store,body);}
function validPass(store,token,now=Date.now()){const m=/^([0-9a-z]+)\.([A-Za-z0-9_-]*)\.([A-Za-z0-9_-]{22})$/.exec(String(token||''));if(!m)return false;
 const body=m[1]+'.'+m[2],good=sign(store,body);if(good.length!==m[3].length||!crypto.timingSafeEqual(Buffer.from(good),Buffer.from(m[3])))return false;return parseInt(m[1],36)>now;}
function of(store,req,hosts=[],now=Date.now()){const src=req.headers.origin||req.headers.referer||'';if(!src||src==='null')return 'any';
 let u;try{u=new URL(src);}catch{return 'any';}if(u.protocol==='http:')return 'hotspot';
 // Only our own customer/admin pages are the PPPoE experience; other https sites (e.g. the brand website) are left alone.
 if(!hosts.filter(Boolean).includes(u.host))return 'any';
 if(validPass(store,req.headers['x-portal-pass'],now))return 'hotspot';return 'pppoe';}
// Does an account / package of this service belong to the experience the request came from?
const fits=(mode,service)=>mode==='any'||!service||service==='both'||(mode==='hotspot'?service==='hotspot':service!=='hotspot');
function hotspotHost(custHost){return process.env.NETWORK_HOTSPOT_HOST||(custHost&&custHost.split('.').length>2?'wifi.'+custHost.split('.').slice(1).join('.'):'wifi.kadenetworks.com');}
function wrong(mode,custHost){const e=new Error(mode==='pppoe'?`This is a WiFi (hotspot) account. Connect to the Kade WiFi and open ${hotspotHost(custHost)} to buy or renew.`:'This is a home internet (PPPoE) account. Open my.'+String(custHost||'kadenetworks.com').split('.').slice(-2).join('.')+' to manage it.');e.status=409;e.wrongService=mode==='pppoe'?'hotspot':'pppoe';return e;}
function check(mode,service,custHost){if(!fits(mode,service))throw wrong(mode,custHost);}
// Endpoints that only exist for the hotspot (device/MAC sessions, router login, trial, points, TVs).
const HOTSPOT_ONLY=new Set(['session','active','usage','connect-account','connect-now','code-login','login','trial','redeem-points','me/tv','brand/hotspot-packages']);
const PPPOE_ONLY=new Set(['brand/pppoe-packages']);
module.exports={PPPOE_ONLY,of,pass,validPass,fits,check,wrong,hotspotHost,HOTSPOT_ONLY,PASS_MS};
