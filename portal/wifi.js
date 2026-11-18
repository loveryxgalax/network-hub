'use strict';
// Kade Networks WiFi portal, laid out like the ISPman captive portal. It uses the same /portal/api endpoints as the
// previous portal (kept for reference at /portal/legacy/index.html), so payments, vouchers, M-Pesa codes, one-tap
// connect, loyalty and usage keep their tested server-side rules. Logins are only ever sent to the router as a CHAP answer.
(()=>{
const $=s=>document.querySelector(s),params=new URLSearchParams(location.search);
const META=n=>document.querySelector('meta[name="'+n+'"]')?.content||'',BASE=META('portal-base'),PASS=META('portal-pass');let MODE=META('portal-mode');
const ADM=!!params.get('viewas');
const router={login:params.get('login')||'',dst:params.get('dst')||'',chapId:params.get('chapId')||'',chapChallenge:params.get('chapChallenge')||'',mac:params.get('mac')||'',nas:params.get('nas')||''};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kes=n=>'Ksh.'+Number(n||0).toLocaleString('en-KE',{maximumFractionDigits:2});
const bytes=b=>{b=Number(b)||0;return b>=1073741824?(b/1073741824).toFixed(2)+' GB':b>=1048576?(b/1048576).toFixed(1)+' MB':Math.round(b/1024)+' KB';};
const DTK='portal-dt',getDT=()=>{if(ADM)return params.get('pv')||'';try{return localStorage.getItem(DTK)||'';}catch{return '';}},setDT=v=>{if(v&&!ADM)try{localStorage.setItem(DTK,v);}catch{}};

/* ---------- words (English / Kiswahili) ---------- */
const W={en:{needHelp:'Need help?',loyalty:'Loyalty Points Balance',pts:'pts',redeem:'Redeem',welcome:'Welcome to our Hotspot Service!',paidHint:'If you already paid just click the package paid for to auto connect.',useVoucher:'Use Voucher',mpesaCode:'Connect with M-PESA code.',myUsage:'My Usage',myUsageSub:'Data used, payments and subscription history.',terms:'Terms',findTitle:'Find my account',findPh:'Account number or phone',find:'Find',homeWelcome:'Home Internet',homeHint:'Enter your account number or phone number to see your account and pay.',homePkgs:'Home internet packages',
 unlimited:'Unlimited',valid:'Valid for {d}.',devices:'Connect up to {n} devices',upTo:'Up to {n} Mbps',popular:'POPULAR',active:'You have an active connection!',pkg:'Package',expires:'Expires in {t}',auto:'You will be connected automatically in',connectNow:'Connect Now',viewAll:'View All Packages',stay:'Stay here',
 buy:'Buy {p}',phone:'M-Pesa phone number',pay:'Pay {a}',payNote:'You will get an M-Pesa prompt on this phone. Enter your PIN to pay.',sending:'Sending the payment request…',checkPhone:'Check your phone',enterPin:'Enter your M-Pesa PIN to pay {a}.',stillWaiting:'Still waiting for M-Pesa. Keep this page open.',paid:'Payment received',connecting:'Connecting you now…',joinWifi:'Connect to the {b} WiFi and use these details to log in.',code:'Username',password:'Password',ok:'OK',
 voucherT:'Use voucher',voucherS:'Enter the voucher code you bought.',voucherPh:'Voucher code',codeT:'Connect with M-PESA code',codeS:'Enter the M-Pesa confirmation code from the SMS, like UK3IF0TW26.',codePh:'M-Pesa code',go:'Connect',needWifi:'Join our WiFi first, then open this page again and tap Connect.',
 trial:'Try free for {n} minutes',free:'Free WiFi is on',freeBtn:'Connect free',freeUntil:'Until {t}',
 usageT:'My usage',overview:'Overview',payments:'Payments',history:'History',last30:'Last 30 days',total:'All time',down:'Downloaded',up:'Uploaded',wallet:'Wallet',none:'Nothing yet.',noUsage:'We could not find your account on this device. Connect with a package, voucher or M-Pesa code first.',reversed:'Reversed',activeNow:'active',expired:'expired',
 redeemed:'Points turned into KSh {n} wallet credit.',notFound:'We could not find that account.',lockedT:'Confirm it is you',lockedS:'Enter the phone number on this account ({h}).',wrongPhone:'That phone number does not match.',statusL:'Status',planL:'Package',expiresL:'Expires',openAcct:'Open my account',
 msgT:'Message us',msgName:'Your name',msgPhone:'Phone number',msgText:'Your message',send:'Send',msgDone:'Thank you. We will get back to you.',adm:'Admin preview as {u}. You are not on the hotspot WiFi, so connecting is off.',err:'Something went wrong. Try again.',maint:'Planned maintenance'},
 sw:{needHelp:'Unahitaji msaada?',loyalty:'Salio la Pointi',pts:'pointi',redeem:'Tumia',welcome:'Karibu kwenye huduma yetu ya Hotspot!',paidHint:'Kama tayari umelipa, bofya kifurushi ulicholipia ili kuunganishwa.',useVoucher:'Tumia Vocha',mpesaCode:'Unganisha kwa msimbo wa M-PESA.',myUsage:'Matumizi Yangu',myUsageSub:'Data uliyotumia, malipo na historia ya vifurushi.',terms:'Masharti',findTitle:'Tafuta akaunti yangu',findPh:'Namba ya akaunti au simu',find:'Tafuta',homeWelcome:'Intaneti ya Nyumbani',homeHint:'Weka namba ya akaunti au simu ili kuona akaunti yako na kulipa.',homePkgs:'Vifurushi vya intaneti ya nyumbani',
 unlimited:'Bila kikomo',valid:'Kinadumu {d}.',devices:'Unganisha hadi vifaa {n}',upTo:'Hadi Mbps {n}',popular:'MAARUFU',active:'Una muunganisho unaoendelea!',pkg:'Kifurushi',expires:'Kinaisha baada ya {t}',auto:'Utaunganishwa kiotomatiki baada ya',connectNow:'Unganisha Sasa',viewAll:'Tazama Vifurushi Vyote',stay:'Baki hapa',
 buy:'Nunua {p}',phone:'Namba ya simu ya M-Pesa',pay:'Lipa {a}',payNote:'Utapokea ombi la M-Pesa kwenye simu hii. Weka PIN yako kulipa.',sending:'Tunatuma ombi la malipo…',checkPhone:'Angalia simu yako',enterPin:'Weka PIN ya M-Pesa kulipa {a}.',stillWaiting:'Bado tunasubiri M-Pesa. Usifunge ukurasa huu.',paid:'Malipo yamepokelewa',connecting:'Tunakuunganisha sasa…',joinWifi:'Jiunge na WiFi ya {b} na utumie maelezo haya kuingia.',code:'Jina la mtumiaji',password:'Nenosiri',ok:'Sawa',
 voucherT:'Tumia vocha',voucherS:'Weka msimbo wa vocha uliyonunua.',voucherPh:'Msimbo wa vocha',codeT:'Unganisha kwa msimbo wa M-PESA',codeS:'Weka msimbo wa uthibitisho wa M-Pesa kutoka kwenye SMS, mfano UK3IF0TW26.',codePh:'Msimbo wa M-Pesa',go:'Unganisha',needWifi:'Jiunge na WiFi yetu kwanza, kisha fungua ukurasa huu tena na ubofye Unganisha.',
 trial:'Jaribu bure kwa dakika {n}',free:'WiFi ya bure imewashwa',freeBtn:'Unganisha bure',freeUntil:'Hadi {t}',
 usageT:'Matumizi yangu',overview:'Muhtasari',payments:'Malipo',history:'Historia',last30:'Siku 30 zilizopita',total:'Jumla',down:'Iliyopakuliwa',up:'Iliyopakiwa',wallet:'Pochi',none:'Hakuna bado.',noUsage:'Hatukupata akaunti yako kwenye kifaa hiki. Unganisha kwa kifurushi, vocha au msimbo wa M-Pesa kwanza.',reversed:'Imerudishwa',activeNow:'kinaendelea',expired:'kimeisha',
 redeemed:'Pointi zimekuwa salio la KSh {n} kwenye pochi.',notFound:'Hatukupata akaunti hiyo.',lockedT:'Thibitisha ni wewe',lockedS:'Weka namba ya simu iliyo kwenye akaunti hii ({h}).',wrongPhone:'Namba hiyo haifanani.',statusL:'Hali',planL:'Kifurushi',expiresL:'Inaisha',openAcct:'Fungua akaunti yangu',
 msgT:'Tutumie ujumbe',msgName:'Jina lako',msgPhone:'Namba ya simu',msgText:'Ujumbe wako',send:'Tuma',msgDone:'Asante. Tutawasiliana nawe.',adm:'Hakikisho la admin kama {u}. Hauko kwenye WiFi, kwa hivyo kuunganisha kumezimwa.',err:'Kuna tatizo. Jaribu tena.',maint:'Matengenezo yaliyopangwa'}};
let LANG='en';try{const s=localStorage.getItem('portal-lang');if(W[s])LANG=s;}catch{}
const t=(k,v={})=>String((W[LANG]||W.en)[k]??W.en[k]??k).replace(/\{(\w+)\}/g,(_,x)=>v[x]??'');
function translate(){for(const el of document.querySelectorAll('[data-t]'))el.textContent=t(el.dataset.t);for(const el of document.querySelectorAll('[data-ph]'))el.placeholder=t(el.dataset.ph);
 document.documentElement.lang=LANG;for(const b of document.querySelectorAll('[data-lang]'))b.classList.toggle('on',b.dataset.lang===LANG);}

/* ---------- server ---------- */
async function call(path,opt={}){
 let body=opt.body;if(body&&typeof body!=='string'){body=JSON.stringify({...body,dt:getDT()});}
 const dev=router.mac&&!/[?&]mac=/.test(path)?(path.includes('?')?'&':'?')+'d='+encodeURIComponent(router.mac):'';
 const r=await fetch(BASE+'/portal/api/'+path+dev,{method:opt.method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(PASS?{'X-Portal-Pass':PASS}:{})},...(body?{body}:{})});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(data.error||t('err')),{data});
 if(data&&data.dt)setDT(data.dt);return data;}
