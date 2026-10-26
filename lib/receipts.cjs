'use strict';
// Printable receipts and invoices (use the browser's Print > Save as PDF). Plain HTML, no scripts inline.
const e=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const money=n=>'KSh '+Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:0,maximumFractionDigits:2});
const day=t=>t?new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Nairobi'}):'—';
const stamp=t=>t?new Date(t).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Nairobi'}):'—';
function page(title,body){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
body{margin:0;background:#eef2f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f1d2a}.sheet{max-width:760px;margin:24px auto;background:#fff;border-radius:14px;padding:40px;box-shadow:0 8px 30px #0f1d2a1a}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0e8f80;padding-bottom:18px}h1{margin:0;font-size:26px;color:#0e8f80;letter-spacing:.5px}.brand{font-weight:800;font-size:18px}.muted{color:#667685;font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:22px}td,th{padding:11px 8px;border-bottom:1px solid #e3e9ef;text-align:left;font-size:14px}th{font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#667685}.r{text-align:right}.total td{font-weight:800;font-size:16px;border-bottom:0}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}.meta b{display:block;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#667685;margin-bottom:3px}.paid{display:inline-block;margin-top:18px;padding:5px 14px;border:2px solid #13895f;color:#13895f;border-radius:8px;font-weight:800;transform:rotate(-3deg)}
.bar{max-width:760px;margin:14px auto 0;text-align:right}.bar button{background:#0e8f80;color:#fff;border:0;border-radius:9px;padding:10px 18px;font-weight:700;cursor:pointer}footer{margin-top:28px;font-size:12px;color:#667685;text-align:center}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none}.bar{display:none}}</style></head><body><div class="bar"><button id="print">Print / Save as PDF</button></div><div class="sheet">${body}</div><script src="/receipt.js"></script></body></html>`;}
function header(kind,no,phone,email){return `<header><div><div class="brand">Kade Networks</div><div class="muted">${e([phone,email].filter(Boolean).join(' · '))}</div></div><div style="text-align:right"><h1>${kind}</h1><div class="muted">${e(no)}</div></div></header>`;}
function build(store,sub,{kind='receipt',ref='',cfg={}}={}){
 const plan=store.get('plans',sub.planId),pays=store.list('subscriberPayments').filter(p=>p.subscriberId===sub.id).sort((a,b)=>(b.time||b.created)-(a.time||a.created));
 const phone=cfg.phone||'',email=cfg.email||'';
 if(kind==='invoice'){const due=sub.expiresAt&&sub.expiresAt>Date.now()?sub.expiresAt:Date.now(),no='INV-'+sub.username.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10)+'-'+new Date(due).toISOString().slice(0,10).replace(/-/g,'');
  return page('Invoice '+no,header('INVOICE',no,phone,email)+`<div class="meta"><div><b>Billed to</b>${e(sub.name)}<br><span class="muted">${e(sub.phone||'')} ${e(sub.email||'')}</span><br><span class="muted">${e(sub.address||'')}</span></div><div><b>Account</b>${e(sub.username)}<br><span class="muted">Issued ${e(day(Date.now()))}</span><br><span class="muted">Due ${e(day(due))}</span></div></div>
   <table><tr><th>Description</th><th class="r">Amount</th></tr><tr><td>${e(plan?.name||'Internet package')}<br><span class="muted">${plan?e(plan.downloadMbps+' / '+plan.uploadMbps+' Mbps'):''}</span></td><td class="r">${money(plan?.price)}</td></tr>${sub.balance?`<tr><td>Wallet credit</td><td class="r">- ${money(Math.min(sub.balance,plan?.price||0))}</td></tr>`:''}<tr class="total"><td>Amount due</td><td class="r">${money(Math.max(0,(plan?.price||0)-(sub.balance||0)))}</td></tr></table>
   <p class="muted">Pay by M-Pesa using your account name <b>${e(sub.username)}</b> as the account number.</p><footer>Kade Networks · Thank you for your business</footer>`);}
 const p=(ref?pays.find(x=>x.reference===ref):pays[0]);if(!p)throw Object.assign(new Error('No payment found for this customer'),{status:404});
 const no='RCT-'+p.reference;
 return page('Receipt '+no,header('RECEIPT',no,phone,email)+`<div class="meta"><div><b>Received from</b>${e(sub.name)}<br><span class="muted">${e(sub.phone||'')}</span></div><div><b>Account</b>${e(sub.username)}<br><span class="muted">${e(stamp(p.time||p.created))}</span></div></div>
  <table><tr><th>Description</th><th>Method</th><th class="r">Amount</th></tr><tr><td>${e(plan?.name||'Internet package')}${p.periods?`<br><span class="muted">${p.periods} period${p.periods===1?'':'s'} · active until ${e(day(p.expiresAt))}</span>`:''}</td><td>${e(p.method)}<br><span class="muted">${e(p.reference)}</span></td><td class="r">${money(p.amount)}</td></tr><tr class="total"><td colspan="2">Total paid</td><td class="r">${money(p.amount)}</td></tr></table>
  <div class="paid">PAID</div><footer>Kade Networks · Thank you for your payment</footer>`);
}
module.exports={build};
