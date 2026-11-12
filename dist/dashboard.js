'use strict';
// Kade Networks command centre: the dashboard page. Live throughput, router health, customers online, revenue,
// expiries, top sites and live traffic, all drawn from the routers' own reports (see /api/overview).
const kd={range:'24h',router:'',data:null,request:0,first:true,timer:null,hs:'today',biz:null,showMoney:false,portalTimer:null,portalEvery:10};
const E=kc.esc;
const kdFive=value=>E(Array.from(String(value??'')).slice(0,5).join(''));
const KD_DEFS=[['Network throughput','Bits per second through each router\'s internet port (the busiest physical port), from interface counters sampled about every minute. Long ranges show thinned samples; 3 months shows each day\'s busiest hour.'],['Router health','CPU and memory as RouterOS reports them at the last check-in.'],['Customers online','PPPoE and hotspot sessions in the routers\' own active lists, sampled every 5 minutes.'],['Revenue','Payments recorded in netops per Nairobi calendar day; reversed payments are left out.'],['Plans in use','Customers whose package is active now, by package.'],['Top sites','DNS lookups reported by the routers today, by site.'],['Expiring soon','Active customers whose package ends in the next 3 days.'],['PPPoE customers','netops PPPoE accounts matched by username to the PPPoE sessions the routers report as connected.'],['Data completeness','Routers reporting = checked in within 2 minutes. Customer lists = sent within 15 minutes. Accounting = last RADIUS accounting packet received.']];
const kdDefs=()=>`<details class="kd-defs"><summary>How these numbers are measured</summary><dl>${KD_DEFS.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></details>`;
function kdGreeting(){const hour=new Date().getHours();return hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';}
function kdAgo(t){if(!t)return '—';const s=Math.max(0,(Date.now()-t)/1000);return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':Math.floor(s/86400)+' d ago';}
function kdIn(t){const s=(t-Date.now())/1000;return s<=0?'expired':s<3600?'in '+Math.max(1,Math.floor(s/60))+' min':s<86400?'in '+Math.floor(s/3600)+' h':'in '+Math.floor(s/86400)+' d';}
const kdIcon=(name,size=20)=>typeof icon==='function'?icon(name,size):'';
function kdKpi({key,label,value,sub,tone='blue',icon:ic,spark,prefix='',suffix='',decimals=0,hidden}){
 if(hidden)return '';return `<article class="kd-kpi kd-${tone}" data-kpi="${key}"><div class="kd-kpi-top"><span class="kd-chip">${kdIcon(ic,18)}</span><span class="kd-kpi-label">${E(label)}</span></div><div class="kd-kpi-num"><span data-count="${key}" data-prefix="${E(prefix)}" data-suffix="${E(suffix)}" data-decimals="${decimals}" data-value="${value==null?'':value}">${value==null?'—':''}</span></div><div class="kd-kpi-sub">${sub||''}</div><div class="kd-kpi-spark">${spark||''}</div></article>`;}
function kdOnlineSeries(routers){
 // Each router reports at its own moment, so a bucket may hold only some routers. Carry a router's last count forward (up to 15 min)
 // so the total does not jump up and down between "all routers" and "one router".
 const size=300000,hold=size*3,keys=new Set(),per=routers.map(r=>{const m=new Map();for(const [t,p,h] of r.onlineSeries){const k=Math.floor(t/size)*size;m.set(k,[p,h]);keys.add(k);}return m;});
 const last=per.map(()=>null),ppp=[],hot=[];
 for(const k of [...keys].sort((a,b)=>a-b)){let p=0,h=0;per.forEach((m,i)=>{const v=m.get(k);if(v)last[i]={k,v};const l=last[i];if(l&&k-l.k<=hold){p+=l.v[0];h+=l.v[1];}});ppp.push([k,p]);hot.push([k,h]);}
 return {hotspot:hot,pppoe:ppp};
}
function kdSkeleton(){
 const user=state.session.user,admin=user.role==='admin';
 const more=[['Add Static IP','#st-customers'],['PPPoE customers','#cust-pppoe'],['Hotspot customers','#cust-hotspot'],['Static customers','#st-customers'],['Routers & devices','#mikrotiks'],['Hotspot packages','#hs-packages'],['PPPoE packages','#pp-packages'],['Support','#tickets'],['Settings','#settings']];
 $('#main').innerHTML=`<div class="kd kd2" id="kd">
 <section class="kd2-head"><div><h1><span id="kd-greeting">Hello</span>, ${E(String(user.name||'').split(' ')[0])}</h1><p id="kd-status" class="kd2-status"></p></div>
  <div class="kd2-actions"><a class="button primary" href="#cust-hotspot" data-kd-add="hotspot">${kdIcon('plus',15)} Hotspot customer</a><a class="button primary" href="#cust-pppoe" data-kd-add="pppoe">${kdIcon('plus',15)} PPPoE customer</a><a class="button secondary" href="#cust-table">${kdIcon('search',15)} Find customer</a><a class="button secondary" href="#router-link">${kdIcon('router',15)} Link MikroTik</a><a class="button kd2-dark" href="#system-logs">${kdIcon('shield',15)} System logs<span class="kade-sys-n" hidden></span></a>
   <details class="ct-menu"><summary class="button secondary">More</summary><div class="ct-menu-list">${more.map(([l,h])=>`<a href="${h}">${l}</a>`).join('')}</div></details></div></section>
 <section class="kd2-kpis" id="kd-kpis"></section>
 <section class="kd-pn" id="kd-pn" aria-live="polite"></section>
 <section class="kd2-grid">
  <div class="kd2-col">
   <article class="kd-card kd2-card"><header><div><h2>Network throughput</h2><p id="kd-peak" class="kd2-sub"></p></div><div class="kd-tools"><select id="kd-router" aria-label="Router"></select><div class="segmented" id="kd-range">${[['1h','1 h'],['24h','24 h'],['7d','7 d'],['30d','30 d'],['90d','3 m']].map(([k,l])=>`<button type="button" data-range="${k}" class="${kd.range===k?'active':''}">${l}</button>`).join('')}</div></div></header><div id="kd-throughput" class="kd-chart"></div></article>
   <div class="kd2-two">
    <article class="kd-card kd2-card"><header><div><h2>Hotspot customers</h2></div><div class="kd-tools"><div class="segmented kd-hs-range" id="kd-hs-range">${[['today','Today'],['week','Week'],['month','Month']].map(([k,l])=>`<button type="button" data-hs="${k}" class="${kd.hs===k?'active':''}">${l}</button>`).join('')}</div><a class="kd-link" href="#cust-hotspot">View →</a></div></header><div id="kd-hs"></div></article>
    <article class="kd-card kd2-card"><header><div><h2>PPPoE customers</h2></div><a class="kd-link" href="#cust-pppoe">View →</a></header><div id="kd-ppp"></div></article>
   </div>
   <article class="kd-card kd2-card" id="kd-st-card" hidden><header><div><h2>Static IP customers</h2></div><a class="kd-link" href="#st-customers">View →</a></header><div id="kd-st"></div></article>
   <article class="kd-card kd2-card"><header><div><h2>Router health</h2></div><a class="kd-link" href="#mikrotiks">All routers →</a></header><div id="kd-routers" class="kd2-routers"></div></article>
   <article class="kd-card kd2-card"><header><div><h2>Customers online</h2><p class="kd2-sub">Every 5 minutes, from the routers</p></div><footer class="kd-legend"><span><i style="background:#06b6d4"></i>Hotspot</span><span><i style="background:#6366f1"></i>PPPoE</span></footer></header><div id="kd-online" class="kd-chart"></div></article>
  <article class="kd-card kd2-card" id="kd-paycard" hidden><header><div><h2>Received payments</h2></div><a class="kd-link" href="#pay-received">View all →</a></header><div id="kd-pays"></div></article>
  ${admin?`<div class="kd-rb-side">${KD_RB.filter(c=>c.side).map(kdRbCard).join('')}</div>`:''}
  </div>
  <div class="kd2-col">
   ${admin?`<article class="kd-card kd2-card"><header><div><h2>Revenue</h2><p class="kd2-sub">Last 14 days</p></div><a class="kd-link" href="#pay-received">Payments →</a></header><div class="kd-money kd2-money"><div><small>Today</small><strong id="kd-rev-today">—</strong></div><div><small>7 days</small><strong id="kd-rev-week">—</strong></div><div><small>This month</small><strong id="kd-rev-month">—</strong></div><div><small>Last month</small><strong id="kd-rev-last">—</strong></div><div><small>Last 3 months</small><strong id="kd-rev-3m">—</strong></div><div><small>Year to date</small><strong id="kd-rev-ytd">—</strong></div></div><div id="kd-revenue"></div></article>`:''}
   <article class="kd-card kd2-card"><header><div><h2>Expiring soon</h2></div><a class="kd-link" href="#cust-table">All →</a></header><div id="kd-expiring" class="kd-list"></div></article>
   <article class="kd-card kd2-card"><header><div><h2>Alerts</h2></div><a class="kd-link" href="#notifications">All alerts →</a></header><div id="kd-alerts" class="kd-alertlist"></div></article>
   <article class="kd-card kd2-card"><header><div><h2>${admin?'Plans &amp; payments':'Open alerts'}</h2></div></header><div id="kd-mix" class="kd-mix"></div></article>

  </div>
 </section>
 ${admin?`<section class="kd-rb" id="kd-rb"><div class="kd-rb-head"><h2>Revenue by service &amp; package</h2><p>Where the money comes from, and vouchers redeemed (valued at their package price). Each chart has its own period.</p></div><div class="kd-rb-grid kd-rb-two">${KD_RB.filter(c=>!c.side&&c.id!=='vloc').map(kdRbCard).join('')}</div></section>`:''}
 <section class="kd-bottom-three">${admin?kdRbCard(KD_RB.find(c=>c.id==='vloc')):''}<article class="kd-card kd2-card"><header><div><h2>Top sites today</h2></div><a class="kd-link" href="#sites">All →</a></header><div id="kd-sites" class="kd-list"></div></article>
   <article class="kd-card kd2-card"><header><div><h2>Live traffic</h2></div><a class="kd-link" href="#sites">Torch →</a></header><div id="kd-live" class="kd-list"></div></article></section>
 <footer class="kd-foot"><span id="kd-updated"></span><span id="kd-complete"></span></footer>${kdDefs()}
 <span hidden id="kd-hero-down"></span><span hidden id="kd-hero-up"></span><span hidden id="kd-date"></span><span hidden id="kd-clock"></span></div>`;
 for(const b of document.querySelectorAll('#kd-hs-range [data-hs]'))b.onclick=()=>{kd.hs=b.dataset.hs;for(const x of document.querySelectorAll('#kd-hs-range [data-hs]'))x.classList.toggle('active',x===b);kdLoad();};
 for(const a of document.querySelectorAll('[data-kd-add]'))a.onclick=e=>{if(typeof window.subscriberEditor==='function'){e.preventDefault();window.subscriberEditor(null,{service:a.dataset.kdAdd});}};
 kdPortalNow();
 for(const b of document.querySelectorAll('#kd-range [data-range]'))b.onclick=()=>{kd.range=b.dataset.range;for(const x of document.querySelectorAll('#kd-range [data-range]'))x.classList.toggle('active',x===b);kd.first=true;kdLoad();};
 $('#kd-router').onchange=e=>{kd.router=e.target.value;kdPaint(false);};
 kdClock();
 if(admin)kdRbLoad();
 if(typeof refreshSysBadge==='function')try{refreshSysBadge();}catch{}
}
function kdClock(){if(!$('#kd-clock'))return;const n=new Date();$('#kd-greeting').textContent=kdGreeting();$('#kd-date').textContent=n.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:'Africa/Nairobi'});$('#kd-clock').textContent=n.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Africa/Nairobi'});}
function kdPaint(animate){
 const d=kd.data;if(!d||!$('#kd'))return;const admin=state.session.user.role==='admin',routers=d.routers,pick=kd.router?routers.filter(r=>r.id===kd.router):routers;
 const sel=$('#kd-router');sel.innerHTML='<option value="">All routers</option>'+routers.map(r=>`<option value="${E(r.id)}" ${kd.router===r.id?'selected':''}>${E(r.name)}</option>`).join('');
 // Hero + status chips
 const up=routers.filter(r=>r.status==='online').length,total=routers.length;
 $('#kd-status').innerHTML=`${new Date().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'Africa/Nairobi'})} · <b class="${up===total&&total?'ok':'warn'}">${total?`${up} of ${total} routers online`:'No routers yet'}</b> · updated ${new Date(d.now).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Africa/Nairobi'})}`;
 const downNow=d.totals.downMbps,upNow=d.totals.upMbps;$('#kd-hero-down').textContent=kc.fmtRate(up?downNow:null);$('#kd-hero-up').textContent=kc.fmtRate(up?upNow:null);
 // KPI tiles
 const tot=d.totals.series,tail=n=>tot.slice(-24).map(p=>p[n]),online=kdOnlineSeries(routers),onl=[...new Set([...online.hotspot,...online.pppoe].map(p=>p[0]))].sort().map(t=>(online.hotspot.find(p=>p[0]===t)?.[1]||0)+(online.pppoe.find(p=>p[0]===t)?.[1]||0));
 const days=d.revenue?.days||[],yest=days.length>1?days[days.length-2].amount:0,delta=yest?Math.round((d.revenue.today-yest)/yest*100):null;
 const hsOn=d.hotspot?.online||0,ppOn=d.pppoe?.online||0;
 const kpis=[{key:'online',label:'Online now',value:d.customers.connected,sub:`${kc.fmtNum(hsOn)} hotspot · ${kc.fmtNum(ppOn)} PPPoE`,tone:'blue',icon:'onu',href:'#cust-table',spark:kc.spark(onl.slice(-24),{color:'#3b5bfd'})},
  {key:'portal',label:'On the WiFi page',value:kd.portal?.total??null,sub:kd.portal?`${kc.fmtNum(kd.portal.hotspot)} hotspot · ${kc.fmtNum(kd.portal.pppoe)} PPPoE`:'live',tone:'cyan',icon:'wifi',href:'#hs-connect'},
  ...(admin?[{key:'rev',label:'Revenue today',value:d.revenue.today,prefix:'KSh ',sub:delta==null?'no payments yesterday':`<span class="${delta>=0?'kd2-up':'kd2-dn'}">${delta>=0?'▲':'▼'} ${Math.abs(delta)}%</span> vs yesterday`,tone:'good',icon:'receipt',href:'#pay-received'},
   {key:'month',label:'This month',value:d.revenue.month,prefix:'KSh ',sub:`KSh ${kc.fmtNum(d.revenue.week)} in 7 days`,tone:'violet',icon:'wallet',href:'#pay-received'}]:[{key:'active',label:'Active subscribers',value:d.customers.active,sub:`${kc.fmtNum(d.customers.expired)} expired`,tone:'good',icon:'check',href:'#cust-table'}]),
  {key:'soon',label:'Expiring in 3 days',value:d.customers.expiringSoon,sub:d.customers.expiringSoon?'send a reminder →':'nobody about to expire',tone:'amber',icon:'clock',href:'#cust-table'},
  {key:'alerts',label:'Open alerts',value:d.alerts.open,sub:d.alerts.open?d.alerts.items.slice(0,1).map(a=>E(a.title)).join('')||'needs attention':'all clear',tone:d.alerts.open?'bad':'good',icon:'warning',href:'#notifications'}];
 const kpiHtml=k=>`<a class="kd2-kpi kd2-${k.tone}" href="${k.href}" data-kpi="${k.key}"><span class="kd2-kpi-ic">${kdIcon(k.icon,17)}</span><span class="kd2-kpi-body"><small>${E(k.label)}</small><b data-count="${k.key}">${k.value==null?'—':''}</b><em class="kd-kpi-sub">${k.sub||''}</em></span>${k.spark?`<span class="kd-kpi-spark">${k.spark}</span>`:''}</a>`;
 if(!$('#kd-kpis').children.length||animate)$('#kd-kpis').innerHTML=kpis.map(kpiHtml).join('');else for(const k of kpis){const card=document.querySelector(`[data-kpi="${k.key}"]`);if(card){card.querySelector('.kd-kpi-sub').innerHTML=k.sub||'';const sp=card.querySelector('.kd-kpi-spark');if(sp)sp.innerHTML=k.spark||'';}}
 for(const k of kpis){const el=document.querySelector(`[data-count="${k.key}"]`);if(el&&k.value!=null)kc.count(el,k.value,{decimals:0,prefix:k.prefix||'',suffix:''});}
 // Throughput chart
 const series=[{name:'Download',color:'#3b5bfd',points:[]},{name:'Upload',color:'#a855f7',points:[]}],src=kd.router?pick[0]?.series.map(p=>[p[0],p[1],p[2]])||[]:d.totals.series;
 series[0].points=src.map(p=>[p[0],p[1]]);series[1].points=src.map(p=>[p[0],p[2]]);
 const peak=series[0].points.reduce((m,p)=>p[1]!=null&&p[1]>m[1]?p:m,[0,0]);$('#kd-peak').textContent=peak[1]?`Peak ${kc.fmtRate(peak[1])} at ${['7d','30d','90d'].includes(d.range)?kc.dayHour(peak[0]):kc.hhmm(peak[0])}`:'';
 kc.area($('#kd-throughput'),{series,height:window.innerWidth<720?200:260,unit:kc.fmtRate,axis:v=>v>=1000?(v/1000)+'G':v>=1?Math.round(v*10)/10:Math.round(v*1000)+'k',animate,label:'Network throughput',empty:'No throughput history yet',emptyHint:'Routers report every 30 seconds; the graph fills as data arrives.'});
 // Router health cards
 const meter=(v,label)=>{const n=Math.round(Number(v)||0),tone=n>=85?'bad':n>=60?'warn':'ok';return `<span class="kd2-meter ${tone}" title="${label} ${n}%"><small>${label}</small><i><b style="width:${Math.min(100,n)}%"></b></i><em>${n}%</em></span>`;};
 $('#kd-routers').innerHTML=routers.length?routers.map(r=>`<div class="kd2-router ${r.status}"><span class="kd-dot ${r.status}"></span><div class="kd2-rname"><strong>${E(r.name)}</strong><small>${E([r.model,r.version&&'RouterOS '+r.version,r.uptime&&'up '+r.uptime].filter(Boolean).join(' · ')||'Waiting for a report')}</small></div>${r.status==='online'?`<div class="kd2-rstats">${meter(r.cpu,'CPU')}${meter(r.memory,'RAM')}<span class="kd2-rnum"><b>${kc.fmtNum((r.customers.ppp||0)+(r.customers.hotspot||0))}</b> online</span><span class="kd2-rnum">↓ ${E(kc.fmtRate(r.downMbps))}</span></div>`:`<div class="kd2-rstats"><span class="kd2-off">Offline · last seen ${E(kdAgo(r.lastSeen))}</span></div>`}</div>`).join(''):'<div class="kd-empty-note">Add a MikroTik with Link a MikroTik to see live health.</div>';
 // Customers online chart
 kc.area($('#kd-online'),{series:[{name:'Hotspot',color:'#06b6d4',points:online.hotspot},{name:'PPPoE',color:'#6366f1',points:online.pppoe}],height:window.innerWidth<720?170:220,unit:v=>kc.fmtNum(v)+' customers',axis:v=>Math.round(v),animate,label:'Customers online',empty:'Collecting customer counts',emptyHint:'One point is stored every 5 minutes from each router report.'});
 // Revenue
 if(admin){const money=(id,v)=>{kc.count($('#'+id),v,{prefix:'KSh '});};money('kd-rev-today',d.revenue.today);money('kd-rev-week',d.revenue.week);money('kd-rev-month',d.revenue.month);money('kd-rev-last',d.revenue.lastMonth||0);money('kd-rev-3m',d.revenue.threeMonths||0);money('kd-rev-ytd',d.revenue.ytd||0);
  kc.bars($('#kd-revenue'),{items:d.revenue.days.map(x=>({label:x.day.slice(8),title:new Date(x.day+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}),value:x.amount,sub:x.count+' payment'+(x.count===1?'':'s')})),height:window.innerWidth<720?150:180,format:kc.fmtKsh,colorful:true,empty:'No payments yet',emptyHint:'Payments from the portal, paybill and manual entries appear here.',label:'Revenue per day'});}
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
 {const sc=$('#kd-st-card');if(sc)sc.hidden=!(d.statics&&d.statics.total);}
 kdStatus($('#kd-st'),d.statics,[['Online','online','good','check'],['Offline','offline','muted','clock'],['Online expired','onlineExpired','warn','warning'],['Expired','expired','bad','clock'],['Deactivated','deactivated','violet','info'],['Unpaid','unpaid','grey','info']],'static');
 // Received payments (admins): package, account, service, router, reference, amount, time; 10 per page.
 {const card=$('#kd-paycard'),rows=d.revenue?.recent||[];if(card){card.hidden=!admin||!rows.length;kd.payPage=Math.min(kd.payPage||0,Math.max(0,Math.ceil(rows.length/10)-1));const paint=()=>{const pg=rows.slice(kd.payPage*10,kd.payPage*10+10),svc={hotspot:'Hotspot',pppoe:'PPPoE',static:'Static'};
  $('#kd-pays').innerHTML=`<div class="kd-table-wrap"><table class="kd-table kd-paystack"><thead><tr><th>PACKAGE</th><th>CUSTOMER</th><th>ROUTER</th><th>REF</th><th>AMOUNT</th><th>TIME</th></tr></thead><tbody>${pg.map(p=>`<tr><td data-l="Package">${E(p.package||'—')}</td><td data-l="Customer" title="${E(p.account||p.name||'—')}">${p.subscriberId?`<button class="link-button" data-kd-cust="${E(p.subscriberId)}">${kdFive(p.account||p.name||'—')}</button>`:kdFive(p.account||p.name||'—')} ${p.service?`<span class="kd-svc-pill">${svc[p.service]||E(p.service)}</span>`:''}</td><td data-l="Router" title="${E(p.router||'—')}">${kdFive(p.router||'—')}</td><td data-l="Ref" title="${E(p.reference||'')}"><code>${kdFive(p.reference||'')}</code></td><td data-l="Amount" class="kd-plus">+KSh ${E(Number(p.amount).toLocaleString('en-KE'))}</td><td data-l="Time">${E(kdAgo(p.time))}</td></tr>`).join('')}</tbody></table></div><div class="kd-pager"><span>${rows.length?kd.payPage*10+1:0}–${Math.min(rows.length,kd.payPage*10+10)} of ${rows.length}</span><button class="button secondary" data-kd-pg="-1" ${kd.payPage?'':'disabled'}>‹ Prev</button><button class="button secondary" data-kd-pg="1" ${(kd.payPage+1)*10<rows.length?'':'disabled'}>Next ›</button></div>`;
  for(const b of document.querySelectorAll('[data-kd-pg]'))b.onclick=()=>{kd.payPage+=Number(b.dataset.kdPg);paint();};for(const b of document.querySelectorAll('[data-kd-cust]'))b.onclick=()=>window.openProfile&&window.openProfile(b.dataset.kdCust);};if(admin)paint();}}
 $('#kd-alerts').innerHTML=d.alerts.items.length?d.alerts.items.slice(0,10).map(a=>`<div class="kd-alert ${E(a.severity||'warning')}"><span class="kd-alert-dot"></span><div><strong>${E(a.title)}</strong><small>${E(a.details||'')}</small></div><time>${E(kdAgo(a.time))}</time></div>`).join(''):'<div class="kd-allclear"><span>✓</span><div><strong>All clear</strong><small>No open alerts. Your network is healthy.</small></div></div>';
 $('#kd-updated').textContent='· updated '+new Date(d.now).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Africa/Nairobi'});{const c=d.completeness,el=$('#kd-complete');if(c&&el){const mins=c.lastAccounting?Math.round((d.now-c.lastAccounting)/60000):null;el.textContent=` · ${c.reporting} of ${c.routers} routers reporting · customer lists from ${c.customerLists} · accounting ${mins==null?'not received yet':mins<1?'just now':mins+' min ago'}`;el.title='Data completeness: see "How these numbers are measured" below';}}
}
function kdStatus(el,p,tiles,svc){if(!el)return;if(!p){el.innerHTML='';return;}
 const C={online:'#3b5bfd',offline:'#f59e0b',onlineExpired:'#ec4899',expired:'#ef4444',unpaid:'#94a3b8',deactivated:'#8b5cf6'};
 const parts=tiles.map(([l,k])=>[l,k,p[k]||0]),top=[...(p.byPackage||[])].sort((a,b)=>b.count-a.count)[0],topR=[...(p.byDevice||[])].filter(x=>x.count).sort((a,b)=>b.count-a.count)[0];
 el.innerHTML=`<div class="kd2-chips">${parts.map(([l,k,n])=>`<span class="kd2-chip" style="--c:${C[k]}"><b>${kc.fmtNum(n)}</b>${l.toLowerCase()}</span>`).join('')}</div>
  <div class="kd2-bar" role="img" aria-label="${E(parts.map(([l,,n])=>l+' '+n).join(', '))}">${parts.filter(x=>x[2]).map(([l,k,n])=>`<i title="${l}: ${n}" style="width:${p.total?n/p.total*100:0}%;background:${C[k]}"></i>`).join('')}</div>
  <div class="kd2-foot"><span><b>${kc.fmtNum(p.total)}</b> total</span><span>${top?`Top package: <b>${E(top.name)}</b> (${kc.fmtNum(top.count)} online)`:topR?`Busiest: <b>${E(topR.name)}</b>`:'Nobody online right now'}</span></div>
  ${p.notInNetops?`<p class="kd-ppp-note"><b>${kc.fmtNum(p.notInNetops)}</b> connected ${svc==='pppoe'?'PPPoE':svc==='static'?'static':'hotspot'} ${p.notInNetops===1?'user is':'users are'} not in netops yet.</p>`:''}`;}
