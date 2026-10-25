'use strict';
// Captive portal: buy a hotspot package or renew an account with M-Pesa, then log in through the MikroTik.
const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);// mac, ip, login, dst, chapId, chapChallenge, error (from the router)
const router={login:params.get('login')||'',dst:params.get('dst')||'',chapId:params.get('chapId')||'',chapChallenge:params.get('chapChallenge')||'',mac:params.get('mac')||''};
let plans=[],selected=null,polling=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ksh=n=>'KSh '+Number(n).toLocaleString();
async function call(path,options={}){const r=await fetch('/portal/api/'+path,{...options,headers:{'Content-Type':'application/json'}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Something went wrong. Try again.');return data;}
function alertBox(text,ok=false){const el=$('#portal-alert');el.textContent=text;el.classList.toggle('ok',ok);el.hidden=!text;if(text)el.scrollIntoView({block:'nearest'});}
function show(panel){for(const s of document.querySelectorAll('[data-panel]'))s.hidden=s.dataset.panel!==panel;for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b.dataset.tab===panel);$('.portal-tabs').hidden=false;$('#portal-wait').hidden=true;$('#portal-done').hidden=true;}
function busy(state){for(const s of document.querySelectorAll('[data-panel]'))s.hidden=true;$('.portal-tabs').hidden=true;$('#portal-wait').hidden=!state;}
function renderPlans(){$('#portal-plans').innerHTML=plans.length?plans.map(p=>`<button type="button" class="portal-plan${selected===p.id?' selected':''}" data-plan="${esc(p.id)}"><span><strong>${esc(p.name)}</strong><small>${esc(p.duration)} · up to ${esc(p.downloadMbps)} Mbps${p.devices>1?' · '+p.devices+' devices':''}</small></span><span class="portal-price">${ksh(p.price)}</span></button>`).join(''):'<p class="portal-muted">No packages are on sale right now.</p>';
 for(const b of document.querySelectorAll('[data-plan]'))b.onclick=()=>{selected=b.dataset.plan;renderPlans();$('#buy-form').hidden=false;$('#buy-form input').focus();};}
// Log in through the router: a top-level GET to its login page (works from this HTTPS page; forms to HTTP would warn).
async function routerLogin(username,password){
 if(!router.login){return false;}
 const r=await call('login',{method:'POST',body:JSON.stringify({username,password,chapId:router.chapId,chapChallenge:router.chapChallenge})});
 const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});
 location.href=router.login+(router.login.includes('?')?'&':'?')+q;return true;
}
function done(html){busy(false);$('.portal-tabs').hidden=true;for(const s of document.querySelectorAll('[data-panel]'))s.hidden=true;const d=$('#portal-done');d.innerHTML=html;d.hidden=false;}
async function pay(input){
 alertBox('');busy(true);$('#wait-title').textContent='Check your phone';$('#wait-text').textContent='Sending the M-Pesa prompt…';
 try{const start=await call('pay',{method:'POST',body:JSON.stringify({...input,mac:router.mac})});$('#wait-text').textContent=`Enter your M-Pesa PIN to pay ${ksh(start.amount)}.`;poll(start.id,start.token,Date.now());}
 catch(error){busy(false);show(input.kind==='account'?'account':'buy');alertBox(error.message);}
}
function poll(id,token,started){clearTimeout(polling);polling=setTimeout(async()=>{
 try{const s=await call('pay/'+id+'?t='+encodeURIComponent(token));
  if(s.status==='pending'){if(Date.now()-started>40000)$('#wait-text').textContent='Still waiting for M-Pesa… this can take a minute.';return poll(id,token,started);}
  if(s.status==='failed'){busy(false);show(s.kind==='account'?'account':'buy');return alertBox(s.reason||'Payment was not completed.');}
  const until=s.expiresAt?new Date(s.expiresAt).toLocaleString('en-KE',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';
  if(s.kind==='account')return done(`<h2>Payment received ✓</h2><p>Account <strong>${esc(s.username)}</strong> is active until <strong>${esc(until)}</strong>.</p><p class="portal-muted">If you are not online within a minute, restart your router.</p>`);
  done(`<h2>Payment received ✓</h2><p>Your Wi-Fi is active until <strong>${esc(until)}</strong>. Save these to log in on another device:</p><dl class="portal-code"><dt>Code</dt><dd>${esc(s.username)}</dd><dt>Password</dt><dd>${esc(s.password)}</dd></dl><p class="portal-muted" id="connecting">${router.login?'Connecting you now…':'Join the Kade Networks Wi-Fi and log in with this code.'}</p>`);
  if(router.login)await routerLogin(s.username,s.password).catch(e=>{$('#connecting').textContent=e.message;});
 }catch(error){if(Date.now()-started<240000)return poll(id,token,started);busy(false);show('buy');alertBox(error.message);}
},3000);}
async function init(){
 for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{alertBox('');show(b.dataset.tab);};
 const err=params.get('error');if(err)alertBox(err);
 try{const info=await call('info');document.title=info.name+' Wi-Fi';$('#portal-name').textContent=info.name;plans=info.plans;renderPlans();if(info.support)$('#portal-support').textContent='Help: '+info.support;if(!info.mpesa)alertBox('M-Pesa payments are not available yet. If you have a code, use “I have a code”.');}
 catch{$('#portal-plans').innerHTML='<p class="portal-muted">Could not load packages. Refresh the page.</p>';}
 $('#buy-form').onsubmit=e=>{e.preventDefault();if(!selected)return alertBox('Choose a package first');pay({kind:'hotspot',planId:selected,phone:e.target.phone.value});};
 $('#account-form').onsubmit=e=>{e.preventDefault();pay({kind:'account',username:e.target.username.value,phone:e.target.phone.value});};
 $('#code-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;alertBox('');
  try{const u=e.target.username.value,p=e.target.password.value;if(!router.login){await call('login',{method:'POST',body:JSON.stringify({username:u,password:p})});alertBox('This code is valid. Join the Kade Networks Wi-Fi to use it.',true);}else await routerLogin(u,p);}
  catch(error){alertBox(error.message);}finally{btn.disabled=false;}};
}
init();
