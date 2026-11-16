// Staff preview: the hotspot buying page as one signed-in customer sees it (loyalty, vouchers, packages, My Usage).
(function(){'use strict';
 const q=new URLSearchParams(location.search),T=q.get('t')||'',SP=q.get('sp')||'',$=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 (async()=>{try{
  const r=await fetch('/portal/api/me?t='+encodeURIComponent(T),{headers:SP?{'X-Portal-Pass':SP}:{}});const d=await r.json();if(!r.ok)throw new Error(d.error||'This link has expired');
  const b=d.brand||{},acct='/portal/account.html?t='+encodeURIComponent(T)+(SP?'&sp='+encodeURIComponent(SP):'');
  document.title=(b.name||'WiFi')+' - signed in';$('#brand').textContent=b.name||'WiFi';$('#who').textContent=String(d.account||'').toUpperCase();
  $('#help').innerHTML='Need help? '+(b.phone?`<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`:'')+(b.whatsapp?`<a href="https://wa.me/${esc(String(b.whatsapp).replace(/\D/g,''))}">${esc(b.whatsapp)}</a>`:'');
  const pts=d.points||0,lo=d.loyalty&&d.loyalty.enabled;
  $('#app').innerHTML=`${lo?`<section class="loy"><div><small>Loyalty Points Balance</small><b>${esc(pts)} pts</b></div><button type="button" ${pts>0?'':'disabled'}>Redeem</button></section>`:''}
   <div class="wel"><p>Welcome to our Hotspot Service!</p><small>If you already paid just click the package paid for to auto connect.</small></div>
   <div class="two"><a href="/portal/">Use Voucher</a><a href="/portal/">Connect with M-PESA code.</a></div>
   <div class="grid">${(d.plans||[]).map(p=>`<a class="pk ${p.current?'cur':''}" href="${acct}#buy"><b>Ksh.${esc(p.price)}</b>${p.popular?'<span class="pop">★ POPULAR</span>':''}<h3>${esc(p.name)}</h3><hr><p>Unlimited</p><p>Valid for ${esc(p.duration)}.</p>${p.devices>1?`<p>Connect up to ${p.devices} devices</p>`:''}</a>`).join('')}</div>
   <a class="usage" href="${acct}"><i>▮</i><div><b>My Usage</b><small>Data used, payments and subscription history.</small></div><span>›</span></a>`;
 }catch(e){$('#app').innerHTML='<p class="muted" style="text-align:center;margin-top:40px">'+esc(e.message)+'</p>';}})();})();
