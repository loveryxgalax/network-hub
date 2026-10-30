'use strict';
// ISPman-style list tables everywhere: a Filters panel (one box per column), paging with "Page 1 of N (showing 1–25 of
// 240)", rows per page, and Export CSV. Works on the rendered table, so every list page gets it without changes; a page
// that re-renders its table keeps the chosen filters and page.
(()=>{
const MIN_ROWS=6,SKIP=/^(actions?|)$/i,NOFILTER=/started|update|ended|time|date|downloaded|uploaded|expires|expiry|registered|seen|^when|duration|session time|down \/ up|^usage/i,memo=new Map();
const ACR={ip:'IP',mac:'MAC',id:'ID',sms:'SMS',pppoe:'PPPoE',olt:'OLT',onu:'ONU',ipv4:'IPv4',ipv6:'IPv6',nas:'NAS',sn:'SN',cpe:'CPE',mpesa:'M-Pesa'};
const title=s=>s.toLowerCase().replace(/[a-z0-9-]+/g,w=>ACR[w]||w.charAt(0).toUpperCase()+w.slice(1));
let size=25;try{size=Number(localStorage.getItem('kd-page-size'))||25;}catch{}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cellText=td=>td.innerText.replace(/\s+/g,' ').trim();
function key(table){return (typeof state!=='undefined'?state.page:'')+'|'+[...table.tHead.rows[0].cells].map(c=>c.textContent.trim()).join(',');}
function enhance(table){
 if(table.dataset.kt||!table.tHead||!table.tBodies[0]||table.closest('dialog,.kd,.im-no-kt'))return;const rows=[...table.tBodies[0].rows].filter(r=>r.cells.length>1);
 table.dataset.kt='1';if(rows.length<MIN_ROWS)return;
 const wrap=table.closest('.table-wrap')||table,k=key(table),st=memo.get(k)||{page:0,f:{}};memo.set(k,st);
 const heads=[...table.tHead.rows[0].cells].map((c,i)=>({i,name:c.textContent.trim()})).filter(h=>!SKIP.test(h.name));
 // A card that already has its own search box keeps it; the Filters panel is added only where nothing filters the rows.
 const card=wrap.closest('.card,section')||wrap.parentElement,own=card&&card.querySelector('input[type=search],.table-toolbar input,.sites-panel>input');
 let panel=null;if(!own&&heads.some(h=>!NOFILTER.test(h.name))){panel=document.createElement('section');panel.className='card im-filters kt-filters';
  panel.innerHTML=`<h2>Filters</h2><div class="im-filter-grid">${heads.filter(h=>!NOFILTER.test(h.name)).slice(0,8).map(h=>`<label>${esc(title(h.name))}<input type="search" data-col="${h.i}" placeholder="Filter ${esc(title(h.name))}…" value="${esc(st.f[h.i]||'')}"></label>`).join('')}</div>`;
  wrap.before(panel);for(const i of panel.querySelectorAll('input'))i.oninput=()=>{st.f[i.dataset.col]=i.value;st.page=0;paint();};}
 const foot=document.createElement('div');foot.className='kt-foot';wrap.after(foot);
 function paint(){const f=Object.entries(st.f).filter(([,v])=>v&&v.trim()).map(([c,v])=>[Number(c),v.trim().toLowerCase()]);
  const shown=rows.filter(r=>f.every(([c,v])=>r.cells[c]&&cellText(r.cells[c]).toLowerCase().includes(v)));const pages=Math.max(1,Math.ceil(shown.length/size));if(st.page>=pages)st.page=pages-1;
  const from=st.page*size,vis=new Set(shown.slice(from,from+size));for(const r of rows)r.hidden=!vis.has(r);
  const btn=(p,label=p+1)=>`<button type="button" data-p="${p}" class="${p===st.page?'on':''}">${label}</button>`,nums=[];for(let p=0;p<pages;p++)if(p<2||p>=pages-2||Math.abs(p-st.page)<=1)nums.push(p);else if(nums.at(-1)!=='…')nums.push('…');
  foot.innerHTML=`<span class="kt-info">Page ${st.page+1} of ${pages} <b>(showing ${shown.length?from+1:0}–${Math.min(from+size,shown.length)} of ${shown.length}${shown.length!==rows.length?`, filtered from ${rows.length}`:''})</b></span>
   <button type="button" class="kt-csv">${typeof icon==='function'?icon('download',14):''} Export CSV</button>
   <span class="kt-size">Show <select aria-label="Rows per page">${[5,10,25,50,100].map(n=>`<option ${n===size?'selected':''}>${n}</option>`).join('')}</select> per page</span>
   <span class="kt-pages">${st.page>0?btn(st.page-1,'‹'):''}${nums.map(p=>p==='…'?'<span>…</span>':btn(p)).join('')}${st.page<pages-1?btn(st.page+1,'›'):''}</span>`;
  for(const b of foot.querySelectorAll('[data-p]'))b.onclick=()=>{st.page=Number(b.dataset.p);paint();wrap.scrollIntoView({block:'nearest'});};
  foot.querySelector('select').onchange=e=>{size=Number(e.target.value);try{localStorage.setItem('kd-page-size',size);}catch{}st.page=0;paint();};
  foot.querySelector('.kt-csv').onclick=()=>{const cols=heads.map(h=>h.i),q=v=>'"'+String(v).replace(/"/g,'""')+'"';const csv=[heads.map(h=>q(h.name)).join(','),...shown.map(r=>cols.map(c=>q(r.cells[c]?cellText(r.cells[c]):'')).join(','))].join('\r\n');
   const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'}));a.download=((document.querySelector('#main h1')?.textContent||'export').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-'))+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};}
 paint();}
function scan(){for(const t of document.querySelectorAll('#main table.data-table:not([data-kt])'))enhance(t);}
const obs=new MutationObserver(()=>{clearTimeout(obs.t);obs.t=setTimeout(scan,30);});
document.addEventListener('DOMContentLoaded',()=>{const m=document.querySelector('#main');if(m){obs.observe(m,{childList:true,subtree:true});scan();}});
})();
