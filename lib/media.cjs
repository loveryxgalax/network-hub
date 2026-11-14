'use strict';
// Media library: images uploaded by staff for adverts and the portal, stored on this server (no outside image host).
// Only real PNG, JPEG, GIF and WebP files are accepted (checked by their first bytes, not the name), up to 3 MB each.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s});};
const MAX=3*1024*1024,TYPES={png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp'};
function kind(b){if(b.length>8&&b[0]===0x89&&b.slice(1,4).toString()==='PNG')return 'png';if(b.length>3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'jpg';
 if(b.length>6&&/^GIF8[79]a$/.test(b.slice(0,6).toString()))return 'gif';if(b.length>12&&b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP')return 'webp';return null;}
const dir=store=>{const d=path.join(store.dir,'media');fs.mkdirSync(d,{recursive:true,mode:0o700});return d;};
const lib=store=>store.setting('mediaLibrary')?.items||[];
function save(store,{name,data},user,now=Date.now()){
 const m=/^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(data||''));if(!m)fail('Choose an image file');
 const buf=Buffer.from(m[2],'base64');if(!buf.length)fail('The file is empty');if(buf.length>MAX)fail('Images must be 3 MB or smaller');
 const k=kind(buf);if(!k)fail('Only PNG, JPEG, GIF or WebP images are accepted');
 const file=crypto.createHash('sha256').update(buf).digest('hex').slice(0,24)+'.'+k,full=path.join(dir(store),file);
 if(!fs.existsSync(full))fs.writeFileSync(full,buf,{mode:0o600});
 const items=lib(store).filter(x=>x.file!==file),item={file,name:String(name||file).replace(/[^\w .()-]/g,'').slice(0,80)||file,bytes:buf.length,type:TYPES[k],created:now,by:user?.name||''};
 store.setting('mediaLibrary',{items:[item,...items].slice(0,500)});return {...item,url:'/portal/media/'+file};}
function list(store){return lib(store).map(x=>({...x,url:'/portal/media/'+x.file}));}
function remove(store,file){const items=lib(store);if(!items.some(x=>x.file===file))fail('Not found',404);
 if(store.list('ads').some(a=>String(a.imageUrl||'').endsWith('/media/'+file)))fail('An advert still uses this image. Change the advert first.',409);
 store.setting('mediaLibrary',{items:items.filter(x=>x.file!==file)});try{fs.unlinkSync(path.join(dir(store),file));}catch{}return {ok:true};}
// For the public route: the file path and type, or null.
function file(store,name){if(!/^[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(name))return null;const full=path.join(dir(store),name);if(!fs.existsSync(full))return null;return {full,type:TYPES[name.split('.').pop()]};}
module.exports={save,list,remove,file,kind};
