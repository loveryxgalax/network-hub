'use strict';
// Customer's own account page. Everything shown comes from /portal/api/me for the signed link in ?t=.
(()=>{
const $=s=>document.querySelector(s),T=new URLSearchParams(location.search).get('t')||'';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kes=n=>'KES '+Number(n||0).toLocaleString('en-KE',{maximumFractionDigits:0});
const bytes=n=>{n=Number(n)||0;for(const [u,d] of [['GB',1073741824],['MB',1048576],['KB',1024]])if(n>=d)return (n/d).toFixed(2)+' '+u;return n+' B';};
const when=t=>t?new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Nairobi'}):'—';
let D=null;
async function api(path,opt){const r=await fetch('/portal/api/'+path,opt),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||j.message||'Something went wrong');return j;}
const post=(p,b)=>api(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t:T,...b})});
function sheet(html){$('#sheet-body').innerHTML=html;$('#sheet').hidden=false;}
function closeSheet(){$('#sheet').hidden=true;$('#sheet-body').innerHTML='';clearTimeout(poll.t);}
$('#sheet-x').onclick=closeSheet;$('#sheet').onclick=e=>{if(e.target.id==='sheet')closeSheet();};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
function paint(){
 const d=D,st=d.status,label={active:'Connected plan active',expired:'Expired',suspended:'Deactivated'}[st]||st;
 document.title=d.brand.name+' · My account';$('#brand').textContent=d.brand.name||'Your account';$('#user').textContent=d.account;
 document.documentElement.style.setProperty('--brand',d.brand.color);
 const HI_PH='<svg class="hi" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.6 3.6a1 1 0 01-.25 1z"/></svg>',HI_WA='<svg class="hi wa" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 2a8 8 0 11-4.3 14.7l-.4-.2-2.6.7.7-2.5-.3-.4A8 8 0 0112 4zm-3 3.5c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.7.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.4l-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.3-.1-1.1-.4-2.1-1.3-.8-.7-1.3-1.5-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5.3-.4v-.5l-.8-1.9c-.2-.5-.4-.5-.6-.5z"/></svg>';
$('#help').innerHTML=(d.brand.phone||d.brand.whatsapp)?'Need help? '+(d.brand.phone?`<a href="tel:${esc(d.brand.phone)}">${HI_PH}${esc(d.brand.phone)}</a>`:'')+(d.brand.phone&&d.brand.whatsapp?' <span class="or">or</span> ':'')+(d.brand.whatsapp?`<a href="https://wa.me/${esc(d.brand.whatsapp.replace(/\D/g,''))}">${HI_WA}${esc(d.brand.whatsapp)}</a>`:''):'';
 const active=st==='active',pts=d.points||0,worth=d.loyalty.perPoint?pts*d.loyalty.perPoint:0;
 $('#app').innerHTML=`
 <section class="card"><header><h2>Account information</h2><span class="badge ${esc(st)}">${esc(st==='active'?'Active':st==='expired'?'Expired':'Deactivated')}</span></header>
  <div class="body kv"><div><span>Username:</span> <b>${esc(String(d.account).toUpperCase())}</b></div><div><span>Phone:</span> ${esc(d.phone||'—')}</div><div><span>Package:</span> ${esc(d.plan||'—')}</div><div><span>${active?'Expires':'Expired'}:</span> ${esc(when(d.expiresAt))}</div>${d.balance?`<div><span>Wallet:</span> ${esc(kes(d.balance))}</div>`:''}${d.sharedCode?`<div><span>Sharing code:</span> <b>${esc(d.sharedCode)}</b></div>`:''}</div></section>
 ${d.loyalty.enabled?`<section class="card"><header><div><h2>Loyalty points</h2><p>You have <b>${pts}</b> point${pts===1?'':'s'}${worth?` (worth ${esc(kes(worth))})`:''}. Redeem them for wallet credit towards your next package.</p></div><button class="btn" id="redeem" ${pts>0?'':'disabled'}>Redeem</button></header></section>`:''}
 <section class="card"><header><div><h2>Data usage (last ${d.usage.days} days)</h2><p>Your download and upload data consumption</p></div></header><div class="body usage"><div class="stat"><i>↓</i><div><small>Download</small><b>${esc(bytes(d.usage.down))}</b></div></div><div class="stat"><i>↑</i><div><small>Upload</small><b>${esc(bytes(d.usage.up))}</b></div></div></div></section>
 <section class="card"><header><div><h2>${active?'Extend your package':'Choose a package'}</h2><p>Browse and buy internet packages.</p></div></header>
  ${active?'<div class="note">✔ You have an active connection. You can only extend your current package until it expires.</div>':st==='suspended'?'<div class="note">This account is deactivated. Please contact support.</div>':''}
  <div class="pk">${d.plans.map(p=>{const cur=p.current,can=st==='suspended'?false:cur?true:(!active&&p.available);return `<div class="p ${cur?'cur':''}"><h3><span>${esc(p.name)}</span>${cur&&active?'<span class="tag">✓ Active</span>':''}</h3><b>${esc(kes(p.price))}</b><small>${esc(p.duration)}</small><button class="btn ${cur?'ok':''}" data-p="${esc(p.id)}" ${can?'':'disabled'}>${cur?(active?'Extend':'Renew'):can?'Choose':'Unavailable'}</button></div>`;}).join('')||'<p style="padding:16px">No packages are on sale right now.</p>'}</div></section>`;
 const r=$('#redeem');if(r)r.onclick=()=>sheet(`<h3>Redeem points</h3><p>Turn ${pts} point${pts===1?'':'s'} into wallet credit${worth?` of ${esc(kes(worth))}`:''}.</p><div id="rmsg"></div><button class="btn" id="rgo" style="width:100%">Redeem ${pts} points</button>`),r&&setTimeout(()=>{const g=$('#rgo');},0);
 for(const b of document.querySelectorAll('[data-p]'))b.onclick=()=>buy(d.plans.find(p=>p.id===b.dataset.p));
}
document.addEventListener('click',async e=>{if(e.target.id!=='rgo')return;const b=e.target;b.disabled=true;try{D=await post('me/redeem',{});closeSheet();paint();}catch(x){$('#rmsg').innerHTML=`<div class="msg bad">${esc(x.message)}</div>`;b.disabled=false;}});
function buy(p){sheet(`<h3>${esc(p.name)}</h3><p>${esc(kes(p.price))} · ${esc(p.duration)}. Enter your M-Pesa number and we'll send a payment prompt.</p><div id="pmsg"></div><input id="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" value="${esc(D.phone||'')}"><button class="btn" id="pgo" style="width:100%">Pay ${esc(kes(p.price))}</button>`);
 $('#pgo').onclick=async()=>{const b=$('#pgo');b.disabled=true;$('#pmsg').innerHTML='';try{const s=await post('me/pay',{phone:$('#phone').value,planId:p.id});sheet(`<div class="center"><div class="spin"></div><h3>Check your phone</h3><p>Enter your M-Pesa PIN to pay ${esc(kes(s.amount))}.</p></div>`);poll(s.id,s.token,Date.now());}catch(x){$('#pmsg').innerHTML=`<div class="msg bad">${esc(x.message)}</div>`;b.disabled=false;}};}
