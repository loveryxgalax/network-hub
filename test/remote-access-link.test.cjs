'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
test('Remote Access link: admin makes a 1-hour link, it opens the router web page over the tunnel, then expires',async()=>{
 const router=http.createServer((req,res)=>{if(req.url.startsWith('/webfig/')){res.writeHead(200,{'Content-Type':'text/html','Set-Cookie':'x=1'});res.end('WEBFIG '+req.headers.host+' cookie='+(req.headers.cookie||''));}else{res.writeHead(404);res.end();}});
 await new Promise(r=>router.listen(0,'127.0.0.1',r));
 const {createApp}=require('../server.cjs'),app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'ral-')),collector:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'ral@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],csrf=(await owner.json()).csrf,st=app.store,h={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf};
  const r=st.put('devices',{name:'LAB-HEX',type:'router'});
  let res=await fetch(o+'/api/routers/'+r.id+'/remote-link',{method:'POST',headers:h,body:'{}'});assert.equal(res.status,409,'needs WireGuard first');
  st.put('wgPeers',{kind:'router',routerId:r.id,name:'LAB-HEX',address:'127.0.0.1',publicKey:'k',enabled:true});
  res=await fetch(o+'/api/routers/'+r.id+'/remote-link',{method:'POST',headers:h,body:'{}'});assert.equal(res.status,201);const link=await res.json();
  assert.match(link.url,/\/tunnel\/[A-Za-z0-9_-]{32}$/);assert.ok(link.expiresAt-Date.now()>59*60000&&link.expiresAt-Date.now()<=3600000);
  const rec=st.list('tunnelLinks')[0];assert.ok(rec.hash&&!JSON.stringify(rec).includes(link.url.split('/').pop()),'only a hash is stored');
  st.put('tunnelLinks',{...rec,port:router.address().port},rec);
  assert.equal((await fetch(o+'/webfig/')).status,410,'no cookie, no router');
  res=await fetch(link.url.replace(/^https?:\/\/[^/]+/,o),{redirect:'manual'});assert.equal(res.status,302);assert.equal(res.headers.get('location'),'/webfig/');
  const tc=res.headers.get('set-cookie');assert.match(tc,/nt_tunnel=.*HttpOnly.*SameSite=Lax.*Max-Age=\d+/);
  res=await fetch(o+'/webfig/',{headers:{Cookie:tc.split(';')[0]+'; '+cookie}});const text=await res.text();
  assert.equal(res.status,200);assert.match(text,/^WEBFIG 127\.0\.0\.1 cookie=$/,'router gets no Kade Cloud cookies');assert.equal(res.headers.get('set-cookie'),null);assert.equal(res.headers.get('content-security-policy'),null);
  const cur=st.list('tunnelLinks')[0];st.put('tunnelLinks',{...cur,expiresAt:Date.now()-1},cur);
  assert.equal((await fetch(o+'/webfig/',{headers:{Cookie:tc.split(';')[0]}})).status,410,'expired');
  assert.equal((await fetch(link.url.replace(/^https?:\/\/[^/]+/,o),{redirect:'manual'})).status,410);
 }finally{app.server.close();router.close();}
});

test('remote access job: only the server address, only the www port, no duplicate rule, and a way back',()=>{
 const jobs=require('../lib/jobs.cjs'),on=jobs.TYPES['remote-access-on'],off=jobs.TYPES['remote-access-off'];
 assert.equal(on.risky,false);const s=on.script({});
 assert.match(s,/src-address=10\.99\.0\.1 protocol=tcp dst-port=\$port action=accept comment="kade: remote access"/);
 assert.match(s,/:if \(\[:len \[\/ip firewall filter find where comment="kade: remote access"\]\]=0\)/);
 assert.doesNotMatch(s,/0\.0\.0\.0|address=""/);
 assert.match(off.script({}),/remove \[find where comment="kade: remote access"\]/);
});

test('remote access: a router that sends /webfig/ to its root page stays inside the tunnel (no jump to the dashboard)',async()=>{
 const TN=require('../lib/tunnel.cjs');
 const router=http.createServer((req,res)=>{if(req.url==='/webfig/'){res.writeHead(302,{Location:'http://10.99.0.2/'});return res.end();}if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<title>RouterOS</title><script src="/webfig/x.js"></script>');}res.writeHead(404);res.end();});
 await new Promise(r=>router.listen(0,'127.0.0.1',r));
 const front=http.createServer((req,res)=>TN.proxy({address:'127.0.0.1',port:router.address().port,routerName:'R'},req,res,new URL(req.url,'http://x')));
 await new Promise(r=>front.listen(0,'127.0.0.1',r));
 try{const r=await fetch(`http://127.0.0.1:${front.address().port}/webfig/`,{redirect:'manual'});assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.match(await r.text(),/RouterOS/);}
 finally{router.close();front.close();}
});
