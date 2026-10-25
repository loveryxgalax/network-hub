'use strict';
// Captive portal (Spotlight design): buy a hotspot package or renew an account with M-Pesa, then log in through the MikroTik.
// Same API as v1: GET info · POST pay · GET pay/:id?t= · POST login
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const params=new URLSearchParams(location.search);// mac, ip, login, dst, chapId, chapChallenge, error (from the router)
const router={login:params.get('login')||'',dst:params.get('dst')||'',chapId:params.get('chapId')||'',chapChallenge:params.get('chapChallenge')||'',mac:params.get('mac')||''};
let plans=[],selected=null,polling=null,brand='Kade Networks',lastKind='hotspot';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kes=n=>'KES '+Number(n).toLocaleString();

// ---------- Language ----------
const T={
en:{welcome:'Welcome to',intro:'Welcome to our hotspot service! Please select a package to get connected.',promoTitle:'Use our On-the-Go WiFi wherever you are',promoSub:'Affordable packages at our hotspots',
tabCode:'I have a code',tabAccount:'Pay home internet',codeHint:'Already paid? Log in with the code we sent you.',codeLabel:'Wi-Fi code',codePh:'e.g. KN4821',passLabel:'Password',passPh:'Password from your SMS',connect:'Connect',
accHint:'Renew your home internet with M-Pesa.',accLabel:'account number',accPh:'Your account username',mpesaLabel:'M-Pesa number',payAcc:'Pay with M-Pesa',accNote:"We'll send a prompt to your phone for the amount due on your plan.",
pkgTitle:'On-the-Go WiFi',pkgSub:'Connect at any of our hotspots. Tap a package to buy it.',helpTitle:'Need a hand?',helpSub:'Our team is here to help you get connected.',
youPicked:'You picked',payBuy:'Pay with M-Pesa',buyNote:"You'll get a prompt on your phone. Enter your M-Pesa PIN to pay.",
upTo:'up to {n} Mbps',devices:'{n} devices',device:'1 device',noPlans:'No packages are on sale right now.',loadFail:'Could not load packages. Refresh the page.',
noMpesa:'M-Pesa payments are not available yet. If you have a code, use “I have a code”.',choose:'Choose a package first',
checkPhone:'Check your phone',sending:'Sending the M-Pesa prompt…',enterPin:'Enter your M-Pesa PIN to pay {a}.',stillWaiting:'Still waiting for M-Pesa… this can take a minute.',notCompleted:'Payment was not completed.',
paid:'Payment received',accActive:'Account <strong>{u}</strong> is active until <strong>{d}</strong>.',restart:'If you are not online within a minute, restart your router.',
wifiActive:'Your Wi-Fi is active until <strong>{d}</strong>. Save these to log in on another device:',code:'Code',password:'Password',connecting:'Connecting you now…',
joinWifi:'Join the {b} Wi-Fi and log in with this code.',useCode:'Log in with this code',back:'Back to packages',valid:'This code is valid. Join the {b} Wi-Fi to use it.',
call:'Call us',whatsapp:'Chat on WhatsApp',connectingBtn:'Connecting…'},
sw:{welcome:'Karibu',intro:'Karibu kwenye huduma yetu ya hotspot! Chagua kifurushi ili uunganishwe.',promoTitle:'Tumia WiFi yetu popote ulipo',promoSub:'Vifurushi nafuu kwenye hotspot zetu',
tabCode:'Nina msimbo',tabAccount:'Lipia intaneti ya nyumbani',codeHint:'Umeshalipa? Ingia kwa msimbo tuliokutumia.',codeLabel:'Msimbo wa Wi-Fi',codePh:'mf. KN4821',passLabel:'Nenosiri',passPh:'Nenosiri kutoka kwa SMS',connect:'Unganisha',
accHint:'Lipia intaneti ya nyumbani kwa M-Pesa.',accLabel:'nambari ya akaunti',accPh:'Jina la akaunti yako',mpesaLabel:'Nambari ya M-Pesa',payAcc:'Lipa kwa M-Pesa',accNote:'Tutatuma ombi kwenye simu yako kwa kiasi cha kifurushi chako.',
pkgTitle:'WiFi Popote',pkgSub:'Unganisha kwenye hotspot zetu zozote. Gusa kifurushi kukinunua.',helpTitle:'Unahitaji msaada?',helpSub:'Timu yetu iko tayari kukusaidia kuunganishwa.',
youPicked:'Umechagua',payBuy:'Lipa kwa M-Pesa',buyNote:'Utapokea ombi kwenye simu. Weka PIN yako ya M-Pesa kulipa.',
upTo:'hadi Mbps {n}',devices:'vifaa {n}',device:'kifaa 1',noPlans:'Hakuna vifurushi kwa sasa.',loadFail:'Imeshindwa kupakia vifurushi. Onyesha upya ukurasa.',
noMpesa:'Malipo ya M-Pesa bado hayapatikani. Kama una msimbo, tumia “Nina msimbo”.',choose:'Chagua kifurushi kwanza',
checkPhone:'Angalia simu yako',sending:'Tunatuma ombi la M-Pesa…',enterPin:'Weka PIN yako ya M-Pesa kulipa {a}.',stillWaiting:'Bado tunasubiri M-Pesa… inaweza kuchukua dakika moja.',notCompleted:'Malipo hayakukamilika.',
paid:'Malipo yamepokelewa',accActive:'Akaunti <strong>{u}</strong> iko hai hadi <strong>{d}</strong>.',restart:'Usipounganishwa ndani ya dakika moja, zima na uwashe router yako.',
wifiActive:'Wi-Fi yako iko hai hadi <strong>{d}</strong>. Hifadhi hizi uingie kwenye kifaa kingine:',code:'Msimbo',password:'Nenosiri',connecting:'Tunakuunganisha sasa…',
joinWifi:'Jiunge na Wi-Fi ya {b} na uingie kwa msimbo huu.',useCode:'Ingia kwa msimbo huu',back:'Rudi kwa vifurushi',valid:'Msimbo huu ni sahihi. Jiunge na Wi-Fi ya {b} kuutumia.',
call:'Tupigie',whatsapp:'Ongea nasi WhatsApp',connectingBtn:'Inaunganisha…'}};
let lang='en';
try{const s=localStorage.getItem('portal-lang');if(s&&T[s])lang=s;}catch{}
const t=(k,vars={})=>(T[lang][k]??T.en[k]??k).replace(/\{(\w+)\}/g,(_,v)=>vars[v]??'');
function applyLang(){
  document.documentElement.lang=lang;
  for(const el of $$('[data-i18n]'))el.textContent=t(el.dataset.i18n);
  for(const el of $$('[data-i18n-ph]'))el.placeholder=t(el.dataset.i18nPh);
  for(const b of $$('[data-lang]'))b.classList.toggle('active',b.dataset.lang===lang);
  renderPlans();renderSupport();
}

