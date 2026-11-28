'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {Store}=require('../lib/store.cjs'),wg=require('../lib/wireguard.cjs');
const fx=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wg-')),store=new Store(dir);return {dir,store,done:()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});}};};
const pubOf=priv=>crypto.createPublicKey(crypto.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),Buffer.from(priv,'base64')]),format:'der',type:'pkcs8'})).export({format:'der',type:'spki'}).subarray(-32).toString('base64');
test('WireGuard: valid key pairs, addresses by kind, expiring staff access, host config and handshake report',()=>{
 const {dir,store,done}=fx();try{const k=wg.keypair();assert.equal(pubOf(k.privateKey),k.publicKey);assert.equal(Buffer.from(k.privateKey,'base64').length,32);
  assert.throws(()=>wg.addRouter(store,{name:'hEX'}),/server details/);assert.throws(()=>wg.setServer(store,{publicKey:'nope',endpoint:'1.2.3.4'}),/public key/);
  const srvKey=wg.keypair().publicKey;wg.setServer(store,{publicKey:srvKey,endpoint:'20.1.2.3',port:51820});
  const dev=store.put('devices',{name:'CCR Core',type:'router',driver:'none'});
  const r=wg.addRouter(store,{routerId:dev.id});assert.equal(r.peer.address,'10.99.0.2');assert.match(r.script,/private-key="[A-Za-z0-9+/]{43}="/);assert.match(r.script,new RegExp('public-key="'+srvKey.replace(/[+/]/g,'\\$&')+'"'));assert.doesNotMatch(r.script,/secret="(?!<RADIUS_SECRET>)/);
  assert.throws(()=>wg.addRouter(store,{routerId:dev.id}),/already/);assert.equal(store.get('wgPeers',r.peer.id).privateKey,undefined,'private key is not stored');
  const t0=Date.now(),st=wg.addStaff(store,{name:'Kevin laptop',hours:2},{id:'u1',email:'k@x.test'},t0);assert.equal(st.peer.address,'10.99.0.200');assert.match(st.config,/Endpoint = 20\.1\.2\.3:51820/);assert.match(st.config,/AllowedIPs = 10\.99\.0\.0\/24/);
  let h=wg.hostConfig(store,t0+1000);assert.deepEqual(h.staff,['10.99.0.200']);assert.deepEqual(h.routers,['10.99.0.2']);assert.match(h.conf,/AllowedIPs = 10\.99\.0\.200\/32/);
  h=wg.hostConfig(store,t0+3*36e5);assert.deepEqual(h.staff,[],'expired staff access is dropped');
  wg.setEnabled(store,r.peer.id,false);assert.deepEqual(wg.hostConfig(store,t0).routers,[]);wg.setEnabled(store,r.peer.id,true);
  const dump=`${r.peer.publicKey}\t(none)\t41.90.1.2:13299\t10.99.0.2/32\t${Math.floor(t0/1000)}\t1000\t2000\t25\nbadline\n${k.privateKey}\t${k.publicKey}\t51820\toff`;
  assert.deepEqual(wg.report(store,dump,t0),{peers:1},'only 8-field peer lines are read');const ov=wg.overview(store,t0);assert.equal(ov.peers.find(p=>p.kind==='router').status.endpoint,'41.90.1.2:13299');
  store.close();const out=execFileSync(process.execPath,[path.join(__dirname,'..','lib','wg-cli.cjs'),'peers'],{env:{...process.env,NETWORK_DATA_DIR:dir}}).toString();assert.deepEqual(JSON.parse(out).routers,['10.99.0.2']);
  execFileSync(process.execPath,[path.join(__dirname,'..','lib','wg-cli.cjs'),'status'],{env:{...process.env,NETWORK_DATA_DIR:dir},input:dump});
 }finally{try{done();}catch{fs.rmSync(dir,{recursive:true,force:true});}}
});
