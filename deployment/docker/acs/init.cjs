'use strict';
// Idempotent: creates the GenieACS database user and the serial-scoped CWMP authentication expression.
const fs=require('node:fs'),{MongoClient}=require('node:module').createRequire('/opt/acs/node_modules/genieacs/package.json')('mongodb');
const need=n=>{const v=process.env[n];if(!v)throw new Error(n+' is required');return v;};
const admin=encodeURIComponent(need('MONGO_ROOT_USER'))+':'+encodeURIComponent(need('MONGO_ROOT_PASSWORD'));
const appUser=need('MONGO_APP_USER'),appPass=need('MONGO_APP_PASSWORD');
if(!fs.existsSync('/private/cpes.json'))fs.writeFileSync('/private/cpes.json',JSON.stringify({devices:{}},null,2),{mode:0o600,flag:'wx'});
(async()=>{
 let client;
 for(let i=0;i<60;i++){try{client=new MongoClient('mongodb://'+admin+'@mongo:27017/admin?authSource=admin',{serverSelectionTimeoutMS:3000});await client.connect();break}catch(e){await client?.close().catch(()=>{});client=null;await new Promise(r=>setTimeout(r,2000))}}
 if(!client)throw new Error('MongoDB did not become ready');
 try{
  const db=client.db('genieacs'),info=await db.command({usersInfo:appUser});
  if(!info.users.length)await db.command({createUser:appUser,pwd:appPass,roles:[{role:'readWrite',db:'genieacs'}]});
  await db.collection('config').updateOne({_id:'cwmp.auth'},{$set:{value:'EXT("network-hub-auth", "enrolled", DeviceID.SerialNumber) = true AND AUTH(DeviceID.SerialNumber, EXT("network-hub-auth", "password", DeviceID.SerialNumber))'}},{upsert:true});
 }finally{await client.close()}
})().catch(e=>{console.error(e.name+': '+e.message);process.exit(1)});
