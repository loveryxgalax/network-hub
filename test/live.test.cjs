'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const {createApp}=require('../server.cjs');
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
test('live view: feed needs the token; /live needs sign-in and reaches Phoenix with the user; websocket passes through',async()=>{
 // Stand-in for the Phoenix service: echoes what netops forwards, and accepts a websocket upgrade.
 let seen=null;const upstream=http.createServer((req,res)=>{seen=req.headers;res.writeHead(200,{'Content-Type':'text/plain'});res.end('phoenix '+req.url);});
 const upSockets=new Set();upstream.on('upgrade',(req,socket)=>{seen=req.headers;upSockets.add(socket);socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');socket.on('data',d=>socket.write(d));});
 const upPort=await listen(upstream),dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-'));
 const app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',liveToken:'live-token-for-tests-0123456789',liveUrl:'http://127.0.0.1:'+upPort});
 const port=await listen(app.server),feedPort=await listen(app.liveFeed),origin='http://127.0.0.1:'+port;
 try{
  const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'live@example.test',password:'fixture-owner-password-123'})});const cookie=owner.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch('http://127.0.0.1:'+feedPort+'/internal/live')).status,401,'feed needs the token');
  const feed=await fetch('http://127.0.0.1:'+feedPort+'/internal/live',{headers:{Authorization:'Bearer live-token-for-tests-0123456789'}});assert.equal(feed.status,200);const snap=await feed.json();assert.deepEqual(Object.keys(snap).sort(),['alerts','at','online','payments','portal','routers']);
  const anon=await fetch(origin+'/live',{redirect:'manual'});assert.equal(anon.status,302,'not signed in: back to netops');assert.equal(seen,null,'nothing reached Phoenix');
  const page=await fetch(origin+'/live/noc?x=1',{headers:{Cookie:cookie,'X-Netops-User':'forged'}});assert.equal(page.status,200);assert.equal(await page.text(),'phoenix /live/noc?x=1');
  assert.equal(seen['x-netops-proxy'],'live-token-for-tests-0123456789');const u=JSON.parse(Buffer.from(seen['x-netops-user'],'base64url').toString());assert.equal(u.email,'live@example.test');assert.equal(u.role,'admin');
  // Websocket: signed in passes through and echoes; without the cookie it is refused.
  const ws=(withCookie)=>new Promise(resolve=>{const sock=net.connect(port,'127.0.0.1',()=>sock.write(`GET /live/live/websocket HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${withCookie?'Cookie: '+cookie+'\r\n':''}\r\n`));let buf='';sock.on('data',d=>{buf+=d;if(buf.includes('\r\n\r\n')&&buf.startsWith('HTTP/1.1 101')&&!buf.includes('ping')){sock.write('ping');}if(buf.includes('ping')||buf.startsWith('HTTP/1.1 403')){sock.destroy();resolve(buf);}});sock.on('close',()=>resolve(buf));});
  assert.match(await ws(false),/^HTTP\/1.1 403/);const ok=await ws(true);assert.match(ok,/^HTTP\/1.1 101/);assert.match(ok,/ping/);
 }finally{await app.close();for(const x of upSockets)x.destroy();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('live view without Phoenix configured says so instead of failing',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live2-')),app=createApp({dataDir:dir,collector:false,publicOrigin:'https://network.example.test',liveToken:'',liveUrl:''});const port=await listen(app.server),origin='http://127.0.0.1:'+port;
 try{const owner=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'l2@example.test',password:'fixture-owner-password-123'})});const cookie=owner.headers.get('set-cookie').split(';')[0];
  const r=await fetch(origin+'/live',{headers:{Cookie:cookie}});assert.equal(r.status,503);assert.match(await r.text(),/not running/);assert.equal(app.liveFeed,null);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('live snapshot counts what routers report, plus netops RADIUS sessions only for routers that do not report',()=>{
 const now=Date.now(),{snapshot}=require('../lib/live.cjs');
 const rows={devices:[{id:'r1',name:'CCR',type:'router',ip:'10.0.0.1',lastSeen:now},{id:'r2',name:'HEX',type:'router',lastSeen:now},{id:'r3',name:'RBX',type:'router'}],subscribers:[],alerts:[],subscriberPayments:[]};
 const settings={'onlineSeries:r1':{points:[[now-60000,5,40]]},'onlineSeries:r3':{points:[[now-3*36e5,9,9]]}};
 const sessions=[{username:'a',service:'pppoe',nasName:'10.0.0.1',updatedAt:now,startedAt:now},{username:'b',service:'hotspot',nasName:'HEX',updatedAt:now,startedAt:now}];
 const store={list:k=>rows[k]||[],setting:k=>settings[k],sessionsSince:()=>sessions};
 const s=snapshot(store,now);
 // CCR: 5 PPPoE + 40 hotspot reported (its RADIUS session is not counted twice); HEX: 1 RADIUS session; RBX: report too old.
 assert.deepEqual({total:s.online.total,hotspot:s.online.hotspot,pppoe:s.online.pppoe},{total:46,hotspot:41,pppoe:5});
 assert.deepEqual(s.online.byRouter.map(r=>r.name),['CCR','HEX']);
 assert.equal(s.online.top.length,2);
});