const presenceTab=Math.random().toString(36).slice(2,10);let presenceTimer=null,presencePage='Packages';
function here(page){if(page)presencePage=page;if(params.get('admin')||params.get('frame')||ADM)return;
 fetch(BASE+'/portal/api/presence',{method:'POST',headers:{'Content-Type':'application/json',...(PASS?{'X-Portal-Pass':PASS}:{})},body:JSON.stringify({page:presencePage,service:MODE==='pppoe'?'pppoe':'hotspot',mac:router.mac,nas:router.nas,tab:presenceTab}),keepalive:true}).catch(()=>{});
 clearTimeout(presenceTimer);presenceTimer=setTimeout(()=>{if(!document.hidden)here();},10000);}

/* ---------- small UI helpers ---------- */
function alertBox(text,ok=false){const a=$('#alert');a.textContent=text||'';a.classList.toggle('ok',ok);a.hidden=!text;if(text)a.scrollIntoView({block:'center',behavior:'smooth'});}
const ICON={phone:'<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',wa:'<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>',check:'<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>'};
let sheetClose=null;
function sheet(html,onClose){$('#sheet-body').innerHTML=html;$('#sheet').hidden=false;sheetClose=onClose||null;const f=$('#sheet-body input');if(f)setTimeout(()=>f.focus(),60);}
function closeSheet(){$('#sheet').hidden=true;$('#sheet-body').innerHTML='';if(sheetClose){const f=sheetClose;sheetClose=null;f();}}
$('#sheet-x').onclick=closeSheet;$('#sheet').onclick=e=>{if(e.target.id==='sheet')closeSheet();};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#sheet').hidden)closeSheet();});
function leftText(ms){if(ms==null)return '';const m=Math.max(1,Math.round(ms/60000));if(m<60)return m+(LANG==='sw'?' dakika':m===1?' minute':' minutes');const h=Math.round(m/60);if(h<48)return h+(LANG==='sw'?' saa':h===1?' hour':' hours');const d=Math.round(h/24);return d+(LANG==='sw'?' siku':' days');}
const when=ms=>ms?new Date(ms).toLocaleString(LANG==='sw'?'sw-KE':'en-KE',{dateStyle:'medium',timeStyle:'short'}):'—';

