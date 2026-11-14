'use strict';
// Package editor with tabs: Details, Burst, Fair usage, Notifications, Time & day of purchase, Other.
// Replaces the simple plan form in radius.js; the server validates everything again.
const PK_NOTICES=[[2,'2 minutes'],[5,'5 minutes'],[10,'10 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour'],[1440,'1 day'],[10080,'1 week']];
const PK_DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
// Package speed override (shared by PPPoE and hotspot editors): stored as a package-level speed rule.
function pkOverrideHtml(rule){const ruleRaise=!rule||rule.mode!=='cut',ruleCut=!!rule&&rule.mode!=='raise';return `<h3 class="pk-h">Speed override</h3><p class="muted">Shape this package's sessions at a different speed from the one it is sold at. Leave both blank to use the package speed. Everyone-rules on the Speed rules page can still take priority.</p>
 <div class="form-grid"><label>Upload (Mbps)<input id="pk-ov-up" type="number" min="0.064" step="0.001" value="${h(rule?.upMbps??'')}"></label><label>Download (Mbps)<input id="pk-ov-down" type="number" min="0.064" step="0.001" value="${h(rule?.downMbps??'')}"></label></div>
 <p class="muted small">Which customers this moves, compared against the speed they would have had without it.</p>
 <label class="pk-switch"><input type="checkbox" id="pk-ov-raise" ${ruleRaise?'checked':''}><span></span><b>Raise customers who are slower</b></label><label class="pk-switch"><input type="checkbox" id="pk-ov-cut" ${ruleCut?'checked':''}><span></span><b>Cut customers who are faster</b></label>
 <p><button type="button" class="button secondary" id="pk-ov-save">Save speed override</button></p>`;}
function pkOverride(id,kind,rule){$('#pk-ov-save').onclick=async()=>{const up=$('#pk-ov-up').value,down=$('#pk-ov-down').value,raise=$('#pk-ov-raise').checked,cut=$('#pk-ov-cut').checked;
  try{if(!up&&!down){if(rule)await api('speed-rules/'+rule.id,'DELETE');toast('Speed override cleared');return;}
   if(!up||!down)throw new Error('Enter both the upload and the download speed');if(!raise&&!cut)throw new Error('Choose who it applies to: slower customers, faster customers, or both');
   const body={scope:'plan',targetId:id,service:kind,mode:raise&&cut?'exact':raise?'raise':'cut',downMbps:down,upMbps:up,note:'Package speed override'};
   const r=rule?await api('speed-rules/'+rule.id,'PATCH',body):await api('speed-rules','POST',body);rule=r?.id?r:rule;toast('Speed override saved');}catch(e){toast(e.message);}};}
async function pkRule(id){try{return ((await api('speed-rules')).items||[]).find(r=>r.scope==='plan'&&r.targetId===id)||null;}catch{return null;}}
// "When it can be bought": show the hour and day pickers only when ticked, quick day presets, and a plain summary.
function pkWindowWire(){const f=$('#editor-form');if(!f||!f.querySelector('[name="window.fromHour"]'))return;
 const H24=i=>String(i).padStart(2,'0')+':00',DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 const paint=()=>{const hOn=f['window.hours'].checked,dOn=f['window.days'].checked;f.querySelector('.pk-win-hours').hidden=!hOn;f.querySelector('.pk-win-days').hidden=!dOn;
  const a=Number(f['window.fromHour'].value),b=Number(f['window.toHour'].value),days=[...f.querySelectorAll('[name="window.weekdays"]:checked')].map(x=>Number(x.value)).sort();
  const when=!hOn?'at any time':a===b%24?'all day':`from ${H24(a)} to ${H24(b)}${b<=a?' (overnight, ends the next morning)':''}`;
  const on=!dOn||days.length===7?'every day':!days.length?'on no day (choose at least one)':days.join()==='1,2,3,4,5'?'on weekdays':days.join()==='0,6'?'at weekends':'on '+days.map(d=>DAYS[d]).join(', ');
  $('#pk-win-sum').textContent=!hOn&&!dOn?'On sale at any time, every day.':`On sale ${on}, ${when} (Nairobi time).`;};
 for(const b of f.querySelectorAll('[data-win-days]'))b.onclick=()=>{const set=b.dataset.winDays.split(',');for(const x of f.querySelectorAll('[name="window.weekdays"]'))x.checked=set.includes(x.value);paint();};
 f.addEventListener('change',e=>{if(/^window\./.test(e.target.name||''))paint();});paint();}
