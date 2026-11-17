'use strict';
// The newer status page designs (light, brand colour, live "ends at" clock, low-time warning). The older designs in
// status.cjs stay as they are; status.page() hands these keys over to render() below.
const DESIGNS={pass:'Ticket',halo:'Halo',wallet:'Wallet',widgets:'Widgets',forecast:'Forecast',appbar:'Android app',quick:'Quick settings',christmas:'Christmas',newyear:'New Year'};
const LOW=600;// seconds left that switch the page to "Running low"

const ic={
 down:'<path d="M12 4v13M6.5 11.5 12 17l5.5-5.5"/>',up:'<path d="M12 20V7M6.5 12.5 12 7l5.5 5.5"/>',
 clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',bolt:'<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>',
 globe:'<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5s-1.1 5.9-3.6 8.5M12 3.5C9.5 6.1 8.4 9 8.4 12s1.1 5.9 3.6 8.5"/>',
 phone:'<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',chart:'<path d="M5 20v-8M10 20V5M15 20v-6M20 20V9"/>',
 power:'<path d="M12 3.5V11M6.8 6.8a7.5 7.5 0 1 0 10.4 0"/>',plus:'<path d="M12 5v14M5 12h14"/>',home:'<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4z"/>',
 cart:'<path d="M3 4h2.2l2.3 11h10.3L20 7.5H6.4"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
 pkg:'<path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4z"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/>',timer:'<path d="M9.5 2.5h5M12 13V9"/><circle cx="12" cy="13.5" r="7.5"/>',
 wifi:'<path d="M2 8.8a15 15 0 0 1 20 0M5.5 12.4a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.4" r="1.2" fill="currentColor"/>',
 alert:'<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',expand:'<path d="M6 9.5l6 6 6-6"/>'};
const I=(n,s=18)=>`<svg class="i" width="${s}" height="${s}" viewBox="0 0 24 24">${ic[n]}</svg>`;

// Wavy progress line (Android style): a repeating wave image clipped to the share of time left.
const WAVE="url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='12'%3E%3Cpath d='M0 6 Q5.5 0 11 6 T22 6' fill='none' stroke='%23fff' stroke-width='3.4' stroke-linecap='round'/%3E%3C/svg%3E\")";

const CSS=`*{box-sizing:border-box}html,body{margin:0}body{font-family:"Maven Pro",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;color:#0b1b4d;background:#f4f6fd;min-height:100vh}
a{text-decoration:none;color:inherit}.num{font-variant-numeric:tabular-nums}.w{max-width:440px;margin:0 auto;padding:30px 18px 28px}
svg.i{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:none;vertical-align:middle}
.mk{width:38px;height:38px;border-radius:11px;background:#fff;display:grid;place-items:center;flex:none;box-shadow:0 2px 8px rgba(10,30,90,.12);overflow:hidden;font-weight:800;color:var(--p);font-size:18px}.mk img{width:27px;height:27px;object-fit:contain}
.hdr{display:flex;align-items:center;gap:11px}.hdr b{display:block;font-size:16px;font-weight:700}.hdr small{font-size:12.5px;color:#6476a8}
.live{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:#15803d;background:#fff;padding:6px 12px 6px 10px;border-radius:999px;box-shadow:0 1px 3px rgba(10,60,255,.1);white-space:nowrap}.live i{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.22)}
.u{font-size:.5em;opacity:.6;font-weight:600;margin:0 .3em 0 .05em}.u:last-child{margin-right:0}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:15px;border-radius:16px;font-weight:700;font-size:15.5px}
.btn.buy{background:linear-gradient(135deg,var(--p),var(--a));color:#fff;box-shadow:0 10px 24px color-mix(in srgb,var(--p) 28%,transparent);margin-top:16px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.alt{display:flex;align-items:center;justify-content:center;gap:7px;padding:13px;border-radius:14px;background:#fff;font-weight:600;font-size:14.5px;color:#22325f;box-shadow:0 1px 3px rgba(10,30,90,.07)}
.foot{text-align:center;font-size:12px;color:#8a98c4;margin-top:14px}
.nl,.lw{display:inline-flex;align-items:center;gap:8px}.lw,.warn{display:none}body.low .nl{display:none}body.low .lw{display:inline-flex}
body.low .btn.buy{background:linear-gradient(135deg,#f59e0b,#f97316);color:#fff;box-shadow:0 10px 24px rgba(249,115,22,.35)}
.warn{align-items:center;gap:10px;margin-top:14px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:14px;padding:11px 13px;font-size:13.5px}.warn b{color:#7c2d12}body.low .warn{display:flex}
body.low .big{color:#ea580c!important}body.low .ring{stroke:#f97316!important}body.low .fill{background:linear-gradient(90deg,#f59e0b,#f97316)!important}
.ring{transition:stroke-dashoffset .6s}`;