/* ---------- connecting through the router ---------- */
function toRouter(r){if(!router.login)return false;const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});location.href=router.login+(router.login.includes('?')?'&':'?')+q;return true;}
async function routerLogin(username,password){
 if(!router.login)throw new Error(t('needWifi'));
 const r=await call('login',{body:{username,password,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge}});toRouter(r);}
async function join(path,extra={}){if(!router.login)throw new Error(t('needWifi'));
 const r=await call(path,{body:{...extra,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge,nas:router.nas}});
 if(r.alreadyConnected){closeSheet();alertBox(LANG==='sw'?'Umeshaunganishwa.':'You are already connected.',true);return;}toRouter(r);}

/* ---------- state ---------- */
let CFG=null,plans=[],homePlans=[],me=null,activeInfo=null,timer=null;

/* ---------- packages ---------- */
function facts(p,home){const L=[t('unlimited'),t('valid',{d:p.duration})];
 if(CFG.show.speed!==false&&p.downloadMbps)L.push(t('upTo',{n:p.downloadMbps}));
 if(!home&&p.devices>1)L.push(t('devices',{n:p.devices}));
 for(const f of p.features||[])L.push(f);if(p.availability)L.push(p.availability);return L;}
function pkgCard(p,home){const off=p.available===false,cur=activeInfo&&activeInfo.planId===p.id;
 return `<button type="button" class="pkg${off?' off':''}${cur?' cur':''}" data-pkg="${esc(p.id)}" data-home="${home?1:0}" ${off?'disabled':''}><span class="pr">${esc(kes(p.price))}</span>${p.popular?`<span class="pop">★ ${esc(t('popular'))}</span>`:''}<span class="nm">${esc(p.name)}</span><ul>${facts(p,home).map(f=>`<li>${esc(f)}</li>`).join('')}</ul>${cur&&activeInfo.left!=null?`<span class="chip">${esc(t('expires',{t:leftText(activeInfo.left)}))}</span>`:''}</button>`;}