function pkCollect(fd){
  const out={burst:{},fup:{},window:{},notices:{},trial:{},custom:{}};
  for(const [k,v] of fd.entries()){if(['notices.before','notices.usage','window.weekdays','routerIds'].includes(k)||/^fup\.t\d/.test(k)||/^custom\.d\d/.test(k))continue;const [a,c]=k.split('.');if(c)out[a][c]=v;else out[k]=v;}
  for(const k of ['burst.enabled','fup.enabled','window.hours','window.days','notices.expired','popular','hidden','trial.enabled','custom.enabled'])if(!fd.has(k)){const [a,c]=k.split('.');if(c)out[a][c]=false;else out[k]=false;}
  out.notices.before=fd.getAll('notices.before').map(Number);out.notices.usage=fd.getAll('notices.usage').map(Number);out.routerIds=fd.getAll('routerIds');
  out.fup.tiers=[0,1].map(i=>({downCapMB:fd.get(`fup.t${i}cap`),afterDownMbps:fd.get(`fup.t${i}down`),afterUpMbps:fd.get(`fup.t${i}up`)})).filter(t=>t.downCapMB);out.window.weekdays=fd.getAll('window.weekdays').map(Number);out.custom.discounts=[0,1,2].map(i=>({minQty:fd.get(`custom.d${i}qty`),percent:fd.get(`custom.d${i}pct`)||0})).filter(d=>d.minQty);
  return out;
}
const pkSw=(name,on,label,hint='',value='')=>`<label class="pk-switch"><input type="checkbox" name="${name}" ${value!==''?`value="${value}"`:''} ${on?'checked':''}><span></span><b>${label}</b>${hint?`<small>${hint}</small>`:''}</label>`,
 pkNum=(name,label,val,attrs='')=>radiusField(label,`<input name="${name}" type="number" ${attrs} value="${h(val??'')}">`);
