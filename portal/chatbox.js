// Kade Cloud customer chat (WiFi page and account page): a support chat window like a messenger. The customer's own
// messages are on the right, the team's replies on the left; replies arrive while the window is open.
// window.KadeChat.open({brand, logo, scope, needPhone, phone, conn:{ip,mac}, links, start(text, phone) → token})
(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const CSS=`.kch{position:fixed;right:16px;bottom:16px;z-index:9999;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100dvh - 32px));display:flex;flex-direction:column;background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.28);overflow:hidden;font-family:"Google Sans",system-ui,sans-serif;color:#0f172a;animation:kchIn .18s ease-out}
@keyframes kchIn{from{opacity:0;transform:translateY(12px)}}
.kch-h{display:flex;align-items:center;gap:12px;padding:14px 16px;background:#0032fd;color:#fff}.kch-logo{width:40px;height:40px;border-radius:50%;background:#fff;color:#0032fd;display:grid;place-items:center;font-weight:800;overflow:hidden;flex:none}.kch-logo img{width:100%;height:100%;object-fit:cover}
.kch-h b{display:block;font-size:16px}.kch-h small{opacity:.85;font-size:13px}.kch-x{margin-left:auto;background:none;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:4px}
.kch-c{padding:8px 16px;background:#f1f5f9;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0}.kch-c code{font-family:ui-monospace,monospace;font-size:12px;color:#0f172a}
.kch-m{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#f8fafc;overscroll-behavior:contain}
.kch-b{max-width:82%;padding:10px 14px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;position:relative}
.kch-b small{display:block;font-size:11px;margin-top:6px;opacity:.75;text-align:right}
.kch-me{align-self:flex-end;background:#0032fd;color:#fff;border-bottom-right-radius:4px}.kch-them{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-bottom-left-radius:4px}
.kch-them small{text-align:left;display:flex;justify-content:space-between;gap:12px}.kch-cp{background:none;border:0;cursor:pointer;color:#94a3b8;font-size:12px;padding:0}
.kch-hint{align-self:center;font-size:12.5px;color:#64748b;text-align:center;padding:6px 10px}
.kch-f{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-top:1px solid #e2e8f0;background:#fff}.kch-row{display:flex;gap:8px;align-items:center}
.kch-f input{flex:1;min-width:0;height:44px;border:1px solid #cbd5e1;border-radius:22px;padding:0 16px;font:inherit;font-size:15px;outline:none}.kch-f input:focus{border-color:#0032fd}
.kch-s{width:44px;height:44px;flex:none;border:0;border-radius:50%;background:#0032fd;color:#fff;cursor:pointer;display:grid;place-items:center}.kch-s:disabled{opacity:.5}
.kch-err{color:#b91c1c;font-size:12.5px;min-height:0}.kch-l{display:flex;gap:8px;flex-wrap:wrap;font-size:12.5px}.kch-l a{color:#0032fd;text-decoration:none}
@media(max-width:520px){.kch{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0}}`;
 const SEND='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
 let box=null,timer=null;
 const tm=t=>new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
 const key=s=>'kade-chat:'+(s||'wifi');
 function close(){clearInterval(timer);timer=null;box?.remove();box=null;}
 async function api(method,token,body){const r=await fetch('/portal/api/chat',{method,headers:{'X-Chat-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'Could not reach support'),{status:r.status});return d;}
 function open(o={}){close();if(!document.getElementById('kch-css')){const st=document.createElement('style');st.id='kch-css';st.textContent=CSS;document.head.appendChild(st);}
  let token='';try{token=localStorage.getItem(key(o.scope))||'';}catch{}
  box=document.createElement('section');box.className='kch';box.setAttribute('role','dialog');box.setAttribute('aria-label','Support chat');
  const c=o.conn||{};
  box.innerHTML=`<div class="kch-h"><span class="kch-logo">${o.logo?`<img src="${esc(o.logo)}" alt="">`:esc(String(o.brand||'S').trim().charAt(0).toUpperCase())}</span><div><b>${esc(o.brand||'Support')}</b><small>Support Chat</small></div><button class="kch-x" type="button" aria-label="Close">×</button></div>
   ${c.ip||c.mac?`<div class="kch-c">Your connection<br><code>${c.ip?'IP: '+esc(c.ip):''}${c.ip&&c.mac?'  ·  ':''}${c.mac?'MAC: '+esc(c.mac):''}</code></div>`:''}
   <div class="kch-m" aria-live="polite"></div>
   <form class="kch-f">${o.needPhone?`<input name="phone" inputmode="tel" autocomplete="tel" placeholder="Your phone number (0712 345 678)" value="${esc(o.phone||'')}" ${token?'hidden':''}>`:''}<div class="kch-row"><input name="text" autocomplete="off" maxlength="1000" placeholder="Type a message..." required><button class="kch-s" aria-label="Send">${SEND}</button></div><div class="kch-err"></div>${o.links?`<div class="kch-l">${o.links}</div>`:''}</form>`;
  document.body.appendChild(box);
  const list=box.querySelector('.kch-m'),f=box.querySelector('form'),err=box.querySelector('.kch-err');
  box.querySelector('.kch-x').onclick=close;
  let shown='';
  const paint=d=>{const sig=JSON.stringify(d.messages.map(m=>m.id));if(sig===shown)return;shown=sig;const atEnd=list.scrollHeight-list.scrollTop-list.clientHeight<40;
   list.innerHTML=`<div class="kch-hint">Hi! Send us a message and our team will reply here.</div>`+d.messages.map(m=>m.from==='customer'?`<div class="kch-b kch-me">${esc(m.text)}<small>${esc(tm(m.time))}</small></div>`:`<div class="kch-b kch-them">${esc(m.text)}<small><span>${esc(tm(m.time))}</span><button type="button" class="kch-cp" data-cp="${esc(m.text)}" title="Copy">⧉</button></small></div>`).join('')+(d.status==='Closed'||d.status==='Resolved'?'<div class="kch-hint">This chat was marked done. Write again to reopen it.</div>':'');
   if(atEnd||list.dataset.first!=='1'){list.scrollTop=list.scrollHeight;list.dataset.first='1';}};
  list.onclick=e=>{const b=e.target.closest('[data-cp]');if(b)navigator.clipboard?.writeText(b.dataset.cp).then(()=>{b.textContent='✓';setTimeout(()=>{b.textContent='⧉';},1200);},()=>{});};
  const load=async()=>{if(!token){paint({messages:[]});return;}try{paint(await api('GET',token));}catch(e){if(e.status===404){try{localStorage.removeItem(key(o.scope));}catch{}token='';shown='';paint({messages:[]});const ph=f.querySelector('[name=phone]');if(ph)ph.hidden=false;}}};
  load();timer=setInterval(()=>{if(document.visibilityState==='visible')load();},6000);
  f.onsubmit=async e=>{e.preventDefault();err.textContent='';const text=f.text.value.trim();if(!text)return;const b=f.querySelector('.kch-s');b.disabled=true;
   try{if(token){paint(await api('POST',token,{text}));}
    else{token=await o.start(text,f.phone?.value||'');try{localStorage.setItem(key(o.scope),token);}catch{}const ph=f.querySelector('[name=phone]');if(ph)ph.hidden=true;await load();}
    f.text.value='';list.scrollTop=list.scrollHeight;}catch(x){err.textContent=x.message;}finally{b.disabled=false;f.text.focus();}};
  setTimeout(()=>f.text.focus(),50);}
 window.KadeChat={open,close};
})();