function renderPackages(){
 $('#hotspotPkgs').innerHTML=plans.length?plans.map(p=>pkgCard(p,false)).join(''):`<div class="empty">${LANG==='sw'?'Hakuna vifurushi kwa sasa.':'No packages available right now.'}</div>`;
 $('#pppoePkgs').innerHTML=homePlans.map(p=>pkgCard(p,true)).join('');
 for(const b of document.querySelectorAll('.pkg[data-pkg]'))b.onclick=()=>{const home=b.dataset.home==='1',p=(home?homePlans:plans).find(x=>x.id===b.dataset.pkg);if(p)buySheet(p,home);};}

/* ---------- buying ---------- */
function buySheet(p,home){here('Paying');
 if(home){sheet(`<h2>${esc(p.name)}</h2><div class="price">${esc(kes(p.price))}</div><ul class="list">${facts(p,true).map(f=>`<li>${esc(f)}</li>`).join('')}</ul><p class="muted small">${LANG==='sw'?'Tafuta akaunti yako hapa chini ili kulipa au kubadilisha kifurushi.':'Find your account below to pay or change to this package.'}</p><button class="btn wide" id="go-find">${esc(t('findTitle'))}</button>`);
  $('#go-find').onclick=()=>{closeSheet();$('#find input').focus();};return;}
 if(!CFG.mpesa&&!CFG.paystack){sheet(`<h2>${esc(p.name)}</h2><div class="price">${esc(kes(p.price))}</div><p class="muted">${LANG==='sw'?'Malipo ya mtandaoni hayajawashwa. Tumia vocha au wasiliana nasi.':'Online payment is not switched on. Use a voucher or contact us.'}</p>`);return;}
 let saved='';try{saved=localStorage.getItem('portal-phone')||'';}catch{}
 sheet(`<h2>${esc(t('buy',{p:p.name}))}</h2><div class="price">${esc(kes(p.price))}</div><ul class="list">${facts(p,false).map(f=>`<li>${esc(f)}</li>`).join('')}</ul>
  <form id="pay-form"><label>${esc(t('phone'))}<input class="field" name="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" required value="${esc(saved)}"></label>
  <p class="muted small">${esc(t('payNote'))}</p><p class="err" id="pay-err"></p><button class="btn wide">${esc(t('pay',{a:kes(p.price)}))}</button>
  ${p.trial?`<button type="button" class="btn wide ghost" id="trial">${esc(t('trial',{n:p.trial.minutes}))}</button>`:''}</form>`);
 $('#pay-form').onsubmit=async e=>{e.preventDefault();const phone=e.target.phone.value.trim(),b=e.target.querySelector('.btn');b.disabled=true;$('#pay-err').textContent='';try{localStorage.setItem('portal-phone',phone);}catch{}
  try{const start=await call('pay',{body:{kind:'hotspot',planId:p.id,phone,mac:router.mac}});waitPayment(start,p);}catch(err){b.disabled=false;$('#pay-err').textContent=err.message;}};
 const tr=$('#trial');if(tr)tr.onclick=async()=>{if(!router.login||!router.mac){$('#pay-err').textContent=t('needWifi');return;}tr.disabled=true;try{const r=await call('trial',{body:{planId:p.id,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge}});toRouter(r);}catch(err){tr.disabled=false;$('#pay-err').textContent=err.message;}};}
let polling=null;
function waitPayment(start,p){const started=Date.now();
 sheet(`<div class="wait"><div class="boot-spin"></div><h2>${esc(t('checkPhone'))}</h2><p id="wait-text">${esc(t('enterPin',{a:kes(start.amount??p.price)}))}</p></div>`,()=>{clearTimeout(polling);});
 const tick=async()=>{try{const s=await call('pay/'+encodeURIComponent(start.id)+'?t='+encodeURIComponent(start.token));
   if(s.status==='pending'){if(Date.now()-started>40000){const w=$('#wait-text');if(w)w.textContent=t('stillWaiting');}polling=setTimeout(tick,3000);return;}
   if(s.status==='failed'||s.status==='review'){sheet(`<h2>${esc(LANG==='sw'?'Malipo hayakukamilika':'Payment not completed')}</h2><p>${esc(s.reason||'')}</p><button class="btn wide" id="again">${esc(LANG==='sw'?'Jaribu tena':'Try again')}</button>`);$('#again').onclick=()=>buySheet(p,false);return;}
   const creds=s.username&&s.password?`<dl class="code-box"><dt>${esc(t('code'))}</dt><dd>${esc(s.username)}</dd><dt>${esc(t('password'))}</dt><dd>${esc(s.password)}</dd></dl>`:'';
   sheet(`<div class="wait"><div class="tick">${ICON.check}</div><h2>${esc(t('paid'))}</h2>${creds}<p class="muted" id="conn">${esc(router.login?t('connecting'):t('joinWifi',{b:CFG.brandName}))}</p></div>`);
   if(router.login&&s.username&&s.password)routerLogin(s.username,s.password).catch(err=>{const c=$('#conn');if(c)c.textContent=err.message;});
   else if(router.login&&s.username)join('connect-account',{account:s.username}).catch(err=>{const c=$('#conn');if(c)c.textContent=err.message;});
  }catch(err){if(Date.now()-started<240000){polling=setTimeout(tick,3000);return;}sheet(`<h2>${esc(t('err'))}</h2><p>${esc(err.message)}</p>`);}};
 polling=setTimeout(tick,3000);}

