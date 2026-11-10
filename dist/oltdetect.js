'use strict';
// OLTs page: shows OLTs (and other non-MikroTik gear) that the routers can see on their ports, with one-click onboarding.
(()=>{
const original=window.renderDevices,H=escapeHtml;
const seen=t=>t?stamp(t):'—';
function row(n,primary){return `<tr><td><strong>${H(n.name||n.mac||'Unnamed device')}</strong><small>${H([n.vendor,n.model||n.platform].filter(Boolean).join(' · '))}</small></td><td>${H(n.router)}<small>port ${H(n.port||'—')}</small></td><td>${H(n.ip||'—')}<small>${H(n.mac)}</small></td><td>${n.confidence?`<span class="status ${n.confidence==='high'?'online':'warning'}">${n.confidence==='high'?'Likely OLT':'Possible OLT'}</span>`:`<span class="status">${H(n.kind||'Other device')}</span>`}<small>${H(seen(n.lastSeen))}</small></td><td>${n.added?'<span class="status online">Onboarded</span>':`<button class="ra-btn ${primary?'ra-primary':''}" data-olt-add="${H(n.routerId+'|'+n.key)}">${(primary?'+ Onboard as OLT':'Add as OLT anyway')}</button>`}</td></tr>`;}
async function panel(){
 const host=$('#olt-detect');if(!host)return;
 let d;try{d=await api('olts/detect');}catch(e){host.innerHTML=notice('Could not scan the routers',H(e.message),true);return;}
 if(state.page!=='olts')return;window.__oltLast=d;
 const all=[...d.olts,...d.others],byKey=new Map(all.map(n=>[n.routerId+'|'+n.key,n]));
 const head=['DEVICE','SEEN BY','ADDRESS','STATUS','ACTION'];
 host.innerHTML=`<section class="card"><div class="card-header"><div><h2>Detected on your routers</h2><p>Read from what each MikroTik hears on its ports (MNDP, CDP and LLDP). Routers report every 2 minutes; Scan again reads their latest reports. Nothing here changes a router or an OLT.${d.sampledAt?` <span class="muted">Checked ${H(new Date(d.sampledAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))}.</span>`:''}</p></div><button class="button secondary" id="olt-rescan">Scan again</button></div>
  ${d.olts.length?table(head,d.olts,n=>row(n,true)):`<div class="list-empty"><h3>No OLT identified yet</h3><p>${d.silent.length?'Discovery is off on '+H(d.silent.map(s=>s.router).join(', '))+'. ':''}Many OLTs do not advertise themselves. If yours is not below, pick it from the other devices.</p></div>`}
  ${d.others.length?`<details class="radius-advanced"><summary>Other devices the routers can see (${d.others.length})</summary>${table(head,d.others,n=>row(n,false))}</details>`:''}</section>`;
 $('#olt-rescan').onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='Scanning…';await panel();const n=(window.__oltLast||d).olts.length;toast(n?`${n} OLT${n===1?'':'s'} found`:'Scan done: no OLT advertised itself yet');};
 for(const b of host.querySelectorAll('[data-olt-add]'))b.onclick=async()=>{const n=byKey.get(b.dataset.oltAdd);if(!n)return;b.disabled=true;
  try{await api('records/devices','POST',{name:n.name||(n.vendor?n.vendor+' OLT':'OLT '+n.mac.slice(-5)),type:'olt',driver:'none',model:n.model||n.platform||'',ip:n.ip||'',vendor:n.vendor||'',macAddress:n.mac,location:`Seen by ${n.router} on port ${n.port||'unknown'}`,notes:`Onboarded from MikroTik neighbour data (${n.router}). ${[n.platform,n.software].filter(Boolean).join(' ')}`.trim()});
   toast('OLT added. Set its management method on the OLT record.');await load();render();}catch(e){toast(e.message);b.disabled=false;}};
}
window.renderDevices=function(type){original(type);if(type!=='olt')return;const heading=document.querySelector('#main .page-heading');if(!heading)return;heading.insertAdjacentHTML('afterend','<div id="olt-detect" style="margin-bottom:18px"><div class="card"><p class="muted" style="padding:18px">Looking for OLTs on your routers…</p></div></div>');panel();};
})();
