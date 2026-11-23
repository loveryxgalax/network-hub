'use strict';
// Remote Access link (like ISPman's): a one-hour link that opens the router's own web page (WebFig) through the Kade Cloud
// WireGuard tunnel. Anyone holding the link can reach the router's login page until it expires, so it is made by an
// admin, logged, stored only as a hash, and still needs the router's own username and password.
const crypto=require('node:crypto'),http=require('node:http');
const fail=(m,s=400)=>{const e=new Error(m);e.status=s;throw e;};
const HOUR=36e5,hash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
// Paths WebFig uses; none of them is a Kade Cloud path.
const PATHS=/^\/(webfig|jsproxy|graphics)(\/|$)/;
function create(store,routerId,by,now=Date.now()){
 const r=store.get('devices',routerId);if(!r||r.type!=='router')fail('Router not found',404);
 const peer=store.list('wgPeers').find(p=>p.kind==='router'&&p.routerId===routerId&&p.enabled!==false);
 if(!peer)fail('This router is not on Kade Cloud WireGuard yet. Add it under WireGuard & Winbox access first.',409);
 for(const l of store.list('tunnelLinks'))if(l.expiresAt<now-24*HOUR)store.remove?.('tunnelLinks',l.id);
 const token=crypto.randomBytes(24).toString('base64url');
 store.put('tunnelLinks',{hash:hash(token),routerId,routerName:r.name,address:String(peer.address).split('/')[0],expiresAt:now+HOUR,by:by||''});
 return {token,expiresAt:now+HOUR};}
function check(store,token,now=Date.now()){if(typeof token!=='string'||token.length<20||token.length>64)return null;const h=hash(token);
 const l=store.list('tunnelLinks').find(x=>x.hash===h);return l&&l.expiresAt>now?l:null;}
const cookieOf=req=>{const m=String(req.headers.cookie||'').match(/(?:^|;\s*)nt_tunnel=([A-Za-z0-9_-]{20,64})/);return m?m[1]:'';};
// Forward one request to the router's web server over the tunnel and stream the answer back.
function proxy(link,req,res,url,hops=0){
 for(const h of ['Content-Security-Policy','X-Content-Type-Options','Referrer-Policy','Cache-Control','Strict-Transport-Security'])res.removeHeader(h);
 const headers={...req.headers};delete headers.cookie;delete headers.authorization;headers.host=link.address;
 for(const h of Object.keys(headers))if(/^(cf-|x-forwarded|x-real-ip|cdn-loop)/i.test(h))delete headers[h];
 const up=http.request({host:link.address,port:link.port||80,method:req.method,path:url.pathname+url.search,headers,timeout:20000},r=>{
  const out={...r.headers};delete out['set-cookie'];if(out.location&&/^https?:\/\//i.test(out.location)){try{const u=new URL(out.location);out.location=u.pathname+u.search;}catch{}}
  // RouterOS 7 sends /webfig/ to its root page ("/"). "/" here is the Kade Cloud dashboard, so the browser would
  // leave the router: fetch the router's page here instead and keep the browser on /webfig/.
  if(r.statusCode>=300&&r.statusCode<400&&out.location&&req.method==='GET'&&hops<3){let to;try{to=new URL(out.location,'http://router'+url.pathname);}catch{}
   if(to&&!PATHS.test(to.pathname)){r.resume();return proxy(link,req,res,new URL(to.pathname+to.search,'http://router'),hops+1);}}
  res.writeHead(r.statusCode||503,out);r.pipe(res);});
 up.on('timeout',()=>up.destroy(new Error('timeout')));
 up.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'text/html; charset=utf-8'});res.end(page('The router did not answer','Kade Cloud could not reach '+esc(link.routerName)+' over WireGuard. Check that the router is online, its WireGuard tunnel is up and its www service (port 80) is on.'));}else res.destroy();});
 if(req.method==='GET'||req.method==='HEAD'||req.readableEnded)up.end();else req.pipe(up);}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=(t,b)=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><style>@font-face{font-family:"Google Sans";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/extra/GoogleSans-400.woff2") format("woff2")}@font-face{font-family:"Google Sans";font-style:normal;font-weight:500;font-display:swap;src:url("/fonts/extra/GoogleSans-500.woff2") format("woff2")}@font-face{font-family:"Google Sans";font-style:normal;font-weight:600;font-display:swap;src:url("/fonts/extra/GoogleSans-600.woff2") format("woff2")}@font-face{font-family:"Google Sans";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/extra/GoogleSans-700.woff2") format("woff2")}</style><body style="font:16px 'Google Sans';background:#f1f5f9;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><div style="background:#fff;border-radius:14px;padding:22px;max-width:420px"><h1 style="font-size:19px;margin:0 0 8px;color:#0032fd">${esc(t)}</h1><p style="margin:0;color:#334155">${b}</p></div>`;
module.exports={create,check,cookieOf,proxy,page,PATHS,HOUR};
