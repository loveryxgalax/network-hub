'use strict';
// Shows one loading animation exactly as the WiFi page does, for the designer. ?style=wave&bg=%230a3cff&fg=%23ffffff&text=Kade
const q=new URLSearchParams(location.search),ok=/^#[0-9a-f]{6}$/i;
document.body.dataset.loading=(q.get('style')||'spinner').replace(/[^a-z0-9]/g,'');
if(ok.test(q.get('bg')||''))document.body.style.setProperty('--boot-bg',q.get('bg'));
if(ok.test(q.get('fg')||''))document.body.style.setProperty('--boot-fg',q.get('fg'));
if(ok.test(q.get('brand')||''))document.body.style.setProperty('--brand',q.get('brand'));
document.querySelector('.boot-text').textContent=(q.get('text')||'').slice(0,40);
