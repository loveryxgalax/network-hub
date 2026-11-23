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
// The router's own root ("/": RouterOS 7 sign-in page, /assets/, /logo.png …) is served under ROOT, because "/" on
// this address is the Kade Cloud dashboard. Router pages are rewritten so their links to "/…" stay under ROOT.
const ROOT='/webfig/_root';
const toRouter=p=>p===ROOT||p.startsWith(ROOT+'/')?(p.slice(ROOT.length)||'/'):p;
const toBrowser=p=>PATHS.test(p)?p:ROOT+(p.startsWith('/')?p:'/'+p);
function rewrite(text,type){
 if(/html/.test(type))text=text.replace(/\b(src|href|action)=(["'])\/(?!\/|webfig\/|jsproxy|graphics\/)/gi,(m,a,q)=>`${a}=${q}${ROOT}/`);
 if(/html|css/.test(type))text=text.replace(/url\((["']?)\/(?!\/|webfig\/|jsproxy|graphics\/)/gi,(m,q)=>`url(${q}${ROOT}/`);
 if(/html|javascript/.test(type))text=text.replace(/location\.(replace|assign)\(`\/\$\{/g,(m,f)=>`location.${f}(\`${ROOT}/\${`).replace(/location\.(href|pathname)\s*=\s*(["'])\/(?=["'#?])/g,(m,a,q)=>`location.${a}=${q}${ROOT}/`).replace(/location\.(replace|assign)\((["'])\/(?=["'#?])/g,(m,f,q)=>`location.${f}(${q}${ROOT}/`);
 return text;}
// Forward one request to the router's web server over the tunnel and send the answer back.
function proxy(link,req,res,url){
 for(const h of ['Content-Security-Policy','X-Content-Type-Options','Referrer-Policy','Cache-Control','Strict-Transport-Security'])res.removeHeader(h);
 const headers={...req.headers};delete headers.cookie;delete headers.authorization;headers.host=link.address;headers['accept-encoding']='identity';
 for(const h of Object.keys(headers))if(/^(cf-|x-forwarded|x-real-ip|cdn-loop)/i.test(h))delete headers[h];
 if(headers.referer){try{const u=new URL(headers.referer);headers.referer='http://'+link.address+toRouter(u.pathname)+u.search;}catch{delete headers.referer;}}
 const up=http.request({host:link.address,port:link.port||80,method:req.method,path:toRouter(url.pathname)+url.search,headers,timeout:20000},r=>{
  const out={...r.headers};delete out['set-cookie'];
  if(out.location){try{const u=new URL(out.location,'http://'+link.address+toRouter(url.pathname));if(/^https?:$/.test(u.protocol))out.location=toBrowser(u.pathname)+u.search+u.hash;}catch{}}
  const type=String(out['content-type']||'');
  if(req.method!=='HEAD'&&/html|javascript|css/.test(type)){const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>{const body=Buffer.from(rewrite(Buffer.concat(chunks).toString('utf8'),type),'utf8');delete out['content-length'];delete out['transfer-encoding'];out['content-length']=body.length;res.writeHead(r.statusCode||503,out);res.end(body);});r.on('error',()=>res.destroy());return;}
  res.writeHead(r.statusCode||503,out);r.pipe(res);});
 up.on('timeout',()=>up.destroy(new Error('timeout')));
 up.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'text/html; charset=utf-8'});res.end(page('The router did not answer','Kade Cloud could not reach '+esc(link.routerName)+' over WireGuard. Check that the router is online, its WireGuard tunnel is up and its www service (port 80) is on.'));}else res.destroy();});
 if(req.method==='GET'||req.method==='HEAD'||req.readableEnded)up.end();else req.pipe(up);}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=(t,b)=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><style>@font-face{font-family:"Google Sans";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/extra/GoogleSans-400.woff2") format("woff2")}@font-face{font-family:"Google Sans";font-style:normal;font-weight:500;font-display:swap;src:url("/fonts/extra/GoogleSans-500.woff2") format("woff2")}@font-face{font-family:"Google Sans";font-style:normal;font-weight:600;font-display:swap;src:url("/fonts/extra/GoogleSans-600.woff2") format("woff2")}@font-face{font-family:"Google Sans";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/extra/GoogleSans-700.woff2") format("woff2")}</style><body style="font:16px 'Google Sans';background:#f1f5f9;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px"><div style="background:#fff;border-radius:14px;padding:22px;max-width:420px"><h1 style="font-size:19px;margin:0 0 8px;color:#0032fd">${esc(t)}</h1><p style="margin:0;color:#334155">${b}</p></div>`;
module.exports={create,check,cookieOf,proxy,page,PATHS,HOUR,ROOT,rewrite};
