'use strict';
// Read a RouterOS export (the config backups Kade Cloud keeps) into sections of key=value items. Read only.
function parse(text){const out={};let sec='';
 const lines=String(text||'').replace(/\\\r?\n\s*/g,'').split(/\r?\n/);
 for(const raw of lines){const l=raw.trim();if(!l||l.startsWith('#'))continue;
  if(l.startsWith('/')){const m=l.match(/^(\/[a-z0-9 -]+?)(?:\s+(add|set)\b(.*))?$/);if(!m)continue;sec=m[1].trim();if(m[2])push(out,sec,m[2],m[3]);continue;}
  const m=l.match(/^(add|set)\b(.*)$/);if(m&&sec)push(out,sec,m[1],m[2]);}
 return out;}
function push(out,sec,verb,rest){const item={_verb:verb};let s=String(rest||'').replace(/\[\s*find[^\]]*\]/,m=>{const d=m.match(/default-name=([^\s\]]+)|name=([^\s\]]+)/);if(d)item._target=(d[1]||d[2]).replace(/^"|"$/g,'');if(/default=yes/.test(m))item._default=true;return '';});
 const re=/([a-z0-9-]+)=("(?:[^"\\]|\\.)*"|\S+)/g;let m;while((m=re.exec(s)))item[m[1]]=m[2].startsWith('"')?m[2].slice(1,-1).replace(/\\(.)/g,'$1'):m[2];
 (out[sec]=out[sec]||[]).push(item);}
const ip2n=a=>a.split('.').reduce((x,y)=>x*256+Number(y),0);
function inNet(addr,cidr){const [n,b]=String(cidr||'').split('/');if(!n||!addr||!/^\d+\.\d+\.\d+\.\d+$/.test(addr))return false;const bits=Number(b??32);return Math.floor(ip2n(addr)/2**(32-bits))===Math.floor(ip2n(n)/2**(32-bits));}
// Everything a hotspot server depends on, like ISPman's hotspot page.
function hotspot(text,name){const c=parse(text),L=k=>c[k]||[];
 const servers=L('/ip hotspot').filter(x=>x._verb==='add'),server=servers.find(x=>x.name===name)||(servers.length===1?servers[0]:null);if(!server)return null;
 const pname=server.profile||'default',profiles=L('/ip hotspot profile'),profile=profiles.find(x=>x.name===pname||(pname==='default'&&x._default))||{name:pname},iface=server.interface||'';
 const ip=L('/ip address').find(x=>x.interface===iface)||null,gw=ip?.address?.split('/')[0]||'';
 const ports=L('/interface bridge port').filter(x=>x.bridge===iface).map(x=>x.interface);
 const wl=[...L('/interface wireless'),...L('/interface wifi')].filter(x=>ports.includes(x.name||x._target)||ports.includes(x._target)).map(x=>({name:x.name||x._target||'',ssid:x.ssid||x['configuration.ssid']||'',mode:x.mode||x['configuration.mode']||'',country:x.country||x['configuration.country']||''}));
 const dhcp=L('/ip dhcp-server').find(x=>x.interface===iface)||null;
 return {server:{name:server.name||'',interface:iface,profile:pname,addressPool:server['address-pool']||'',idleTimeout:server['idle-timeout']||'',disabled:server.disabled==='yes'},
  profile:{name:profile.name||pname,dnsName:profile['dns-name']||'',hotspotAddress:profile['hotspot-address']||gw,loginBy:profile['login-by']||'',useRadius:profile['use-radius']==='yes',radiusAccounting:profile['radius-accounting']!=='no'&&profile['use-radius']==='yes',htmlDirectory:profile['html-directory']||''},
  bridge:L('/interface bridge').some(x=>x.name===iface)?{name:iface,ports}:null,ip,pool:L('/ip pool').find(x=>x.name===(server['address-pool']||dhcp?.['address-pool']))||null,
  dhcp:dhcp?{name:dhcp.name||'',pool:dhcp['address-pool']||'',leaseTime:dhcp['lease-time']||''}:null,dhcpNetwork:L('/ip dhcp-server network').find(x=>gw&&inNet(gw,x.address))||null,
  nat:L('/ip firewall nat').filter(x=>x.action==='masquerade').map(x=>({outInterface:x['out-interface']||x['out-interface-list']||'',srcAddress:x['src-address']||'',disabled:x.disabled==='yes'})),wifi:wl};}
module.exports={parse,hotspot,inNet};