const DESIGN_CSS={
pass:`body{background:#e8edf5}.tk{background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 14px 40px rgba(15,23,42,.12)}
.tk .hd{background:var(--p);color:#fff;padding:18px 20px;display:flex;align-items:center;gap:11px}.tk .hd b{font-size:16px}.tk .hd .pn{margin-left:auto;text-align:right;font-size:11px;letter-spacing:.06em;opacity:.85}.tk .hd .pn b{display:block;font-size:15px;letter-spacing:.08em;opacity:1}
.rt{display:flex;align-items:center;justify-content:space-between;padding:22px 20px 6px}.rt>div{text-align:center}.rt small,.tg small{font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;color:#64748b;font-weight:600}.rt b{display:block;font-size:22px;margin-top:3px}.rt em{display:block;font-style:normal;font-size:11.5px;color:#64748b;margin-top:2px}
.rt .ln{flex:1;border-top:2px dashed #cbd5e1;margin:0 12px;position:relative}.rt .ln span{position:absolute;left:50%;top:-12px;transform:translateX(-50%);background:#fff;padding:0 6px;color:var(--p)}
.cut{position:relative;border-top:2px dashed #dbe2ec;margin:16px 0}.cut:before,.cut:after{content:"";position:absolute;top:-13px;width:24px;height:24px;border-radius:50%;background:#e8edf5}.cut:before{left:-12px}.cut:after{right:-12px}
.tg{display:grid;grid-template-columns:1fr 1fr;gap:14px 10px;padding:0 20px 18px}.tg b{display:block;font-size:15px;margin-top:2px;word-break:break-all}.ok{color:#16a34a}
.bc{height:36px;margin:0 20px 20px;background:repeating-linear-gradient(90deg,#1e293b 0 2px,transparent 2px 4px,#1e293b 4px 5px,transparent 5px 8px,#1e293b 8px 11px,transparent 11px 13px);border-radius:3px;opacity:.85}`,
halo:`body{background:radial-gradient(90% 40% at 0 0,color-mix(in srgb,var(--p) 16%,#fff),transparent 60%),radial-gradient(80% 40% at 100% 8%,color-mix(in srgb,var(--a) 18%,#fff),transparent 60%),#f6f8ff}
.rg{position:relative;width:250px;height:250px;margin:26px auto 0}.rg>svg{position:absolute;inset:0;transform:rotate(-90deg)}.rc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.rc small{font-size:13px;color:#5b6b99}.rc .big{font-size:46px;font-weight:800;letter-spacing:-.02em;color:var(--p);margin:2px 0}.rc .e{font-size:13px;color:#5b6b99;display:flex;align-items:center;gap:5px}
.pk{text-align:center;margin-top:12px}.pk>span{display:inline-block;font-size:13px;font-weight:700;color:var(--p);background:#fff;border:1px solid #e3e9ff;padding:6px 13px;border-radius:999px}
.st{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:20px}.st>div{background:#fff;border:1px solid #e9eefc;border-radius:16px;padding:12px;box-shadow:0 4px 14px rgba(10,60,255,.05)}.st small{display:flex;align-items:center;gap:5px;font-size:11.5px;color:#5b6b99}.st b{display:block;margin-top:7px;font-size:15.5px}`,
wallet:`body{background:#f2f2f6}.hi h1{margin:0;font-size:25px;font-weight:800}.hi small{font-size:13.5px;color:#6b7280}
.cd{margin-top:20px;border-radius:24px;padding:20px;color:#fff;position:relative;overflow:hidden;background:linear-gradient(135deg,var(--p),color-mix(in srgb,var(--p) 60%,var(--a)) 55%,var(--a));box-shadow:0 20px 40px color-mix(in srgb,var(--p) 25%,transparent)}
.cd:before{content:"";position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.22),transparent 70%)}.cd:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(115deg,transparent 0 14px,rgba(255,255,255,.035) 14px 15px)}
.cd>*{position:relative;z-index:1}.ct{display:flex;align-items:center;gap:10px}.ct .mk{width:32px;height:32px}.ct b{font-size:16px}.ct .pl{margin-left:auto;font-size:11.5px;font-weight:800;letter-spacing:.08em;background:rgba(255,255,255,.22);padding:5px 10px;border-radius:8px}
.cm{margin-top:30px}.cm small,.cb small{font-size:11px;letter-spacing:.08em;opacity:.8;font-weight:700;text-transform:uppercase}.cm .big{font-size:44px;font-weight:800;letter-spacing:-.02em}
.cb{display:flex;justify-content:space-between;margin-top:20px}.cb b{display:block;font-size:14.5px;letter-spacing:.03em;margin-top:3px}
.sh{font-size:13px;font-weight:700;color:#6b7280;margin:22px 4px 8px}.ls{background:#fff;border-radius:18px}.it{display:flex;align-items:center;gap:12px;padding:12px 16px}.it+.it{border-top:1px solid #f1f1f4}.it .c{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#eef2ff;color:var(--p)}.it>span:not(.c){flex:1;font-size:15px}.it .c{flex:none}.it b{font-size:15px}`,
widgets:`body{background:linear-gradient(180deg,color-mix(in srgb,var(--p) 8%,#fff),#f6f7fb 40%)}.w{padding-bottom:120px}
.g{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}.x{background:#fff;border-radius:22px;padding:16px;box-shadow:0 1px 2px rgba(11,16,32,.04),0 8px 24px rgba(11,16,32,.05)}.x .l{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#6b7280}
.hero{grid-column:span 2;display:flex;align-items:center;gap:18px;background:linear-gradient(135deg,var(--p),var(--a));color:#fff}.hero .l{color:rgba(255,255,255,.8)}.hero .big{font-size:38px;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px}.hero .s{font-size:13px;opacity:.9}
.mini{width:96px;height:96px;position:relative;flex:none}.mini svg{transform:rotate(-90deg)}.mini b{position:absolute;inset:0;display:grid;place-items:center;font-size:19px}
.tot{font-size:22px;font-weight:800;margin:10px 0}.sp{display:flex;height:8px;border-radius:99px;overflow:hidden;gap:2px;background:#eef1f8}.sp i{background:var(--p)}.sp i+i{background:var(--a)}
.lg{display:flex;justify-content:space-between;font-size:12px;color:#6b7280;margin-top:8px}.lg b{display:block;color:#0b1020;font-size:13px}.v{font-size:22px;font-weight:800;margin:10px 0 4px}.vs{font-size:12.5px;color:#6b7280}
.net{grid-column:span 2;display:grid;grid-template-columns:1fr 1fr;padding:0}.net>div{padding:14px 16px}.net>div+div{border-left:1px solid #f0f1f5}.net b{display:block;margin-top:6px;font-size:14.5px;word-break:break-all}
.tip{grid-column:span 2;display:flex;align-items:center;gap:12px;font-size:13.5px;color:#374151}.tip .c{width:38px;height:38px;border-radius:12px;background:#fff7ed;color:#ea580c;display:grid;place-items:center;flex:none}.tip b{display:block;color:#0b1020}
.dock{position:fixed;left:12px;right:12px;bottom:16px;max-width:416px;margin:0 auto;background:var(--p);border-radius:24px;padding:8px;display:flex;gap:6px;box-shadow:0 16px 36px color-mix(in srgb,var(--p) 35%,transparent)}
.dock a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:9px 0;color:rgba(255,255,255,.85);font-size:11.5px;font-weight:700;border-radius:16px}.dock .btn.buy{flex:1.7;flex-direction:row;background:#fff;color:var(--p);margin:0;box-shadow:none;font-size:14.5px;padding:12px}
body.low .dock .btn.buy{background:#fff7ed;color:#ea580c}.warn{grid-column:span 2;margin:0}`,
forecast:`body{background:#f2f6ff}.w{padding-bottom:150px}.fc{margin-top:18px;border-radius:30px;padding:22px 20px 16px;color:#fff;background:radial-gradient(90% 70% at 100% 0,color-mix(in srgb,var(--a) 75%,#fff),transparent 60%),linear-gradient(160deg,color-mix(in srgb,var(--p) 80%,#fff),var(--p));box-shadow:0 18px 40px color-mix(in srgb,var(--p) 30%,transparent);position:relative;overflow:hidden}
.fc:after{content:"";position:absolute;right:-30px;top:-30px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.12)}.fc>*{position:relative;z-index:1}
.fc .lo{font-size:15px;font-weight:700;display:flex;align-items:center;gap:7px}.fc .big{font-size:68px;font-weight:500;letter-spacing:-.03em;line-height:1.05;margin-top:6px}.fc .c{font-size:15.5px;font-weight:700}.fc .hl{font-size:13.5px;opacity:.92;margin-top:2px}
.hr{display:flex;justify-content:space-between;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.25);min-height:76px}.hr div{text-align:center;font-size:12.5px;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:7px;min-width:52px}.hr .end{background:rgba(255,255,255,.2);border-radius:12px;padding:0 6px}
.tl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.tl>div{background:#fff;border-radius:20px;padding:13px 14px;box-shadow:0 4px 14px rgba(10,60,255,.05)}.tl small{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;color:#6476a8;letter-spacing:.04em;text-transform:uppercase}.tl b{display:block;font-size:22px;margin-top:6px;word-break:break-all}.tl p{margin:3px 0 0;font-size:12.5px;color:#6476a8}
.bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-radius:28px 28px 0 0;padding:14px 18px 22px;box-shadow:0 -8px 30px rgba(10,60,255,.08)}.bar>*{max-width:404px;margin-left:auto;margin-right:auto}.bar .btn.buy{margin-top:0}
.sec{display:flex;justify-content:center;margin-top:10px}.sec a{display:flex;align-items:center;gap:7px;font-size:14.5px;font-weight:600;color:#33437a;padding:6px 18px}.sec a+a{border-left:1px solid #e3e8f7}`,
appbar:`body{background:#fbf8ff}.w{padding-bottom:170px}.ap{display:flex;align-items:center;gap:12px}.ap .mk{border-radius:50%;width:44px;height:44px}.ap small{font-size:13px;color:#45464f}.ap h1{margin:0;font-size:25px;font-weight:500}
.hc{margin-top:18px;background:var(--p);color:#fff;border-radius:28px;padding:20px}.hc .t{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:600}.hc .t .cn{font-size:12px;font-weight:700;background:rgba(255,255,255,.18);padding:5px 10px;border-radius:8px}
.hc .big{font-size:54px;font-weight:700;letter-spacing:-.02em;margin-top:6px}.pr{display:flex;align-items:center;gap:8px;height:14px;margin-top:6px}.pr .fill{height:12px;background:${WAVE} repeat-x left center/22px 12px;min-width:12px}.pr .rest{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.35)}.pr i{width:6px;height:6px;border-radius:50%;background:#fff}
.hc .se{display:flex;justify-content:space-between;font-size:13px;opacity:.92;margin-top:8px}.lb{font-size:14px;font-weight:600;color:var(--p);margin:20px 2px 8px}
.tg{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tg>div{background:#efedf7;border-radius:20px;padding:14px;color:var(--p)}.tg b{display:block;font-size:20px;color:#1b1b21;margin-top:8px;word-break:break-all}.tg small{font-size:13px;color:#45464f}
.fab{position:fixed;right:16px;bottom:100px}.fab .btn.buy{border-radius:16px;padding:16px 20px;margin:0;background:var(--p)}
.nv{position:fixed;left:0;right:0;bottom:0;height:84px;background:#efedf7;display:flex;padding:10px 0 16px}.nv a{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;font-weight:600;color:#45464f}.nv a span{width:64px;height:32px;border-radius:16px;display:grid;place-items:center}.nv a.on{color:#1b1b21;font-weight:700}.nv a.on span{background:color-mix(in srgb,var(--p) 14%,#fff)}`,
quick:`body{background:linear-gradient(180deg,color-mix(in srgb,var(--p) 15%,#fff),color-mix(in srgb,var(--p) 5%,#fff) 40%,#fbf8ff)}.ap{display:flex;align-items:center;gap:12px}.ap .mk{border-radius:50%;width:44px;height:44px}.ap b{display:block;font-size:16px;font-weight:600}.ap small{font-size:13px;color:#45464f}
.qs{margin-top:16px;background:#fbf8ff;border-radius:32px;padding:14px}.qg{display:grid;grid-template-columns:1fr 1fr;gap:8px}.q{height:68px;border-radius:24px;background:#e3e1ec;display:flex;align-items:center;gap:12px;padding:0 14px;color:#1b1b21}.q b{display:block;font-size:14.5px;font-weight:600}.q small{font-size:13px;color:#45464f}
.q.on{grid-column:span 2;height:72px;background:var(--p);color:#fff;padding:0 18px}.q.on small{color:rgba(255,255,255,.9)}.q.on b{font-size:16.5px}.q.tn{background:color-mix(in srgb,var(--p) 14%,#fff)}
.sl{margin-top:12px;height:48px;border-radius:24px;background:#e3e1ec;position:relative;overflow:hidden}.sl .fill{position:absolute;left:0;top:0;bottom:0;background:var(--p);border-radius:24px;min-width:48px}.sl .tx{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:14.5px;font-weight:600}.sl .tx>span:first-child{color:#fff;display:flex;gap:8px;align-items:center}.sl .tx>span:last-child{color:#45464f}
.mp{margin-top:12px;background:color-mix(in srgb,var(--p) 13%,#fff);border-radius:28px;padding:18px 18px 14px;color:#00115a}.mp .h{display:flex;align-items:center;gap:12px}.mp .ab{width:52px;height:52px;border-radius:14px;background:var(--p);color:#fff;display:grid;place-items:center}.mp .h b{display:block;font-size:19px;font-weight:700}.mp .h small{font-size:13.5px}
.pr{display:flex;align-items:center;gap:8px;height:14px;margin-top:14px}.pr .fill{height:12px;background:${WAVE.replace('%23fff','%230a3cff')} repeat-x left center/22px 12px;min-width:12px}.pr .rest{flex:1;height:4px;border-radius:2px;background:color-mix(in srgb,var(--p) 25%,#fff)}.pr i{width:6px;height:6px;border-radius:50%;background:var(--p)}
.mt{display:flex;justify-content:space-between;font-size:12.5px;margin-top:4px}.ctl{display:flex;justify-content:space-around;align-items:center;margin-top:10px}.ctl>a:not(.btn){display:grid;place-items:center;gap:2px;font-size:12.5px;font-weight:600}.ctl .btn.buy{margin:0;width:128px;height:56px;border-radius:20px;background:var(--p);box-shadow:none}`,
christmas:`body{background:radial-gradient(500px 300px at 50% 0,#1f6b3a,transparent 70%),#0c2a1a;color:#fff}body:before{content:"";position:fixed;inset:0;background-image:radial-gradient(rgba(255,255,255,.8) 1.4px,transparent 1.6px),radial-gradient(rgba(255,255,255,.5) 1px,transparent 1.2px);background-size:46px 46px,29px 29px;background-position:0 0,13px 21px;opacity:.55;pointer-events:none}
.lights{position:fixed;top:0;left:0;right:0;height:26px;background:radial-gradient(circle at 12px 14px,#ef4444 5px,transparent 6px),radial-gradient(circle at 36px 18px,#facc15 5px,transparent 6px),radial-gradient(circle at 60px 14px,#22c55e 5px,transparent 6px),radial-gradient(circle at 84px 18px,#38bdf8 5px,transparent 6px);background-size:96px 26px;border-top:2px solid #14532d}
.w{position:relative;padding-top:44px}.hdr b{color:#fff}.hdr small{color:rgba(255,255,255,.65)}.hdr .mk{color:#b91c1c}.hdr .live{background:rgba(255,255,255,.12);color:#fff}
.card{margin-top:26px;background:#fffaf2;color:#3b0d0d;border-radius:22px;padding:22px 18px 18px;border:3px solid #b91c1c;box-shadow:0 0 0 4px #fffaf2,0 18px 40px rgba(0,0,0,.4);position:relative}.bow{position:absolute;top:-24px;left:50%;transform:translateX(-50%);font-size:34px}
.card small{font-size:11px;letter-spacing:.07em;text-transform:uppercase;font-weight:700;color:#9a3412}.h{text-align:center;margin-bottom:14px}.h .tt{font-family:Georgia,serif;font-style:italic;font-size:19px;color:#b91c1c}.h .big{font-size:42px;font-weight:800;color:#14532d;letter-spacing:-.02em}
.g{display:grid;grid-template-columns:1fr 1fr;gap:8px}.g>div{background:#fdecd8;border-radius:12px;padding:10px 12px}.g b{display:block;font-size:15px;margin-top:2px;word-break:break-all}
.btn.buy{background:#b91c1c;box-shadow:0 8px 24px rgba(185,28,28,.4)}.alt{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.22);box-shadow:none}.foot{color:rgba(255,255,255,.5)}`,
newyear:`body{background:radial-gradient(circle at 20% 22%,rgba(245,158,11,.33) 0 2px,transparent 60px),radial-gradient(circle at 80% 12%,rgba(236,72,153,.33) 0 2px,transparent 70px),linear-gradient(180deg,#0b0726,#1b0f3b);color:#fff}
.fw{position:fixed;inset:0;width:100%;height:100%;pointer-events:none}.w{position:relative}.hdr b{color:#fff}.hdr small{color:rgba(255,255,255,.6)}.hdr .live{background:rgba(255,255,255,.08);color:#fde68a}
.t{text-align:center;margin-top:34px}.yr{font-size:66px;font-weight:900;letter-spacing:-.02em;background:linear-gradient(90deg,#fde68a,#f59e0b,#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1}.hny{font-family:Georgia,serif;font-style:italic;font-size:19px;color:#fde68a;margin-top:4px}
.card{margin-top:26px;background:rgba(255,255,255,.06);border:1px solid rgba(253,230,138,.2);border-radius:22px;padding:18px}.card .tl{display:flex;justify-content:space-between;align-items:flex-end;gap:8px}.card small{font-size:11px;letter-spacing:.07em;text-transform:uppercase;font-weight:700;color:#c4b5fd}.card .big{font-size:36px;font-weight:800}.pk{font-size:12.5px;font-weight:800;color:#0b0726;background:#fde68a;padding:5px 11px;border-radius:99px;white-space:nowrap}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.g>div{background:rgba(255,255,255,.05);border-radius:12px;padding:10px;text-align:center}.g small{font-size:9.5px}.g b{display:block;font-size:14px;margin-top:3px}
.btn.buy{background:linear-gradient(90deg,#f59e0b,#ec4899);border-radius:999px;box-shadow:0 10px 30px rgba(236,72,153,.33)}.alt{background:rgba(255,255,255,.07);color:#fff;border-radius:999px;box-shadow:none}.foot{color:rgba(255,255,255,.45)}`};