// Business strip: money collected (hidden until the eye is pressed) and who this workspace is.
async function kdBusiness(){const el=$('#kd-isp');if(!el)return;try{kd.biz=await api('business');}catch{el.remove();return;}kdBusinessPaint();}
function kdBusinessPaint(){const el=$('#kd-isp'),b=kd.biz;if(!el||!b)return;const m=b.money,mask='••••••',v=n=>kd.showMoney?E(kc.fmtKsh(n).replace('KSh ','')):mask;
 el.innerHTML=`${m?`<div class="kd-isp-wallet"><span class="kd-isp-ic">${kdIcon('wallet',22)}</span><button type="button" class="kd-eye" id="kd-eye" aria-label="${kd.showMoney?'Hide':'Show'} amounts">${kdIcon(kd.showMoney?'eyeoff':'eye',16)}</button><div><small>Collected</small><b>KES</b></div><div><small>Today</small><b>${v(m.today)}</b></div><div><small>This month</small><b>${v(m.month)}</b></div></div>`:''}
 <div class="kd-isp-biz"><img src="/img/kade-mark.png" alt="" width="22" height="22"><strong>${E(b.name)}</strong>${b.code?`<span>Account prefix: <b>${E(b.code)}</b></span>`:''}${b.email?`<span>Email: <b>${E(b.email)}</b></span>`:''}${b.phone?`<span>Phone: <b>${E(b.phone)}</b></span>`:''}<span>Site: <b>${E(b.site)}</b></span><a href="#team">Team: <b>${kc.fmtNum(b.members)}</b></a>${m&&m.pendingPayouts?`<a href="#payouts">Payouts waiting: <b>${m.pendingPayouts}</b></a>`:''}</div>`;
 const eye=$('#kd-eye');if(eye)eye.onclick=()=>{kd.showMoney=!kd.showMoney;kdBusinessPaint();};}
