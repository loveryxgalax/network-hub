'use strict';
// Kade chart kit: dependency-free SVG charts (area/line with hover, bars, donut, ring gauge, sparkline) that follow the
// theme colours (CSS variables) so they work in light and dark mode. Everything is escaped before it reaches innerHTML.
const kc=(()=>{
 const NS='http://www.w3.org/2000/svg';let uid=0;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const niceMax=v=>{if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v)),n=v/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p;};
 const fmtRate=v=>v==null?'—':v>=1000?(v/1000).toFixed(v>=10000?0:2)+' Gbps':v>=100?Math.round(v)+' Mbps':v>=1?v.toFixed(1)+' Mbps':Math.round(v*1000)+' kbps';
 const fmtNum=v=>v==null?'—':Number(v).toLocaleString('en-KE',{maximumFractionDigits:0});
 const fmtKsh=v=>v==null?'—':'KSh '+Number(v).toLocaleString('en-KE',{maximumFractionDigits:0});
 const fmtBytes=n=>{if(!Number.isFinite(n))return '—';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++;}return (n>=10||i===0?Math.round(n):n.toFixed(1))+' '+u[i];};
 const tz='Africa/Nairobi';
 const hhmm=t=>new Date(t).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:tz});
 const dayHour=t=>new Date(t).toLocaleString('en-GB',{weekday:'short',hour:'2-digit',minute:'2-digit',timeZone:tz});
 // Smooth path through points (monotone-ish: horizontal tangents keep it from overshooting). Null values break the line.
 function segments(points,x,y){const out=[];let cur=[];for(const p of points){if(p[1]==null){if(cur.length)out.push(cur);cur=[];}else cur.push([x(p[0]),y(p[1])]);}if(cur.length)out.push(cur);return out;}
 const curve=seg=>seg.length===1?`M${seg[0][0]},${seg[0][1]}`:seg.reduce((d,p,i)=>i?d+` C${(seg[i-1][0]+p[0])/2},${seg[i-1][1]} ${(seg[i-1][0]+p[0])/2},${p[1]} ${p[0]},${p[1]}`:`M${p[0]},${p[1]}`,'');
 function tooltip(host){let tip=host.querySelector('.kc-tip');if(!tip){tip=document.createElement('div');tip.className='kc-tip';tip.hidden=true;host.appendChild(tip);}return tip;}
 // opt: {series:[{name,color,points:[[t,v]]}], height, unit(fn), timeFormat(fn), min, max, animate, empty}
 function area(host,opt){
  const render=()=>{
   const W=Math.max(260,host.clientWidth||600),H=opt.height||260,m={l:46,r:12,t:12,b:24},iw=W-m.l-m.r,ih=H-m.t-m.b,id='kc'+(++uid);
   const all=opt.series.flatMap(s=>s.points.filter(p=>p[1]!=null));
   if(!all.length){host.innerHTML=`<div class="kc-empty" style="height:${H}px"><strong>${esc(opt.empty||'No data yet')}</strong><span>${esc(opt.emptyHint||'It appears once the routers have reported for a few minutes.')}</span></div>`;return;}
   const t0=Math.min(...all.map(p=>p[0])),t1=Math.max(...all.map(p=>p[0]),t0+1),vmax=niceMax(Math.max(opt.max??0,...all.map(p=>p[1]))*1.08),vmin=opt.min??0;
   const x=t=>m.l+(t-t0)/(t1-t0)*iw,y=v=>m.t+ih-(v-vmin)/(vmax-vmin)*ih,fmt=opt.unit||(v=>v);
   const grid=[0,1,2,3,4].map(i=>{const v=vmin+(vmax-vmin)*i/4,yy=y(v);return `<line class="kc-grid" x1="${m.l}" x2="${W-m.r}" y1="${yy}" y2="${yy}"/><text class="kc-axis" x="${m.l-8}" y="${yy+4}" text-anchor="end">${esc(opt.axis?opt.axis(v):v>=100?Math.round(v):+v.toFixed(1))}</text>`;}).join('');
   const span=t1-t0,tf=opt.timeFormat||(span>36*3600000?dayHour:hhmm),ticks=[0,1,2,3,4].map(i=>{const t=t0+span*i/4;return `<text class="kc-axis" x="${x(t)}" y="${H-6}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${esc(tf(t))}</text>`;}).join('');
   const defs=opt.series.map((s,i)=>`<linearGradient id="${id}g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${s.color}" stop-opacity=".42"/><stop offset="100%" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('');
   const paths=opt.series.map((s,i)=>segments(s.points,x,y).map(seg=>{const d=curve(seg);return (seg.length>1?`<path class="kc-fill" d="${d} L${seg.at(-1)[0]},${m.t+ih} L${seg[0][0]},${m.t+ih} Z" fill="url(#${id}g${i})"/>`:'')+`<path class="kc-line${opt.animate!==false?' kc-draw':''}" pathLength="1" d="${d}" stroke="${s.color}" fill="none"/>`;}).join('')).join('');
   host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opt.label||'Chart')}"><defs>${defs}</defs>${grid}${ticks}${paths}<line class="kc-cursor" y1="${m.t}" y2="${m.t+ih}" hidden/><g class="kc-dots"></g><rect class="kc-hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/></svg>`;
   const svg=host.querySelector('svg'),hit=svg.querySelector('.kc-hit'),cursor=svg.querySelector('.kc-cursor'),dots=svg.querySelector('.kc-dots'),tip=tooltip(host);
   const move=ev=>{const r=svg.getBoundingClientRect(),px=((ev.touches?ev.touches[0].clientX:ev.clientX)-r.left)*(W/r.width),t=t0+(px-m.l)/iw*(t1-t0);
    const rows=opt.series.map(s=>{let best=null;for(const p of s.points)if(p[1]!=null&&(best===null||Math.abs(p[0]-t)<Math.abs(best[0]-t)))best=p;return best&&Math.abs(best[0]-t)<span/8?{s,p:best}:null;}).filter(Boolean);
    if(!rows.length){tip.hidden=true;cursor.setAttribute('hidden','');dots.innerHTML='';return;}
    const cx=x(rows[0].p[0]);cursor.removeAttribute('hidden');cursor.setAttribute('x1',cx);cursor.setAttribute('x2',cx);
    dots.innerHTML=rows.map(r=>`<circle cx="${x(r.p[0])}" cy="${y(r.p[1])}" r="4.5" fill="${r.s.color}" stroke="var(--card,#fff)" stroke-width="2"/>`).join('');
    tip.innerHTML=`<b>${esc(tf(rows[0].p[0]))}</b>`+rows.map(r=>`<span><i style="background:${r.s.color}"></i>${esc(r.s.name)}<em>${esc(fmt(r.p[1]))}</em></span>`).join('');tip.hidden=false;
    const left=Math.min(Math.max(cx/W*r.width+12,0),r.width-tip.offsetWidth-4);tip.style.left=(cx/W*r.width>r.width*.6?cx/W*r.width-tip.offsetWidth-12:left)+'px';tip.style.top='8px';};
   hit.addEventListener('mousemove',move);hit.addEventListener('touchmove',move,{passive:true});hit.addEventListener('mouseleave',()=>{tip.hidden=true;cursor.setAttribute('hidden','');dots.innerHTML='';});
  };
  host.classList.add('kc-host');render();
  if(!host._kcObserver&&typeof ResizeObserver==='function'){let w=host.clientWidth,timer;host._kcObserver=new ResizeObserver(()=>{if(Math.abs(host.clientWidth-w)<8)return;w=host.clientWidth;clearTimeout(timer);timer=setTimeout(()=>{opt.animate=false;render();},120);});host._kcObserver.observe(host);}
 }
 // opt: {items:[{label,value,sub}], height, format(fn), color}
 function bars(host,opt){
  const render=()=>{
   const W=Math.max(260,host.clientWidth||600),H=opt.height||220,m={l:8,r:8,t:14,b:26},iw=W-m.l-m.r,ih=H-m.t-m.b,id='kb'+(++uid),n=opt.items.length,max=niceMax(Math.max(...opt.items.map(i=>i.value),1)),gap=Math.min(10,iw/n*.25),bw=Math.max(4,iw/n-gap),fmt=opt.format||(v=>v);
   if(!opt.items.some(i=>i.value>0)){host.innerHTML=`<div class="kc-empty" style="height:${H}px"><strong>${esc(opt.empty||'Nothing yet')}</strong><span>${esc(opt.emptyHint||'')}</span></div>`;return;}
   const bars=opt.items.map((it,i)=>{const h=Math.max(it.value>0?3:0,it.value/max*ih),xx=m.l+i*(iw/n)+gap/2,yy=m.t+ih-h;return `<g class="kc-bar" data-i="${i}"><rect class="kc-bar-bg" x="${xx}" y="${m.t}" width="${bw}" height="${ih}" rx="${Math.min(8,bw/2)}"/><rect class="kc-bar-fg" x="${xx}" y="${yy}" width="${bw}" height="${h}" rx="${Math.min(8,bw/2)}" fill="url(#${id})" style="--d:${i*35}ms"/><text class="kc-axis" x="${xx+bw/2}" y="${H-8}" text-anchor="middle">${esc(it.label)}</text></g>`;}).join('');
   host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opt.label||'Bar chart')}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${opt.color||'var(--kd-cyan,#00a8ff)'}"/><stop offset="100%" stop-color="${opt.color2||'var(--kd-blue,#0a3cff)'}"/></linearGradient></defs>${bars}</svg>`;
   const tip=tooltip(host),svg=host.querySelector('svg');
   for(const g of svg.querySelectorAll('.kc-bar')){const it=opt.items[+g.dataset.i];g.addEventListener('mousemove',ev=>{const r=host.getBoundingClientRect();tip.innerHTML=`<b>${esc(it.title||it.label)}</b><span>${esc(fmt(it.value))}<em>${esc(it.sub||'')}</em></span>`;tip.hidden=false;tip.style.left=Math.min(ev.clientX-r.left+12,r.width-tip.offsetWidth-4)+'px';tip.style.top='8px';g.classList.add('on');});g.addEventListener('mouseleave',()=>{tip.hidden=true;g.classList.remove('on');});}
  };
  host.classList.add('kc-host');render();
  if(!host._kcObserver&&typeof ResizeObserver==='function'){let w=host.clientWidth,timer;host._kcObserver=new ResizeObserver(()=>{if(Math.abs(host.clientWidth-w)<8)return;w=host.clientWidth;clearTimeout(timer);timer=setTimeout(render,120);});host._kcObserver.observe(host);}
 }
 // Ring gauge: value 0-100 → coloured arc (green, amber, red) with the number in the middle.
 function ring(value,{size=64,stroke=7,label='',color}={}){const v=Math.max(0,Math.min(100,Number(value)||0)),r=(size-stroke)/2,c=2*Math.PI*r,col=color||(v<60?'var(--kd-good,#17c98b)':v<85?'var(--kd-warn,#f5a524)':'var(--kd-bad,#ff5470)');
  return `<svg class="kc-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)} ${v}%"><circle cx="${size/2}" cy="${size/2}" r="${r}" class="kc-ring-bg" stroke-width="${stroke}" fill="none"/><circle cx="${size/2}" cy="${size/2}" r="${r}" class="kc-ring-fg" stroke="${col}" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c*v/100} ${c}" transform="rotate(-90 ${size/2} ${size/2})"/><text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" class="kc-ring-n">${value==null?'—':Math.round(v)}</text></svg>`;}
 // Donut: items [{label,value,color}] with the total in the centre.
 function donut(host,items,{size=170,stroke=22,center='',sub=''}={}){
  const total=items.reduce((n,i)=>n+i.value,0),r=(size-stroke)/2,c=2*Math.PI*r;let off=0;
  if(!total){host.innerHTML=`<div class="kc-empty" style="height:${size}px"><strong>No data yet</strong></div>`;return;}
  const arcs=items.map(i=>{const len=i.value/total*c,a=`<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${i.color}" stroke-width="${stroke}" stroke-dasharray="${Math.max(0,len-2)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size/2} ${size/2})" class="kc-arc"><title>${esc(i.label)}: ${esc(i.value)}</title></circle>`;off+=len;return a;}).join('');
  host.innerHTML=`<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"><circle cx="${size/2}" cy="${size/2}" r="${r}" class="kc-ring-bg" stroke-width="${stroke}" fill="none"/>${arcs}<text x="50%" y="48%" text-anchor="middle" class="kc-donut-n">${esc(center)}</text><text x="50%" y="62%" text-anchor="middle" class="kc-donut-s">${esc(sub)}</text></svg>`;
 }
 // Inline sparkline as an SVG string; points are plain numbers (nulls skipped).
 function spark(values,{w=120,h=34,color='var(--kd-cyan,#00a8ff)'}={}){const v=values.filter(n=>n!=null);if(v.length<2)return `<svg class="kc-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"></svg>`;
  const mx=Math.max(...v),mn=Math.min(...v),rg=mx-mn||1,id='ks'+(++uid),pts=v.map((n,i)=>[i/(v.length-1)*w,h-3-(n-mn)/rg*(h-8)]),d=curve(pts);
  return `<svg class="kc-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w},${h} L0,${h} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/></svg>`;}
 // Animated number: counts from the previous value to the new one.
 function count(el,to,{decimals=0,prefix='',suffix='',ms=900}={}){if(!el)return;if(to==null||!Number.isFinite(to)){el.textContent='—';return;}
  const from=Number(el.dataset.v)||0;el.dataset.v=to;if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||from===to){el.textContent=prefix+to.toLocaleString('en-KE',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})+suffix;return;}
  const t0=performance.now(),step=t=>{const k=Math.min(1,(t-t0)/ms),e=1-Math.pow(1-k,3),v=from+(to-from)*e;el.textContent=prefix+v.toLocaleString('en-KE',{minimumFractionDigits:decimals,maximumFractionDigits:decimals})+suffix;if(k<1)requestAnimationFrame(step);};requestAnimationFrame(step);}
 return {area,bars,ring,donut,spark,count,esc,fmtRate,fmtNum,fmtKsh,fmtBytes,hhmm,dayHour};
})();