// Live layer: "ends at"/"started at" clocks, the share of the package left, the forecast row and the low-time state.
// Plain ES5 so old phones run it. Never write a dollar sign followed by a bracket here: RouterOS fills those in. TOTAL is filled from the server's /portal/api/active answer (or a sample in preview).
function live(origin,preview,showPkg){
 return `<script>(function(){var P=function(t){var m,n=0,ok=false,r=/(\\d+)\\s*(w|d|h|m|s)/g;t=String(t||'');while((m=r.exec(t))){ok=true;n+=Number(m[1])*({w:604800,d:86400,h:3600,m:60,s:1}[m[2]]);}return ok?n:null;};
var Q=function(k){return document.querySelectorAll('[data-k="'+k+'"]');},each=function(k,f){var e=Q(k);for(var i=0;i<e.length;i++)f(e[i]);},set=function(k,t){each(k,function(e){e.textContent=t;});};
var tl=document.getElementById('tl'),up=document.getElementById('upt'),TOTAL=${preview?28800:'null'},LOW=${LOW};
var clk=function(d){var h=d.getHours(),m=d.getMinutes(),a=h<12?'AM':'PM';h=h%12||12;return h+':'+(m<10?'0':'')+m+' '+a;};
var hr=function(d){var h=d.getHours(),a=h<12?'AM':'PM';h=h%12||12;return h+' '+a;};
var big=function(L,sec){var d=Math.floor(L/86400),h=Math.floor(L%86400/3600),m=Math.floor(L%3600/60),s=L%60,u=function(n,x){return n+'<span class="u">'+x+'</span>';},o=[];if(d)o.push(u(d,'d'));if(d||h)o.push(u(h,'h'));o.push(u(m,'m'));if((sec||L<3600)&&!d)o.push(u(s,'s'));return o.join(' ');};
var short=function(L){var h=Math.floor(L/3600),m=Math.floor(L%3600/60);return h?h+'h '+m+'m':m+'m';};
var size=function(b){b=Number(b)||0;var u=['B','KB','MB','GB','TB'],i=0;while(b>=1024&&i<4){b/=1024;i++;}return (i?b.toFixed(1):b)+' '+u[i];};
var dn=Number(document.body.getAttribute('data-dn'))||0,upb=Number(document.body.getAttribute('data-up'))||0;
if(dn||upb){set('used',size(dn+upb));each('split',function(e){var s=e.children,t=dn+upb;if(s.length>1&&t){s[0].style.flex=String(Math.max(dn/t,.04));s[1].style.flex=String(Math.max(upb/t,.04));}});}
var yr=new Date();set('year',String(yr.getFullYear()+(yr.getMonth()===11?1:0)));
function tick(){var L=tl?P(tl.textContent):null,U=up?P(up.textContent):null,now=new Date();
 if(U!==null){set('online',short(U));set('start',clk(new Date(now.getTime()-U*1000)));}
 if(L===null){set('big','No limit');set('end','—');return;}
 each('big',function(e){e.innerHTML=big(L,e.getAttribute('data-s')==='1');});set('left',short(L));
 var end=new Date(now.getTime()+L*1000),same=end.toDateString()===now.toDateString();set('end',clk(end));set('endday',(same?'today at ':(L<172800?'tomorrow at ':end.toDateString().slice(0,10)+' at '))+clk(end));
 each('hh',function(e){e.textContent=String(Math.floor(L/3600)).replace(/^(\\d)$/,'0$1');});each('mm',function(e){var m=Math.floor(L%3600/60);e.textContent=(m<10?'0':'')+m;});
 var pct=TOTAL?Math.max(0,Math.min(1,L/TOTAL)):1;set('pct',Math.round(pct*100)+'%');
 each('ring',function(e){var c=Number(e.getAttribute('data-c'));e.setAttribute('stroke-dashoffset',String(c*(1-pct)));});each('bar',function(e){e.style.width=(pct*100)+'%';});
 document.body.className=document.body.className.replace(/\\s*low/g,'')+(L<=LOW?' low':'');
 each('hours',function(e){if(e.getAttribute('data-for')===String(Math.floor(L/60)))return;e.setAttribute('data-for',String(Math.floor(L/60)));
  var w='<svg class="i" width="18" height="18" viewBox="0 0 24 24">${ic.wifi}</svg>',o='<div>Now'+w+'<b>'+short(L)+'</b></div>',t=new Date(now.getTime()),n=0;t.setMinutes(0,0,0);
  var step=L>43200?Math.ceil(L/3600/4):2;t.setHours(t.getHours()+step);while(n<3&&t<end){o+='<div>'+hr(t)+w+'<b>'+short((end-t)/1000)+'</b></div>';t.setHours(t.getHours()+step);n++;}
  o+='<div class="end">'+clk(end).replace(/ (AM|PM)$/,'')+'<svg class="i" width="18" height="18" viewBox="0 0 24 24">${ic.power}</svg><b>Ends</b></div>';e.innerHTML=o;});}
tick();setInterval(tick,1000);
${preview?'':`try{var dt='';try{dt=localStorage.getItem('portal-dt')||'';}catch(x){}fetch('${origin}/portal/api/active?mac='+encodeURIComponent('$(mac)')+'&dt='+encodeURIComponent(dt)).then(function(r){return r.json();}).then(function(d){if(!d||!d.found)return;if(d.total)TOTAL=Math.round(d.total/1000);${showPkg?"if(d.plan)set('plan',d.plan);":''}tick();}).catch(function(){});}catch(e){}`}
})();</script>`;}