// Live captive-portal visitors, refreshed on the chosen interval while the dashboard is open.
async function kdPortalNow(){clearTimeout(kd.portalTimer);if(!$('#kd-pn'))return;
 if(!document.hidden&&!$('dialog[open]'))try{kd.portal=await api('portal-now');const card=document.querySelector('[data-kpi="portal"]');if(card){const b=card.querySelector('[data-count="portal"]');if(b)b.textContent=kc.fmtNum(kd.portal.total);card.querySelector('.kd-kpi-sub').textContent=`${kc.fmtNum(kd.portal.hotspot)} hotspot · ${kc.fmtNum(kd.portal.pppoe)} PPPoE`;}}catch{}
 kdPortalPaint();if(kd.portalEvery>0)kd.portalTimer=setTimeout(kdPortalNow,kd.portalEvery*1000);}
// "On the captive portal now": who is on the WiFi page right now, by page and by router, refreshed live.
try{const v=Number(localStorage.getItem('kd.portalEvery'));if([0,5,10,30,60].includes(v)&&localStorage.getItem('kd.portalEvery')!==null)kd.portalEvery=v;}catch{}
function kdPortalPaint(){const el=$('#kd-pn');if(!el)return;const p=kd.portal||{total:0,hotspot:0,pppoe:0,pages:{},devices:{}};
 const chips=o=>Object.entries(o||{}).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`<span class="kd-pn-chip">${E(k)} <b>${kc.fmtNum(n)}</b></span>`).join('')||'<span class="kd-pn-none">nobody right now</span>';
 const sync=[[5,'5s'],[10,'10s'],[30,'30s'],[60,'1 min'],[0,'Paused']];
 el.innerHTML=`<div class="kd-pn-top"><h2><i class="kd-pn-dot ${p.total?'on':''}"></i>On the captive portal now</h2><span class="kd-pn-pill"><b>${kc.fmtNum(p.total)}</b> total</span><span class="kd-pn-pill"><b class="hs">${kc.fmtNum(p.hotspot)}</b> hotspot</span><span class="kd-pn-pill"><b>${kc.fmtNum(p.pppoe)}</b> PPPoE</span></div>
  <div class="kd-pn-row"><span class="kd-pn-k">Pages</span><div class="kd-pn-chips">${chips(p.pages)}</div></div>
  <div class="kd-pn-row"><span class="kd-pn-k">Devices</span><div class="kd-pn-chips">${chips(p.devices)}</div><div class="kd-pn-sync"><span>${kd.portalEvery?'live · every '+(sync.find(x=>x[0]===kd.portalEvery)?.[1]||kd.portalEvery+'s'):'paused'}</span><select id="kd-pn-every" aria-label="Refresh every">${sync.map(([v,l])=>`<option value="${v}" ${v===kd.portalEvery?'selected':''}>Sync: ${l}</option>`).join('')}</select></div></div>`;
 $('#kd-pn-every').onchange=e=>{kd.portalEvery=Number(e.target.value);try{localStorage.setItem('kd.portalEvery',String(kd.portalEvery));}catch{}kdPortalNow();};}
