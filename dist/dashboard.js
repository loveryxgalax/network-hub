'use strict';
// Kade Networks command centre: the dashboard page. Live throughput, router health, customers online, revenue,
// expiries, top sites and live traffic, all drawn from the routers' own reports (see /api/overview).
const kd={range:'24h',router:'',data:null,request:0,first:true,timer:null,hs:'today',biz:null,showMoney:false,portalTimer:null,portalEvery:10};
const E=kc.esc;
const KD_DEFS=[['Network throughput','Bits per second through each router\'s internet port (the busiest physical port), from interface counters sampled about every minute. Long ranges show thinned samples; 3 months shows each day\'s busiest hour.'],['Router health','CPU and memory as RouterOS reports them at the last check-in.'],['Customers online','PPPoE and hotspot sessions in the routers\' own active lists, sampled every 5 minutes.'],['Revenue','Payments recorded in netops per Nairobi calendar day; reversed payments are left out.'],['Plans in use','Customers whose package is active now, by package.'],['Top sites','DNS lookups reported by the routers today, by site.'],['Expiring soon','Active customers whose package ends in the next 3 days.'],['PPPoE customers','netops PPPoE accounts matched by username to the PPPoE sessions the routers report as connected.'],['Data completeness','Routers reporting = checked in within 2 minutes. Customer lists = sent within 15 minutes. Accounting = last RADIUS accounting packet received.']];
const kdDefs=()=>`<details class="kd-defs"><summary>How these numbers are measured</summary><dl>${KD_DEFS.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></details>`;
function kdGreeting(){const hour=new Date().getHours();return hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';}
function kdAgo(t){if(!t)return '—';const s=Math.max(0,(Date.now()-t)/1000);return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':Math.floor(s/86400)+' d ago';}
function kdIn(t){const s=(t-Date.now())/1000;return s<=0?'expired':s<3600?'in '+Math.max(1,Math.floor(s/60))+' min':s<86400?'in '+Math.floor(s/3600)+' h':'in '+Math.floor(s/86400)+' d';}
const kdIcon=(name,size=20)=>typeof icon==='function'?icon(name,size):'';
function kdKpi({key,label,value,sub,tone='blue',icon:ic,spark,prefix='',suffix='',decimals=0,hidden}){
 if(hidden)return '';return `<article class="kd-kpi kd-${tone}" data-kpi="${key}"><div class="kd-kpi-top"><span class="kd-chip">${kdIcon(ic,18)}</span><span class="kd-kpi-label">${E(label)}</span></div><div class="kd-kpi-num"><span data-count="${key}" data-prefix="${E(prefix)}" data-suffix="${E(suffix)}" data-decimals="${decimals}" data-value="${value==null?'':value}">${value==null?'—':''}</span></div><div class="kd-kpi-sub">${sub||''}</div><div class="kd-kpi-spark">${spark||''}</div></article>`;}
function kdOnlineSeries(routers){
 const size=300000,hot=new Map(),ppp=new Map();
 for(const r of routers)for(const [t,p,h] of r.onlineSeries){const k=Math.floor(t/size)*size;ppp.set(k,(ppp.get(k)||new Map()).set(r.id,p));hot.set(k,(hot.get(k)||new Map()).set(r.id,h));}
 const sum=m=>[...m].sort((a,b)=>a[0]-b[0]).map(([t,v])=>[t,[...v.values()].reduce((n,x)=>n+x,0)]);return {hotspot:sum(hot),pppoe:sum(ppp)};
}
function kdSkeleton(){
 const user=state.session.user,admin=user.role==='admin';
 $('#main').innerHTML=`<div class="kd" id="kd">
 <section class="kd-isp" id="kd-isp"></section>
 <div id="kd-quick-slot"></div>
 <section class="kd-card kd-portalnow"><header><div><h2><span class="kd-live-dot"></span> On the captive portal now</h2></div><div class="kd-tools"><small class="muted">live · every <span id="kd-pn-every">${kd.portalEvery}</span>s</small><select id="kd-pn-sync" aria-label="Refresh every">${[5,10,30,60].map(n=>`<option value="${n}" ${n===kd.portalEvery?'selected':''}>Sync: ${n}s</option>`).join('')}</select></div></header><div id="kd-portalnow" class="kd-pn"></div></section>
 <section class="kd-grid kd-status2">
  <article class="kd-card kd-svc"><header><div><h2>Hotspot Customers Status</h2><p><span class="kd-live-dot"></span> Live · with the routers and RADIUS</p></div><a class="kd-link" href="#cust-hotspot">View Details →</a></header><div class="segmented kd-hs-range" id="kd-hs-range">${[['today','Today'],['3d','3 Days'],['week','Week'],['month','Month']].map(([k,l])=>`<button type="button" data-hs="${k}" class="${kd.hs===k?'active':''}">${l}</button>`).join('')}</div><div id="kd-hs"></div></article>
  <article class="kd-card kd-svc"><header><div><h2>PPPoE Customers Status</h2><p><span class="kd-live-dot"></span> Live · with the routers and RADIUS</p></div><a class="kd-link" href="#cust-pppoe">View Details →</a></header><div id="kd-ppp"></div></article>
 </section>
 <section class="kd-hero"><div class="kd-glow kd-glow-a"></div><div class="kd-glow kd-glow-b"></div><div class="kd-rings" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="kd-hero-main"><div class="kd-logo-card"><img src="/img/kade-logo.png" alt="Kade Networks" width="236" height="56"></div>
   <p class="kd-date"><span id="kd-date"></span><b>·</b><time id="kd-clock"></time></p>
   <h1><span id="kd-greeting">Hello</span>, <em>${E(user.name)}</em></h1>
   <div class="kd-chips" id="kd-status"></div></div>
  <div class="kd-hero-live"><div class="kd-live"><span class="kd-live-dot"></span>LIVE</div>
   <div class="kd-bigrate"><div><small>DOWNLOAD</small><strong id="kd-hero-down">—</strong></div><div><small>UPLOAD</small><strong id="kd-hero-up">—</strong></div></div>
   <div class="kd-actions"><a class="kd-btn kd-btn-solid" href="#radius">${kdIcon('plus',16)} New subscriber</a><a class="kd-btn" href="#sites">${kdIcon('activity',16)} Sites &amp; traffic</a><a class="kd-btn" href="#mikrotiks">${kdIcon('router',16)} Routers</a></div></div></section>
 <section class="kd-kpis" id="kd-kpis"></section>
 <section class="kd-grid kd-main">
  <article class="kd-card kd-wide"><header><div><h2>Network throughput</h2><p>Internet traffic through each router's uplink</p></div><div class="kd-tools"><select id="kd-router" aria-label="Router"></select><div class="segmented" id="kd-range">${[['1h','1 h'],['24h','24 h'],['7d','7 d'],['30d','30 d'],['90d','3 m']].map(([k,l])=>`<button type="button" data-range="${k}" class="${kd.range===k?'active':''}">${l}</button>`).join('')}</div></div></header><div id="kd-throughput" class="kd-chart"></div><footer class="kd-legend"><span><i style="background:var(--kd-cyan)"></i>Download</span><span><i style="background:var(--kd-violet)"></i>Upload</span><span class="kd-note" id="kd-peak"></span></footer></article>
  <article class="kd-card"><header><div><h2>Router health</h2><p>CPU, memory and load right now</p></div><a class="kd-link" href="#mikrotiks">All routers →</a></header><div id="kd-routers" class="kd-routers"></div></article>
 </section>
 <section class="kd-grid kd-row3">
  <article class="kd-card"><header><div><h2>Customers online</h2><p>Connected through the routers, every 5 minutes</p></div></header><div id="kd-online" class="kd-chart"></div><footer class="kd-legend"><span><i style="background:var(--kd-cyan)"></i>Hotspot</span><span><i style="background:var(--kd-blue)"></i>PPPoE</span></footer></article>
  ${admin?`<article class="kd-card"><header><div><h2>Revenue</h2><p>Payments recorded, last 14 days</p></div><a class="kd-link" href="#radius">Payments →</a></header><div class="kd-money"><div><small>TODAY</small><strong id="kd-rev-today">—</strong></div><div><small>7 DAYS</small><strong id="kd-rev-week">—</strong></div><div><small>THIS MONTH</small><strong id="kd-rev-month">—</strong></div></div><div id="kd-revenue" class="kd-chart"></div></article>`:`<article class="kd-card"><header><div><h2>Plans in use</h2><p>Active subscribers per plan</p></div></header><div id="kd-plans-a" class="kd-donut"></div></article>`}
  <article class="kd-card"><header><div><h2>Top sites today</h2><p>Most looked-up by your customers</p></div><a class="kd-link" href="#sites">All sites →</a></header><div id="kd-sites" class="kd-list"></div></article>
 </section>
 <section class="kd-grid kd-row3">
  <article class="kd-card"><header><div><h2>Live traffic</h2><p>Biggest connections right now</p></div><a class="kd-link" href="#sites">Torch →</a></header><div id="kd-live" class="kd-list"></div></article>
  <article class="kd-card"><header><div><h2>Expiring soon</h2><p>Customers to remind in the next 3 days</p></div><a class="kd-link" href="#radius">Subscribers →</a></header><div id="kd-expiring" class="kd-list"></div></article>
  <article class="kd-card"><header><div><h2>${admin?'Plans &amp; payment methods':'Alerts'}</h2><p>${admin?'Active customers by plan, and how they pay':'Open network alerts'}</p></div></header><div id="kd-mix" class="kd-mix"></div></article>
 </section>
 <section class="kd-card kd-alerts"><header><div><h2>Alerts</h2><p>What needs attention on the network</p></div><a class="kd-link" href="#notifications">All alerts →</a></header><div id="kd-alerts" class="kd-alertlist"></div></section>
 <footer class="kd-foot"><img src="/img/kade-mark.png" alt="" width="22" height="22"> Kade Networks · live data from your MikroTiks <span id="kd-updated"></span><span id="kd-complete"></span></footer>${kdDefs()}</div>`;
 for(const b of document.querySelectorAll('#kd-hs-range [data-hs]'))b.onclick=()=>{kd.hs=b.dataset.hs;for(const x of document.querySelectorAll('#kd-hs-range [data-hs]'))x.classList.toggle('active',x===b);kdLoad();};
 $('#kd-pn-sync').onchange=e=>{kd.portalEvery=Number(e.target.value)||10;$('#kd-pn-every').textContent=kd.portalEvery;kdPortalNow();};
 kdBusiness();kdPortalNow();
 for(const b of document.querySelectorAll('#kd-range [data-range]'))b.onclick=()=>{kd.range=b.dataset.range;for(const x of document.querySelectorAll('#kd-range [data-range]'))x.classList.toggle('active',x===b);kd.first=true;kdLoad();};
 $('#kd-router').onchange=e=>{kd.router=e.target.value;kdPaint(false);};
 kdClock();
}
function kdClock(){if(!$('#kd-clock'))return;const n=new Date();$('#kd-greeting').textContent=kdGreeting();$('#kd-date').textContent=n.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'Africa/Nairobi'});$('#kd-clock').textContent=n.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Africa/Nairobi'});}
function kdPaint(animate){
 const d=kd.data;if(!d||!$('#kd'))return;const admin=state.session.user.role==='admin',routers=d.routers,pick=kd.router?routers.filter(r=>r.id===kd.router):routers;
 const sel=$('#kd-router');sel.innerHTML='<option value="">All routers</option>'+routers.map(r=>`<option value="${E(r.id)}" ${kd.router===r.id?'selected':''}>${E(r.name)}</option>`).join('');
 // Hero + status chips
 const up=routers.filter(r=>r.status==='online').length,total=routers.length;
 $('#kd-status').innerHTML=`<span class="kd-pill ${up===total&&total?'good':up?'warn':'bad'}"><i></i>${total?`${up} of ${total} routers online`:'No routers yet'}</span><span class="kd-pill ${d.alerts.open?'warn':'good'}"><i></i>${d.alerts.open?d.alerts.open+' open alert'+(d.alerts.open>1?'s':''):'No open alerts'}</span><span class="kd-pill"><i></i>${kc.fmtNum(d.customers.connected)} customers connected</span>`;
 const downNow=d.totals.downMbps,upNow=d.totals.upMbps;$('#kd-hero-down').textContent=kc.fmtRate(up?downNow:null);$('#kd-hero-up').textContent=kc.fmtRate(up?upNow:null);
 // KPI tiles
 const tot=d.totals.series,tail=n=>tot.slice(-24).map(p=>p[n]),online=kdOnlineSeries(routers),onl=[...new Set([...online.hotspot,...online.pppoe].map(p=>p[0]))].sort().map(t=>(online.hotspot.find(p=>p[0]===t)?.[1]||0)+(online.pppoe.find(p=>p[0]===t)?.[1]||0));
 const kpis=[{key:'down',label:'Download now',value:up?downNow:null,decimals:downNow>=10?0:1,suffix:' Mbps',sub:'All routers combined',tone:'cyan',icon:'activity',spark:kc.spark(tail(1),{color:'var(--kd-cyan)'})},
  {key:'up',label:'Upload now',value:up?upNow:null,decimals:upNow>=10?0:1,suffix:' Mbps',sub:'Customers sending to the internet',tone:'violet',icon:'activity',spark:kc.spark(tail(2),{color:'var(--kd-violet)'})},
  {key:'online',label:'Customers online',value:d.customers.connected,sub:`${kc.fmtNum(d.customers.onlineNow)} via netops RADIUS`,tone:'blue',icon:'onu',spark:kc.spark(onl.slice(-24),{color:'var(--kd-blue)'})},
  {key:'active',label:'Active subscribers',value:d.customers.active,sub:`${kc.fmtNum(d.customers.expired)} expired · ${kc.fmtNum(d.customers.suspended)} suspended`,tone:'good',icon:'check'},
  {key:'rev',label:'Revenue today',value:d.revenue.today,prefix:'KSh ',sub:`KSh ${kc.fmtNum(d.revenue.week)} this week`,tone:'amber',icon:'server',spark:kc.spark(d.revenue.days.map(x=>x.amount),{color:'var(--kd-warn)'}),hidden:!admin},
  {key:'soon',label:'Expiring in 3 days',value:d.customers.expiringSoon,sub:d.customers.expiringSoon?'Send them a reminder':'Nobody is about to expire',tone:'pink',icon:'clock'}];
 if(!$('#kd-kpis').children.length||animate)$('#kd-kpis').innerHTML=kpis.map(kdKpi).join('');else for(const k of kpis){const card=document.querySelector(`[data-kpi="${k.key}"]`);if(card){card.querySelector('.kd-kpi-sub').innerHTML=k.sub||'';card.querySelector('.kd-kpi-spark').innerHTML=k.spark||'';}}
 for(const k of kpis){const el=document.querySelector(`[data-count="${k.key}"]`);if(el)kc.count(el,k.value,{decimals:k.decimals||0,prefix:k.prefix||'',suffix:k.suffix||''});}
 // Throughput chart
 const series=[{name:'Download',color:'var(--kd-cyan)',points:[]},{name:'Upload',color:'var(--kd-violet)',points:[]}],src=kd.router?pick[0]?.series.map(p=>[p[0],p[1],p[2]])||[]:d.totals.series;
 series[0].points=src.map(p=>[p[0],p[1]]);series[1].points=src.map(p=>[p[0],p[2]]);
 const peak=series[0].points.reduce((m,p)=>p[1]!=null&&p[1]>m[1]?p:m,[0,0]);$('#kd-peak').textContent=peak[1]?`Peak ${kc.fmtRate(peak[1])} at ${['7d','30d','90d'].includes(d.range)?kc.dayHour(peak[0]):kc.hhmm(peak[0])}`:'';
 kc.area($('#kd-throughput'),{series,height:340,unit:kc.fmtRate,axis:v=>v>=1000?(v/1000)+'G':v>=1?Math.round(v*10)/10:Math.round(v*1000)+'k',animate,label:'Network throughput',empty:'No throughput history yet',emptyHint:'Routers report every 30 seconds; the graph fills as data arrives.'});
 // Router health cards
 $('#kd-routers').innerHTML=routers.length?routers.map(r=>`<div class="kd-router ${r.status}"><div class="kd-router-head"><span class="kd-dot ${r.status}"></span><div><strong>${E(r.name)}</strong><small>${E([r.model,r.version&&'RouterOS '+r.version].filter(Boolean).join(' · ')||'Waiting for a report')}</small></div><span class="kd-state ${r.status}">${r.status==='online'?'Online':'Offline'}</span></div>
  <div class="kd-router-body">${r.status==='online'?`<div class="kd-gauge">${kc.ring(r.cpu,{label:'CPU'})}<small>CPU</small></div><div class="kd-gauge">${kc.ring(r.memory,{label:'Memory'})}<small>Memory</small></div>`:`<div class="kd-offline">Last seen ${E(kdAgo(r.lastSeen))}</div>`}
  <div class="kd-rates"><span><b>↓</b>${E(kc.fmtRate(r.downMbps))}</span><span><b>↑</b>${E(kc.fmtRate(r.upMbps))}</span><span class="kd-people">${kc.fmtNum((r.customers.ppp||0)+(r.customers.hotspot||0))} online · ${E(r.uptime||'—')} up</span></div></div></div>`).join(''):'<div class="kd-empty-note">Add a MikroTik under Routers and install its script to see live health.</div>';
 // Customers online chart
 kc.area($('#kd-online'),{series:[{name:'Hotspot',color:'var(--kd-cyan)',points:online.hotspot},{name:'PPPoE',color:'var(--kd-blue)',points:online.pppoe}],height:300,unit:v=>kc.fmtNum(v)+' customers',axis:v=>Math.round(v),animate,label:'Customers online',empty:'Collecting customer counts',emptyHint:'One point is stored every 5 minutes from each router report.'});
 // Revenue
 if(admin){const money=(id,v)=>{kc.count($('#'+id),v,{prefix:'KSh '});};money('kd-rev-today',d.revenue.today);money('kd-rev-week',d.revenue.week);money('kd-rev-month',d.revenue.month);
  kc.bars($('#kd-revenue'),{items:d.revenue.days.map(x=>({label:x.day.slice(8),title:new Date(x.day+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}),value:x.amount,sub:x.count+' payment'+(x.count===1?'':'s')})),height:250,format:kc.fmtKsh,empty:'No payments yet',emptyHint:'Payments from the portal, paybill and manual entries appear here.',label:'Revenue per day'});}
 else{kc.donut($('#kd-plans-a'),d.customers.plans.map((p,i)=>({label:p.name,value:p.count,color:kdPalette[i%kdPalette.length]})),{center:kc.fmtNum(d.customers.active),sub:'active'});}
 // Lists
 const maxLookups=d.sites.top[0]?.lookups||1;
 $('#kd-sites').innerHTML=d.sites.top.length?d.sites.top.map((s,i)=>`<div class="kd-row"><span class="kd-rank">${i+1}</span><div class="kd-row-main"><strong>${E(s.domain)}</strong><span class="kd-bar"><i style="width:${Math.max(4,s.lookups/maxLookups*100)}%"></i></span></div><em>${kc.fmtNum(s.lookups)}</em></div>`).join(''):'<div class="kd-empty-note">No lookups yet. Turn on DNS logging under Sites &amp; traffic → Setup.</div>';
 const maxLive=d.sites.live[0]?.bytes||1;
 $('#kd-live').innerHTML=d.sites.live.length?d.sites.live.map(r=>`<div class="kd-row"><div class="kd-row-main"><strong>${E(r.name)}</strong><small>${E(r.remote)}${r.port?':'+r.port:''} · ${E(kc.fmtBytes(r.bytes))}</small><span class="kd-bar kd-bar-violet"><i style="width:${Math.max(4,r.bytes/maxLive*100)}%"></i></span></div><em>${E(kc.fmtRate(r.downBps!=null?r.downBps/1e6:null))}</em></div>`).join(''):'<div class="kd-empty-note">No big connections right now.</div>';
 $('#kd-expiring').innerHTML=d.expiring.length?d.expiring.map(s=>`<div class="kd-row"><div class="kd-avatar">${E((s.name||'?').trim().charAt(0).toUpperCase())}</div><div class="kd-row-main"><strong>${E(s.name)}</strong><small>${E(s.plan)}${s.phone?' · '+E(s.phone):''}</small></div><em class="kd-warn">${E(kdIn(s.expiresAt))}</em></div>`).join(''):'<div class="kd-empty-note">Nobody expires in the next 3 days.</div>';
 if(admin){const methods={mpesa:'M-Pesa',cash:'Cash',bank:'Bank',other:'Other'},payItems=Object.entries(d.revenue.byMethod).map(([k,v],i)=>({label:methods[k]||k,value:v,color:kdPalette[(i+2)%kdPalette.length]})),planItems=d.customers.plans.map((p,i)=>({label:p.name,value:p.count,color:kdPalette[i%kdPalette.length]}));
  $('#kd-mix').innerHTML=`<div class="kd-mixes"><div><div id="kd-d1" class="kd-donut"></div><h3>Plans</h3></div><div><div id="kd-d2" class="kd-donut"></div><h3>This month</h3></div></div><ul class="kd-keys">${planItems.map(i=>`<li><i style="background:${i.color}"></i>${E(i.label)}<b>${kc.fmtNum(i.value)}</b></li>`).join('')}${payItems.map(i=>`<li><i style="background:${i.color}"></i>${E(i.label)}<b>${E(kc.fmtKsh(i.value))}</b></li>`).join('')}</ul>`;
  kc.donut($('#kd-d1'),planItems,{size:130,stroke:18,center:kc.fmtNum(d.customers.active),sub:'active'});kc.donut($('#kd-d2'),payItems,{size:130,stroke:18,center:kc.fmtKsh(d.revenue.month).replace('KSh ','').replace(/,\d{3}$/,'k'),sub:'KSh'});}
 else $('#kd-mix').innerHTML=d.alerts.items.length?d.alerts.items.map(a=>`<div class="kd-row"><div class="kd-row-main"><strong>${E(a.title)}</strong><small>${E(a.details||'')}</small></div></div>`).join(''):'<div class="kd-empty-note">All clear.</div>';
 // Hotspot and PPPoE status cards: tiles by state, then who is online by router and by package
 kdStatus($('#kd-hs'),d.hotspot,[['Online','online','good','check'],['Offline','offline','muted','clock'],['Expired','expired','bad','clock'],['Unpaid','unpaid','grey','info']],'hotspot');
 kdStatus($('#kd-ppp'),d.pppoe,[['Online','online','good','check'],['Offline','offline','muted','clock'],['Online expired','onlineExpired','warn','warning'],['Expired','expired','bad','clock'],['Deactivated','deactivated','violet','info'],['Unpaid','unpaid','grey','info']],'pppoe');
 $('#kd-alerts').innerHTML=d.alerts.items.length?d.alerts.items.map(a=>`<div class="kd-alert ${E(a.severity||'warning')}"><span class="kd-alert-dot"></span><div><strong>${E(a.title)}</strong><small>${E(a.details||'')}</small></div><time>${E(kdAgo(a.time))}</time></div>`).join(''):'<div class="kd-allclear"><span>✓</span><div><strong>All clear</strong><small>No open alerts. Your network is healthy.</small></div></div>';
 $('#kd-updated').textContent='· updated '+new Date(d.now).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Africa/Nairobi'});{const c=d.completeness,el=$('#kd-complete');if(c&&el){const mins=c.lastAccounting?Math.round((d.now-c.lastAccounting)/60000):null;el.textContent=` · ${c.reporting} of ${c.routers} routers reporting · customer lists from ${c.customerLists} · accounting ${mins==null?'not received yet':mins<1?'just now':mins+' min ago'}`;el.title='Data completeness: see "How these numbers are measured" below';}}
}
function kdStatus(el,p,tiles,svc){if(!el)return;if(!p){el.innerHTML='';return;}const pct=n=>p.total?(n/p.total*100).toFixed(1)+'%':'0.0%',on=p.byDevice.reduce((a,x)=>a+x.count,0)||1,onp=p.byPackage.reduce((a,x)=>a+x.count,0)||1;
 const box=(title,ic,items,sum,empty)=>`<div class="kd-svc-box"><h3><span class="kd-svc-ic">${kdIcon(ic,16)}</span>${title}</h3>${items.length?`<div class="kd-svc-mini">${items.map(x=>`<div><small title="${E(x.name)}">${kdIcon(svc==='hotspot'?'wifi':'network',14)} ${E(x.name)}</small><strong>${kc.fmtNum(x.count)}</strong><span>${(x.count/sum*100).toFixed(1)}%</span></div>`).join('')}</div>`:`<div class="kd-empty-note">${empty}</div>`}</div>`;
 el.innerHTML=`<div class="kd-svc-tiles" style="--n:${tiles.length}">${tiles.map(([l,k,tone,ic])=>`<div class="kd-svc-tile ${tone}" title="${l}"><small><span>${kdIcon(ic,13)}</span>${l}</small><div class="kd-svc-num"><strong>${kc.fmtNum(p[k]||0)}</strong><em>${pct(p[k]||0)}</em></div></div>`).join('')}</div>
 ${p.notInNetops?`<p class="kd-ppp-note"><b>${kc.fmtNum(p.notInNetops)}</b> connected ${svc==='pppoe'?'PPPoE':'hotspot'} ${p.notInNetops===1?'user is':'users are'} not in netops yet.</p>`:''}
 ${box('Online by Device','router',p.byDevice.filter(x=>x.count),on,'Nobody online right now')}${box('Online by Package','box',p.byPackage,onp,'Nobody online right now')}`;}