// ---------- API ----------
async function call(path,options={}){const r=await fetch('/portal/api/'+path,{...options,headers:{'Content-Type':'application/json'}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Something went wrong. Try again.');return data;}

// ---------- UI helpers ----------
function alertBox(text,ok=false){const el=$('#portal-alert');el.textContent=text;el.classList.toggle('ok',ok);el.hidden=!text;if(text)el.scrollIntoView({block:'center',behavior:'smooth'});}
function show(panel){
  if(panel==='buy'){$('#packages').scrollIntoView({behavior:'smooth'});return;}
  for(const s of $$('[data-panel]'))s.hidden=s.dataset.panel!==panel;
  for(const b of $$('[data-tab]'))b.classList.toggle('active',b.dataset.tab===panel);
}
function busy(state){$('#portal-wait').hidden=!state;if(state){closeSheet();$('#portal-done').hidden=true;}document.body.style.overflow=state?'hidden':'';}
function done(html){busy(false);$('#done-card').innerHTML=html;$('#portal-done').hidden=false;document.body.style.overflow='hidden';
  const back=$('#done-back');if(back)back.onclick=()=>{$('#portal-done').hidden=true;document.body.style.overflow='';};}
function fail(kind,message){busy(false);$('#portal-done').hidden=true;if(kind==='account')show('account');else if(selected)openSheet(selected);alertBox(message);}

const planMeta=p=>[p.duration,t('upTo',{n:p.downloadMbps}),p.devices>1?t('devices',{n:p.devices}):null].filter(Boolean);
function renderPlans(){
  const grid=$('#portal-plans');if(!grid||grid.dataset.state==='loading')return;
  if(grid.dataset.state==='error'){grid.innerHTML=`<p class="muted">${esc(t('loadFail'))}</p>`;return;}
  grid.innerHTML=plans.length?plans.map(p=>`<button type="button" class="plan" data-plan="${esc(p.id)}" aria-label="${esc(p.name+', '+kes(p.price)+', '+p.duration)}"><span class="p-name" title="${esc(p.name)}">${esc(p.name)}</span><span class="p-price">${kes(p.price)}</span><span class="p-meta"><span class="chip">${esc(p.duration)}</span>${p.devices>1?`<span class="chip">${esc(t('devices',{n:p.devices}))}</span>`:''}</span></button>`).join(''):`<p class="muted">${esc(t('noPlans'))}</p>`;
  for(const b of $$('[data-plan]'))b.onclick=()=>openSheet(b.dataset.plan);
}
function renderSupport(){
  const box=$('#portal-support');if(!box)return;
  const s=box.dataset.support||'';
  const items=[];
  if(s){
    const digits=s.replace(/\D/g,'');const intl=digits.startsWith('0')?'254'+digits.slice(1):digits;
    items.push(`<a class="help-item" href="tel:${esc(s.replace(/\s/g,''))}"><span class="help-icon"><svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg></span><span>${esc(t('call'))} · ${esc(s)}</span><span class="help-arrow">→</span></a>`);
    items.push(`<a class="help-item" href="https://wa.me/${esc(intl)}" target="_blank" rel="noopener"><span class="help-icon"><svg viewBox="0 0 24 24"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z" class="fill"/></svg></span><span>${esc(t('whatsapp'))}</span><span class="help-arrow">→</span></a>`);
  }
  items.push(`<a class="help-item" href="mailto:info@kadenetworks.com"><span class="help-icon"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg></span><span>info@kadenetworks.com</span><span class="help-arrow">→</span></a>`);
  box.innerHTML=items.join('');
}

// ---------- Buy sheet ----------
function openSheet(id){
  const p=plans.find(x=>x.id===id);if(!p)return;selected=id;
  $('#sheet-name').textContent=p.name;$('#sheet-price').textContent=kes(p.price);
  $('#sheet-facts').innerHTML=[p.duration,t('upTo',{n:p.downloadMbps}),p.devices>1?t('devices',{n:p.devices}):t('device')].map(f=>`<li>${esc(f)}</li>`).join('');
  $('#sheet').hidden=false;document.body.style.overflow='hidden';
  setTimeout(()=>{const i=$('#buy-form input[name=phone]');if(i&&!i.value)i.focus();},260);
}
function closeSheet(){$('#sheet').hidden=true;if($('#portal-wait').hidden&&$('#portal-done').hidden)document.body.style.overflow='';}

// ---------- Router login ----------
// A top-level GET to the router's login page (works from this HTTPS page; forms to HTTP would warn).
async function routerLogin(username,password){
  if(!router.login)return false;
  const r=await call('login',{method:'POST',body:JSON.stringify({username,password,chapId:router.chapId,chapChallenge:router.chapChallenge})});
  const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});
  location.href=router.login+(router.login.includes('?')?'&':'?')+q;return true;
}

// ---------- Payments ----------
async function pay(input){
  alertBox('');lastKind=input.kind;busy(true);$('#wait-title').textContent=t('checkPhone');$('#wait-text').textContent=t('sending');
  try{const start=await call('pay',{method:'POST',body:JSON.stringify({...input,mac:router.mac})});$('#wait-text').textContent=t('enterPin',{a:kes(start.amount)});poll(start.id,start.token,Date.now());}
  catch(error){fail(input.kind,error.message);}
}
function poll(id,token,started){clearTimeout(polling);polling=setTimeout(async()=>{
  try{
    const s=await call('pay/'+id+'?t='+encodeURIComponent(token));
    if(s.status==='pending'){if(Date.now()-started>40000)$('#wait-text').textContent=t('stillWaiting');return poll(id,token,started);}
    if(s.status==='failed')return fail(s.kind||lastKind,s.reason||t('notCompleted'));
    const until=s.expiresAt?new Date(s.expiresAt).toLocaleString('en-KE',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';
    const tick='<div class="pulse ok"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>';
    if(s.kind==='account')return done(`${tick}<h2>${esc(t('paid'))}</h2><p>${t('accActive',{u:esc(s.username),d:esc(until)})}</p><p class="muted small">${esc(t('restart'))}</p><button type="button" class="btn ghost" id="done-back">OK</button>`);
    done(`${tick}<h2>${esc(t('paid'))}</h2><p>${t('wifiActive',{d:esc(until)})}</p><dl class="code-box"><div><dt>${esc(t('code'))}</dt><dd>${esc(s.username)}</dd></div><div><dt>${esc(t('password'))}</dt><dd>${esc(s.password)}</dd></div></dl><p class="muted small" id="connecting">${esc(router.login?t('connecting'):t('joinWifi',{b:brand}))}</p>${router.login?'':`<button type="button" class="btn ghost" id="done-back">${esc(t('back'))}</button>`}`);
    if(router.login)await routerLogin(s.username,s.password).catch(e=>{$('#connecting').textContent=e.message;});
    else{const f=$('#code-form');f.username.value=s.username;f.password.value=s.password;}
  }catch(error){if(Date.now()-started<240000)return poll(id,token,started);fail(lastKind,error.message);}
},3000);}

// ---------- Init ----------
async function init(){
  $('#year').textContent=new Date().getFullYear();
  for(const b of $$('[data-tab]'))b.onclick=()=>{alertBox('');show(b.dataset.tab);};
  for(const b of $$('[data-lang]'))b.onclick=()=>{lang=b.dataset.lang;try{localStorage.setItem('portal-lang',lang);}catch{}applyLang();};
  $('#sheet-close').onclick=closeSheet;
  $('#sheet').onclick=e=>{if(e.target.id==='sheet')closeSheet();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#sheet').hidden)closeSheet();});
  $('#portal-plans').dataset.state='loading';
  applyLang();
  const tab=params.get('tab');if(['buy','code','account'].includes(tab))setTimeout(()=>show(tab),50);
  const err=params.get('error');if(err)alertBox(err);
  try{
    const info=await call('info');brand=info.name||brand;document.title=brand+' Wi-Fi';
    for(const el of $$('#portal-name,.js-name'))el.textContent=brand;
    plans=info.plans||[];$('#portal-plans').dataset.state='ok';
    if(info.support)$('#portal-support').dataset.support=info.support;
    applyLang();
    if(!info.mpesa)alertBox(t('noMpesa'));
  }catch{$('#portal-plans').dataset.state='error';renderPlans();}
  $('#buy-form').onsubmit=e=>{e.preventDefault();if(!selected)return alertBox(t('choose'));pay({kind:'hotspot',planId:selected,phone:e.target.phone.value});};
  $('#account-form').onsubmit=e=>{e.preventDefault();pay({kind:'account',username:e.target.username.value.trim(),phone:e.target.phone.value});};
  $('#code-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;alertBox('');
    try{const u=e.target.username.value.trim(),p=e.target.password.value;
      if(!router.login){await call('login',{method:'POST',body:JSON.stringify({username:u,password:p})});alertBox(t('valid',{b:brand}),true);}
      else await routerLogin(u,p);}
    catch(error){alertBox(error.message);}finally{btn.disabled=false;}};
}
init();