const kdPalette=['#3b5bfd','#06b6d4','#a855f7','#10b981','#f59e0b','#ec4899','#14b8a6','#6366f1'];
async function kdLoad(){const request=++kd.request;try{const d=await api('overview?range='+kd.range+'&hotspot='+kd.hs);if(request!==kd.request||!['dashboard','trends'].includes(state.page))return;kd.data=d;kdPaint(kd.first);kd.first=false;}catch(error){if(request===kd.request&&$('#kd')&&!kd.data)$('#kd').insertAdjacentHTML('afterbegin',notice('Could not load the overview',E(error.message),true));}}
// Revenue breakdown donuts (admin): by service, package and location, and voucher revenue by package and location.
const KD_RB=[{id:'svc',title:'Revenue by service',pick:r=>r.byService},{id:'plan',title:'Revenue by package',pick:r=>r.byPlan},{id:'loc',title:'Revenue by location',side:true,pick:r=>r.byLocation},
 {id:'vplan',title:'Voucher revenue by package',side:true,voucher:true,pick:r=>r.vouchers.byPlan},{id:'vloc',title:'Voucher revenue by location',voucher:true,pick:r=>r.vouchers.byLocation}];
const KD_RB_P=[['today','Today'],['yesterday','Yesterday'],['week','This week'],['month','This month'],['lastmonth','Last month'],['3m','Last 3 months'],['ytd','Year to date']];
kd.rb=kd.rb||{};kd.rbCache=kd.rbCache||new Map();
function kdRbCard(c){const p=kd.rb[c.id]||'today';return `<article class="kd-card kd-rb-card" data-rb="${c.id}"><header><h3>${c.title}</h3><div class="kd-rb-tools"><button type="button" class="kd-rb-refresh" data-rb-refresh="${c.id}" aria-label="Refresh" title="Refresh">↻</button><select data-rb-period="${c.id}" aria-label="Period">${KD_RB_P.map(([v,l])=>`<option value="${v}" ${v===p?'selected':''}>${l}</option>`).join('')}</select></div></header><div class="kd-rb-body"><div class="kd-rb-chart" id="kd-rb-${c.id}"></div><ul class="kd-rb-legend" id="kd-rb-l-${c.id}"></ul></div></article>`;}
async function kdRbReport(period,fresh){const hit=kd.rbCache.get(period);if(hit&&!fresh&&Date.now()-hit.at<60000)return hit.value;const value=await api('reports?period='+period);kd.rbCache.set(period,{at:Date.now(),value});return value;}
async function kdRbPaint(c,fresh){const host=$('#kd-rb-'+c.id),leg=$('#kd-rb-l-'+c.id);if(!host)return;const period=kd.rb[c.id]||'today';host.classList.add('loading');
 try{const r=await kdRbReport(period,fresh);if(!$('#kd-rb-'+c.id))return;const rows=(c.pick(r)||[]).filter(x=>x.amount>0),top=rows.slice(0,7),rest=rows.slice(7).reduce((a,x)=>a+x.amount,0);if(rest>0)top.push({name:'Others',amount:rest});
  const total=top.reduce((a,x)=>a+x.amount,0),short=n=>n>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':n>=1e3?(n/1e3).toFixed(1).replace(/\.0$/,'')+'K':String(Math.round(n));
  kc.donut(host,top.map((x,i)=>({label:x.name,value:x.amount,color:kdPalette[i%kdPalette.length]})),{size:180,stroke:26,center:short(total),sub:'KSh total'});
  if(!total)host.innerHTML=`<div class="kd-rb-none"><b>No revenue</b><span>${E(KD_RB_P.find(p=>p[0]===period)?.[1]||'')}</span></div>`;
  leg.innerHTML=top.map((x,i)=>`<li><i style="background:${kdPalette[i%kdPalette.length]}"></i><span>${E(x.name)}</span><b>${kc.fmtKsh(x.amount)}</b><small>${total?Math.round(x.amount/total*100):0}%</small></li>`).join('');}
 catch(e){host.innerHTML=`<div class="kd-rb-none"><b>Could not load</b><span>${E(e.message)}</span></div>`;leg.innerHTML='';}
 finally{host.classList.remove('loading');}}
