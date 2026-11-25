'use strict';
// Account numbers: PPPoE and static customers created with a blank account number (username) get the next number in
// the ISP's own series, e.g. ACC-{n:5} → ACC-00001. Numbers typed in, and imported ones, are kept as they are. A number
// any customer already has (deleted customers included) is skipped.
const fail=(m,s=400)=>{throw Object.assign(new Error(m),{status:s});};
const DEF={enabled:false,pattern:'',last:0,ispCode:false,defaultUsername:'type'};
function settings(store){return {...DEF,...(store.setting('accountNumbers')||{})};}
function check(pattern){const p=String(pattern||'').trim();if(!p)return '';if(p.length>40)fail('The pattern is up to 40 characters');
 const m=p.match(/\{n(?::(\d+))?\}/g)||[];if(m.length!==1)fail('Put exactly one {n} (or {n:5}) in the pattern');const w=Number((/\{n:(\d+)\}/.exec(p)||[])[1]||1);if(w<1||w>12)fail('Padding is 1 to 12 digits');
 if(!/^[A-Za-z0-9._ -]*$/.test(p.replace(/\{n(?::\d+)?\}/,'')))fail('Use letters, numbers, dots, dashes, spaces or underscores around {n}');return p;}
const ispCode=store=>{try{return require('./portal.cjs').settings(store).accountPrefix||'KNE';}catch{return 'KNE';}};
function format(store,cfg,n){const out=cfg.pattern.replace(/\{n(?::(\d+))?\}/,(_,w)=>String(n).padStart(Number(w||1),'0'));return (cfg.ispCode?ispCode(store)+'-':'')+out;}
function taken(store){const s=new Set();for(const x of store.list('subscribers'))s.add(String(x.username||'').toLowerCase());for(const x of store.list('deletedSubscribers'))s.add(String(x.username||'').toLowerCase());return s;}
function preview(store,cfg=settings(store)){if(!cfg.pattern)return null;const t=taken(store);let n=Number(cfg.last)||0;do{n++;}while(t.has(format(store,cfg,n).toLowerCase())&&n<cfg.last+100000);return {number:format(store,cfg,n),n};}
// Takes the next number and moves the counter on (call inside the transaction that creates the customer).
function take(store){const cfg=settings(store);if(!cfg.enabled||!cfg.pattern)return '';const p=preview(store,cfg);store.setting('accountNumbers',{...cfg,last:p.n});return p.number;}
function save(store,input){const cur=settings(store),pattern=input.pattern===undefined?cur.pattern:check(input.pattern),last=input.last===undefined?cur.last:Math.round(Number(input.last));
 if(!Number.isFinite(last)||last<0||last>1e12)fail('The last number used is 0 or more');const enabled=input.enabled===undefined?cur.enabled:!!input.enabled;if(enabled&&!pattern)fail('Enter a pattern first');
 const du=['type','account','phone'].includes(input.defaultUsername)?input.defaultUsername:cur.defaultUsername;
 const next={enabled,pattern,last,ispCode:input.ispCode===undefined?cur.ispCode:!!input.ispCode,defaultUsername:du};store.setting('accountNumbers',next);return view(store);}
// The highest number in the pattern among existing customers, so the series carries on after an old system.
function suggest(store,pattern){const p=check(pattern||settings(store).pattern);if(!p)fail('Enter a pattern first');const cfg={...settings(store),pattern:p};
 const pre=(cfg.ispCode?ispCode(store)+'-':'')+p,i=pre.search(/\{n(?::\d+)?\}/),a=pre.slice(0,i).toLowerCase(),b=pre.slice(pre.indexOf('}',i)+1).toLowerCase();let max=0;
 for(const u of taken(store))if(u.startsWith(a)&&u.endsWith(b)){const mid=u.slice(a.length,u.length-b.length);if(/^\d{1,12}$/.test(mid))max=Math.max(max,Number(mid));}return {last:max};}
function view(store){const cfg=settings(store);return {...cfg,ispCodeText:ispCode(store)+'-',next:cfg.pattern?preview(store,cfg).number:''};}
module.exports={settings,save,take,preview,suggest,view,format};
