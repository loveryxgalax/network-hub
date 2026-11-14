'use strict';
// Speed rules: raise slower customers (floor), cut faster ones (ceiling) or set an exact speed, for the whole ISP,
// one router, one package or one customer, optionally on a schedule (Nairobi time) or until a time ("flight speed").
// The most specific matching rule wins over broader ones: ISP, then router, then package, then customer, unless an
// everyone-rule takes priority over a level, which then has its rules ignored.
const crypto=require('node:crypto');
const fail=m=>{throw Object.assign(new Error(m),{status:400});};
const SCOPES=['isp','router','plan','customer'],MODES=['raise','cut','exact'],NAIROBI=3*36e5;
const num=(v,l)=>{const n=Number(v);if(!(n>=0.064&&n<=10000))fail('Invalid '+l);return n;};
function validate(input,existing={}){
 const v={...existing,...input},scope=SCOPES.includes(v.scope)?v.scope:fail('Choose who the rule is for');
 if(scope!=='isp'&&!String(v.targetId||''))fail('Choose the router, package or customer');
 const mode=MODES.includes(v.mode)?v.mode:fail('Choose raise, cut or exact');
 const out={scope,targetId:scope==='isp'?'':String(v.targetId),mode,downMbps:num(v.downMbps,'download speed'),upMbps:num(v.upMbps,'upload speed'),service:['all','pppoe','hotspot'].includes(v.service)?v.service:'all',enabled:v.enabled!==false&&v.enabled!=='false',note:String(v.note||'').slice(0,120),until:v.until?Number(v.until):null,schedule:null,
  // An everyone-rule can take priority over router, package and customer rules (ISPman's "What it takes priority over").
  over:scope==='isp'?(Array.isArray(v.over)?v.over:[]).filter(x=>['router','plan','customer'].includes(x)).filter((x,i,a)=>a.indexOf(x)===i):[]};
 if(out.until!==null&&!Number.isFinite(out.until))fail('Invalid end time');
 const s=v.schedule;if(s&&(s.enabled===true||s.enabled==='on')){const days=(Array.isArray(s.days)?s.days:[]).map(Number).filter(d=>d>=0&&d<=6),from=Math.round(Number(s.fromHour)),to=Math.round(Number(s.toHour));if(!days.length)fail('Choose the days the rule applies');if(!(from>=0&&from<=23&&to>=0&&to<=24&&from!==to))fail('Invalid schedule hours');out.schedule={days:[...new Set(days)].sort(),fromHour:from,toHour:to};}
 return out;
}
function list(store){return store.setting('speedRules')?.items||[];}
function save(store,input,id){const items=list(store),old=id?items.find(r=>r.id===id):null;if(id&&!old)throw Object.assign(new Error('Rule not found'),{status:404});const rule={...validate(input,old||{}),id:old?.id||crypto.randomUUID(),created:old?.created||Date.now()};store.setting('speedRules',{items:old?items.map(r=>r.id===id?rule:r):[...items,rule]});return rule;}
function remove(store,id){const items=list(store);if(!items.some(r=>r.id===id))throw Object.assign(new Error('Rule not found'),{status:404});store.setting('speedRules',{items:items.filter(r=>r.id!==id)});}
function activeNow(r,now){if(!r.enabled)return false;if(r.until&&now>=r.until)return false;if(!r.schedule)return true;const d=new Date(now+NAIROBI),h=d.getUTCHours(),day=d.getUTCDay(),s=r.schedule,inHours=s.fromHour<s.toHour?h>=s.fromHour&&h<s.toHour:h>=s.fromHour||h<s.toHour;return s.days.includes(day)&&inHours;}
// Returns the effective rate and a plain-language explanation of every step.
function resolve(store,{subscriber,plan,routerId='',service,baseDown,baseUp},now=Date.now()){
 let down=baseDown,up=baseUp;const steps=[`Package ${plan?.name||''}: ${baseDown} / ${baseUp} Mbps`];
 const matches=list(store).filter(r=>activeNow(r,now)&&(r.service==='all'||r.service===service)&&(r.scope==='isp'||(r.scope==='router'&&r.targetId===routerId)||(r.scope==='plan'&&r.targetId===plan?.id)||(r.scope==='customer'&&r.targetId===subscriber?.id)));
 matches.sort((a,b)=>SCOPES.indexOf(a.scope)-SCOPES.indexOf(b.scope));
 const overridden=new Set(matches.filter(r=>r.scope==='isp').flatMap(r=>r.over||[]));
 for(const r of matches.filter(r=>overridden.has(r.scope)))steps.push(`${{router:'Router rule',plan:'Package rule',customer:'Customer rule'}[r.scope]} ignored: an everyone-rule takes priority`);
 const applied=matches.filter(r=>!overridden.has(r.scope));
 for(const r of applied){const bd=down,bu=up;if(r.mode==='raise'){down=Math.max(down,r.downMbps);up=Math.max(up,r.upMbps);}else if(r.mode==='cut'){down=Math.min(down,r.downMbps);up=Math.min(up,r.upMbps);}else{down=r.downMbps;up=r.upMbps;}
  steps.push(`${{isp:'All customers',router:'Router rule',plan:'Package rule',customer:'Customer rule'}[r.scope]} (${{raise:'raise to at least',cut:'cut to at most',exact:'set to exactly'}[r.mode]} ${r.downMbps} / ${r.upMbps} Mbps${r.until?', until '+new Date(r.until).toISOString().slice(0,16).replace('T',' ')+' UTC':''}): ${bd}/${bu} → ${down}/${up} Mbps`);}
 return {downMbps:down,upMbps:up,changed:down!==baseDown||up!==baseUp,steps,rules:applied.map(r=>r.id)};
}
// Remove expired temporary rules so the list stays readable.
function prune(store,now=Date.now()){const items=list(store),keep=items.filter(r=>!r.until||r.until>now-864e5);if(keep.length!==items.length)store.setting('speedRules',{items:keep});}
module.exports={validate,list,save,remove,resolve,activeNow,prune};