function poll(id,tok,t0){clearTimeout(poll.t);poll.t=setTimeout(async()=>{try{const s=await api('pay/'+id+'?t='+encodeURIComponent(tok));
 if(s.status==='pending'){if(Date.now()-t0>120000)return sheet('<h3>Still waiting</h3><p>We have not received the payment yet. If you paid, refresh this page in a minute.</p>');return poll(id,tok,t0);}
 if(s.status==='paid'||s.status==='completed'||s.status==='success'){D=await api('me?t='+encodeURIComponent(T));paint();return sheet('<div class="center"><h3>Payment received ✔</h3><p>Your package has been extended. Thank you!</p><button class="btn" onclick="document.getElementById(\'sheet-x\').click()">Done</button></div>');}
 sheet(`<h3>Payment not completed</h3><p>${esc(s.message||s.reason||'The payment was cancelled or failed.')}</p>`);}catch(x){sheet(`<h3>Something went wrong</h3><p>${esc(x.message)}</p>`);}},2500);}
(async()=>{if(!T)return $('#app').innerHTML='<div class="card skeleton">Open the link your provider sent you.</div>';
 try{D=await api('me?t='+encodeURIComponent(T));paint();}catch(e){$('#app').innerHTML=`<div class="card skeleton">${esc(e.message)}</div>`;}})();
})();