// Business strip: money collected (hidden until the eye is pressed) and who this workspace is.
async function kdBusiness(){const el=$('#kd-isp');if(!el)return;try{kd.biz=await api('business');}catch{el.remove();return;}kdBusinessPaint();}
function kdBusinessPaint(){const el=$('#kd-isp'),b=kd.biz;if(!el||!b)return;const m=b.money,mask='••••••',v=n=>kd.showMoney?E(kc.fmtKsh(n).replace('KSh ','')):mask;
 el.innerHTML=`${m?`<div class="kd-isp-wallet"><span class="kd-isp-ic">${kdIcon('wallet',22)}</span><button type="button" class="kd-eye" id="kd-eye" aria-label="${kd.showMoney?'Hide':'Show'} amounts">${kdIcon(kd.showMoney?'eyeoff':'eye',16)}</button><div><small>Collected</small><b>KES</b></div><div><small>Today</small><b>${v(m.today)}</b></div><div><small>This month</small><b>${v(m.month)}</b></div></div>`:''}
 <div class="kd-isp-biz"><img src="/img/kade-mark.png" alt="" width="22" height="22"><strong>${E(b.name)}</strong><span>ID: <b>${E(b.id)}</b></span>${b.code?`<span>Code: <b>${E(b.code)}</b></span>`:''}${b.email?`<span>Email: <b>${E(b.email)}</b></span>`:''}${b.phone?`<span>Phone: <b>${E(b.phone)}</b></span>`:''}<span>Site: <b>${E(b.site)}</b></span><span>Members: <b>${kc.fmtNum(b.members)}</b></span>${m&&m.pendingPayouts?`<a href="#payouts">Payouts waiting: <b>${m.pendingPayouts}</b></a>`:''}</div>`;
 const eye=$('#kd-eye');if(eye)eye.onclick=()=>{kd.showMoney=!kd.showMoney;kdBusinessPaint();};}
