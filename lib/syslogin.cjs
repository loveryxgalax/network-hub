'use strict';
// Remote logging: routers that have "Remote Logging" turned on send every log line (syslog over UDP) to netops on the
// private WireGuard address (relayed to the hub). Lines are matched to a router by the identity in each line, else the sender's address, kept per
// router (newest 3000, 14 days) and shown on that router's Logs page. Nothing listens on a public address.
const dgram=require('node:dgram');
const KEEP=3000,AGE=14*864e5,SEV=['critical','critical','critical','error','warning','notice','info','debug'];
function parse(buf){const s=buf.toString('utf8').slice(0,1500);const m=s.match(/^<(\d{1,3})>(.*)$/s);const pri=m?Number(m[1]):14,rest=(m?m[2]:s).trim();
 // RouterOS sends "<pri>Mmm dd hh:mm:ss host topics message" or "<pri>topics message".
 // BSD syslog header: "Mmm dd hh:mm:ss <router identity> ..."; RFC 5424: "1 2026-11-18T10:00:00Z <identity> ...".
 let host='';let t=rest.replace(/^[A-Z][a-z]{2}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+(\S+)\s+/,(_,h)=>{host=h;return '';});
 t=t.replace(/^1\s+\S+\s+(\S+)\s+\S+\s+\S+\s+\S+\s+(?:-|\[[^\]]*\])\s*/,(_,h)=>{host=h;return '';});const tm=t.match(/^([a-z,]+(?:,[a-z]+)*)\s+(.*)$/s);
 return {host,level:SEV[pri%8]||'info',topics:tm&&/^[a-z,]+$/.test(tm[1])&&tm[1].length<60?tm[1]:'',message:(tm&&/^[a-z,]+$/.test(tm[1])?tm[2]:t).slice(0,600)};}
function start(store,{port=5514,host='0.0.0.0'}={}){
 const sock=dgram.createSocket('udp4'),buf=new Map();let timer=null;
 // Which router: its identity in the syslog header (as the portal knows it), else its WireGuard or management address.
 const routerOf=(ip,host)=>{if(host){try{const r=require('./portal.cjs').routerByIdentity(store,host);if(r)return r.id;}catch{}const d=store.list('devices').find(x=>x.type==='router'&&String(x.name).toLowerCase()===String(host).toLowerCase());if(d)return d.id;}const a=String(ip||'').replace(/^::ffff:/,'');const peer=store.list('wgPeers').find(p=>p.kind==='router'&&String(p.address||'').split('/')[0]===a);if(peer?.routerId)return peer.routerId;return store.list('devices').find(d=>d.type==='router'&&d.ip===a)?.id||null;};
 const flush=()=>{timer=null;const now=Date.now();for(const [id,lines] of buf){const key='routerSyslog:'+id,prev=store.setting(key)?.items||[];store.setting(key,{items:[...lines.reverse(),...prev].filter(x=>now-x.time<AGE).slice(0,KEEP)});}buf.clear();};
 sock.on('message',(msg,rinfo)=>{try{const p=parse(msg),id=routerOf(rinfo.address,p.host);if(!id)return;const {host,...rest}=p,l={time:Date.now(),...rest};const a=buf.get(id)||[];if(a.length<2000)a.push(l);buf.set(id,a);if(!timer){timer=setTimeout(flush,5000);timer.unref?.();}}catch{}});
 sock.on('error',e=>console.warn('Remote logging listener: '+e.message));
 sock.bind(port,host,()=>console.log('Remote logging listening on udp '+port));
 return {close:()=>{try{flush();sock.close();}catch{}}};}
module.exports={start,parse};
