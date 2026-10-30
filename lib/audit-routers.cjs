'use strict';
// Router config audit (ISPman's "Audit" column): what netops can confirm about each MikroTik from what it already
// receives. It never logs in to the router; each check says where to fix it.
const MIN=60000;
function audit(store,now=Date.now()){
 const sessions=store.sessionFieldsSince(now-24*36e5),wg=store.setting('wgStatus')?.peers||{},peers=store.list('wgPeers'),subs=store.list('subscribers');
 return store.list('devices').filter(d=>d.type==='router').map(r=>{const checks=[],add=(key,label,ok,detail,fix)=>checks.push({key,label,ok,detail,fix:ok?'':fix});
  const seen=r.lastSeen&&now-r.lastSeen<2*MIN;add('checkin','Reports to netops',!!seen,r.lastSeen?'Last report '+Math.round((now-r.lastSeen)/MIN)+' min ago':'Never reported','Run the connection script (Routers → Connect with script).');
  const names=new Set([r.name,r.ip].filter(Boolean).map(x=>String(x).toLowerCase())),acct=sessions.filter(x=>names.has(String(x.nasName||'').toLowerCase())||names.has(String(x.nas||'').toLowerCase()));
  add('radius','RADIUS accounting',acct.length>0,acct.length?acct.length+' sessions in 24 h':'No accounting from this router in 24 h','Add netops as the RADIUS server on this router (WireGuard & Winbox access shows the command).');
  const disc=store.setting('customerDiscovery:'+r.id);add('lists','Customer lists',!!(disc?.lastReport&&now-disc.lastReport<15*MIN),disc?.lastReport?'Sent '+Math.round((now-disc.lastReport)/MIN)+' min ago':'Not sent','Re-run the connection script; it includes the customer list report.');
  add('runner','Job runner',!!store.secret('jobs:'+r.id),store.secret('jobs:'+r.id)?'Installed':'Not installed','MikroTik → Router jobs → Install on this router (needed for static IP, connect and disconnect).');
  const peer=peers.find(p=>p.kind==='router'&&p.routerId===r.id),hs=peer&&wg[peer.publicKey]?.handshake;add('wireguard','WireGuard tunnel',!!(hs&&now-hs<3*MIN),peer?(hs?'Handshake '+Math.round((now-hs)/MIN)+' min ago':'No handshake yet'):'No WireGuard address','WireGuard & Winbox access → Add router, then paste the script on the router.');
  const b=(store.setting('routerBackups:'+r.id)||{items:[]}).items[0];add('backup','Config backup',!!(b&&now-(b.checked||b.time)<7*1440*MIN),b?'Checked '+new Date(b.checked||b.time).toISOString().slice(0,10):'None yet','Config backups → Take a backup now.');
  if(subs.some(s=>s.service==='static'&&s.routerId===r.id))add('static','Static IP network',!!store.setting('staticSettings:'+r.id),store.setting('staticSettings:'+r.id)?.network||'Not set','Static IP → Settings for this router.');
  return {id:r.id,name:r.name,ok:checks.filter(c=>c.ok).length,total:checks.length,checks};});}
module.exports={audit};
