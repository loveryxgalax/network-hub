'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const EXPORT=`# 2026-11-18 by RouterOS 7.16
/interface bridge
add name=br-ispman
/interface wireless
set [ find default-name=wlan1 ] country=kenya mode=ap-bridge ssid="Kade WiFi" \\
    disabled=no
/ip hotspot profile
set [ find default=yes ] html-directory=hotspot
add dns-name=kne.wifi hotspot-address=10.111.0.1 login-by=mac,http-chap,http-pap,mac-cookie name=kade-profile use-radius=yes
/ip pool
add name=hs-pool ranges=10.111.0.2-10.111.255.254
/ip dhcp-server
add address-pool=hs-pool interface=br-ispman lease-time=1h name=kade
/interface bridge port
add bridge=br-ispman interface=wlan1
/ip hotspot
add address-pool=hs-pool idle-timeout=5m interface=br-ispman name="kade networks" profile=kade-profile
/ip address
add address=10.111.0.1/16 interface=br-ispman network=10.111.0.0
/ip dhcp-server network
add address=10.111.0.0/16 dns-server=10.111.0.1 gateway=10.111.0.1
/ip firewall nat
add action=masquerade chain=srcnat out-interface=ether1
`;
test('hotspot server details are read from the config backup',()=>{const R=require('../lib/rosexport.cjs'),d=R.hotspot(EXPORT,'kade networks');
 assert.equal(d.server.interface,'br-ispman');assert.equal(d.server.idleTimeout,'5m');assert.equal(d.profile.dnsName,'kne.wifi');assert.equal(d.profile.useRadius,true);
 assert.deepEqual(d.bridge.ports,['wlan1']);assert.equal(d.wifi[0].ssid,'Kade WiFi');assert.equal(d.wifi[0].country,'kenya');assert.equal(d.pool.ranges,'10.111.0.2-10.111.255.254');
 assert.equal(d.dhcp.leaseTime,'1h');assert.equal(d.dhcpNetwork['dns-server'],'10.111.0.1');assert.equal(d.nat[0].outInterface,'ether1');
 assert.equal(R.hotspot(EXPORT,'other').server.name,'kade networks','one server: shown even if the name differs');assert.equal(R.hotspot('/ip address\nadd address=1.1.1.1/24 interface=x\n','a'),null);
 assert.equal(R.inNet('10.111.4.5','10.111.0.0/16'),true);assert.equal(R.inNet('10.112.0.1','10.111.0.0/16'),false);});
test('free mode themes: saved, checked and sent to the WiFi page',()=>{const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),portal=require('../lib/portal.cjs');
 const st=new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'fm-')),'db.sqlite')),plan=st.put('plans',radius.plan({name:'Free hour',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'hours'}));
 const until=Date.now()+3600e3;
 assert.throws(()=>radius.updateSettings(st,{freeMode:{enabled:true,until,planId:plan.id,theme:'image'}}),/image/);
 assert.throws(()=>radius.updateSettings(st,{freeMode:{enabled:true,until,planId:plan.id,theme:'image',imageUrl:'http://x.example/a.png'}}),/https/);
 radius.updateSettings(st,{freeMode:{enabled:true,until,planId:plan.id,theme:'matchday',reason:'Finals tonight'}});
 let f=portal.info(st).freeMode;assert.equal(f.theme,'matchday');assert.equal(f.down,5);assert.equal(f.reason,'Finals tonight');
 radius.updateSettings(st,{freeMode:{enabled:true,until,planId:plan.id,theme:'nonsense'}});assert.equal(portal.info(st).freeMode.theme,'gift');
 radius.updateSettings(st,{freeMode:{enabled:true,until,planId:plan.id,theme:'image',imageUrl:'/portal/media/0123456789abcdef01234567.png'}});f=portal.info(st).freeMode;assert.equal(f.imageUrl,'/portal/media/0123456789abcdef01234567.png');});
test('VPN block job: risky, keeps private networks, can be undone',()=>{const j=require('../lib/jobs.cjs').TYPES;
 assert.ok(j['vpn-block'].risky&&j['vpn-unblock'].risky);const s=j['vpn-block'].script({});
 for(const x of ['1723','1701','gre','sstp-server','src-address-list=!netops-private','192.168.0.0/16','100.64.0.0/10'])assert.ok(s.includes(x),x);
 assert.match(j['vpn-unblock'].script({}),/remove \[find where comment~"netops: block VPN"\]/);});