/* ---------- voucher / M-Pesa code ---------- */
function codeSheet(title,sub,ph,go){sheet(`<h2>${esc(title)}</h2><p class="muted">${esc(sub)}</p><form id="code-form"><input class="field" name="code" required maxlength="40" autocapitalize="characters" autocomplete="off" placeholder="${esc(ph)}" style="width:100%;margin-top:8px"><p class="err" id="code-err"></p><button class="btn wide">${esc(t('go'))}</button></form>`);
 $('#code-form').onsubmit=async e=>{e.preventDefault();const v=e.target.code.value.trim(),b=e.target.querySelector('.btn');b.disabled=true;$('#code-err').textContent='';try{if(!router.login)throw new Error(t('needWifi'));await go(v);}catch(err){b.disabled=false;$('#code-err').textContent=err.message;}};}
$('#voucher').onclick=()=>codeSheet(t('voucherT'),t('voucherS'),t('voucherPh'),v=>routerLogin(v,v.toLowerCase()));
$('#mcode').onclick=()=>codeSheet(t('codeT'),t('codeS'),t('codePh'),v=>join('code-login',{code:v}));

/* ---------- active connection (ISPman card) ---------- */
async function showActive(){
 if(params.get('renew')==='1'||!router.mac||CFG.show.autoConnect===false)return;
 if(!ADM&&(!router.login||!router.chapId))return;
 let a;try{a=await call('active?mac='+encodeURIComponent(router.mac)+'&dt='+encodeURIComponent(getDT()));}catch{return;}
 if(!a.found)return;activeInfo=a;renderPackages();
 const failed=!!params.get('error');let n=5;
 const box=$('#active');box.hidden=false;
 box.innerHTML=`<div class="hd"><span class="ck">${ICON.check}</span><h2>${esc(t('active'))}</h2></div><hr><p class="pk">${esc(t('pkg'))}: <b>${esc(a.plan)}</b></p>${a.left!=null?`<p class="ex">${esc(t('expires',{t:leftText(a.left)}))}</p>`:''}<hr>
  ${ADM?`<p class="adm">${esc(t('adm',{u:params.get('viewas')}))}</p>`:failed?'':`<p class="cn" id="auto">${esc(t('auto'))}</p>`}
  <button type="button" class="go" id="go-now" ${ADM?'disabled':''}>${esc(t('connectNow'))}${!ADM&&!failed?` (<span id="n">${n}</span>)`:''}</button>
  <hr><button type="button" class="lk" id="all">${esc(t('viewAll'))}</button>${!ADM&&!failed?`<button type="button" class="lk" id="stay">${esc(t('stay'))}</button>`:''}`;
 const go=async()=>{clearInterval(timer);const b=$('#go-now');b.disabled=true;try{await join('connect-now');}catch(err){b.disabled=false;alertBox(err.message);}};
 $('#go-now').onclick=go;$('#all').onclick=()=>{clearInterval(timer);$('#hotspotPkgs').scrollIntoView({behavior:'smooth'});};
 const st=$('#stay');if(st)st.onclick=()=>{clearInterval(timer);$('#auto')?.remove();const s=$('#n');if(s)s.parentElement.textContent=t('connectNow');st.remove();};
 // After the router has just refused a login, never count down and retry by itself.
 if(!ADM&&!failed)timer=setInterval(()=>{n--;const s=$('#n');if(s)s.textContent=Math.max(n,0);if(n<=0)go();},1000);}

/* ---------- loyalty + usage ---------- */
async function loadMe(){if(!router.mac&&!getDT())return;
 try{me=await call('usage?mac='+encodeURIComponent(router.mac)+'&dt='+encodeURIComponent(getDT()));}catch{me=null;}
 if(!me||!me.found)return;
 if(me.account)$('#acct').textContent=me.account.toUpperCase();
 if(me.loyalty?.enabled){$('#loyalty').hidden=false;$('#pts').textContent=me.points||0;$('#redeem').disabled=!(me.points>0)||ADM;}}
