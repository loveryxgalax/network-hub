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
 // Dashboard settings (like ISPman's): theme, display style and menu style, saved for this person on this browser.
 // Fonts for the whole dashboard (files served from netops; Maven Pro stays the default).
 const FONTS=[['Maven Pro','Maven Pro'],['Google Sans','Google Sans'],['Google Sans Flex','Google Sans Flex'],['Inter','Inter'],['Open Sans','Open Sans'],['Bricolage Grotesque','Bricolage Grotesque'],['Poppins','Poppins'],['Roboto','Roboto'],['Nunito','Nunito'],['DM Sans','DM Sans'],['Plus Jakarta Sans','Plus Jakarta Sans'],['Manrope','Manrope'],['Montserrat','Montserrat'],['Rubik','Rubik'],['Work Sans','Work Sans'],['IBM Plex Sans','IBM Plex Sans'],['Lato','Lato'],['Outfit','Outfit'],['Figtree','Figtree'],['system','System font (system-ui)'],['serif','Serif']];
 function fontApply(f){let st=document.getElementById('ds-font');if(!f||f==='Maven Pro'){if(st)st.remove();return;}
  if(!document.getElementById('ds-font-faces')&&f!=='system'&&f!=='serif'){const l=document.createElement('link');l.id='ds-font-faces';l.rel='stylesheet';l.href='/fonts-extra.css?v=1';document.head.appendChild(l);}
  const fam=f==='system'?'system-ui,-apple-system,"Segoe UI",sans-serif':f==='serif'?'Georgia,"Times New Roman",serif':`"${f}",system-ui,sans-serif`;
  if(!st){st=document.createElement('style');st.id='ds-font';document.head.appendChild(st);}st.textContent=`html body,html body *:not(svg):not(svg *):not(code):not(pre):not(kbd){font-family:${fam}!important}`;}
 const DS={theme:[['light','Light'],['dark','Dark'],['system','System']],display:[['classic','Classic'],['minimal','Minimal'],['compact','Compact']],nav:[['classic','Classic'],['soft','Soft'],['midnight','Midnight']]};
 const dsGet=()=>{try{return JSON.parse(localStorage.getItem('dash-settings:'+who())||'{}');}catch{return {};}};
 function dsApply(){const s=dsGet(),h=document.documentElement;h.classList.remove('ds-minimal','ds-compact','nav-soft','nav-midnight');if(s.display&&s.display!=='classic')h.classList.add('ds-'+s.display);if(s.nav&&s.nav!=='classic')h.classList.add('nav-'+s.nav);
  if(s.theme==='system')h.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';fontApply(s.font);}
 function dsOpen(){let d=document.getElementById('ds-dlg');if(d)d.remove();d=document.createElement('dialog');d.id='ds-dlg';d.className='ds-dlg';
  const s=dsGet(),cur={theme:s.theme||(document.documentElement.dataset.theme==='dark'?'dark':'light'),display:s.display||'classic',nav:s.nav||'classic'};
  const seg=(k,title,sub)=>`<h4>${title}</h4><p class="ds-sub">${sub}</p><div class="ds-seg">${DS[k].map(([v,l])=>`<button type="button" data-k="${k}" data-v="${v}" aria-pressed="${cur[k]===v}">${l}</button>`).join('')}</div>`;
  d.innerHTML=`<div class="ds-in"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Dashboard settings</h3><button type="button" class="nt-x" data-close aria-label="Close" style="border:0;background:none;font-size:22px;cursor:pointer;color:inherit">×</button></div><p class="ds-sub">Make this dashboard yours.</p>
   ${seg('theme','APPEARANCE','Theme for this browser')}${seg('display','DISPLAY STYLE','How tiles and cards are drawn')}${seg('nav','NAVIGATION','How the left side menu is drawn')}<h4>FONT</h4><p class="ds-sub">Typeface for the whole dashboard</p><select class="ds-font" data-font aria-label="Font">${FONTS.map(([v,l])=>`<option value="${v}" ${(s.font||'Maven Pro')===v?'selected':''} style="font-family:${v==='system'?'system-ui':v==='serif'?'Georgia':'&quot;'+v+'&quot;'}">${l}</option>`).join('')}</select>
   <div class="ds-foot"><span>Saved on this browser for you.</span><button type="button" class="button secondary" data-reset>Reset</button></div></div>`;
  document.body.appendChild(d);d.showModal();d.querySelector('[data-font]').onchange=e=>{const n={...dsGet(),font:e.target.value};try{localStorage.setItem('dash-settings:'+who(),JSON.stringify(n));}catch{}fontApply(n.font);};d.onclick=e=>{if(e.target===d||e.target.closest('[data-close]'))d.close();
   const b=e.target.closest('[data-k]');if(b){const n={...dsGet(),[b.dataset.k]:b.dataset.v};try{localStorage.setItem('dash-settings:'+who(),JSON.stringify(n));}catch{}
    if(b.dataset.k==='theme'&&b.dataset.v!=='system'){document.documentElement.dataset.theme=b.dataset.v;try{localStorage.setItem('network-hub-theme',b.dataset.v);}catch{}}
    dsApply();for(const x of d.querySelectorAll(`[data-k="${b.dataset.k}"]`))x.setAttribute('aria-pressed',x===b);}
   if(e.target.closest('[data-reset]')){try{localStorage.removeItem('dash-settings:'+who());}catch{}dsApply();d.close();window.toast?.('Dashboard settings reset');}};}
 function dsButton(){const t=document.getElementById('theme-toggle');if(!t||document.getElementById('ds-gear'))return;const b=t.cloneNode(false);b.id='ds-gear';b.className=t.className+' ds-gear';b.setAttribute('aria-label','Dashboard settings');b.title='Dashboard settings';
  b.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  b.onclick=e=>{e.preventDefault();e.stopPropagation();dsOpen();};t.parentNode.insertBefore(b,t);}
 window.netopsDashSettings={open:dsOpen,apply:dsApply};
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
 dsApply();let lastWho='';setInterval(()=>{const w=who();if(w!==lastWho){lastWho=w;dsApply();}},2000);
 let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;onDash();copies(document);dsButton();});}).observe(document.body,{childList:true,subtree:true});
})();