// Which kind of package the current page is about (null on the combined Subscribers & plans page).
function planKind(){const pp=radiusView.planPred;if(!pp)return null;const a=pp({service:'pppoe'}),b=pp({service:'hotspot'});return a&&!b?'pppoe':b&&!a?'hotspot':null;}
// One editor per kind: PPPoE packages and hotspot packages have different settings, so they are never mixed.
function planEditor(id,kind){
 const cur=id?radiusView.data.plans.find(x=>x.id===id):null;kind=kind||(cur?(cur.service==='pppoe'?'pppoe':'hotspot'):planKind());
 if(!kind){radiusForm('New package','Which kind of package?',radiusField('Kind',`<select name="kind"><option value="pppoe">PPPoE package (home and business fibre)</option><option value="hotspot">Hotspot package (WiFi)</option></select>`),'Continue',async inp=>{setTimeout(()=>planEditor(null,inp.kind),60);});return;}
 return kind==='pppoe'?pppoeEditor(id):hotspotEditor(id);
}
async function hotspotEditor(id){const rule=id?await pkRule(id):null;
 const p=radiusView.data.plans.find(x=>x.id===id)||{service:'hotspot',durationValue:1,durationUnit:'days',devices:1,active:true,burst:{},fup:{},window:{},notices:{before:[]},features:[]};
 const b=p.burst||{},f=p.fup||{},w=p.window||{},n=p.notices||{before:[]},chk=(name,on,label,hint='')=>`<label class="pk-switch"><input type="checkbox" name="${name}" ${on?'checked':''}><span></span><b>${label}</b>${hint?`<small>${hint}</small>`:''}</label>`,num=(name,label,val,attrs='')=>radiusField(label,`<input name="${name}" type="number" ${attrs} value="${h(val??'')}">`);
 const tabs=[['details','Details'],['burst','Burst'],['fup','Fair usage'],['notices','Notifications'],['window','Time & day of purchase'],['other','Other']];
 const html=`<nav class="pk-tabs" role="tablist">${tabs.map(([k,l],i)=>`<button type="button" role="tab" data-pk-tab="${k}" class="${i?'':'active'}">${l}</button>`).join('')}</nav>
 <section data-pk="details">
  ${radiusField('Package name',`<input name="name" required maxlength="120" value="${h(p.name||'')}" placeholder="24 hrs unlimited">`)}
  <div class="form-grid"><input type="hidden" name="service" value="${p.service==='both'?'both':'hotspot'}">${num('price','Price (KSh)',p.price,'min="0" step="1" required')}
  ${num('downloadMbps','Download (Mbps)',p.downloadMbps,'min="0.064" step="0.001" required')}${num('uploadMbps','Upload (Mbps)',p.uploadMbps,'min="0.064" step="0.001" required')}
  ${num('durationValue','Lasts',p.durationValue,'min="1" max="1000" required')}${radiusField('Unit',`<select name="durationUnit">${radiusOptions([['minutes','Minutes'],['hours','Hours'],['days','Days'],['weeks','Weeks'],['months','Months (30 days)']],p.durationUnit)}</select>`)}
  ${num('devices','Devices at once',p.devices,'min="1" max="50"')}${num('idleTimeoutMinutes','Idle timeout (minutes, 0 = none)',p.idleTimeoutMinutes||0,'min="0" max="1440"')}
  ${num('interimSeconds','Accounting interval (seconds, 0 = default)',p.interimSeconds||0,'min="0" max="3600"')}${num('order','Order on the portal (lower first)',p.order||0,'min="0" max="9999"')}${num('maxSessions','Max concurrent sessions on this package (0 = no limit)',p.maxSessions||0,'min="0" max="100000"')}</div>
  ${radiusField('Features shown on the portal (one per line, up to 8)',`<textarea name="features" rows="3" maxlength="600" placeholder="Unlimited data&#10;Stream HD">${h((p.features||[]).join('\n'))}</textarea>`)}
  ${radiusField('Description (optional)',`<input name="description" maxlength="500" value="${h(p.description||'')}">`)}
  ${chk('popular',p.popular,'Popular','Shows a “popular” badge on the portal')}
  <p class="muted">Routers that sell this package (none ticked = all routers):</p><div class="pk-chips">${rows('devices').filter(d=>d.type==='router').map(r=>`<label class="pk-chip"><input type="checkbox" name="routerIds" value="${h(r.id)}" ${(p.routerIds||[]).includes(r.id)?'checked':''}> ${h(r.name)}</label>`).join('')||'<span class="muted small">No routers yet.</span>'}</div></section>
 <section data-pk="burst" hidden><p class="muted">Let customers go faster for a short time (for example while a page loads). The speed rises to the burst limit while their average over the averaging time stays under the threshold.</p>
  ${chk('burst.enabled',b.enabled,'Enable burst')}
  <div class="form-grid">${num('burst.downMbps','Burst limit download (Mbps)',b.downMbps,'min="0.064" step="0.001"')}${num('burst.upMbps','Burst limit upload (Mbps)',b.upMbps,'min="0.064" step="0.001"')}
  ${num('burst.thresholdDownMbps','Threshold download (Mbps)',b.thresholdDownMbps,'min="0.064" step="0.001"')}${num('burst.thresholdUpMbps','Threshold upload (Mbps)',b.thresholdUpMbps,'min="0.064" step="0.001"')}
  ${num('burst.seconds','Averaging time (seconds)',b.seconds??8,'min="1" max="3600"')}</div><p class="muted small">The burst limit must be above the normal speed; the threshold must not be above it.</p></section>
 <section data-pk="fup" hidden><p class="muted">When a customer uses more than the cap inside one paid period, they get the reduced speed from their next login. 0 means no cap.</p>
  ${chk('fup.enabled',f.enabled,'Enable fair usage policy')}
  ${radiusField('Count usage per',`<select name="fup.period">${radiusOptions([['package','Paid period'],['daily','Day (resets at midnight)']],f.period||'package')}</select>`)}
  <div class="form-grid">${num('fup.downCapMB','Download cap (MB)',f.downCapMB||0,'min="0"')}${num('fup.upCapMB','Upload cap (MB)',f.upCapMB||0,'min="0"')}
  ${num('fup.timeCapMinutes','Online-time cap (minutes)',f.timeCapMinutes||0,'min="0"')}<span></span>
  ${num('fup.afterDownMbps','Speed after the cap: download (Mbps)',f.afterDownMbps,'min="0.064" step="0.001"')}${num('fup.afterUpMbps','Speed after the cap: upload (Mbps)',f.afterUpMbps,'min="0.064" step="0.001"')}</div>
  <h3>Adaptive steps (optional)</h3><p class="muted small">Slow the customer down further after bigger download caps. Leave a cap empty to skip that step.</p>
  ${[0,1].map(i=>{const t=(f.tiers||[])[i]||{};return `<div class="form-grid">${num(`fup.t${i}cap`,`Step ${i+2}: after (MB downloaded)`,t.downCapMB??'','min="0"')}${num(`fup.t${i}down`,'Download (Mbps)',t.afterDownMbps??'','min="0.064" step="0.001"')}${num(`fup.t${i}up`,'Upload (Mbps)',t.afterUpMbps??'','min="0.064" step="0.001"')}</div>`;}).join('')}</section>
 <section data-pk="notices" hidden><p class="muted">SMS sent to customers on this package (needs the SMS provider and a phone number). These go out at any hour, unlike the daily reminders.</p>
  ${chk('notices.expired',n.expired,'When the package expires')}
  <p class="muted">Fair-usage progress (needs a download cap):</p><div class="pk-chips">${[50,80,100].map(x=>`<label class="pk-chip"><input type="checkbox" name="notices.usage" value="${x}" ${(n.usage||[]).includes(x)?'checked':''}> ${x}% of the cap used</label>`).join('')}</div>
  <p class="muted">Before expiry:</p><div class="pk-chips">${PK_NOTICES.map(([m,l])=>`<label class="pk-chip"><input type="checkbox" name="notices.before" value="${m}" ${n.before?.includes(m)?'checked':''}> ${l} before expiry</label>`).join('')}</div></section>
 <section data-pk="window" hidden><p class="muted">Limit when this package can be bought (Nairobi time). Customers who already bought it keep using it outside these times.</p>
  <p class="pk-win-sum" id="pk-win-sum" aria-live="polite"></p>
  ${chk('window.hours',w.hours,'Only sell between certain hours','For example a night package sold from 22:00 to 06:00')}
  <div class="form-grid pk-win-hours"><label>From<select name="window.fromHour">${Array.from({length:24},(_,i)=>`<option value="${i}" ${(w.fromHour??22)===i?'selected':''}>${String(i).padStart(2,'0')}:00 (${i===0?'midnight':i===12?'noon':i<12?i+' AM':(i-12)+' PM'})</option>`).join('')}</select></label><label>Until<select name="window.toHour">${Array.from({length:25},(_,i)=>i).filter(i=>i>0).map(i=>`<option value="${i}" ${(w.toHour??6)===i?'selected':''}>${i===24?'24:00 (midnight)':String(i).padStart(2,'0')+':00 ('+(i===12?'noon':i<12?i+' AM':(i-12)+' PM')+')'}</option>`).join('')}</select></label></div>
  ${chk('window.days',w.days,'Only sell on certain days','For example a weekend package')}
  <div class="pk-win-days"><div class="pk-win-quick"><button type="button" class="button secondary" data-win-days="0,1,2,3,4,5,6">Every day</button><button type="button" class="button secondary" data-win-days="1,2,3,4,5">Weekdays</button><button type="button" class="button secondary" data-win-days="0,6">Weekend</button></div>
  <div class="pk-chips">${[1,2,3,4,5,6,0].map(i=>`<label class="pk-chip"><input type="checkbox" name="window.weekdays" value="${i}" ${w.weekdays?.includes(i)?'checked':''}> ${PK_DAYS[i]}</label>`).join('')}</div></div></section>
 <section data-pk="other" hidden>
  ${chk('offSale',p.active===false,'Package disabled (off sale)','Not sold on the portal; existing customers keep it')}
  ${chk('hidden',p.hidden,'Hide from the landing page','Still usable for vouchers, manual connects and staff renewals')}
  <h3>Free trial</h3>${chk('trial.enabled',p.trial?.enabled,'Offer a free trial on the WiFi page','One trial per device, then the customer must wait before another')}
  <div class="form-grid"><label>Trial length (minutes)<input name="trial.minutes" type="number" min="1" max="1440" value="${p.trial?.minutes||10}"></label><label>Days before the same device can try again<input name="trial.everyDays" type="number" min="1" max="365" value="${p.trial?.everyDays||30}"></label></div>
  <h3>Customize (buy several)</h3>${chk('custom.enabled',p.custom?.enabled,'Let customers buy several units at once','For example 3 × daily = 3 days. The validity and price are multiplied.')}
  <div class="form-grid"><label>Most units per purchase<input name="custom.maxQty" type="number" min="2" max="100" value="${p.custom?.maxQty||7}"></label></div><div class="form-grid">${[0,1,2].map(i=>`<label>Discount ${i+1}: from units<input name="custom.d${i}qty" type="number" min="2" max="100" value="${p.custom?.discounts?.[i]?.minQty??''}"></label><label>Discount ${i+1}: percent off<input name="custom.d${i}pct" type="number" min="0" max="90" step="0.5" value="${p.custom?.discounts?.[i]?.percent??''}"></label>`).join('')}</div>
  ${id?`<div class="pk-hs-ov">${pkOverrideHtml(rule)}</div>`:''}
  ${id?`<h3>Version history</h3><p class="muted small">This is version ${p.version||1}. Payments record the version they were made under.</p><div id="pk-versions"><button type="button" class="button secondary" id="pk-load-versions">Show earlier versions</button></div>`:''}</section>`;
 radiusForm(id?'Edit hotspot package':'New hotspot package','Changes apply at each customer\'s next login.',html,id?'Save package':'Create package',()=>{
  const fd=new FormData($('#editor-form')),out=pkCollect(fd);
  out.active=!fd.has('offSale');delete out.offSale;out.features=String(out.features||'').split('\n').map(s=>s.trim()).filter(Boolean);
  return api(id?'radius/plans/'+id:'radius/plans',id?'PATCH':'POST',out);});
 $('#editor').classList.add('pk-editor');$('#editor').addEventListener('close',()=>$('#editor').classList.remove('pk-editor'),{once:true});
 if(id)pkOverride(id,p.service==='both'?'all':'hotspot',rule);
 for(const t of document.querySelectorAll('[data-pk-tab]'))t.onclick=()=>{for(const x of document.querySelectorAll('[data-pk-tab]'))x.classList.toggle('active',x===t);for(const s of document.querySelectorAll('[data-pk]'))s.hidden=s.dataset.pk!==t.dataset.pkTab;};
 pkWindowWire();
 const lv=$('#pk-load-versions');if(lv)lv.onclick=async()=>{try{const r=await api('radius/plans/'+id+'?versions=1');$('#pk-versions').innerHTML=r.versions.length?table(['VERSION','REPLACED','BY','PRICE','SPEED'],r.versions,v=>`<tr><td>${v.version}</td><td>${h(stamp(v.replacedAt))}</td><td>${h(v.by||'')}</td><td>${ksh(v.terms.price)}</td><td>${v.terms.downloadMbps} / ${v.terms.uploadMbps} Mbps</td></tr>`):'<p class="muted">No earlier versions.</p>';}catch(e){toast(e.message);}};
 // A server error names the field; open the tab that holds it.
 const err=$('#editor-error');new MutationObserver(()=>{const m=err.textContent.toLowerCase(),tab=/burst|threshold|averag/.test(m)?'burst':/cap|fair|after the cap/.test(m)?'fup':/hour|day/.test(m)?'window':/feature/.test(m)?'details':null;if(tab)document.querySelector(`[data-pk-tab="${tab}"]`)?.click();}).observe(err,{childList:true,characterData:true,subtree:true});
}