function kdRbLoad(){for(const c of KD_RB){const sel=document.querySelector(`[data-rb-period="${c.id}"]`),btn=document.querySelector(`[data-rb-refresh="${c.id}"]`);if(!sel)continue;
 sel.onchange=()=>{kd.rb[c.id]=sel.value;kdRbPaint(c);};btn.onclick=()=>kdRbPaint(c,true);kdRbPaint(c);}}
function renderDashboard(){kd.first=true;kd.data=null;kdSkeleton();kdLoad();clearInterval(kd.timer);kd.timer=setInterval(()=>{if(['dashboard','trends'].includes(state.page)&&!document.hidden&&!$('dialog[open]'))kdLoad();else if(!['dashboard','trends'].includes(state.page))clearInterval(kd.timer);},30000);}
// Alerts arrive within seconds: a tiny request every 5 s while the dashboard is open and visible; the page repaints only when something changed.
setInterval(async()=>{if(!state.session?.user||!['dashboard','trends'].includes(state.page)||document.hidden||!kd.data||$('dialog[open]'))return;
 try{const r=await api('alerts/live');if(kd.alertHash===undefined){kd.alertHash=r.hash;return;}if(r.hash!==kd.alertHash){kd.alertHash=r.hash;kd.data.alerts={open:r.open,items:r.items};kdPaint(false);}}catch{}},5000);
setInterval(kdClock,1000);
