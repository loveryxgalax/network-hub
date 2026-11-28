'use strict';
// Gives every table cell its column name so the small-screen card layout can show "SPEED: 10 Mbps".
(()=>{
const label=table=>{const heads=[...table.querySelectorAll('thead th')].map(t=>t.textContent.trim());if(!heads.length)return;
 for(const tr of table.querySelectorAll('tbody tr')){[...tr.children].forEach((td,i)=>{if(td.tagName==='TD'&&td.dataset.label!==(heads[i]||''))td.dataset.label=heads[i]||'';});}};
const run=()=>{for(const t of document.querySelectorAll('.data-table'))label(t);};
let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;run();});}).observe(document.documentElement,{childList:true,subtree:true});
run();
})();
