// Kade Cloud customer chat (WiFi page and account page): a support chat like a messenger. The customer's own
// messages are on the right, the team's replies on the left; replies arrive while the window is open.
// Phone: full screen (like WhatsApp). Larger screens: a panel at the bottom right.
// window.KadeChat.open({brand, logo, scope, needPhone, phone, conn:{ip,mac}, links, start(text, phone) → token})
(()=>{
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const CSS=`.kch{position:fixed;right:20px;bottom:20px;z-index:9999;width:min(390px,calc(100vw - 24px));height:min(620px,calc(100dvh - 40px));display:flex;flex-direction:column;background:#fff;border-radius:20px;box-shadow:0 24px 64px rgba(15,23,42,.30),0 2px 6px rgba(15,23,42,.08);overflow:hidden;font-family:"Google Sans",system-ui,sans-serif;color:#0f172a;animation:kchIn .2s ease-out}
@keyframes kchIn{from{opacity:0;transform:translateY(16px) scale(.98)}}
.kch-h{display:flex;align-items:center;gap:12px;padding:16px 16px 14px;padding-top:calc(16px + env(safe-area-inset-top));background:linear-gradient(135deg,#0032fd,#2251ff);color:#fff}
.kch-logo{position:relative;width:42px;height:42px;border-radius:50%;background:#fff;color:#0032fd;display:grid;place-items:center;font-weight:800;font-size:18px;flex:none}.kch-logo img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.kch-logo i{position:absolute;right:0;bottom:0;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid #fff}
.kch-h b{display:block;font-size:16.5px;font-weight:700}.kch-h small{display:block;opacity:.9;font-size:12.5px;margin-top:2px}
.kch-x{margin-left:auto;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.16);border:0;color:#fff;cursor:pointer;display:grid;place-items:center;flex:none}.kch-x:hover{background:rgba(255,255,255,.26)}
.kch-c{padding:8px 16px;background:#eef2ff;font-size:12px;color:#3730a3;border-bottom:1px solid #e0e7ff}.kch-c code{font-family:ui-monospace,monospace;font-size:12px}
.kch-m{flex:1;overflow-y:auto;padding:16px 14px 8px;display:flex;flex-direction:column;gap:6px;background:#f6f8fb;overscroll-behavior:contain}
.kch-day{align-self:center;font-size:11.5px;color:#64748b;background:#e9eef5;border-radius:999px;padding:3px 10px;margin:8px 0 4px}
.kch-b{max-width:80%;padding:9px 13px 7px;border-radius:18px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.kch-b small{display:block;font-size:10.5px;margin-top:3px;opacity:.7;text-align:right}
.kch-me{align-self:flex-end;background:#0032fd;color:#fff;border-bottom-right-radius:6px}.kch-me.kch-pend{opacity:.7}.kch-me.kch-fail{background:#fee2e2;color:#991b1b;cursor:pointer}
.kch-them{align-self:flex-start;background:#fff;border:1px solid #e5e9f0;border-bottom-left-radius:6px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.kch-them small{text-align:left;display:flex;justify-content:space-between;gap:12px}.kch-cp{background:none;border:0;cursor:pointer;color:#94a3b8;font-size:12px;padding:0}
.kch-note{align-self:center;font-size:12.5px;color:#64748b;text-align:center;padding:6px 10px;max-width:90%}
.kch-q{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px;justify-content:flex-end}.kch-q button{border:1px solid #c7d2fe;background:#fff;color:#0032fd;border-radius:999px;padding:8px 13px;font:inherit;font-size:13.5px;cursor:pointer}.kch-q button:hover{background:#eef2ff}
.kch-f{display:flex;flex-direction:column;gap:6px;padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom));border-top:1px solid #e5e9f0;background:#fff}
.kch-row{display:flex;gap:8px;align-items:flex-end}
.kch-f input,.kch-f textarea{flex:1;width:100%;box-sizing:border-box;min-width:0;border:1px solid #d5dbe5;border-radius:22px;padding:11px 16px;font:inherit;font-size:16px;outline:none;background:#f8fafc;resize:none;line-height:1.35;max-height:120px}
.kch-f input:focus,.kch-f textarea:focus{border-color:#0032fd;background:#fff;box-shadow:0 0 0 3px rgba(0,50,253,.12)}
.kch-s{width:46px;height:46px;flex:none;border:0;border-radius:50%;background:#0032fd;color:#fff;cursor:pointer;display:grid;place-items:center;transition:transform .1s}.kch-s:active{transform:scale(.94)}.kch-s:disabled{opacity:.45;cursor:default}
.kch-err{color:#b91c1c;font-size:12.5px}.kch-err:empty{display:none}
.kch-l{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;font-size:12.5px}.kch-l a{color:#0032fd;text-decoration:none;font-weight:600}
.kch-ph{display:block}.kch-ph[hidden]{display:none}.kch-ph small{display:block;font-size:11.5px;color:#64748b;margin:0 0 4px 6px}
@media(max-width:560px){.kch{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0;animation:kchUp .22s ease-out}@keyframes kchUp{from{transform:translateY(24px);opacity:0}}}`;
 const SEND='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
 const X='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
 const QUICK=["I paid but I'm not connected","My internet is slow","I want to buy a package","Something else"];
 let box=null,timer=null,keyH=null;
 const tm=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 const day=t=>{const d=new Date(t),n=new Date(),y=new Date(Date.now()-864e5);return d.toDateString()===n.toDateString()?'Today':d.toDateString()===y.toDateString()?'Yesterday':d.toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'});};
 const key=s=>'kade-chat:'+(s||'wifi');
 const mobile=()=>matchMedia('(max-width:560px)').matches;
 function close(){clearInterval(timer);timer=null;if(keyH)document.removeEventListener('keydown',keyH);keyH=null;box?.remove();box=null;document.documentElement.style.removeProperty('overflow');}
 async function api(method,token,body){const r=await fetch('/portal/api/chat',{method,headers:{'X-Chat-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'Could not reach support'),{status:r.status});return d;}
 function open(o={}){close();if(!document.getElementById('kch-css')){const st=document.createElement('style');st.id='kch-css';st.textContent=CSS;document.head.appendChild(st);}
  let token='';try{token=localStorage.getItem(key(o.scope))||'';}catch{}
  const brand=String(o.brand||'Support').trim(),c=o.conn||{},links=Array.isArray(o.links)?o.links.filter(Boolean).join(''):(o.links||'');
  box=document.createElement('section');box.className='kch';box.setAttribute('role','dialog');box.setAttribute('aria-label','Support chat');
  box.innerHTML=`<div class="kch-h"><span class="kch-logo">${o.logo?`<img src="${esc(o.logo)}" alt="">`:esc(brand.charAt(0).toUpperCase())}<i></i></span><div><b>${esc(brand)}</b><small>Support · usually replies in minutes</small></div><button class="kch-x" type="button" aria-label="Close chat">${X}</button></div>
   ${c.ip||c.mac?`<div class="kch-c">Your connection: <code>${c.ip?'IP '+esc(c.ip):''}${c.ip&&c.mac?' · ':''}${c.mac?'MAC '+esc(c.mac):''}</code></div>`:''}
   <div class="kch-m" aria-live="polite"></div>
   <form class="kch-f" novalidate>${o.needPhone?`<label class="kch-ph" ${token?'hidden':''}><small>Your phone number, so we can reach you</small><input name="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" value="${esc(o.phone||'')}"></label>`:''}
    <div class="kch-row"><textarea name="text" rows="1" autocomplete="off" maxlength="1000" placeholder="Write a message…" aria-label="Message"></textarea><button class="kch-s" aria-label="Send" disabled>${SEND}</button></div><div class="kch-err" role="alert"></div>${links?`<div class="kch-l">${links}</div>`:''}</form>`;
  document.body.appendChild(box);if(mobile())document.documentElement.style.overflow='hidden';
  const list=box.querySelector('.kch-m'),f=box.querySelector('form'),err=box.querySelector('.kch-err'),ta=f.elements.text,sb=f.querySelector('.kch-s'),phoneIn=f.elements.phone||null;
  box.querySelector('.kch-x').onclick=close;keyH=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',keyH);
  let msgs=[],pending=[],status='',sig='';
  const greet=`<div class="kch-b kch-them">Hi! 👋 How can we help? Tell us what's wrong and our team will reply here.<small><span>${esc(brand)}</span></small></div>`;
  const render=()=>{const atEnd=list.scrollHeight-list.scrollTop-list.clientHeight<60;let h=greet,last='';const all=[...msgs,...pending];
   if(!all.length)h+=`<div class="kch-q">${QUICK.map(q=>`<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
   for(const m of all){const d=day(m.time||Date.now());if(d!==last){h+=`<div class="kch-day">${esc(d)}</div>`;last=d;}
    h+=m.from==='customer'||m.pending!==undefined?`<div class="kch-b kch-me${m.pending===true?' kch-pend':m.pending==='fail'?' kch-fail':''}" ${m.pending==='fail'?`data-retry="${esc(m.id)}" title="Tap to send again"`:''}>${esc(m.text)}<small>${m.pending===true?'Sending…':m.pending==='fail'?'Not sent · tap to retry':esc(tm(m.time))}</small></div>`
     :`<div class="kch-b kch-them">${esc(m.text)}<small><span>${esc(tm(m.time))}</span><button type="button" class="kch-cp" data-cp="${esc(m.text)}" title="Copy" aria-label="Copy message">⧉</button></small></div>`;}
   if(msgs.length&&!msgs.some(m=>m.from!=='customer')&&!pending.length)h+=`<div class="kch-note">Thanks, your message is with our team. Keep this window open, or come back here for the reply.</div>`;
   if(status==='Closed'||status==='Resolved')h+='<div class="kch-note">This chat was marked done. Write again to reopen it.</div>';
   list.innerHTML=h;if(atEnd||!list.dataset.first){list.scrollTop=list.scrollHeight;list.dataset.first='1';}};
  const paint=d=>{status=d.status||'';const s=JSON.stringify(d.messages.map(m=>m.id))+status;if(s===sig&&!pending.length)return;sig=s;msgs=d.messages;render();};
  list.onclick=e=>{const q=e.target.closest('[data-q]');if(q){send(q.dataset.q);return;}const r=e.target.closest('[data-retry]');if(r){const p=pending.find(x=>x.id===r.dataset.retry);if(p){pending=pending.filter(x=>x!==p);send(p.text);}return;}
   const b=e.target.closest('[data-cp]');if(b)navigator.clipboard?.writeText(b.dataset.cp).then(()=>{b.textContent='✓';setTimeout(()=>{b.textContent='⧉';},1200);},()=>{});};
  const load=async()=>{if(!token){render();return;}try{paint(await api('GET',token));}catch(e){if(e.status===404){try{localStorage.removeItem(key(o.scope));}catch{}token='';sig='';msgs=[];render();const ph=f.querySelector('.kch-ph');if(ph)ph.hidden=false;}}};
  const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(120,ta.scrollHeight)+'px';sb.disabled=!ta.value.trim();};
  ta.oninput=grow;ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!mobile()){e.preventDefault();f.requestSubmit();}};
  async function send(text){text=String(text||'').trim();if(!text)return;err.textContent='';
   if(!token&&o.needPhone){const ph=(phoneIn?.value||'').replace(/[\s-]/g,'');if(!/^(\+?254|0)?[17]\d{8}$/.test(ph)){err.textContent='Enter your phone number first, so we can reach you.';phoneIn?.focus();return false;}}
   const p={id:'p'+Date.now()+Math.random(),text,time:Date.now(),pending:true};pending.push(p);render();list.scrollTop=list.scrollHeight;
   try{if(token){const d=await api('POST',token,{text});pending=pending.filter(x=>x!==p);sig='';paint(d);}
    else{token=await o.start(text,phoneIn?.value||'');try{localStorage.setItem(key(o.scope),token);}catch{}const ph=f.querySelector('.kch-ph');if(ph)ph.hidden=true;pending=pending.filter(x=>x!==p);sig='';await load();}
    return true;}
   catch(x){p.pending='fail';err.textContent=x.message||'Could not send. Check your connection and tap the message to retry.';render();return false;}}
  f.onsubmit=async e=>{e.preventDefault();const t=ta.value;if(!t.trim())return;ta.value='';grow();const ok=await send(t);if(ok===false&&!pending.length){ta.value=t;grow();}ta.focus();};
  load();timer=setInterval(()=>{if(document.visibilityState==='visible')load();},5000);
  setTimeout(()=>(o.needPhone&&!token&&!phoneIn?.value?phoneIn:ta).focus(),60);}
 window.KadeChat={open,close};
})();
