'use strict';
// ISPman-style list tables everywhere: a Filters panel (one box per column), paging with "Page 1 of N (showing 1–25 of
// 240)", rows per page, and Export CSV. Works on the rendered table, so every list page gets it without changes; a page
// that re-renders its table keeps the chosen filters and page.
(()=>{
// List pages that always show the Filters panel, as the reference does, even before any rows exist.
const ALWAYS=new Set(['inventory','ops-stock','st-expiring','st-customers','promo-campaigns','loyalty','tickets','pay-received','pay-wallets','pay-payouts','pay-ledger','hs-vouchers','audit','deleted','comms-sms','comms-mailout','me']);
const MIN_ROWS=6,SKIP=/^(actions?|)$/i,NOFILTER=/started|update|ended|time|date|downloaded|uploaded|expires|expiry|registered|seen|^when|duration|session time|down \/ up|^usage/i,memo=new Map();
const ACR={ip:'IP',mac:'MAC',id:'ID',sms:'SMS',pppoe:'PPPoE',olt:'OLT',onu:'ONU',ipv4:'IPv4',ipv6:'IPv6',nas:'NAS',sn:'SN',cpe:'CPE',mpesa:'M-Pesa'};
const RNUM=/amount|price|balance|wallet|paid|cost|points|^qty$|on hand|minimum|^used$|^available$|^codes$|^sent$|^failed$/i,RDATE=/^(time|date|when)$|transacted|deleted|detected|registered|started|expires|expiry|last seen|created|recorded/i;
// The value of a cell for range filters: the first number (amounts), or a date from its text or title.
const numOf=td=>{const m=/-?\d[\d,]*(\.\d+)?/.exec(td.innerText.replace(/\s/g,''));return m?Number(m[0].replace(/,/g,'')):null;};
const dateOf=td=>{for(const v of [td.querySelector('[title]')?.title,td.title,td.innerText.split('\n')[0],td.innerText]){const t=Date.parse(String(v||'').trim());if(Number.isFinite(t))return t;}return null;};
const title=s=>s.toLowerCase().replace(/[a-z0-9-]+/g,w=>ACR[w]||w.charAt(0).toUpperCase()+w.slice(1));
let size=25;try{size=Number(localStorage.getItem('kd-page-size'))||25;}catch{}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cellText=td=>td.innerText.replace(/\s+/g,' ').trim();
function key(table){return (typeof state!=='undefined'?state.page:'')+'|'+[...table.tHead.rows[0].cells].map(c=>c.textContent.trim()).join(',');}
function enhance(table){
 if(table.dataset.kt||!table.tHead||!table.tBodies[0]||table.closest('dialog,.kd,.im-no-kt'))return;const rows=[...table.tBodies[0].rows].filter(r=>r.cells.length>1);
 table.dataset.kt='1';const always=typeof state!=='undefined'&&ALWAYS.has(state.page)&&!table.closest('dialog');if(rows.length<MIN_ROWS&&!always)return;
 // A page with its own Filters panel and paging keeps them; nothing is added twice.
 if(document.querySelector('#main .ct-filters,#main .im-filters:not(.kt-filters)'))return;
 const wrap=table.closest('.table-wrap')||table,k=key(table),st=memo.get(k)||{page:0,f:{}};memo.set(k,st);
 const heads=[...table.tHead.rows[0].cells].map((c,i)=>({i,name:c.textContent.trim()})).filter(h=>!SKIP.test(h.name));
 // A card that already has its own search box keeps it; the Filters panel is added only where nothing filters the rows.
 const card=wrap.closest('.card,section')||wrap.parentElement;let own=card&&card.querySelector('input[type=search],.table-toolbar input,.sites-panel>input');
 // On the always-filtered pages the panel replaces a plain search box (one way to filter, not two).
 if(own&&always&&own.id==='list-query'){own.hidden=true;own=null;}
 let panel=null;if(!own&&heads.some(h=>!NOFILTER.test(h.name)||RNUM.test(h.name)||RDATE.test(h.name))){panel=document.createElement('section');panel.className='card im-filters kt-filters';
  const few=h=>{const v=[...new Set(rows.map(r=>r.cells[h.i]?cellText(r.cells[h.i]).split(' · ')[0]:'').filter(Boolean))];return rows.length>=2&&v.length>=2&&v.length<=8&&/status|service|type|priority|provider|category|kind|active|state|level|router|device|package/i.test(h.name)?v.sort():null;};
  panel.innerHTML=`<h2>Filters</h2><div class="im-filter-grid">${[...heads.filter(h=>!NOFILTER.test(h.name)&&!RNUM.test(h.name)).slice(0,6).map(h=>{const o=few(h);return o?`<label>${esc(title(h.name))}<select data-col="${h.i}"><option value="">All</option>${o.map(x=>`<option ${st.f[h.i]===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>`:`<label>${esc(title(h.name))}<input type="search" data-col="${h.i}" placeholder="Filter ${esc(title(h.name))}…" value="${esc(st.f[h.i]||'')}"></label>`;}),...heads.filter(h=>RNUM.test(h.name)||RDATE.test(h.name)).slice(0,3).map(h=>{const d=!RNUM.test(h.name),ty=d?'date':'number';return `<label>${esc(title(h.name))}<span class="kt-range"><input type="${ty}" data-col="${h.i}" data-r="min" placeholder="Min" value="${esc(st.f[h.i+':min']||'')}"><em>to</em><input type="${ty}" data-col="${h.i}" data-r="max" placeholder="Max" value="${esc(st.f[h.i+':max']||'')}"></span></label>`;})].join('')}</div>`;
  wrap.before(panel);for(const i of panel.querySelectorAll('input,select'))i.oninput=i.onchange=()=>{st.f[i.dataset.r?i.dataset.col+':'+i.dataset.r:i.dataset.col]=i.value;st.page=0;paint();};}
 const foot=document.createElement('div');foot.className='kt-foot';wrap.after(foot);
 function paint(){const f=Object.entries(st.f).filter(([k,v])=>v&&v.trim()&&!k.includes(':')).map(([c,v])=>[Number(c),v.trim().toLowerCase()]);
  // Ranges: min/max for amounts, from/to (whole days, Nairobi) for dates.
  const rg=Object.entries(st.f).filter(([k,v])=>v&&k.includes(':')).map(([k,v])=>{const [c,side]=k.split(':'),isDate=/^\d{4}-\d{2}-\d{2}$/.test(v);return {c:Number(c),side,isDate,v:isDate?Date.parse(v+'T00:00:00+03:00')+(side==='max'?864e5-1:0):Number(v)};}).filter(x=>Number.isFinite(x.v));
  const shown=rows.filter(r=>f.every(([c,v])=>r.cells[c]&&cellText(r.cells[c]).toLowerCase().includes(v))&&rg.every(x=>{const td=r.cells[x.c];if(!td)return false;const val=x.isDate?dateOf(td):numOf(td);return val!=null&&(x.side==='min'?val>=x.v:val<=x.v);}));const pages=Math.max(1,Math.ceil(shown.length/size));if(st.page>=pages)st.page=pages-1;
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