function render(cfg,ctx){
 const {esc,origin,preview,phone,v,buy,timer}=ctx,d=cfg.design,brand=esc(cfg.brandName),bl=esc(cfg.buyLabel);
 const mark=cfg.showLogo?`<span class="mk"><img src="${preview?'':esc(origin)}/img/kade-mark.png" alt=""></span>`:`<span class="mk">${esc(cfg.brandName.charAt(0))}</span>`;
 const plan=cfg.showPackage?`<span data-k="plan" id="pk">${preview?'NET PLUS':'Your package'}</span>`:'';
 const planTxt=cfg.showPackage?(preview?'NET PLUS':'Your package'):'';
 const usage=`${buy.replace(/#.*$/,'')}#usage`,tgt=preview?' target="_blank" rel="noopener"':'';
 const off=`href="${v.logout}" onclick="return confirm('Disconnect this device? Your package keeps its remaining time; connect again any time from the WiFi page.')"`;
 const B=(cls='btn buy',label=`${I('plus')}${bl}`,low=`${I('plus')}Top up now`)=>`<a class="${cls}" href="${buy}"${tgt}><span class="nl">${label}</span><span class="lw">${low}</span></a>`;
 const U=(c='alt',lab='My usage',icon='chart')=>`<a class="${c}" href="${usage}"${tgt}>${I(icon,17)}${lab}</a>`,X=(c='alt',lab='Disconnect')=>`<a class="${c}" ${off}>${I('power',17)}${lab}</a>`;
 const warn=`<div class="warn">${I('alert',20)}<div><b>Running low.</b> Top up now to stay online without interruption.</div></div>`;
 const BIG=(s='')=>`<span class="big num" data-k="big"${s?' data-s="1"':''}>${esc(v.left)}</span>`;
 const hdr=(sub=`$(username)`)=>`<div class="hdr">${mark}<div><b>${brand}</b><small>${preview?'ABCD2345':sub}${planTxt?' · <span data-k="plan">'+planTxt+'</span>':''}</small></div><span class="live"><i></i>Connected</span></div>`;
 const user=preview?'ABCD2345':'$(username)';
 const ring=(r,w,col,track)=>{const c=(2*Math.PI*r).toFixed(1),sz=2*r+w;return `<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><circle cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${track}" stroke-width="${w}"/><circle class="ring" data-k="ring" data-c="${c}" cx="${sz/2}" cy="${sz/2}" r="${r}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="0"/></svg>`;};
 const foot=`<div class="foot">IP ${v.ip} · ${v.mac}</div>`;
 let body;
 if(d==='pass')body=`<div class="w"><div class="tk"><div class="hd">${mark}<b>${brand}</b><div class="pn">PASS<b>${user}</b></div></div>
<div class="rt"><div><small>Online for</small><b class="num" data-k="online">${esc(v.uptime)}</b><em>since <span data-k="start">—</span></em></div><div class="ln"><span>${I('bolt',16)}</span></div><div><small>Time left</small><b class="num big" data-k="left">${esc(v.left)}</b><em>ends <span data-k="end">—</span></em></div></div>
<div class="cut"></div><div class="tg">${plan?`<div><small>Package</small><b>${plan}</b></div>`:''}<div><small>Status</small><b class="ok">● Connected</b></div><div><small>Downloaded</small><b class="num">${v.down}</b></div><div><small>Uploaded</small><b class="num">${v.up}</b></div><div><small>IP address</small><b class="num">${v.ip}</b></div><div><small>Device</small><b class="num">${v.mac}</b></div></div><div class="bc"></div></div>
${warn}${B()}<div class="row">${U()}${X()}</div></div>`;
 else if(d==='halo')body=`<div class="w">${hdr()}<div class="rg">${ring(119,12,'var(--p)','#e6ecff')}<div class="rc"><small>Time remaining</small>${BIG()}<span class="e">${I('clock',14)}Ends <span data-k="endday">—</span></span></div></div>
<div class="pk"><span>${planTxt?`<span data-k="plan">${planTxt}</span> · `:''}<span data-k="pct">—</span> left</span></div>
<div class="st"><div><small>${I('down',13)}Download</small><b class="num">${v.down}</b></div><div><small>${I('up',13)}Upload</small><b class="num">${v.up}</b></div><div><small>${I('bolt',13)}Online</small><b class="num" data-k="online">${esc(v.uptime)}</b></div></div>
${warn}${B()}<div class="row">${U()}${X()}</div>${foot}</div>`;
 else if(d==='wallet')body=`<div class="w"><div class="hdr hi"><div><h1>You're online</h1><small>${brand} WiFi</small></div><span class="live"><i></i>Live</span></div>
<div class="cd"><div class="ct">${mark}<b>${brand}</b>${planTxt?`<span class="pl" data-k="plan">${planTxt}</span>`:''}</div><div class="cm"><small>Time remaining</small><div>${BIG(1)}</div></div>
<div class="cb"><div><small>Account</small><b>${user}</b></div><div><small>Ends</small><b data-k="end">—</b></div><div style="text-align:right"><small>Online</small><b data-k="online">${esc(v.uptime)}</b></div></div></div>
<div class="sh">This session</div><div class="ls"><div class="it"><span class="c">${I('down')}</span><span>Downloaded</span><b class="num">${v.down}</b></div><div class="it"><span class="c">${I('up')}</span><span>Uploaded</span><b class="num">${v.up}</b></div><div class="it"><span class="c">${I('globe')}</span><span>IP address</span><b class="num">${v.ip}</b></div></div>
${warn}${B()}<div class="row">${U()}${X()}</div></div>`;
 else if(d==='widgets')body=`<div class="w">${hdr()}<div class="g">
<div class="x hero"><div class="mini">${ring(40,10,'#fff','rgba(255,255,255,.25)')}<b data-k="pct">—</b></div><div><div class="l">${I('clock',14)}Time left</div>${BIG()}<div class="s">Ends <span data-k="endday">—</span></div></div></div>
<div class="x"><div class="l">${I('chart',14)}Data used</div><div class="tot num" data-k="used">${v.down}</div><div class="sp" data-k="split"><i style="flex:9"></i><i style="flex:1"></i></div><div class="lg"><div>Down<b class="num">${v.down}</b></div><div style="text-align:right">Up<b class="num">${v.up}</b></div></div></div>
<div class="x"><div class="l">${I('bolt',14)}This session</div><div class="v num" data-k="online">${esc(v.uptime)}</div><div class="vs">Since <span data-k="start">—</span></div></div>
<div class="x net"><div><div class="l">${I('globe',14)}IP address</div><b class="num">${v.ip}</b></div><div><div class="l">${I('phone',14)}This device</div><b class="num">${v.mac}</b></div></div>
<div class="x tip"><span class="c">${I('clock',20)}</span><div><b>Stay online past <span data-k="end">—</span></b>Top up before your time runs out and you won't be disconnected.</div></div>${warn}</div>
<div class="dock">${U('','Usage')}${B()}${X('','Disconnect')}</div></div>`;
 else if(d==='forecast')body=`<div class="w">${hdr()}<div class="fc"><div class="lo">${I('wifi',20)}${brand} WiFi</div><div>${BIG()}</div><div class="c">Connected${planTxt?` · <span data-k="plan">${planTxt}</span>`:''}</div><div class="hl">Ends <span data-k="end">—</span> · Started <span data-k="start">—</span></div><div class="hr" data-k="hours"></div></div>
<div class="tl"><div><small>${I('down',13)}Downloaded</small><b class="num">${v.down}</b><p>This session</p></div><div><small>${I('up',13)}Uploaded</small><b class="num">${v.up}</b><p>This session</p></div><div><small>${I('bolt',13)}Online</small><b class="num" data-k="online">${esc(v.uptime)}</b><p>Since <span data-k="start">—</span></p></div><div><small>${I('globe',13)}IP address</small><b class="num" style="font-size:18px">${v.ip}</b><p>${v.mac}</p></div></div>${warn}</div>
<div class="bar">${B()}<div class="sec">${U('')}${X('')}</div></div>`;
 else if(d==='appbar')body=`<div class="w"><div class="ap">${mark}<div><small>${brand}</small><h1>Your connection</h1></div></div>
<div class="hc"><div class="t">Time left${planTxt?` · <span data-k="plan">${planTxt}</span>`:''}<span class="cn">Connected</span></div><div>${BIG()}</div><div class="pr"><div class="fill" data-k="bar" style="width:100%"></div><div class="rest"></div><i></i></div><div class="se"><span>Started <span data-k="start">—</span></span><span>Ends <span data-k="end">—</span></span></div></div>
<div class="lb">This session</div><div class="tg"><div>${I('down',22)}<b class="num">${v.down}</b><small>Downloaded</small></div><div>${I('up',22)}<b class="num">${v.up}</b><small>Uploaded</small></div><div>${I('clock',22)}<b class="num" data-k="online">${esc(v.uptime)}</b><small>Online for</small></div><div>${I('globe',22)}<b class="num">${v.ip}</b><small>IP address</small></div></div>${warn}</div>
<div class="fab">${B()}</div><nav class="nv"><a class="on"><span>${I('home',22)}</span>Status</a><a href="${usage}"${tgt}><span>${I('chart',22)}</span>Usage</a><a href="${buy}"${tgt}><span>${I('cart',22)}</span>Buy</a><a ${off}><span>${I('power',22)}</span>Disconnect</a></nav>`;
 else if(d==='quick')body=`<div class="w"><div class="ap">${mark}<div><b>${brand}</b><small>Account ${user}</small></div></div>
<div class="qs"><div class="qg"><div class="q on">${I('wifi',26)}<div style="flex:1"><b>${brand} WiFi</b><small>Connected · <span data-k="left">${esc(v.left)}</span> left</small></div>${I('expand',22)}</div>
<div class="q">${I('down',22)}<div><b>Download</b><small class="num">${v.down}</small></div></div><div class="q">${I('up',22)}<div><b>Upload</b><small class="num">${v.up}</small></div></div>
<div class="q tn">${I('clock',22)}<div><b>Ends</b><small data-k="end">—</small></div></div><div class="q">${I('timer',22)}<div><b>Online</b><small data-k="online">${esc(v.uptime)}</small></div></div></div>
<div class="sl"><div class="fill" data-k="bar" style="width:100%"></div><div class="tx"><span>${I('timer',20)}<span data-k="pct">—</span>&nbsp;of package left</span><span data-k="end">—</span></div></div></div>
<div class="mp"><div class="h"><span class="ab">${I('pkg',28)}</span><div><b>${planTxt?`<span data-k="plan">${planTxt}</span>`:'Your package'}</b><small>${brand} · hotspot package</small></div></div>
<div class="pr"><div class="fill" data-k="bar" style="width:100%"></div><div class="rest"></div><i></i></div><div class="mt num"><span data-k="online">${esc(v.uptime)}</span><span>-<span data-k="left">${esc(v.left)}</span></span></div>
<div class="ctl">${U('','Usage')}${B('btn buy',`${I('plus',20)}Buy`,`${I('plus',20)}Top up`)}${X('','Disconnect')}</div></div>${warn}${foot}</div>`;
 else if(d==='christmas')body=`<div class="lights"></div><div class="w">${hdr()}<div class="card"><div class="bow">🎁</div><div class="h"><div class="tt">Merry Christmas!</div><small>Time left${planTxt?` · <span data-k="plan">${planTxt}</span>`:''}</small><div>${BIG(1)}</div><small style="text-transform:none;letter-spacing:0">Ends <span data-k="endday">—</span></small></div>
<div class="g"><div><small>Downloaded</small><b class="num">${v.down}</b></div><div><small>Uploaded</small><b class="num">${v.up}</b></div><div><small>Online for</small><b class="num" data-k="online">${esc(v.uptime)}</b></div><div><small>Account</small><b>${user}</b></div><div><small>IP address</small><b class="num">${v.ip}</b></div><div><small>Device</small><b class="num" style="font-size:13px">${v.mac}</b></div></div></div>
${warn}${B()}<div class="row">${U()}${X()}</div></div>`;
 else body=`<svg class="fw" viewBox="0 0 390 844" preserveAspectRatio="xMidYMin slice"><g stroke-linecap="round" stroke-width="2.5" fill="none"><g stroke="#fde68a" transform="translate(70 170)"><path d="M0-30V-14M0 30V14M-30 0H-14M30 0H14M-21-21-10-10M21 21 10 10M21-21 10-10M-21 21-10 10"/></g><g stroke="#f472b6" transform="translate(330 215) scale(1.1)"><path d="M0-30V-14M0 30V14M-30 0H-14M30 0H14M-21-21-10-10M21 21 10 10M21-21 10-10M-21 21-10 10"/></g><g stroke="#7dd3fc" transform="translate(40 330) scale(.7)"><path d="M0-30V-14M0 30V14M-30 0H-14M30 0H14M-21-21-10-10M21 21 10 10M21-21 10-10M-21 21-10 10"/></g></g></svg>
<div class="w">${hdr()}<div class="t"><div class="yr" data-k="year">${new Date().getFullYear()}</div><div class="hny">Happy New Year!</div></div>
<div class="card"><div class="tl"><div><small>Time left</small><div>${BIG()}</div></div>${planTxt?`<span class="pk" data-k="plan">${planTxt}</span>`:''}</div><div class="g"><div><small>Down</small><b class="num">${v.down}</b></div><div><small>Up</small><b class="num">${v.up}</b></div><div><small>Online</small><b class="num" data-k="online">${esc(v.uptime)}</b></div></div></div>
${warn}${B()}<div class="row">${U()}${X()}</div></div>`;
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${preview?'':'<meta http-equiv="refresh" content="60">'}<title>${brand}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Maven+Pro:wght@400..900&amp;display=swap">
<style>:root{--p:${cfg.primary};--a:${cfg.accent}}${CSS}${DESIGN_CSS[d]}${phone?'.w{padding-top:44px}html{scrollbar-width:none}html::-webkit-scrollbar{display:none}':''}</style></head>
<body class="${d}" data-dn="${v.downB}" data-up="${v.upB}"><span id="tl" hidden>${esc(v.left)}</span><span id="upt" hidden>${esc(v.uptime)}</span>${timer}${body}${live(esc(origin),preview,cfg.showPackage)}</body></html>`;
}
module.exports={DESIGNS,render,LOW};