$('#redeem').onclick=async()=>{const b=$('#redeem');b.disabled=true;try{const before=me.points||0,r=await call('redeem-points',{body:{mac:router.mac}});me.points=r.points||0;$('#pts').textContent=me.points;alertBox(t('redeemed',{n:Math.round((before-me.points)*(me.loyalty?.pointValue||0))}),true);}catch(err){alertBox(err.message);}finally{b.disabled=!(me?.points>0);}};
function usageSheet(){here('My usage');
 if(!me||!me.found){sheet(`<h2>${esc(t('usageT'))}</h2><p class="muted">${esc(t('noUsage'))}</p>`);return;}
 const pane=k=>{if(k==='o')return `<div class="stats"><div><small>${esc(t('last30'))} · ${esc(t('down'))}</small><b>${esc(bytes(me.last30?.down))}</b></div><div><small>${esc(t('last30'))} · ${esc(t('up'))}</small><b>${esc(bytes(me.last30?.up))}</b></div><div><small>${esc(t('total'))} · ${esc(t('down'))}</small><b>${esc(bytes(me.total?.down))}</b></div><div><small>${esc(t('wallet'))}</small><b>${esc(kes(me.wallet))}</b></div></div>`;
  if(k==='p')return (me.payments||[]).length?`<ul class="list">${me.payments.map(p=>`<li><span>${esc(p.plan||p.ref)}<small>${esc(when(p.time))} · ${esc(p.ref||'')}</small></span><b>${esc(kes(p.amount))}${p.reversed?' · '+esc(t('reversed')):''}</b></li>`).join('')}</ul>`:`<p class="muted">${esc(t('none'))}</p>`;
  return (me.connects||[]).length?`<ul class="list">${me.connects.map(c=>`<li><span>${esc(c.plan)}<small>${esc(when(c.time))} · ${esc(bytes(c.down))} ↓ ${esc(bytes(c.up))} ↑</small></span><b>${esc(c.status==='active'?t('activeNow'):t('expired'))}</b></li>`).join('')}</ul>`:`<p class="muted">${esc(t('none'))}</p>`;};
 sheet(`<h2>${esc(t('usageT'))}</h2><p class="muted small">${esc((me.account||'').toUpperCase())}</p><div class="tabs"><button data-k="o" class="on">${esc(t('overview'))}</button><button data-k="p">${esc(t('payments'))}</button><button data-k="h">${esc(t('history'))}</button></div><div id="pane">${pane('o')}</div>`);
 for(const b of document.querySelectorAll('.tabs button'))b.onclick=()=>{for(const x of document.querySelectorAll('.tabs button'))x.classList.toggle('on',x===b);$('#pane').innerHTML=pane(b.dataset.k);};}
$('#usage').onclick=usageSheet;

/* ---------- find my account ---------- */
$('#find-form').onsubmit=async e=>{e.preventDefault();const q=e.target.q.value.trim(),b=e.target.querySelector('.btn');b.disabled=true;$('#find-out').innerHTML='';
 try{await lookup({query:q});}catch(err){$('#find-out').innerHTML=`<p class="err">${esc(err.message)}</p>`;}finally{b.disabled=false;}};
async function lookup(input){const r=await call('account',{body:{...input,mac:router.mac}}),out=$('#find-out');
 if(!r.found){out.innerHTML=`<p class="err">${esc(r.pinError||t('notFound'))}</p>`;return;}
 if(r.link){location.href=/^https?:/.test(r.link)?r.link:BASE+r.link;return;}
 if(r.locked){out.innerHTML=`<form id="ph-form" class="row" style="margin-top:10px"><input class="field" name="phone" inputmode="tel" required placeholder="${esc(t('lockedS',{h:r.phoneHint||''}))}"><button class="btn">${esc(t('find'))}</button></form>${r.wrong?`<p class="err">${esc(t('wrongPhone'))}</p>`:`<p class="muted small">${esc(t('lockedS',{h:r.phoneHint||''}))}</p>`}`;
  $('#ph-form').onsubmit=async ev=>{ev.preventDefault();try{await lookup({query:input.query,phone:ev.target.phone.value.trim()});}catch(err){out.insertAdjacentHTML('beforeend',`<p class="err">${esc(err.message)}</p>`);}};return;}
 out.innerHTML=`<dl class="kv"><dt>${esc(t('statusL'))}</dt><dd>${esc(r.status||'')}</dd><dt>${esc(t('planL'))}</dt><dd>${esc(r.plan||'—')}</dd><dt>${esc(t('expiresL'))}</dt><dd>${esc(when(r.expiresAt))}</dd></dl>`;}

