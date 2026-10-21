'use strict';
// Cloudflare may reuse an origin socket for unrelated CPEs. GenieACS keeps
// CWMP session state on sockets, so give every upstream request a fresh one.
const http=require('node:http');
const hopHeaders=['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'];
function cleanHeaders(input){const headers={...input};for(const name of [...hopHeaders,...String(input.connection||'').toLowerCase().split(',').map(s=>s.trim())])delete headers[name];return headers;}
function createProxy({port=7547,maxBody=8*1024*1024,timeout=90000}={}){
 const server=http.createServer((req,res)=>{
  const fail=(status,message)=>{if(!res.headersSent){res.writeHead(status,{'Content-Type':'text/plain','Cache-Control':'no-store',Connection:'close'});res.end(message);}else res.destroy();};
  if(req.method!=='POST'){res.setHeader('Allow','POST');fail(405,'CWMP requires POST');req.resume();return;}
  if(Number(req.headers['content-length'])>maxBody){fail(413,'CWMP request exceeds limit');req.resume();return;}
  const upstream=http.request({hostname:'127.0.0.1',port,path:req.url,method:'POST',headers:{...cleanHeaders(req.headers),connection:'close'},agent:false,timeout},reply=>{
   res.writeHead(reply.statusCode,{...cleanHeaders(reply.headers),'cache-control':'no-store'});reply.on('error',()=>res.destroy());reply.pipe(res);
  });
  let bytes=0;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBody){fail(413,'CWMP request exceeds limit');upstream.destroy();req.unpipe(upstream);req.resume();}});
  req.on('aborted',()=>upstream.destroy());req.on('error',()=>upstream.destroy());
  res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
  upstream.on('timeout',()=>upstream.destroy(new Error('timeout')));
  upstream.on('error',()=>{if(!res.writableEnded)fail(502,'CWMP service unavailable');});
  req.pipe(upstream);
 });
 server.requestTimeout=timeout;server.headersTimeout=Math.min(timeout,30000);server.keepAliveTimeout=5000;
 return server;
}
if(require.main===module){const server=createProxy();server.listen(7548,'127.0.0.1',()=>console.log('CWMP connection isolation listening on 127.0.0.1:7548'));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),10000).unref();});}
module.exports={createProxy};