async function pppoeEditor(id){
 const p=id?radiusView.data.plans.find(x=>x.id===id):null;if(id&&!p)return;
 const UN=[['months','Months (30 days)'],['weeks','Weeks'],['days','Days'],['hours','Hours'],['minutes','Minutes']];
 if(!id){
  radiusForm('Create a new PPPoE package','Speed, price and how long one payment lasts. Burst, fair usage and alerts are set once it is created.',
   `<input type="hidden" name="service" value="pppoe">`+radiusField('Package Name',`<input name="name" required maxlength="120" placeholder="Home 10 Mbps">`)+
   `<div class="form-grid">${pkNum('downloadMbps','Download Speed (Mbps) *','','min="0.064" step="0.001" required')}${pkNum('uploadMbps','Upload Speed (Mbps) *','','min="0.064" step="0.001" required')}${radiusField('Expires After',`<select name="durationUnit">${radiusOptions(UN,'months')}</select>`)}${pkNum('durationValue','Expires After Value *',1,'min="1" max="1000" required')}</div>`+
   pkNum('price','Price (KSh) *','','min="0" step="1" required')+pkSw('hidden',false,'Hide from landing page','Still sold to customers, but not listed on your landing page.'),
   'Save',async inp=>{const r=await api('radius/plans','POST',{...inp,devices:1});await loadRadius();const nid=r?.id||r?.plan?.id;if(nid)setTimeout(()=>pppoeEditor(nid),80);});
  return;
 }
 let rule=null;try{rule=((await api('speed-rules')).items||[]).find(r=>r.scope==='plan'&&r.targetId===id)||null;}catch{}
 const b=p.burst||{},f=p.fup||{},n=p.notices||{before:[],usage:[]},c=p.custom||{},ruleRaise=!rule||rule.mode!=='cut',ruleCut=!!rule&&rule.mode!=='raise';
 const html=`<div class="pk-pphead"><a href="#plan-customers?id=${h(id)}" data-pk-go="plan-customers?id=${h(id)}">Customers</a><a href="#plan-customers?id=${h(id)}&amp;tab=payments" data-pk-go="plan-customers?id=${h(id)}&tab=payments">Payments</a><button type="button" class="ra-btn ra-danger" id="pk-del"><span>Delete</span></button></div>
 <input type="hidden" name="service" value="pppoe">
 <h3 class="pk-h">Package Info</h3>
 ${radiusField('Package Name',`<input name="name" required maxlength="120" value="${h(p.name||'')}">`)}
 <div class="form-grid">${pkNum('downloadMbps','Download Speed (Mbps) *',p.downloadMbps,'min="0.064" step="0.001" required')}${pkNum('uploadMbps','Upload Speed (Mbps) *',p.uploadMbps,'min="0.064" step="0.001" required')}${radiusField('Expires After',`<select name="durationUnit">${radiusOptions(UN,p.durationUnit)}</select>`)}${pkNum('durationValue','Expires After Value *',p.durationValue,'min="1" max="1000" required')}</div>
 ${pkNum('price','Price (KSh) *',p.price,'min="0" step="1" required')}${pkNum('maxSessions','Max concurrent sessions on this package (0 = no limit)',p.maxSessions||0,'min="0" max="100000"')}
 <h3 class="pk-h">Burst Settings</h3><p class="muted">Configure burst settings for temporary speed boosts. Burst allows customers to exceed their max-limit for a limited time when their average usage is below the threshold.</p>
 ${pkSw('burst.enabled',b.enabled,'Enable burst')}
 <h4>Download Burst</h4><div class="form-grid">${pkNum('burst.downMbps','Limit (Mbps)',b.downMbps,'min="0.064" step="0.001"')}${pkNum('burst.thresholdDownMbps','Threshold (Mbps)',b.thresholdDownMbps,'min="0.064" step="0.001"')}</div>
 <h4>Upload Burst</h4><div class="form-grid">${pkNum('burst.upMbps','Limit (Mbps)',b.upMbps,'min="0.064" step="0.001"')}${pkNum('burst.thresholdUpMbps','Threshold (Mbps)',b.thresholdUpMbps,'min="0.064" step="0.001"')}</div>
 ${pkNum('burst.seconds','Time (sec): period for the average calculation',b.seconds??8,'min="1" max="3600"')}
 <div class="pk-info"><b>How burst works:</b><ul><li><b>Burst Limit:</b> the maximum speed during burst (must be higher than the package speed)</li><li><b>Burst Threshold:</b> burst is allowed when the average usage stays below this value</li><li><b>Burst Time:</b> the time window used to calculate the average rate (not the burst duration)</li></ul><p>Example: for a 10 Mbps package with burst limit 20M, threshold 8M and time 16 s, a customer whose average over the last 16 seconds is below 8 Mbps gets boosted to 20 Mbps. Once the average reaches 8 Mbps, the speed drops back to the normal 10 Mbps.</p></div>
 <h3 class="pk-h">FUP Policy</h3><p class="muted">Configure Fair Usage Policy (FUP) settings. Slow the speed when a customer uses more data than expected.</p>
 ${pkSw('fup.enabled',f.enabled,'Enable FUP Policy','Enable fair usage policy throttling for this package')}
 ${radiusField('Count usage per',`<select name="fup.period">${radiusOptions([['package','Paid period'],['daily','Day (Daily FUP: usage resets at midnight)']],f.period||'package')}</select>`)}
 <div class="form-grid">${pkNum('fup.downCapMB','Download cap (MB)',f.downCapMB||0,'min="0"')}${pkNum('fup.upCapMB','Upload cap (MB)',f.upCapMB||0,'min="0"')}${pkNum('fup.timeCapMinutes','Online-time cap (minutes)',f.timeCapMinutes||0,'min="0"')}<span></span>${pkNum('fup.afterDownMbps','Speed after the cap: download (Mbps)',f.afterDownMbps,'min="0.064" step="0.001"')}${pkNum('fup.afterUpMbps','Speed after the cap: upload (Mbps)',f.afterUpMbps,'min="0.064" step="0.001"')}</div>
 ${[0,1].map(i=>{const t=(f.tiers||[])[i]||{};return `<div class="form-grid">${pkNum(`fup.t${i}cap`,`Step ${i+2}: after (MB downloaded)`,t.downCapMB??'','min="0"')}${pkNum(`fup.t${i}down`,'Download (Mbps)',t.afterDownMbps??'','min="0.064" step="0.001"')}${pkNum(`fup.t${i}up`,'Upload (Mbps)',t.afterUpMbps??'','min="0.064" step="0.001"')}</div>`;}).join('')}
 ${pkSw('hidden',p.hidden,'Hide from landing page','Still sold to customers, but not listed on your landing page or through the branding API.')}
 <h3 class="pk-h">Customize</h3><p class="muted">Let customers choose how much to buy, say 4 hours or 3 days, at a price per unit, with an optional discount for buying more. Customers who do not customize still buy the package at its normal price and validity.</p>
 ${pkSw('custom.enabled',c.enabled,'Customizable','Customers choose a unit and quantity before paying')}
 <div class="form-grid">${pkNum('custom.maxQty','Most units per purchase',c.maxQty||7,'min="2" max="100"')}</div><div class="form-grid">${[0,1,2].map(i=>`${pkNum(`custom.d${i}qty`,`Discount ${i+1}: from units`,c.discounts?.[i]?.minQty??'','min="2" max="100"')}${pkNum(`custom.d${i}pct`,`Discount ${i+1}: percent off`,c.discounts?.[i]?.percent??'','min="0" max="90" step="0.5"')}`).join('')}</div>
 <h3 class="pk-h">Expiry Notifications</h3><p class="muted">Choose when to send expiry alerts to customers via SMS (needs the SMS provider and a phone number).</p>
 <div class="pk-two">${pkSw('notices.expired',n.expired,'When Expired')}${PK_NOTICES.map(([m,l])=>pkSw('notices.before',n.before?.includes(m),l+' before expiry','',m)).join('')}</div>
 <p class="muted">Fair-usage progress (needs a download cap):</p><div class="pk-two">${[50,80,100].map(x=>pkSw('notices.usage',(n.usage||[]).includes(x),x+'% of the cap used','',x)).join('')}</div>
 ${pkOverrideHtml(rule)}`;
 radiusForm('Edit PPPoE package · '+p.name,'Changes apply at each customer\'s next login.',html,'Save',()=>{
  const out=pkCollect(new FormData($('#editor-form')));for(const k of ['window','trial','routerIds','popular','features','active'])delete out[k];out.service='pppoe';
  return api('radius/plans/'+id,'PATCH',out);});
 $('#editor').classList.add('pk-editor');$('#editor').addEventListener('close',()=>$('#editor').classList.remove('pk-editor'),{once:true});
 for(const a of document.querySelectorAll('[data-pk-go]'))a.onclick=e=>{e.preventDefault();$('#editor').close();location.hash='#'+a.dataset.pkGo;};
 $('#pk-del').onclick=()=>{$('#editor').close();removeRecord('plans',id,p.name);};
 pkOverride(id,'pppoe',rule);
}
// Move a package up or down the portal list.
async function movePlan(id,dir){const list=radiusView.data.plans.filter(p=>!radiusView.planPred||radiusView.planPred(p)).sort((a,b)=>(a.order||0)-(b.order||0)||a.price-b.price),i=list.findIndex(p=>p.id===id),j=i+dir;if(i<0||j<0||j>=list.length)return;
 [list[i],list[j]]=[list[j],list[i]];try{for(let k=0;k<list.length;k++)if((list[k].order||0)!==k*10)await api('radius/plans/'+list[k].id,'PATCH',{order:k*10});await loadRadius();}catch(e){toast(e.message);}}