/* ---------- chat / message ---------- */
$('#chat').onclick=()=>{let saved={};try{saved=JSON.parse(localStorage.getItem('portal-chat')||'{}');}catch{}
 const links=[CFG.phone?`<a class="btn ghost wide" style="display:block;text-align:center" href="tel:${esc(CFG.phone.replace(/\s/g,''))}">${ICON.phone} ${esc(CFG.phone)}</a>`:'',CFG.whatsapp?`<a class="btn ghost wide" style="display:block;text-align:center" href="https://wa.me/${esc(intl(CFG.whatsapp))}" rel="noopener">WhatsApp ${esc(CFG.whatsapp)}</a>`:''].join('');
 const form=CFG.show.chat!==false||CFG.show.message?`<form id="msg-form"><label>${esc(t('msgText'))}<textarea class="field" name="message" rows="3" maxlength="600" required></textarea></label><label>${esc(t('msgName'))}<input class="field" name="name" maxlength="60" required value="${esc(saved.name||'')}"></label><label>${esc(t('msgPhone'))}<input class="field" name="phone" inputmode="tel" required value="${esc(saved.phone||'')}"></label><p class="err" id="msg-err"></p><button class="btn wide">${esc(t('send'))}</button></form>`:'';
 sheet(`<h2>${esc(t('msgT'))}</h2>${form}${links}`);
 const f=$('#msg-form');if(f)f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('.btn');b.disabled=true;try{await call('message',{body:{chat:true,name:f.name.value,phone:f.phone.value,message:f.message.value}});try{localStorage.setItem('portal-chat',JSON.stringify({name:f.name.value,phone:f.phone.value}));}catch{}f.innerHTML=`<div class="wait"><div class="tick">${ICON.check}</div><p>${esc(t('msgDone'))}</p></div>`;}catch(err){b.disabled=false;$('#msg-err').textContent=err.message;}};};
const intl=p=>{const d=String(p||'').replace(/\D/g,'');return d.startsWith('0')?'254'+d.slice(1):d;};

/* ---------- free mode ---------- */
function renderFree(){const f=CFG.freeMode;if(!f||MODE==='pppoe'){$('#free').innerHTML='';return;}
 const TH={gift:['🎁','A gift for you','Get my gift'],compensation:['🤝','Sorry for the interruption','Connect free'],trial:['✨','Try us free','Start my free trial'],payments:['💳','Payments are down: connect free','Connect free'],christmas:['🎄','Merry Christmas','Get my gift'],matchday:['⚽','Match day is on us','Watch free'],holiday:['🌴','Happy holidays','Connect free'],image:['🎉','Free internet','Connect free']},T=TH[f.theme]||null;
 $('#free').innerHTML=`<div class="card" style="margin:0 0 12px;text-align:center">${f.theme==='image'&&f.imageUrl?`<img src="${esc(f.imageUrl)}" alt="" style="max-width:100%;max-height:160px;border-radius:12px;margin:0 auto 8px;display:block">`:T?`<div style="font-size:40px;line-height:1.1" aria-hidden="true">${T[0]}</div>`:''}<h3>${esc(T?T[1]:t('free'))}</h3><p class="muted small">${esc(f.reason||'')} ${esc(t('freeUntil',{t:when(f.until)}))}${f.down?` · ${f.down} Mbps down / ${f.up} Mbps up`:''}</p><button type="button" class="btn wide" id="free-go">${esc(T?T[2]:t('freeBtn'))}</button></div>`;
 $('#free-go').onclick=async()=>{const b=$('#free-go');b.disabled=true;try{if(!router.login)throw new Error(t('needWifi'));const r=await call('login',{body:{free:true,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge}});toRouter(r);}catch(err){b.disabled=false;alertBox(err.message);}};}

/* ---------- design + package layout (chosen in admin: Captive experience) ---------- */
const THEMES=['classic','spotlight','split','minimal','midnight','christmas','futuristic','bento','elegant','essential','studio','festive','blueprint','showcase','night','celebrate','daypass','edition','social','together'];
// "Automatic" layout gives each design the layout it was made with.
const AUTO_LAYOUT={studio:'list',festive:'list',night:'list',daypass:'list',edition:'list',together:'list',showcase:'list',social:'grid',bento:'grid',blueprint:'grid',celebrate:'grid'};
function applyLook(){const th=THEMES.includes(params.get('theme'))?params.get('theme'):THEMES.includes(CFG.theme)?CFG.theme:'classic';document.body.dataset.theme=th;
 const pick=['list','grid','swipe'].includes(params.get('layout'))?params.get('layout'):CFG.packageLayout,lay=['list','grid','swipe'].includes(pick)?pick:AUTO_LAYOUT[th]||'';
 for(const c of ['lay-list','lay-grid','lay-swipe'])document.body.classList.remove(c);if(lay)document.body.classList.add('lay-'+lay);
 document.documentElement.style.setProperty('--b',CFG.brandColor||'#0032fd');$('#brand').textContent=CFG.brandName||'';}
