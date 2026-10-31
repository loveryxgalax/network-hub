'use strict';
// Package editor with tabs: Details, Burst, Fair usage, Notifications, Time & day of purchase, Other.
// Replaces the simple plan form in radius.js; the server validates everything again.
const PK_NOTICES=[[2,'2 minutes'],[5,'5 minutes'],[10,'10 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour'],[1440,'1 day'],[10080,'1 week']];
const PK_DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function planEditor(id){
 const p=radiusView.data.plans.find(x=>x.id===id)||{service:'hotspot',durationValue:1,durationUnit:'days',devices:1,active:true,burst:{},fup:{},window:{},notices:{before:[]},features:[]};
 const b=p.burst||{},f=p.fup||{},w=p.window||{},n=p.notices||{before:[]},chk=(name,on,label,hint='')=>`<label class="pk-switch"><input type="checkbox" name="${name}" ${on?'checked':''}><span></span><b>${label}</b>${hint?`<small>${hint}</small>`:''}</label>`,num=(name,label,val,attrs='')=>radiusField(label,`<input name="${name}" type="number" ${attrs} value="${h(val??'')}">`);
 const tabs=[['details','Details'],['burst','Burst'],['fup','Fair usage'],['notices','Notifications'],['window','Time & day of purchase'],['other','Other']];
 const html=`<nav class="pk-tabs" role="tablist">${tabs.map(([k,l],i)=>`<button type="button" role="tab" data-pk-tab="${k}" class="${i?'':'active'}">${l}</button>`).join('')}</nav>
 <section data-pk="details">
  ${radiusField('Package name',`<input name="name" required maxlength="120" value="${h(p.name||'')}" placeholder="24 hrs unlimited">`)}
  <div class="form-grid">${radiusField('For',`<select name="service">${radiusOptions([['hotspot','Hotspot'],['pppoe','PPPoE'],['both','PPPoE and Hotspot']],p.service)}</select>`)}${num('price','Price (KSh)',p.price,'min="0" step="1" required')}
  ${num('downloadMbps','Download (Mbps)',p.downloadMbps,'min="0.064" step="0.001" required')}${num('uploadMbps','Upload (Mbps)',p.uploadMbps,'min="0.064" step="0.001" required')}
  ${num('durationValue','Lasts',p.durationValue,'min="1" max="1000" required')}${radiusField('Unit',`<select name="durationUnit">${radiusOptions([['hours','Hours'],['days','Days'],['weeks','Weeks'],['months','Months (30 days)']],p.durationUnit)}</select>`)}
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
  ${chk('window.hours',w.hours,'Only sell between certain hours')}
  <div class="form-grid">${num('window.fromHour','From (hour 0–23)',w.fromHour??22,'min="0" max="23"')}${num('window.toHour','Until (hour 0–24)',w.toHour??6,'min="0" max="24"')}</div><p class="muted small">From 22 until 6 means overnight.</p>
  ${chk('window.days',w.days,'Only sell on certain days')}
  <div class="pk-chips">${PK_DAYS.map((d,i)=>`<label class="pk-chip"><input type="checkbox" name="window.weekdays" value="${i}" ${w.weekdays?.includes(i)?'checked':''}> ${d}</label>`).join('')}</div></section>
 <section data-pk="other" hidden>
  ${chk('offSale',p.active===false,'Package disabled (off sale)','Not sold on the portal; existing customers keep it')}
  ${chk('hidden',p.hidden,'Hide from the landing page','Still usable for vouchers, manual connects and staff renewals')}
  <h3>Free trial</h3>${chk('trial.enabled',p.trial?.enabled,'Offer a free trial on the WiFi page','One trial per device, then the customer must wait before another')}
  <div class="form-grid"><label>Trial length (minutes)<input name="trial.minutes" type="number" min="1" max="1440" value="${p.trial?.minutes||10}"></label><label>Days before the same device can try again<input name="trial.everyDays" type="number" min="1" max="365" value="${p.trial?.everyDays||30}"></label></div>
  <h3>Customize (buy several)</h3>${chk('custom.enabled',p.custom?.enabled,'Let customers buy several units at once','For example 3 × daily = 3 days. The validity and price are multiplied.')}
  <div class="form-grid"><label>Most units per purchase<input name="custom.maxQty" type="number" min="2" max="100" value="${p.custom?.maxQty||7}"></label></div><div class="form-grid">${[0,1,2].map(i=>`<label>Discount ${i+1}: from units<input name="custom.d${i}qty" type="number" min="2" max="100" value="${p.custom?.discounts?.[i]?.minQty??''}"></label><label>Discount ${i+1}: percent off<input name="custom.d${i}pct" type="number" min="0" max="90" step="0.5" value="${p.custom?.discounts?.[i]?.percent??''}"></label>`).join('')}</div>
  ${id?`<h3>Version history</h3><p class="muted small">This is version ${p.version||1}. Payments record the version they were made under.</p><div id="pk-versions"><button type="button" class="button secondary" id="pk-load-versions">Show earlier versions</button></div>`:''}</section>`;
 radiusForm(id?'Edit package':'New package','Changes apply at each customer\'s next login.',html,id?'Save package':'Create package',()=>{
  const form=$('#editor-form'),fd=new FormData(form),out={burst:{},fup:{},window:{},notices:{},trial:{},custom:{}};
  for(const [k,v] of fd.entries()){if(['notices.before','notices.usage','window.weekdays','routerIds'].includes(k)||/^fup\.t\d/.test(k)||/^custom\.d\d/.test(k))continue;const [a,c]=k.split('.');if(c)out[a][c]=v;else out[k]=v;}
  for(const k of ['burst.enabled','fup.enabled','window.hours','window.days','notices.expired','popular','hidden','trial.enabled','custom.enabled'])if(!fd.has(k)){const [a,c]=k.split('.');if(c)out[a][c]=false;else out[k]=false;}
  out.notices.before=fd.getAll('notices.before').map(Number);out.notices.usage=fd.getAll('notices.usage').map(Number);out.routerIds=fd.getAll('routerIds');
  out.fup.tiers=[0,1].map(i=>({downCapMB:fd.get(`fup.t${i}cap`),afterDownMbps:fd.get(`fup.t${i}down`),afterUpMbps:fd.get(`fup.t${i}up`)})).filter(t=>t.downCapMB);out.window.weekdays=fd.getAll('window.weekdays').map(Number);out.custom.discounts=[0,1,2].map(i=>({minQty:fd.get(`custom.d${i}qty`),percent:fd.get(`custom.d${i}pct`)||0})).filter(d=>d.minQty);
  out.active=!fd.has('offSale');delete out.offSale;out.features=String(out.features||'').split('\n').map(s=>s.trim()).filter(Boolean);
  return api(id?'radius/plans/'+id:'radius/plans',id?'PATCH':'POST',out);});
 $('#editor').classList.add('pk-editor');$('#editor').addEventListener('close',()=>$('#editor').classList.remove('pk-editor'),{once:true});
 for(const t of document.querySelectorAll('[data-pk-tab]'))t.onclick=()=>{for(const x of document.querySelectorAll('[data-pk-tab]'))x.classList.toggle('active',x===t);for(const s of document.querySelectorAll('[data-pk]'))s.hidden=s.dataset.pk!==t.dataset.pkTab;};
 const lv=$('#pk-load-versions');if(lv)lv.onclick=async()=>{try{const r=await api('radius/plans/'+id+'?versions=1');$('#pk-versions').innerHTML=r.versions.length?table(['VERSION','REPLACED','BY','PRICE','SPEED'],r.versions,v=>`<tr><td>${v.version}</td><td>${h(stamp(v.replacedAt))}</td><td>${h(v.by||'')}</td><td>${ksh(v.terms.price)}</td><td>${v.terms.downloadMbps} / ${v.terms.uploadMbps} Mbps</td></tr>`):'<p class="muted">No earlier versions.</p>';}catch(e){toast(e.message);}};
 // A server error names the field; open the tab that holds it.
 const err=$('#editor-error');new MutationObserver(()=>{const m=err.textContent.toLowerCase(),tab=/burst|threshold|averag/.test(m)?'burst':/cap|fair|after the cap/.test(m)?'fup':/hour|day/.test(m)?'window':/feature/.test(m)?'details':null;if(tab)document.querySelector(`[data-pk-tab="${tab}"]`)?.click();}).observe(err,{childList:true,characterData:true,subtree:true});
}
// Move a package up or down the portal list.
async function movePlan(id,dir){const list=radiusView.data.plans.filter(p=>!radiusView.planPred||radiusView.planPred(p)).sort((a,b)=>(a.order||0)-(b.order||0)||a.price-b.price),i=list.findIndex(p=>p.id===id),j=i+dir;if(i<0||j<0||j>=list.length)return;
 [list[i],list[j]]=[list[j],list[i]];try{for(let k=0;k<list.length;k++)if((list[k].order||0)!==k*10)await api('radius/plans/'+list[k].id,'PATCH',{order:k*10});await loadRadius();}catch(e){toast(e.message);}}