// Live captive-portal visitors, refreshed on the chosen interval while the dashboard is open.
async function kdPortalNow(){clearTimeout(kd.portalTimer);const el=$('#kd-portalnow');if(!el||state.page!=='dashboard')return;
 if(!document.hidden&&!$('dialog[open]'))try{const p=await api('portal-now'),chip=(label,n)=>`<span class="kd-pn-chip">${E(label)} <b>${kc.fmtNum(n)}</b></span>`;
  el.innerHTML=`<span class="kd-pn-big"><b>${kc.fmtNum(p.total)}</b> total</span><span class="kd-pn-big"><b>${kc.fmtNum(p.hotspot)}</b> hotspot</span><span class="kd-pn-big"><b>${kc.fmtNum(p.pppoe)}</b> pppoe</span>${p.total?`<span class="kd-pn-label">pages:</span>${Object.entries(p.pages).map(([k,n])=>chip(k,n)).join('')}<span class="kd-pn-label">devices:</span>${Object.entries(p.devices).map(([k,n])=>chip(k,n)).join('')}`:'<span class="muted small">Nobody is on the WiFi login page right now.</span>'}`;}catch{}
 kd.portalTimer=setTimeout(kdPortalNow,kd.portalEvery*1000);}
const kdPalette=['#00a8ff','#0a3cff','#7c5cff','#17c98b','#f5a524','#ff5470','#2dd4bf','#a78bfa'];
async function kdLoad(){const request=++kd.request;try{const d=await api('overview?range='+kd.range+'&hotspot='+kd.hs);if(request!==kd.request||!['dashboard','trends'].includes(state.page))return;kd.data=d;kdPaint(kd.first);kd.first=false;}catch(error){if(request===kd.request&&$('#kd')&&!kd.data)$('#kd').insertAdjacentHTML('afterbegin',notice('Could not load the overview',E(error.message),true));}}
function renderDashboard(){kd.first=true;kd.data=null;kdSkeleton();kdLoad();clearInterval(kd.timer);kd.timer=setInterval(()=>{if(['dashboard','trends'].includes(state.page)&&!document.hidden&&!$('dialog[open]'))kdLoad();else if(!['dashboard','trends'].includes(state.page))clearInterval(kd.timer);},30000);}
setInterval(kdClock,1000);
