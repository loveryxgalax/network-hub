'use strict';
// Public checkout link page: shows what the payment is for, sends the M-Pesa prompt and waits for the confirmation.
(function(){
 const code=(new URLSearchParams(location.search).get('c')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3);
 const bd=document.getElementById('bd'),biz=document.getElementById('biz');
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
 const money=n=>'KES '+Number(n||0).toLocaleString('en-KE');
 const call=(p,o)=>fetch('/portal/api/'+p,o).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong. Try again.');return d;});
 function form(l){biz.textContent=l.business;
  bd.innerHTML=`<div class="row"><span>Checkout code</span><b>${esc(l.code)}</b></div><div class="row"><span>For</span><b>${esc(l.description)}</b></div>
  ${l.amount?`<div class="amt">${money(l.amount)}</div><div class="wait" style="font-size:13px">Amount to pay</div>`:''}
  <form id="f"><label for="ph">M-Pesa phone number</label><input id="ph" name="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" required>
  ${l.amount?'':'<label for="am">Amount (KES)</label><input id="am" name="amount" inputmode="numeric" pattern="[0-9]*" placeholder="500" required>'}
  <button type="submit">Pay${l.amount?' '+money(l.amount):''}</button></form><div class="msg" id="m"></div>`;
  const f=document.getElementById('f'),m=document.getElementById('m');
  f.onsubmit=e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;m.className='msg wait';m.textContent='Sending the M-Pesa prompt…';
   call('checkout/'+code+'/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:f.phone.value,amount:f.amount?.value})})
    .then(r=>{m.textContent=r.message+'. Waiting for confirmation…';wait(r,m,b,0);},err=>{m.className='msg bad';m.textContent=err.message;b.disabled=false;});};}
 function wait(r,m,b,n){if(n>40){m.className='msg bad';m.textContent='No confirmation yet. If you paid, keep your M-Pesa message as proof.';b.disabled=false;return;}
  setTimeout(()=>call('checkout-status/'+r.id+'?t='+encodeURIComponent(r.token)).then(s=>{
   if(s.status==='paid'){bd.innerHTML=`<div class="amt ok">Payment received</div><div class="row"><span>Amount</span><b>${money(s.amount)}</b></div>${s.receipt?`<div class="row"><span>M-Pesa receipt</span><b>${esc(s.receipt)}</b></div>`:''}<p class="wait" style="margin-top:14px">Thank you. You can close this page.</p>`;return;}
   if(s.status==='failed'){m.className='msg bad';m.textContent='Payment not completed'+(s.reason?': '+s.reason:'')+'. You can try again.';b.disabled=false;return;}
   wait(r,m,b,n+1);},()=>wait(r,m,b,n+1)),3000);}
 if(!/^[A-Z0-9]{3}$/.test(code)){biz.textContent='Payment link';bd.innerHTML='<p class="bad">This payment link is not complete. Check the address.</p>';return;}
 call('checkout/'+code).then(form,err=>{biz.textContent='Payment link';bd.innerHTML=`<p class="bad">${esc(err.message)}</p>`;});
})();
