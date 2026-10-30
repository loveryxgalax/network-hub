'use strict';
// WireGuard network (10.99.0.0/24, server 10.99.0.1). Routers get 10.99.0.2–199; staff laptops get 10.99.0.200–254
// with an expiry, and may only reach routers' management ports (the Winbox "jump box"). netops keeps the peer list;
// deployment/wireguard/sync-peers.sh on the host applies it to wg0, keeps the forwarding rules, and reports
// handshakes back. Private keys are generated here, shown once, and never stored.
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const NET='10.99.0.',ROUTERS=[2,199],STAFF=[200,254],PORTS=[8291,22,80,443,8728,8729];
function keypair(){const {privateKey,publicKey}=crypto.generateKeyPairSync('x25519');
 return {privateKey:privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64'),publicKey:publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')};}
const KEY=/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
function server(store){return store.setting('wgServer')||{};}
function setServer(store,input){const publicKey=String(input.publicKey||'').trim(),endpoint=String(input.endpoint||'').trim(),port=Math.round(Number(input.port||51820));
 if(!KEY.test(publicKey))fail('Paste the server public key (sudo wg show wg0 public-key)');if(!/^[A-Za-z0-9.-]{3,253}$/.test(endpoint))fail('Enter the server public IP or host name');if(!(port>0&&port<65536))fail('Invalid port');
 return store.setting('wgServer',{publicKey,endpoint,port});}
function free(store,[lo,hi]){const used=new Set(store.list('wgPeers').map(p=>p.address));for(let n=lo;n<=hi;n++)if(!used.has(NET+n))return NET+n;fail('No free addresses left',409);}
function routerScript(srv,peer,priv){return [`/interface wireguard add name=wg-netops listen-port=13299 private-key="${priv}" comment="netops"`,
 `/interface wireguard peers add interface=wg-netops public-key="${srv.publicKey}" endpoint-address=${srv.endpoint} endpoint-port=${srv.port} allowed-address=10.99.0.0/24 persistent-keepalive=25s comment="netops server"`,
 `/ip address add address=${peer.address}/24 interface=wg-netops comment="netops"`,
 `# For netops RADIUS also run (RADIUS_SECRET is in the server's .env):  /radius add address=10.99.0.1 secret="<RADIUS_SECRET>" service=ppp,hotspot src-address=${peer.address} timeout=3s comment="netops RADIUS"`,
 `/ip firewall filter add chain=input in-interface=wg-netops src-address=10.99.0.0/24 protocol=tcp dst-port=${PORTS.join(',')} action=accept comment="netops: management over WireGuard (move above any drop rule)"`,
 ':delay 5s; /ping 10.99.0.1 count=3'].join('\n');}
function staffConfig(srv,peer,priv){return `[Interface]\n# netops staff access for ${peer.name} — expires ${new Date(peer.expiresAt).toISOString()}\nPrivateKey = ${priv}\nAddress = ${peer.address}/32\n\n[Peer]\nPublicKey = ${srv.publicKey}\nEndpoint = ${srv.endpoint}:${srv.port}\nAllowedIPs = 10.99.0.0/24\nPersistentKeepalive = 25\n`;}
function addRouter(store,{routerId,name}){const srv=server(store);if(!srv.publicKey)fail('Enter the server details first');const r=routerId?store.get('devices',routerId):null;if(routerId&&r?.type!=='router')fail('Router not found');
 if(routerId&&store.list('wgPeers').some(p=>p.routerId===routerId&&p.kind==='router'))fail('This router already has a WireGuard address',409);
 const nm=String(name||r?.name||'').trim().slice(0,40);if(!/^[A-Za-z0-9 ._-]{1,40}$/.test(nm))fail('Name: letters, numbers, spaces, dot, dash');const k=keypair();
 const peer=store.put('wgPeers',{kind:'router',name:nm,routerId:routerId||'',address:free(store,ROUTERS),publicKey:k.publicKey,enabled:true});return {peer,script:routerScript(srv,peer,k.privateKey)};}
function addStaff(store,{name,hours},user,now=Date.now()){const srv=server(store);if(!srv.publicKey)fail('Enter the server details first');const h=Math.round(Number(hours||8));if(!(h>=1&&h<=168))fail('Access lasts 1–168 hours');
 const nm=String(name||user?.name||'').trim().slice(0,40);if(!nm)fail('Name the person or laptop');const k=keypair();
 const peer=store.put('wgPeers',{kind:'staff',name:nm,userId:user?.id||'',address:free(store,STAFF),publicKey:k.publicKey,enabled:true,expiresAt:now+h*36e5,createdBy:user?.email||null});return {peer,config:staffConfig(srv,peer,k.privateKey)};}
function setEnabled(store,id,enabled){const p=store.get('wgPeers',id);if(!p)fail('Peer not found',404);return store.put('wgPeers',{...p,enabled:!!enabled},p);}
function remove(store,id){const p=store.get('wgPeers',id);if(!p)fail('Peer not found',404);store.remove('wgPeers',id);return p;}
const live=(p,now)=>p.enabled&&(!p.expiresAt||p.expiresAt>now);
// What the host applies: [Peer] sections and the allowed staff → router management flows.
function hostConfig(store,now=Date.now()){const peers=store.list('wgPeers').filter(p=>live(p,now)).sort((a,b)=>a.address.localeCompare(b.address,undefined,{numeric:true}));
 const conf=peers.map(p=>`[Peer]\n# ${p.kind}: ${p.name.replace(/[^\w .-]/g,'')}\nPublicKey = ${p.publicKey}\nAllowedIPs = ${p.address}/32\n`).join('\n');
 return {conf,staff:peers.filter(p=>p.kind==='staff').map(p=>p.address),routers:peers.filter(p=>p.kind==='router').map(p=>p.address),ports:PORTS};}
// Peer lines of `wg show wg0 dump` (the host drops the interface line): public-key, preshared, endpoint, allowed-ips, latest-handshake, rx, tx, keepalive.
function report(store,dump,now=Date.now()){const by={};for(const line of String(dump||'').split('\n')){const f=line.split('\t');if(f.length<8||!KEY.test(f[0]))continue;by[f[0]]={endpoint:f[2]==='(none)'?'':f[2],handshake:Number(f[4])?Number(f[4])*1000:null,rx:Number(f[5])||0,tx:Number(f[6])||0};}
 store.setting('wgStatus',{at:now,peers:by});return {peers:Object.keys(by).length};}
function overview(store,now=Date.now()){const st=store.setting('wgStatus')||{peers:{}};return {server:server(store),syncedAt:st.at||null,
 peers:store.list('wgPeers').sort((a,b)=>a.address.localeCompare(b.address,undefined,{numeric:true})).map(p=>({...p,live:live(p,now),status:st.peers?.[p.publicKey]||null}))};}
module.exports={keypair,server,setServer,addRouter,addStaff,setEnabled,remove,hostConfig,report,overview,PORTS};