// Admin preview: the Captive experience page sends unsaved settings; show them straight away.
window.addEventListener('message',e=>{if(e.origin!==location.origin||!params.has('preview')||e.data?.kade!=='config'||!CFG)return;const c=e.data.config||{};
 CFG={...CFG,...c,show:{...CFG.show,...(c.show||{})}};applyLook();renderPackages();});

/* ---------- start ---------- */
for(const b of document.querySelectorAll('[data-lang]'))b.onclick=()=>{LANG=b.dataset.lang;try{localStorage.setItem('portal-lang',LANG);}catch{}translate();if(CFG){renderPackages();renderFree();if(!$('#active').hidden){clearInterval(timer);$('#active').hidden=true;showActive();}}};
async function start(){translate();
 try{const q=new URLSearchParams();for(const k of ['mac','nas','ip'])if(params.get(k))q.set(k,params.get(k));const data=await call('config'+(q.toString()?'?'+q:''));
  CFG={...data.config,mpesa:!!data.mpesa,paystack:!!data.paystack,freeMode:data.freeMode||null,show:data.config.show||{}};plans=data.plans||[];homePlans=data.pppoePlans||[];
  if(!MODE&&data.mode&&data.mode!=='any')MODE=data.mode;
  if(data.maintenance){const n=$('#notice');n.hidden=false;n.textContent=t('maint')+': '+(data.maintenance.message||data.maintenance.title||'');}}
 catch(err){$('#boot').classList.add('done');alertBox(err.message);return;}
 // The customer's own choice wins; otherwise the ISP's default language, or the phone's language when that is "auto".
 let chosen='';try{chosen=localStorage.getItem('portal-lang')||'';}catch{}
 if(!chosen){if(W[CFG.defaultLang])LANG=CFG.defaultLang;else if(/^sw/i.test(navigator.language||''))LANG='sw';}
 translate();
 applyLook();document.title=(CFG.brandName||'')+' WiFi';
 {const l=$('#logo'),u=CFG.logoUrl||'/img/kade-mark.png';l.src=/^\/(?!\/)/.test(u)?BASE+u:u;l.hidden=false;l.onerror=()=>{l.hidden=true;};}
 if(CFG.phone){const a=$('#call');a.href='tel:'+CFG.phone.replace(/\s/g,'');a.innerHTML=ICON.phone+esc(CFG.phone);a.hidden=false;}
 if(CFG.whatsapp){const a=$('#wa');a.href='https://wa.me/'+intl(CFG.whatsapp);a.className='wa';a.innerHTML=ICON.wa+esc(CFG.whatsapp);a.hidden=false;}
 $('#copy').textContent='© '+new Date().getFullYear()+' '+(CFG.brandName||'');
 if(CFG.terms){const tl=$('#terms');tl.hidden=false;tl.onclick=e=>{e.preventDefault();sheet(`<h2>${esc(t('terms'))}</h2><div style="white-space:pre-wrap">${esc(CFG.terms)}</div>`);};}
 $('#chat').hidden=!(CFG.show.chat!==false||CFG.show.message||CFG.phone||CFG.whatsapp);
 const home=MODE==='pppoe';
 $('#hotspot').hidden=home||CFG.show.hotspot===false;$('#home').hidden=!home;// Off the WiFi on the open portal (like ISPman) everyone gets one page: hotspot packages, find my account, home packages.
 $('#homePkgsWrap').hidden=!(homePlans.length&&CFG.show.pppoe!==false&&(home||(!router.mac&&CFG.show.openPortal!==false)));
 $('#voucher').hidden=CFG.show.vouchers===false;if($('#voucher').hidden)$('#actions').style.gridTemplateColumns='1fr';
 // Off the WiFi (no device address) a hotspot customer finds their account instead; on the WiFi the page is about connecting.
 $('#find').hidden=!(home||(!router.mac&&CFG.show.findAccount!==false));
 if(params.get('error')&&!home)alertBox(params.get('error'));
 if(params.get('expired')==='1'||params.get('account')){if(params.get('account'))$('#find input').value=params.get('account');setTimeout(()=>$('#find input').focus(),300);}
 renderPackages();renderFree();
 $('#boot').classList.add('done');here(home?'Home':'Packages');
 if(!home){await loadMe();$('#usage').hidden=!(CFG.show.myUsage!==false&&(router.mac||me?.found));await showActive();}
 if(params.has('preview')){try{parent.postMessage({kade:'ready'},location.origin);}catch{}}}
start();
})();
