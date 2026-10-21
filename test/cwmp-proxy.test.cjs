'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createProxy}=require('../deployment/acs/cwmp-proxy.cjs');
const listen=s=>new Promise(resolve=>s.listen(0,'127.0.0.1',()=>resolve(s.address().port)));
const close=s=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();});
test('CWMP proxy isolates interleaved sessions and preserves protocol data without opening another destination',async()=>{
 const sockets=new WeakMap(),upstreamPorts=[];
 const upstream=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const session=req.headers.cookie;assert.equal(req.headers.authorization,'Basic fixture-only');assert.equal(req.url,'/cwmp/');upstreamPorts.push(req.socket.remotePort);if(sockets.has(req.socket)&&sockets.get(req.socket)!==session){res.writeHead(400).end('Invalid session');return;}sockets.set(req.socket,session);res.setHeader('Set-Cookie',session+'; Path=/; HttpOnly');res.setHeader('Content-Type','text/xml');res.end(body);});
 const upstreamPort=await listen(upstream),proxy=createProxy({port:upstreamPort,maxBody:512}),proxyPort=await listen(proxy),agent=new http.Agent({keepAlive:true,maxSockets:1});
 const send=(method,cookie,body)=>new Promise((resolve,reject)=>{const request=http.request({hostname:'127.0.0.1',port:proxyPort,path:'/cwmp/',method,agent,headers:{Cookie:cookie,Authorization:'Basic fixture-only','Content-Length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text}));});request.on('error',reject);request.end(body);});
 try{
  for(const session of ['A','B','A','B']){const cookie='session='+session,xml='<Inform>'+session+'</Inform>',response=await send('POST',cookie,xml);assert.equal(response.status,200);assert.equal(response.body,xml);assert.deepEqual(response.headers['set-cookie'],[cookie+'; Path=/; HttpOnly']);assert.equal(response.headers['cache-control'],'no-store');}
  assert.equal(new Set(upstreamPorts).size,4);assert.equal((await send('GET','session=A','')).status,405);assert.equal((await send('POST','session=A','x'.repeat(513))).status,413);assert.equal(upstreamPorts.length,4);
  await close(upstream);assert.equal((await send('POST','session=A','<Inform/>')).status,502);
 }finally{agent.destroy();await close(proxy);if(upstream.listening)await close(upstream);}
});
