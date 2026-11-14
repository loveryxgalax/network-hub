'use strict';
// Host helper, run inside the hub container by deployment/wireguard/sync-peers.sh:
//   node lib/wg-cli.cjs peers    → prints JSON {conf, staff, routers, ports} for wg0
//   node lib/wg-cli.cjs server <publicKey> <port> <endpoint>  → fills the WireGuard server details if empty
//   node lib/wg-cli.cjs status   → reads `wg show wg0 dump` on stdin and stores handshakes for the WireGuard page
const {Store}=require('./store.cjs'),wg=require('./wireguard.cjs');
const store=new Store(process.env.NETWORK_DATA_DIR||require('node:path').join(__dirname,'..','data'));
const cmd=process.argv[2];
if(cmd==='peers'){process.stdout.write(JSON.stringify(wg.hostConfig(store)));store.close();}
else if(cmd==='status'){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{input+=c;if(input.length>2e6)process.exit(1);});process.stdin.on('end',()=>{const r=wg.report(store,input);store.close();process.stdout.write(JSON.stringify(r)+'\n');});}
else if(cmd==='server'){const r=wg.autoServer(store,{publicKey:process.argv[3],port:process.argv[4],endpoint:process.argv[5]});store.close();process.stdout.write(JSON.stringify(r));}
else{console.error('usage: wg-cli.cjs peers|status|server');store.close();process.exit(2);}
