'use strict';
// The page a connected hotspot customer sees (the router's status.html): time left, usage, a buy-more button.
// Five designs, your colours. The router fills the $(...) values in; the preview uses sample values.
const DESIGNS={dashboard:'Dashboard',classic:'Classic',minimal:'Minimal',receipt:'Receipt',neon:'Neon terminal'};
const DEFAULTS={design:'dashboard',primary:'#0a3cff',background:'#0f1a2e',text:'#ffffff',accent:'#00a8ff',showLogo:true,brandName:'Kade Networks',buyLabel:'Buy more data'};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hex=(v,label)=>{if(!/^#[0-9a-fA-F]{6}$/.test(String(v||'')))fail(label+' must be a colour like #0a3cff');return String(v).toLowerCase();};
function get(store){return {...DEFAULTS,...(store.setting('statusConfig')||{})};}
function validate(i){if(!i||typeof i!=='object')fail('Expected an object');if(!DESIGNS[i.design])fail('Choose one of the designs');
 const name=String(i.brandName??DEFAULTS.brandName).trim().slice(0,40),buy=String(i.buyLabel??DEFAULTS.buyLabel).trim().slice(0,30);if(/[<>\u0000-\u001f]/.test(name+buy))fail('Invalid text');
 return {design:i.design,primary:hex(i.primary,'Primary'),background:hex(i.background,'Background'),text:hex(i.text,'Text'),accent:hex(i.accent,'Accent'),showLogo:i.showLogo===true,brandName:name||DEFAULTS.brandName,buyLabel:buy||DEFAULTS.buyLabel};}
function save(store,input){return store.setting('statusConfig',validate(input));}
const ROUTER={left:'$(session-time-left)',uptime:'$(uptime)',down:'$(bytes-out-nice)',up:'$(bytes-in-nice)',ip:'$(ip)',mac:'$(mac)',user:'$(username)',logout:'$(link-logout)'};
const SAMPLE={left:'5h 48m',uptime:'1h 12m',down:'412.6 MiB',up:'38.1 MiB',ip:'10.5.50.23',mac:'4C:5E:0C:11:22:33',user:'ABCD2345',logout:'#'};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function page(cfg,origin,preview,phone){
 const v=preview?SAMPLE:ROUTER,logo=cfg.showLogo?`<img class="logo" src="${preview?'':esc(origin)}/img/kade-logo-small.png" alt="">`:'';
 const tiles=[['Time left',v.left],['Uptime',v.uptime],['Downloaded',v.down],['Uploaded',v.up],['IP address',v.ip],['Device',v.mac]];
 const grid=tiles.map(([k,x])=>`<div class="t"><small>${k}</small><b>${x}</b></div>`).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${preview?'':'<meta http-equiv="refresh" content="60">'}<title>${esc(cfg.brandName)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--tx);display:flex;justify-content:center;align-items:flex-start}
:root{--p:${cfg.primary};--bg:${cfg.background};--tx:${cfg.text};--a:${cfg.accent}}
.w{width:100%;max-width:440px;padding:22px 18px 30px}h1{font-size:19px;margin:0}header{margin-bottom:16px}header p{margin:3px 0 0;opacity:.75;font-size:13px}.logo{height:34px;background:#fff;padding:5px 9px;border-radius:9px;margin-bottom:8px;display:block}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.t{padding:12px 14px;border-radius:12px}.t small{display:block;font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;opacity:.7}.t b{display:block;margin-top:5px;font-size:17px;word-break:break-all}
.btn{display:block;text-align:center;margin-top:12px;padding:13px;border-radius:12px;font-weight:700;text-decoration:none;font-size:14px}
.buy{background:var(--tx);color:var(--p)}.out{border:1px solid currentColor;color:var(--tx)}
body.dashboard{background:var(--p)}.dashboard .t{background:#ffffff24}.dashboard .buy{background:#fff;color:var(--p)}.dashboard .out{border-color:#ffffff66}
body.classic{background:#f1f5f9;color:#0f172a}.classic .w{margin-top:30px;background:#fff;border-radius:16px;box-shadow:0 8px 30px #0f172a1a;max-width:420px}.classic .t{background:#f1f5f9}.classic .buy{background:var(--p);color:#fff}.classic .out{color:#0f172a;border-color:#cbd5e1}
body.minimal{background:#fff;color:#111}.minimal .grid{grid-template-columns:1fr}.minimal .t{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;border-radius:0;padding:12px 2px}.minimal .t small{opacity:.6}.minimal .t b{margin:0;font-size:15px}.minimal .buy{background:var(--p);color:#fff}.minimal .out{color:#111;border-color:#d1d5db}
body.receipt{background:#e7e5e4;color:#1c1917;font-family:ui-monospace,Menlo,Consolas,monospace}.receipt .w{margin-top:26px;background:#fffdf8;max-width:380px;border:1px dashed #a8a29e}.receipt header{text-align:center;border-bottom:1px dashed #a8a29e;padding-bottom:12px}.receipt .grid{grid-template-columns:1fr}.receipt .t{display:flex;justify-content:space-between;padding:7px 2px}.receipt .t b{margin:0;font-size:14px}.receipt .buy{background:#1c1917;color:#fff;border-radius:3px}.receipt .out{color:#1c1917;border-radius:3px}
body.neon{background:#05070d;color:#7dffb2;font-family:ui-monospace,Menlo,Consolas,monospace}.neon .t{background:#0b1220;border:1px solid var(--a);box-shadow:0 0 12px color-mix(in srgb,var(--a) 35%,transparent);border-radius:6px}.neon .t b{color:var(--a)}.neon .buy{background:transparent;border:1px solid var(--a);color:var(--a);box-shadow:0 0 14px color-mix(in srgb,var(--a) 40%,transparent)}.neon .out{color:#7dffb2;border-color:#1f6f48}
${phone?".w{padding-top:56px!important}":""}
</style></head><body class="${cfg.design}"><div class="w"><header>${logo}<h1>${esc(cfg.brandName)}</h1><p>You are connected${preview?'':' · $(username)'}</p></header><div class="grid">${grid}</div><a class="btn buy" href="${esc(origin)}/portal/" target="_blank" rel="noopener">${esc(cfg.buyLabel)}</a><a class="btn out" href="${v.logout}">Disconnect</a></div></body></html>`;
}
module.exports={DESIGNS,DEFAULTS,get,save,validate,page};
