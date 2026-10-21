'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {createApp}=require('../server.cjs');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
test('Cloudflare origin keeps local setup private and exports only authenticated mapped records',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'network-hub-deployment-'));let app=createApp({dataDir:directory,collector:false,publicOrigin:'https://network.example.test'}),origin=await listen(app.server),cookie='',csrf='';
 const owner={name:'Deployment QA',workspace:'QA',email:'deployment@example.test',password:'deployment-password-123'};
 async function api(route,method='GET',input,headers={}){return new Promise((resolve,reject)=>{const request=http.request(origin+'/api/'+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...headers}},response=>{const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{const text=Buffer.concat(chunks).toString(),resultHeaders=new Headers();for(const [key,value] of Object.entries(response.headers))if(value!==undefined)resultHeaders.set(key,Array.isArray(value)?value.join(';'):value);resolve({status:response.statusCode,headers:resultHeaders,body:resultHeaders.get('content-type')?.includes('json')?JSON.parse(text):text});});});request.on('error',reject);request.end(input===undefined?undefined:JSON.stringify(input));});}
 try{
  const remote={Host:'network.example.test',Origin:'https://network.example.test'};
  assert.equal((await api('setup','POST',owner,remote)).status,403);
  const local=await api('setup','POST',owner);assert.equal(local.status,201);assert.ok(!local.headers.get('set-cookie').includes('Secure'));cookie=local.headers.get('set-cookie').split(';')[0];csrf=local.body.csrf;
  assert.equal((await api('session','GET',undefined,{Host:'attacker.example.test'})).status,403);
  const login=await api('login','POST',owner,remote);assert.equal(login.status,200);assert.ok(login.headers.get('set-cookie').includes('Secure'));
  assert.equal((await api('workspace','PATCH',{name:'Cross-site'}, {...remote,Origin:'https://attacker.example.test'})).status,403);
  const a=app.store.put('devices',{name:'Router <&>',type:'router',latitude:-1.2,longitude:36.8,phone:'private-phone',customer:'private-customer'}),b=app.store.put('odbs',{name:'ODB',latitude:0,longitude:0});app.store.put('devices',{name:'Unmapped',type:'onu'});app.store.put('cables',{name:'Mapped cable',fromId:a.id,toId:b.id,cores:12});
  const exported=await api('map/export?format=geojson');assert.equal(exported.status,200);assert.equal(exported.body.features.length,3);assert.deepEqual(exported.body.features[0].geometry.coordinates,[36.8,-1.2]);assert.ok(!JSON.stringify(exported.body).includes('private-'));assert.ok(!JSON.stringify(exported.body).includes('Unmapped'));assert.equal(exported.body.features.find(f=>f.geometry.type==='LineString').geometry.coordinates.length,2);
  const kml=await api('map/export?format=kml');assert.equal(kml.status,200);assert.match(kml.body,/Router &lt;&amp;&gt;/);assert.match(kml.headers.get('content-disposition'),/network-map.kml/);
  const operation=app.store.put('acsTasks',{deviceId:'qa',action:'reboot',status:'Sending'});await app.close();app=createApp({dataDir:directory,collector:false});origin=await listen(app.server);assert.equal(app.store.get('acsTasks',operation.id).status,'Uncertain');
  cookie='';assert.equal((await api('map/export?format=geojson')).status,401);
 }finally{await app.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.match(path.basename(directory),/^network-hub-deployment-/);fs.rmSync(directory,{recursive:true,force:true});}
});
