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
  ${num('interimSeconds','Accounting interval (seconds, 0 = default)',p.interimSeconds||0,'min="0" max="3600"')}${num('order','Order on the portal (lower first)',p.order||0,'min="0" max="9999"')}</div>
  ${radiusField('Features shown on the portal (one per line, up to 8)',`<textarea name="features" rows="3" maxlength="600" placeholder="Unlimited data&#10;Stream HD">${h((p.features||[]).join('\n'))}</textarea>`)}
  ${radiusField('Description (optional)',`<input name="description" maxlength="500" value="${h(p.description||'')}">`)}
  ${chk('popular',p.popular,'Popular','Shows a “popular” badge on the portal')}</section>
 <section data-pk="burst" hidden><p class="muted">Let customers go faster for a short time (for example while a page loads). The speed rises to the burst limit while their average over the averaging time stays under the threshold.</p>
  ${chk('burst.enabled',b.enabled,'Enable burst')}
  <div class="form-grid">${num('burst.downMbps','Burst limit download (Mbps)',b.downMbps,'min="0.064" step="0.001"')}${num('burst.upMbps','Burst limit upload (Mbps)',b.upMbps,'min="0.064" step="0.001"')}
  ${num('burst.thresholdDownMbps','Threshold download (Mbps)',b.thresholdDownMbps,'min="0.064" step="0.001"')}${num('burst.thresholdUpMbps','Threshold upload (Mbps)',b.thresholdUpMbps,'min="0.064" step="0.001"')}
  ${num('burst.seconds','Averaging time (seconds)',b.seconds??8,'min="1" max="3600"')}</div><p class="muted small">The burst limit must be above the normal speed; the threshold must not be above it.</p></section>
 <section data-pk="fup" hidden><p class="muted">When a customer uses more than the cap inside one paid period, they get the reduced speed from their next login. 0 means no cap.</p>
  ${chk('fup.enabled',f.enabled,'Enable fair usage policy')}
  <div class="form-grid">${num('fup.downCapMB','Download cap (MB)',f.downCapMB||0,'min="0"')}${num('fup.upCapMB','Upload cap (MB)',f.upCapMB||0,'min="0"')}
  ${num('fup.timeCapMinutes','Online-time cap (minutes)',f.timeCapMinutes||0,'min="0"')}<span></span>
  ${num('fup.afterDownMbps','Speed after the cap: download (Mbps)',f.afterDownMbps,'min="0.064" step="0.001"')}${num('fup.afterUpMbps','Speed after the cap: upload (Mbps)',f.afterUpMbps,'min="0.064" step="0.001"')}</div></section>
 <section data-pk="notices" hidden><p class="muted">SMS sent to customers on this package (needs the SMS provider and a phone number). These go out at any hour, unlike the daily reminders.</p>
  ${chk('notices.expired',n.expired,'When the package expires')}
  <div class="pk-chips">${PK_NOTICES.map(([m,l])=>`<label class="pk-chip"><input type="checkbox" name="notices.before" value="${m}" ${n.before?.includes(m)?'checked':''}> ${l} before expiry</label>`).join('')}</div></section>
 <section data-pk="window" hidden><p class="muted">Limit when this package can be bought (Nairobi time). Customers who already bought it keep using it outside these times.</p>
  ${chk('window.hours',w.hours,'Only sell between certain hours')}
  <div class="form-grid">${num('window.fromHour','From (hour 0–23)',w.fromHour??22,'min="0" max="23"')}${num('window.toHour','Until (hour 0–24)',w.toHour??6,'min="0" max="24"')}</div><p class="muted small">From 22 until 6 means overnight.</p>
  ${chk('window.days',w.days,'Only sell on certain days')}
  <div class="pk-chips">${PK_DAYS.map((d,i)=>`<label class="pk-chip"><input type="checkbox" name="window.weekdays" value="${i}" ${w.weekdays?.includes(i)?'checked':''}> ${d}</label>`).join('')}</div></section>
 <section data-pk="other" hidden>
  ${chk('offSale',p.active===false,'Package disabled (off sale)','Not sold on the portal; existing customers keep it')}
  ${chk('hidden',p.hidden,'Hide from the landing page','Still usable for vouchers, manual connects and staff renewals')}
  <p class="muted small">Not built yet: free trial packages, quantity/bulk-price customisation and per-customer speed overrides.</p></section>`;
 radiusForm(id?'Edit package':'New package','Changes apply at each customer\'s next login.',html,id?'Save package':'Create package',()=>{
  const form=$('#editor-form'),fd=new FormData(form),out={burst:{},fup:{},window:{},notices:{}};
  for(const [k,v] of fd.entries()){if(['notices.before','window.weekdays'].includes(k))continue;const [a,c]=k.split('.');if(c)out[a][c]=v;else out[k]=v;}
  for(const k of ['burst.enabled','fup.enabled','window.hours','window.days','notices.expired','popular','hidden'])if(!fd.has(k)){const [a,c]=k.split('.');if(c)out[a][c]=false;else out[k]=false;}
  out.notices.before=fd.getAll('notices.before').map(Number);out.window.weekdays=fd.getAll('window.weekdays').map(Number);
  out.active=!fd.has('offSale');delete out.offSale;out.features=String(out.features||'').split('\n').map(s=>s.trim()).filter(Boolean);
  return api(id?'radius/plans/'+id:'radius/plans',id?'PATCH':'POST',out);});
 $('#editor').classList.add('pk-editor');$('#editor').addEventListener('close',()=>$('#editor').classList.remove('pk-editor'),{once:true});
 for(const t of document.querySelectorAll('[data-pk-tab]'))t.onclick=()=>{for(const x of document.querySelectorAll('[data-pk-tab]'))x.classList.toggle('active',x===t);for(const s of document.querySelectorAll('[data-pk]'))s.hidden=s.dataset.pk!==t.dataset.pkTab;};
 // A server error names the field; open the tab that holds it.
 const err=$('#editor-error');new MutationObserver(()=>{const m=err.textContent.toLowerCase(),tab=/burst|threshold|averag/.test(m)?'burst':/cap|fair|after the cap/.test(m)?'fup':/hour|day/.test(m)?'window':/feature/.test(m)?'details':null;if(tab)document.querySelector(`[data-pk-tab="${tab}"]`)?.click();}).observe(err,{childList:true,characterData:true,subtree:true});
}
// Move a package up or down the portal list.
async function movePlan(id,dir){const list=radiusView.data.plans.filter(p=>!radiusView.planPred||radiusView.planPred(p)).sort((a,b)=>(a.order||0)-(b.order||0)||a.price-b.price),i=list.findIndex(p=>p.id===id),j=i+dir;if(i<0||j<0||j>=list.length)return;
 [list[i],list[j]]=[list[j],list[i]];try{for(let k=0;k<list.length;k++)if((list[k].order||0)!==k*10)await api('radius/plans/'+list[k].id,'PATCH',{order:k*10});await loadRadius();}catch(e){toast(e.message);}}
