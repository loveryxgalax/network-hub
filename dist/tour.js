'use strict';
// "Show me around": a 10-step walk round the home page and the menu (like ISPman's). Starts by itself the first time
// a person opens the dashboard on this browser; Snooze hides it for a while, "Don't show me again" for good, and the
// Show me around button on the home page starts it again any time. Also: a Copy button on every code/script box.
(function(){
 const STEPS=[
  {t:'Welcome to netops',b:'A quick walk round your dashboard: the home page first, then the menu. Use Next and Back, or put it away for later.'},
  {s:'.kd2-actions',t:'Quick actions',b:'Add a hotspot or PPPoE customer, find anyone, link a MikroTik or open the system logs from here.'},
  {s:'#kd-kpis',t:'Today at a glance',b:'Customers online, people on the WiFi page, revenue today and this month, who expires in the next 3 days and open alerts.'},
  {s:'#kd-pn',t:'On the captive portal now',b:'Phones on your WiFi page right now, by router and by page, with checkouts that are pending, paid or failed.'},
  {s:'#kd-hs-card',t:'Hotspot customers',b:'Online, offline, expired and unpaid hotspot customers, by router and package. It refreshes itself every 30 seconds.'},
  {s:'#kd-ppp-card',t:'PPPoE customers',b:'The same for home and business (PPPoE) customers, including deactivated accounts.'},
  {s:'#kd-paycard',t:'Received payments',b:'The latest payments with the customer, router and M-Pesa reference. Tap a customer to open their profile.'},
  {s:'#search-trigger',t:'Search anything',b:'Name, phone, account, MAC, IP or payment reference. On a computer press Ctrl K.'},
  {s:'#navigation',alt:'#menu-toggle',t:'The menu',b:'Customers, Hotspot, PPPoE, Payments, MikroTik, OLTs, Monitoring and Settings. On a phone, open it with the ☰ button.'},
  {s:'#notification-button',t:"You're all set",b:'Alerts arrive under the bell. Restart this tour any time with Show me around on the home page.'}];
 const who=()=>{try{return (typeof state!=='undefined'&&state.session?.user?.email||'me').toLowerCase();}catch{return 'me';}};
 const K=k=>'tour-'+k+':'+who(),get=k=>{try{return localStorage.getItem(K(k));}catch{return null;}},put=(k,v)=>{try{v==null?localStorage.removeItem(K(k)):localStorage.setItem(K(k),String(v));}catch{}};
 const css=`.nt-veil{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.55);transition:opacity .2s}.nt-veil.hole{background:transparent}
 .nt-hole{position:fixed;z-index:9998;border-radius:14px;box-shadow:0 0 0 9999px rgba(15,23,42,.55),0 0 0 3px var(--primary,#0032fd);transition:all .25s;pointer-events:none}
 .nt-pop{position:fixed;z-index:9999;width:min(360px,calc(100vw - 32px));background:var(--card,#fff);color:var(--ink,#0f172a);border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.35);padding:16px 18px 14px;font-size:14.5px;line-height:1.45}
 .nt-pop .nt-top{display:flex;justify-content:space-between;align-items:center;color:var(--muted,#64748b);font-size:12.5px}.nt-pop .nt-x{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:var(--muted,#64748b);padding:2px 4px}
 .nt-pop h3{margin:6px 0 6px;font-size:17px;color:var(--ink,#0f172a)}.nt-pop p{margin:0 0 14px;color:var(--ink,#334155)}
 .nt-pop .nt-nav{display:flex;justify-content:flex-end;gap:8px}.nt-pop .nt-nav button{border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;border:1px solid var(--border,#d0d7e2);background:var(--card,#fff);color:var(--ink,#0f172a)}
 .nt-pop .nt-nav .nt-next{background:var(--primary,#0032fd);border-color:var(--primary,#0032fd);color:#fff}
 .nt-pop .nt-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--border,#e2e8f0);margin-top:12px;padding-top:10px;font-size:13px;flex-wrap:wrap}
 .nt-pop .nt-foot label{display:flex!important;align-items:center;gap:6px;font-weight:600;margin:0}.nt-pop .nt-foot select{padding:4px 6px;border-radius:7px;border:1px solid var(--border,#d0d7e2);background:var(--card,#fff);color:inherit;width:auto}
 .nt-pop .nt-never{border:0;background:none;color:var(--muted,#64748b);cursor:pointer;font:inherit;padding:4px 0}.nt-pop .nt-never:hover{color:var(--ink,#0f172a);text-decoration:underline}
 .nt-start{margin-left:12px;vertical-align:middle;display:inline-flex;align-items:center;gap:6px;border-radius:999px!important;padding:7px 14px!important;font-weight:700}
 .copy-box{position:relative}.copy-box>.copy-btn{position:absolute;top:6px;right:6px;z-index:2;border-radius:7px;border:1px solid var(--border,#d0d7e2);background:var(--card,#fff);color:var(--ink,#0f172a);font:600 12px "Maven Pro";padding:4px 9px;cursor:pointer;opacity:.9}.copy-box>.copy-btn:hover{opacity:1;border-color:var(--primary,#0032fd)}`;
 const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
 let i=0,els=null;
 const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>4&&r.height>4&&getComputedStyle(e).visibility!=='hidden';};
 function close(){if(els){els.veil.remove();els.hole.remove();els.pop.remove();els=null;}window.removeEventListener('resize',place);document.removeEventListener('keydown',key);}
 function key(e){if(!els)return;if(e.key==='Escape')close();else if(e.key==='ArrowRight')go(1);else if(e.key==='ArrowLeft')go(-1);}
 function place(){if(!els)return;const s=STEPS[i],t=[s.s,s.alt].map(q=>q&&document.querySelector(q)).find(visible),pop=els.pop,pad=8,W=innerWidth,Hh=innerHeight;
  if(!t){els.hole.style.display='none';els.veil.classList.remove('hole');pop.style.left=Math.max(16,(W-pop.offsetWidth)/2)+'px';pop.style.top=Math.max(16,(Hh-pop.offsetHeight)/2)+'px';return;}
  const r0=t.getBoundingClientRect();if(r0.top<70||r0.bottom>Hh-20){t.scrollIntoView({block:'center',behavior:'instant'});}
  const r=t.getBoundingClientRect();els.veil.classList.add('hole');Object.assign(els.hole.style,{display:'block',left:(r.left-pad)+'px',top:(r.top-pad)+'px',width:(r.width+pad*2)+'px',height:(Math.min(r.height,Hh*.6)+pad*2)+'px'});
  const pw=pop.offsetWidth,ph=pop.offsetHeight,below=r.top+Math.min(r.height,Hh*.6)+pad+12;let top=below+ph<Hh-12?below:r.top-pad-12-ph;if(top<12)top=Math.max(12,(Hh-ph)/2);
  pop.style.top=top+'px';pop.style.left=Math.min(W-pw-16,Math.max(16,r.left+r.width/2-pw/2))+'px';}
 function render(){const s=STEPS[i],last=i===STEPS.length-1;
  els.pop.innerHTML=`<div class="nt-top"><span>Step ${i+1} of ${STEPS.length}</span><button class="nt-x" aria-label="Close">×</button></div><h3>${s.t}</h3><p>${s.b}</p>
  <div class="nt-nav">${i?'<button class="nt-back">Back</button>':''}<button class="nt-next">${last?'Finish':'Next'}</button></div>
  <div class="nt-foot"><label>Snooze <select class="nt-snooze"><option value="">Choose…</option><option value="3600000">1 hour</option><option value="86400000">1 day</option><option value="604800000">1 week</option></select></label><button class="nt-never">Don't show me again</button></div>`;
  els.pop.querySelector('.nt-x').onclick=()=>{put('snooze',Date.now()+36e5);close();};
  els.pop.querySelector('.nt-next').onclick=()=>go(1);const b=els.pop.querySelector('.nt-back');if(b)b.onclick=()=>go(-1);
  els.pop.querySelector('.nt-snooze').onchange=e=>{if(!e.target.value)return;put('snooze',Date.now()+Number(e.target.value));close();window.toast?.('Tour snoozed. Show me around brings it back.');};
  els.pop.querySelector('.nt-never').onclick=()=>{put('never',1);close();window.toast?.('The tour will not open by itself again. Show me around on the home page still starts it.');};
  requestAnimationFrame(place);}
 function go(n){i+=n;if(i>=STEPS.length){put('done',1);close();return;}if(i<0)i=0;render();}
 function start(){close();i=0;const veil=document.createElement('div'),hole=document.createElement('div'),pop=document.createElement('div');veil.className='nt-veil';hole.className='nt-hole';pop.className='nt-pop';pop.setAttribute('role','dialog');pop.setAttribute('aria-modal','true');
  veil.onclick=()=>{};document.body.append(veil,hole,pop);els={veil,hole,pop};render();window.addEventListener('resize',place);document.addEventListener('keydown',key);}
 window.netopsTour={start,reset:()=>{put('never',null);put('snooze',null);put('done',null);}};
 const due=()=>!get('never')&&!get('done')&&!(Number(get('snooze'))>Date.now());
 // Home page: add the Show me around button and start once by itself.
 let tried=false;
 function onDash(){const g=document.getElementById('kd-greeting');if(!g)return;const host=g.parentElement;
  if(host&&!host.querySelector('.nt-start')){const b=document.createElement('button');b.type='button';b.className='button secondary nt-start';b.textContent='Show me around';b.onclick=start;host.appendChild(b);}
  if(!tried&&due()){tried=true;setTimeout(()=>{if(document.getElementById('kd-kpis')&&!els)start();},900);}}
 // Copy buttons on code and script boxes (pre and read-only textareas), in pages and dialogs.
 function copies(root){for(const box of root.querySelectorAll('pre, textarea[readonly]')){if(box.closest('.copy-box')||box.dataset.noCopy!==undefined||box.textContent.trim().length<8&&!box.value)continue;
  const wrap=document.createElement('div');wrap.className='copy-box';box.parentNode.insertBefore(wrap,box);wrap.appendChild(box);const c=document.createElement('button');c.type='button';c.className='copy-btn';c.textContent='Copy';
  c.onclick=()=>{const text=box.value??box.textContent;(navigator.clipboard?.writeText(text)||Promise.reject()).then(()=>{c.textContent='Copied';setTimeout(()=>c.textContent='Copy',1500);},()=>{const r=document.createRange();r.selectNodeContents(box);const s=getSelection();s.removeAllRanges();s.addRange(r);window.toast?.('Selected: press Copy on your keyboard');});};wrap.appendChild(c);}}
 let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;onDash();copies(document);});}).observe(document.body,{childList:true,subtree:true});
})();
