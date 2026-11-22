'use strict';
// Remote Access link (like ISPman's): a one-hour link that opens the router's own web page (WebFig) through the netops
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
function proxy(link,req,res,url){
 for(const h of ['Content-Security-Policy','X-Content-Type-Options','Referrer-Policy','Cache-Control','Strict-Transport-Security'])res.removeHeader(h);
 const headers={...req.headers};delete headers.cookie;delete headers.authorization;headers.host=link.address;
 for(const h of Object.keys(headers))if(/^(cf-|x-forwarded|x-real-ip|cdn-loop)/i.test(h))delete headers[h];
 const up=http.request({host:link.address,port:link.port||80,method:req.method,path:url.pathname+url.search,headers,timeout:20000},r=>{
  const out={...r.headers};delete out['set-cookie'];if(out.location&&/^https?:\/\//i.test(out.location)){try{const u=new URL(out.location);out.location=u.pathname+u.search;}catch{}}
  res.writeHead(r.statusCode||502,out);r.pipe(res);});
 up.on('timeout',()=>up.destroy(new Error('timeout')));
 up.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'text/html; charset=utf-8'});res.end(page('The router did not answer','Kade Cloud could not reach '+esc(link.routerName)+' over WireGuard. Check that the router is online, its WireGuard tunnel is up and its www service (port 80) is on.'));}else res.destroy();});
 req.pipe(up);}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=(t,b)=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><style>@font-face{font-family:"Maven Pro";font-weight:400 900;src:url("/fonts/maven-pro-var.woff2?v=2") format("woff2")}</style><body style="font:16px 'Maven Pro';background:#f1f5f9;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><div style="background:#fff;border-radius:14px;padding:22px;max-width:420px"><h1 style="font-size:19px;margin:0 0 8px;color:#0032fd">${esc(t)}</h1><p style="margin:0;color:#334155">${b}</p></div>`;
module.exports={create,check,cookieOf,proxy,page,PATHS,HOUR};
