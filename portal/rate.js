'use strict';
const t=new URLSearchParams(location.search).get('t')||'',box=document.getElementById('c');
for(const b of document.querySelectorAll('[data-s]'))b.onclick=async()=>{for(const x of document.querySelectorAll('[data-s]'))x.disabled=true;
 try{const r=await fetch('/portal/api/rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t,score:Number(b.dataset.s)})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong');
  box.innerHTML='<h1>Thank you!</h1><p class="done">You rated us '+b.dataset.s+' out of 5.</p>';}
 catch(e){box.querySelector('p').textContent=e.message;for(const x of document.querySelectorAll('[data-s]'))x.disabled=false;}};
