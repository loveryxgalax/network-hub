'use strict';
// WiFi page popups (set up in Kade Cloud → Portal popups). kadePopup(list, base) shows the ones this phone has not seen
// as often as each popup allows; several popups are swiped through. Views and button taps are counted.
(function(){
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const GAP={every:0,day:864e5,week:7*864e5,once:Infinity};
 const seen=id=>{try{return Number(localStorage.getItem('kp-'+id))||0;}catch{return 0;}},mark=id=>{try{localStorage.setItem('kp-'+id,String(Date.now()));}catch{}};
 const WA='<svg viewBox="0 0 24 24" width="30" height="30" fill="#25d366" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.7-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>';
 const STAR='<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#1747e6" stroke-width="2" aria-hidden="true"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/></svg>';
 const CSS=`.kp-veil{position:fixed;inset:0;z-index:2147483000;background:rgba(8,16,40,.6);display:flex;align-items:center;justify-content:center;padding:16px;animation:kpf .2s ease}
.kp-card{width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.35);position:relative;font-family:inherit;color:#0b1b4d;animation:kpu .25s ease}
.kp-x{position:absolute;top:10px;right:10px;width:38px;height:38px;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:20px;line-height:1;cursor:pointer;z-index:2}
.kp-ban{min-height:150px;background:radial-gradient(circle at 20% 20%,#3b6cff,#1235c9 60%,#0a1f7a);position:relative;display:flex;align-items:center;justify-content:center}
.kp-ban b{color:#fff;font-size:28px;font-weight:800;letter-spacing:-.5px;text-align:center;padding:30px 20px 40px;line-height:1.15}.kp-ban img{display:block;width:100%;height:auto;max-height:260px;object-fit:cover}.kp-tag{position:absolute;top:14px;left:14px;background:#ffd400;color:#111;font-weight:800;font-size:11px;padding:4px 9px;border-radius:99px;letter-spacing:.3px}
.kp-ic{width:62px;height:62px;border-radius:50%;background:#e7f8ee;display:grid;place-items:center;margin:-31px auto 0;position:relative;border:4px solid #fff}.kp-ic.b{background:#eef2ff}
.kp-bd{padding:8px 22px 20px;text-align:center}.kp-bd h2{margin:6px 0;font-size:21px;line-height:1.25;color:#0b1b4d}.kp-bd p{margin:0;color:#5a6785;font-size:14px;line-height:1.45}
.kp-pts{list-style:none;padding:12px 14px;margin:14px 0 4px;background:#f3f6ff;border-radius:14px;text-align:left;font-size:14px;color:#1d2a4f}.kp-pts li{padding:5px 0}
.kp-btn{display:flex;align-items:center;justify-content:center;margin-top:14px;background:#25d366;color:#fff;font-weight:800;padding:15px;border-radius:14px;font-size:15px;text-decoration:none;letter-spacing:.3px}.kp-btn.b{background:#1747e6}
.kp-dots{display:flex;gap:6px;justify-content:center;margin-top:14px}.kp-dots button{width:8px;height:8px;border-radius:50%;border:0;background:#cdd5ea;padding:0;cursor:pointer}.kp-dots button.on{background:#1747e6;width:20px;border-radius:4px}
.kp-note{font-size:12px;color:#8a94ad;margin-top:10px}
@keyframes kpf{from{opacity:0}}@keyframes kpu{from{transform:translateY(20px);opacity:0}}`;
 const css=()=>{if(!document.getElementById('kp-css')){const s=document.createElement('style');s.id='kp-css';s.textContent=CSS;document.head.append(s);}};
 // The card itself; imgSrc is the picture's address (or a data: URL in the Kade Cloud preview).
 const card=(p,imgSrc,dots='')=>{const wa=/whatsapp\.com|wa\.me/i.test(p.buttonLink||'');
  return `<div class="kp-card"><button class="kp-x" aria-label="Close">✕</button><div class="kp-ban">${imgSrc?`<img src="${esc(imgSrc)}" alt="">`:p.headline?`<b>${esc(p.headline)}</b>`:''}${p.badge?`<span class="kp-tag">${esc(p.badge)}</span>`:''}</div>
<div class="kp-ic ${wa?'':'b'}">${wa?WA:STAR}</div><div class="kp-bd"><h2>${esc(p.title)}</h2>${p.text?`<p>${esc(p.text)}</p>`:''}${(p.points||[]).length?`<ul class="kp-pts">${p.points.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
${p.buttonLink||p.buttonText?`<a class="kp-btn ${wa?'':'b'}" href="${esc(p.buttonLink||'#')}" target="_blank" rel="noopener">${esc(p.buttonText||'Open')}</a>`:''}${p.note?`<div class="kp-note">${esc(p.note)}</div>`:''}${dots}</div></div>`;};
 window.kadePopupCard=(p,imgSrc)=>{css();return card(p,imgSrc);};
 window.kadePopup=function(list,base){
  const items=(list||[]).filter(p=>p&&p.id&&Date.now()-seen(p.id)>=(GAP[p.frequency]??864e5));if(!items.length||document.querySelector('.kp-veil'))return false;
  css();
  const ev=(id,type)=>{try{fetch((base||'')+'/portal/api/popups/'+id+'/event',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({type})}).catch(()=>{});}catch{}};
  const veil=document.createElement('div');veil.className='kp-veil';veil.setAttribute('role','dialog');veil.setAttribute('aria-modal','true');(document.querySelector('dialog[open]')||document.body).append(veil);let i=0;
  const close=()=>{veil.remove();document.removeEventListener('keydown',key);};const key=e=>{if(e.key==='Escape')close();};document.addEventListener('keydown',key);
  const paint=()=>{const p=items[i];mark(p.id);ev(p.id,'view');
   veil.innerHTML=card(p,p.hasImage?(base||'')+'/portal/api/popups/'+p.id+'/image?v='+(p.img||1):'',items.length>1?`<div class="kp-dots">${items.map((_,k)=>`<button data-k="${k}" class="${k===i?'on':''}" aria-label="Popup ${k+1}"></button>`).join('')}</div>`:'');
   veil.querySelector('.kp-x').onclick=close;const a=veil.querySelector('.kp-btn');if(a)a.onclick=()=>ev(p.id,'tap');
   for(const d of veil.querySelectorAll('[data-k]'))d.onclick=()=>{i=Number(d.dataset.k);paint();};
   let x0=null;const c=veil.querySelector('.kp-card');c.ontouchstart=e=>{x0=e.touches[0].clientX;};c.ontouchend=e=>{if(x0==null)return;const dx=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(dx)>50&&items.length>1){i=(i+(dx<0?1:items.length-1))%items.length;paint();}};};
  veil.onclick=e=>{if(e.target===veil)close();};paint();return true;};
})();
