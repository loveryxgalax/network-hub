'use strict';
// Netops RADIUS: plans, subscribers and the login decision that FreeRADIUS asks for (rlm_rest), plus session
// accounting. FreeRADIUS does the PAP/CHAP/MS-CHAP maths; this module decides who may log in, at what speed
// and until when. Subscriber passwords are kept encrypted in the secrets table because CHAP/MS-CHAP need them.
const crypto=require('node:crypto'),net=require('node:net');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const packages=require('./packages.cjs'),speed=require('./speed.cjs');
const HOUR=3600000,DAY=24*HOUR,LOG=2000,STALE=15*60000;
const UNITS={minutes:60000,hours:HOUR,days:DAY,weeks:7*DAY,months:30*DAY};
const SERVICES=['pppoe','hotspot','both','static'];
const text=(value,label,max=120,required=true)=>{const v=String(value??'').trim();if(required&&!v)fail(label+' is required');if(v.length>max||/[\u0000-\u001f]/.test(v))fail('Invalid '+label);return v;};
const number=(value,label,min=0,max=1e7)=>{const n=Number(value);if(value===''||value==null||!Number.isFinite(n)||n<min||n>max)fail('Invalid '+label);return n;};
// PPPoE logins from ISPman often contain spaces ("Dante Muthengi"), so spaces are allowed inside a name.
const USERNAME=/^[A-Za-z0-9._-](?:[A-Za-z0-9._ '-]{0,62}[A-Za-z0-9._-])?$/;
function settings(store){return {deactivateAfterDays:0,installFeePppoe:false,installFeeAmount:0,installFeeStatic:false,installFeeStaticAmount:0,usageMarginPct:0,selfPackageChange:true,blockedMacs:[],freeMode:null,realm:'kade',macBinding:'off',autoLinkCpe:true,acsPublicUrl:'',liveApply:false,roaming:'any',expiredPppoe:'restrict',restrictList:'no-internet',interim:300,...(store.setting('radiusSettings')||{})};}
function plan(input,existing={}){
 const v={...existing,...input};
 const out={name:text(v.name,'plan name'),service:SERVICES.includes(v.service)?v.service:fail('Choose PPPoE, Hotspot or both'),downloadMbps:number(v.downloadMbps,'download speed',0.064,10000),uploadMbps:number(v.uploadMbps,'upload speed',0.064,10000),price:number(v.price,'price',0,1e7),durationValue:number(v.durationValue,'duration',1,1000),durationUnit:UNITS[v.durationUnit]?v.durationUnit:fail('Invalid duration unit'),devices:Math.round(number(v.devices??1,'devices',1,50)),active:v.active!==false&&v.active!=='false',description:text(v.description,'description',500,false)};
 return {...out,...packages.policy(v,out)};
}
const planMs=p=>p.durationValue*UNITS[p.durationUnit];
const mac=v=>{const m=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');if(!m)return '';if(m.length!==12)fail('A router MAC has 12 hex digits, like E0:37:66:9A:33:03');return m.match(/.{2}/g).join(':');};
function subscriber(store,input,existing={},usernames=null){
 const v={...existing,...input},username=text(v.username,'username',64).toLowerCase().replace(/\s+/g,' ');
 if(!USERNAME.test(username))fail('Usernames use 2–64 letters, numbers, spaces, dots, dashes or underscores');
 if(usernames?(usernames.has(username)&&usernames.get(username)!==existing.id):store.list('subscribers').some(s=>s.username===username&&s.id!==existing.id))fail('That username is already used',409);
 const planId=text(v.planId,'plan',80);if(!store.get('plans',planId))fail('Choose an existing plan');
 const staticIp=text(v.staticIp,'static IP',45,false);if(staticIp&&net.isIP(staticIp)!==4)fail('Static IP must be an IPv4 address');
 const expiresAt=v.expiresAt===''||v.expiresAt==null||v.expiresAt==='never'?null:number(typeof v.expiresAt==='string'&&!/^\d+$/.test(v.expiresAt)?Date.parse(v.expiresAt):v.expiresAt,'expiry date',0,8.64e15);
 // A new subscriber with no expiry starts expired: no free internet until it is renewed (paid).
 const expiry=expiresAt==null&&!existing.id&&!('expiresAt' in input&&input.expiresAt==='never')?Date.now():expiresAt;
 const out={name:text(v.name,'customer name'),username,phone:text(v.phone,'phone',30,false),email:text(v.email,'email',120,false),service:['pppoe','hotspot','static'].includes(v.service)?v.service:fail('Choose PPPoE, Hotspot or Static IP'),planId,status:['active','suspended'].includes(v.status)?v.status:'active',expiresAt:expiry,staticIp,address:text(v.address,'address',250,false),notes:text(v.notes,'notes',1000,false),lastSeen:existing.lastSeen||null,lastMac:existing.lastMac||'',points:existing.points||0,paidEver:existing.id?(existing.paidEver??null):(v.paidEver===true||(expiresAt!=null&&expiresAt>Date.now())),installFeeDue:installFee(store,v,existing),maxDevices:v.maxDevices===''?null:v.maxDevices==null?(existing.maxDevices??null):Math.round(number(v.maxDevices,'devices at once',1,50)),splitBandwidth:v.splitBandwidth===true||v.splitBandwidth==='on'||v.splitBandwidth==='true',macPolicy:macPolicyOf(v.macPolicy===undefined?existing.macPolicy:v.macPolicy),specialPrice:v.specialPrice===undefined?(existing.specialPrice??null):v.specialPrice===''||v.specialPrice===null?null:Math.round(number(v.specialPrice,'special price',0,1e6)*100)/100,boundMac:mac(v.boundMac),balance:input.balance!==undefined?Math.max(0,Math.round((Number(input.balance)||0)*100)/100):existing.balance||0};
 const coord=(k,lim)=>{const x=v[k];if(x===''||x==null)return null;const n=Number(x);if(!(Number.isFinite(n)&&Math.abs(n)<=lim))fail('Invalid '+(k==='latitude'?'latitude':'longitude'));return Math.round(n*1e6)/1e6;};
 const ref=String(v.referredBy??'').trim().toLowerCase();if(ref&&ref!==String(existing.referredBy||'')&&!store.list('subscribers').some(x=>x.username===ref&&x.id!==existing.id))fail('Referred by: no customer with that username');out.referredBy=ref;
 out.latitude=coord('latitude',90);out.longitude=coord('longitude',180);out.roaming=['any','assigned'].includes(v.roaming)?v.roaming:'';
 if(out.service==='static')Object.assign(out,require('./statics.cjs').validate(store,null,v,existing));else{const rid=String(v.routerId??existing.routerId??'');if(rid&&store.get('devices',rid)?.type!=='router')fail('Router not found');out.routerId=rid;}
 // Keep everything the form does not edit (family link, pool address, router status, wallet history markers…).
 const {id:_i,version:_v,created:_c,updated:_u,...kept}=existing;
 return {...kept,...out};
}
// Installation fee: blank uses the ISP default for the service, 0 waives it. Only new customers are charged.
function installFee(store,v,existing){if(existing.id)return existing.installFeeDue||0;const cfg=settings(store),d=v.service==='pppoe'&&cfg.installFeePppoe?cfg.installFeeAmount:v.service==='static'&&cfg.installFeeStatic?cfg.installFeeStaticAmount:0;if(v.installFee===''||v.installFee==null)return d;return Math.round(number(v.installFee,'installation fee',0,1e6));}
// One place decides what state an account is in. Never-paid accounts are kept apart from lapsed ones.
function stateOf(s,now=Date.now()){if(s.status!=='active')return 'suspended';if(s.expiresAt!=null&&s.expiresAt<=now)return s.paidEver===false?'unpaid':'expired';return 'active';}
function setPassword(store,id,password){const p=password==null||password===''?crypto.randomBytes(6).toString('base64url'):text(password,'password',64);if(p.length<4)fail('Use a password of at least 4 characters');store.secret('subscriber:'+id,{password:p});return p;}
const password=(store,id)=>store.secret('subscriber:'+id)?.password||null;
// Extend from the later of now and the current expiry, so early renewals are not lost.
function renew(store,id,periods=1,now=Date.now()){const s=store.get('subscribers',id);if(!s)fail('Subscriber not found',404);const p=store.get('plans',s.planId);if(!p)fail('Subscriber has no plan');const n=Math.round(number(periods,'periods',1,24));const saved=store.put('subscribers',{...s,status:'active',paidEver:true,deactivatedReason:'',expiresAt:Math.max(now,s.expiresAt||0)+n*planMs(p)},s);
 try{require('./livechange.cjs').renewed(store,saved,s,now);}catch{}
 return saved;}
// FreeRADIUS rlm_rest sends {"Attr":{"type":..,"value":[..]}}; plain {"Attr":"value"} is accepted for tests and tools.
function macPolicyOf(v){if(!v||typeof v!=='object'||!['prefix','list'].includes(v.mode))return null;
 if(v.mode==='prefix'){const pre=String(v.prefix||'').toUpperCase().replace(/-/g,':').trim();if(!/^([0-9A-F]{2}:){2,4}[0-9A-F]{2}$/.test(pre))fail('MAC prefix looks like AA:BB:CC');return {mode:'prefix',prefix:pre};}
 const list=[...new Set((Array.isArray(v.list)?v.list:String(v.list||'').split(/[\s,]+/)).filter(Boolean).map(x=>mac(x)))].slice(0,10);if(!list.length)fail('Add at least one MAC address');return {mode:'list',list};}
const attr=(req,name)=>{const a=req?.[name];if(a==null)return '';if(typeof a==='object'&&Array.isArray(a.value))return String(a.value[0]??'');return String(a);};
function serviceOf(req){const type=attr(req,'Service-Type').toLowerCase(),proto=attr(req,'Framed-Protocol').toLowerCase();return proto==='ppp'||type==='framed-user'||type==='2'?'pppoe':'hotspot';}
function stripRealm(store,raw){const name=raw.trim().toLowerCase(),realm=settings(store).realm;const at=name.lastIndexOf('@');if(at>0&&(!realm||name.slice(at+1)===realm))return name.slice(0,at);return name;}
// The router a request came from: NAS-Identifier is the router's identity (matches the device name), else its IP.
function routerOf(store,req){const ident=attr(req,'NAS-Identifier').toLowerCase(),ip=attr(req,'NAS-IP-Address');const r=store.list('devices').find(d=>d.type==='router'&&((ident&&d.name.toLowerCase()===ident)||(ip&&(d.ip===ip||d.tunnelIp===ip))));return r?.id||'';}
// Free mode: everyone on the chosen routers gets the chosen package until the end time; paid customers keep their own.
function freeMode(store,routerId,now=Date.now()){const f=settings(store).freeMode;if(!f||!f.enabled||now>=f.until)return null;if(f.routerIds?.length&&!f.routerIds.includes(routerId))return null;const p=store.get('plans',f.planId);return p?{...f,plan:p}:null;}
function log(store,entry){try{require('./hotspot.cjs').add(store,'auth',{...entry,username:String(entry.username||'').split('@')[0]});}catch{}const l=store.setting('radiusAuthLog')||{items:[]};l.items=[entry,...l.items].slice(0,LOG);store.setting('radiusAuthLog',l);}
const rate=p=>`${mbit(p.uploadMbps)}/${mbit(p.downloadMbps)}`;
function mbit(v){return v>=1?(Math.round(v*100)/100)+'M':Math.round(v*1000)+'k';}
function activeSessions(store,username,now){return store.sessionsOf(username,now-STALE).filter(s=>!s.stoppedAt&&now-s.updatedAt<STALE);}
// The login decision. Returns {status,attributes,reason}; status 200 accept (with Cleartext-Password for FreeRADIUS), 401 reject, 404 unknown.
function authorize(store,req,now=Date.now()){
 const raw=attr(req,'User-Name'),username=stripRealm(store,raw),service=serviceOf(req),nas=attr(req,'NAS-IP-Address')||attr(req,'NAS-Identifier'),mac_raw=attr(req,'Calling-Station-Id');
 const done=(status,reason,attributes={})=>{log(store,{time:now,username:raw.slice(0,80),service,nas,mac:mac_raw,result:status===200?'accept':'reject',reason});return {status,reason,attributes:status===200?attributes:{'reply:Reply-Message':reason}};};
 const routerId=routerOf(store,req),fm=freeMode(store,routerId,now);
 const freeReply=p=>({'control:Cleartext-Password':'free','reply:Mikrotik-Rate-Limit':packages.rateLimit(p),'reply:Session-Timeout':String(Math.max(60,Math.ceil((fm.until-now)/1000))),'reply:Acct-Interim-Interval':String(settings(store).interim)});
 if(/^free-[0-9a-f]{12}$/.test(username)){if(!fm)return done(401,'Free access is not on');return done(200,'Free mode',freeReply(fm.plan));}
 let s=store.subscriberByUsername(username)||undefined,share=null;
 // Sharing code: the friend's device logs in with the owner's code and counts as one of the owner's devices.
 if(!s&&service==='hotspot'&&/^s[a-z0-9]{7}$/.test(username)){const sc=require('./sharecode.cjs');if(sc.enabled(store)){const o=sc.owner(store,username);if(o){if(sc.devicesOf(store,o)<2)return done(401,'This package is for one device');share=o;s={...o,username,familyOf:o};}}}
 // Registered TV: signs in by its MAC address and counts as one of the owner's devices.
 if(!s&&service==='hotspot'&&/^[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/.test(username)){const tm=username.toUpperCase().replace(/-/g,':'),o=store.list('subscribers').find(x=>x.service==='hotspot'&&(x.tvs||[]).some(t=>t.mac===tm));if(o){share=o;s={...o,username,familyOf:o};}}
 if(!s&&service==='hotspot')s=require('./vouchers.cjs').redeem(store,username,now)||undefined;
 if(!s)return done(404,'Unknown username');
 if(s.service==='static')return done(401,'Static IP customers do not log in');
 // Family (child) accounts log in with their own password but use the parent's package, expiry and status.
 const parent=s.parentId?store.get('subscribers',s.parentId):null;if(s.parentId&&!parent)return done(401,'Parent account removed');
 const login=s;if(parent)s={...parent,username:s.username,id:s.id,familyOf:parent};
 const secret=share?username:password(store,login.id),p=store.get('plans',s.planId),cfg=settings(store);
 {let m='';try{m=mac(mac_raw);}catch{}if(m&&cfg.blockedMacs.some(b=>b.mac===m))return done(401,'Device blocked');}
 if(!secret)return done(401,'No password set');
 if(s.status!=='active')return done(401,'Account suspended');
 if(!p)return done(401,'Account has no plan');
 if(p.service!=='both'&&p.service!==service)return done(401,'Plan is not for '+(service==='pppoe'?'PPPoE':'Hotspot'));
 // MAC binding (handoff §20.9): the learned router MAC is always allowed; a customer policy can also allow a MAC
 // prefix (same vendor, e.g. a replacement router) or a list of MACs. A customer policy turns binding on for them
 // even when the ISP-wide setting is off.
 const mp=s.macPolicy&&['prefix','list'].includes(s.macPolicy.mode)?s.macPolicy:null;
 if(service==='pppoe'&&(cfg.macBinding==='enforce'||mp)){let seen='';try{seen=mac(mac_raw);}catch{}
  const extra=m=>!!mp&&(mp.mode==='prefix'?!!mp.prefix&&m.startsWith(mp.prefix):(mp.list||[]).includes(m));
  if(seen){if(s.boundMac&&s.boundMac!==seen&&!extra(seen))return done(401,'Router not recognised');if(!s.boundMac)store.put('subscribers',{...s,boundMac:seen},s);}}
 const head=share||parent||s,family=[head.username,...store.list('subscribers').filter(x=>x.parentId===head.id).map(x=>x.username),...(head.shareCode?[head.shareCode.toLowerCase()]:[]),...(head.tvs||[]).map(t=>t.mac.toLowerCase())];
 if(family.reduce((n,u)=>n+activeSessions(store,u,now).length,0)>=(head.maxDevices||p.devices)&&service==='hotspot')return done(401,'Device limit reached');
 // PPPoE maximum connections only when set on the customer (handoff §20.7); the package has no PPPoE default.
 if(service==='pppoe'&&s.maxDevices>0&&activeSessions(store,s.username,now).length>=s.maxDevices)return done(401,'Connection limit reached');
 if(p.routerIds?.length&&routerId&&!p.routerIds.includes(routerId))return done(401,'Package not available on this router');
 // Max concurrent sessions per package (0 = no limit), counted over every customer on that package.
 if(p.maxSessions>0){const onPlan=new Set(store.list('subscribers').filter(x=>x.planId===p.id).map(x=>x.username)),mine=new Set(family);let n=0;for(const x of store.sessionsSince(now-STALE))if(!x.stoppedAt&&now-x.updatedAt<STALE&&onPlan.has(x.username)&&!mine.has(x.username))n++;if(n>=p.maxSessions)return done(401,'Package is full right now, try again later');}
 // Roaming: "assigned" customers (or everyone, by ISP setting) only log in through the router on their account.
 if((s.roaming||cfg.roaming)==='assigned'&&(parent||s).routerId&&routerId&&routerId!==(parent||s).routerId)return done(401,'Not allowed on this router');
 // Not strict: a PPPoE customer's assigned router follows whichever router they connect through.
 if(service==='pppoe'&&!parent&&(s.roaming||cfg.roaming)!=='assigned'&&routerId&&s.routerId!==routerId&&store.get('devices',routerId)){const cur=store.get('subscribers',s.id);if(cur)s={...store.put('subscribers',{...cur,routerId},cur),familyOf:s.familyOf};}
 const fup=packages.fupState(store,s,p,planMs(p),now),eff=speed.resolve(store,{subscriber:s,plan:p,routerId,service,baseDown:fup.downMbps,baseUp:fup.upMbps},now);
 // Split bandwidth: the speed is shared by the customer's configured maximum connections (the divisor is that
 // maximum, not how many are connected now, so a joining session never changes the others' speed).
 const div=s.splitBandwidth===true&&(s.maxDevices||0)>1?s.maxDevices:1,sp=v=>v==null?v:Math.max(0.25,Math.round(v/div*100)/100);
 const reply={'control:Cleartext-Password':secret,'reply:Mikrotik-Rate-Limit':packages.rateLimit(p,{fupActive:fup.active,downMbps:sp(eff.downMbps),upMbps:sp(eff.upMbps)}),'reply:Acct-Interim-Interval':String(p.interimSeconds||cfg.interim)};
 if(p.idleTimeoutMinutes)reply['reply:Idle-Timeout']=String(p.idleTimeoutMinutes*60);
 if(s.staticIp)reply['reply:Framed-IP-Address']=s.staticIp;
 // Optional netops PPPoE pool: the customer's own fixed address (a full pool falls back to the router's pool).
 else if(service==='pppoe'){try{const ip=require('./pppoepool.cjs').assign(store,s);if(ip)reply['reply:Framed-IP-Address']=ip;}catch{}}
 const left=s.expiresAt==null?null:s.expiresAt-now;
 if(left!=null&&left<=0){
  if(fm)return done(200,'Expired: free mode',{...freeReply(fm.plan),'control:Cleartext-Password':secret});
  // Expired PPPoE customers stay connected but land in the restricted list, so the router's existing redirect shows the payment page.
  if(service==='pppoe'&&cfg.expiredPppoe==='restrict')return done(200,'Expired: restricted',{...reply,'reply:Mikrotik-Address-List':cfg.restrictList,'reply:Mikrotik-Rate-Limit':'512k/512k','reply:Session-Timeout':String(3600)});
  return done(401,'Account expired');
 }
 if(left!=null)reply['reply:Session-Timeout']=String(Math.max(60,Math.min(Math.ceil(left/1000),2147483647)));
 return done(200,(fup.active?'OK: fair-usage speed ('+fup.reasons.join(', ')+')':'OK')+(eff.changed?' · speed rule':''),reply);
}
const octets=(req,base)=>{const n=Number(attr(req,base))||0,g=Number(attr(req,base.replace('Octets','Gigawords')))||0;return g*4294967296+n;};
// Accounting Start/Interim-Update/Stop from the routers.
function accounting(store,req,now=Date.now()){
 const kind=attr(req,'Acct-Status-Type').toLowerCase(),sessionId=attr(req,'Acct-Session-Id'),nas=attr(req,'NAS-IP-Address')||attr(req,'NAS-Identifier');
 if(!sessionId)fail('Missing Acct-Session-Id');
 if(!['start','stop','interim-update','alive','1','2','3'].includes(kind))return {ok:true,ignored:true};
 const key=crypto.createHash('sha256').update(nas+'\0'+sessionId).digest('hex').slice(0,32),existing=store.get('radiusSessions',key);
 const username=stripRealm(store,attr(req,'User-Name')),stopped=kind==='stop'||kind==='2';
 // Interim and Stop packets may omit fields the Start carried; keep what we already know.
 const has=name=>attr(req,name)!=='';
 const body={nasName:attr(req,'NAS-Identifier').slice(0,60)||existing?.nasName||'',username:username||existing?.username||'',service:has('Service-Type')||has('Framed-Protocol')?serviceOf(req):existing?.service||serviceOf(req),nas,sessionId:sessionId.slice(0,80),ip:attr(req,'Framed-IP-Address')||existing?.ip||'',mac:attr(req,'Calling-Station-Id').slice(0,40)||existing?.mac||'',startedAt:existing?.startedAt||now-(Number(attr(req,'Acct-Session-Time'))||0)*1000,updatedAt:now,stoppedAt:stopped?now:null,cause:stopped?attr(req,'Acct-Terminate-Cause').slice(0,60):'',
  // Router "input" is what the customer uploaded.
  uploadBytes:octets(req,'Acct-Input-Octets'),downloadBytes:octets(req,'Acct-Output-Octets')};
 // Accounting policy: a margin for protocol overhead is added to what the router counted (never less); raw counts kept.
 {const pct=settings(store).usageMarginPct||0;if(pct>0){body.rawUploadBytes=body.uploadBytes;body.rawDownloadBytes=body.downloadBytes;body.uploadBytes=Math.round(body.uploadBytes*(1+pct/100));body.downloadBytes=Math.round(body.downloadBytes*(1+pct/100));}}
 if(existing){if(existing.stoppedAt&&!stopped)return {ok:true,ignored:true};store.db.prepare("UPDATE records SET body=?,version=version+1,updated=? WHERE kind='radiusSessions' AND id=?").run(JSON.stringify(body),now,key);}
 else store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(key,JSON.stringify(body),now,now);
 // Live view: customer connected / disconnected through netops RADIUS.
 if(body.username&&(!existing||(stopped&&!existing.stoppedAt))){try{const c=store.subscriberByUsername(body.username);require('./outbox.cjs').emit(store,stopped?'session.stop':'session.start',{username:body.username,name:c?.name||'',service:body.service,router:body.nasName||body.nas,cause:stopped?body.cause:''},{now});}catch{}}
 // A PPPoE customer's first login records which router/ONT they dialled from.
 if(!existing&&!stopped&&body.username&&body.service==='pppoe'){try{require('./cpelink.cjs').autoLink(store,body.username,body.mac,now);}catch{}}
 // Daily visit points: the first session start of the day earns the loyalty visit points.
 if(!existing&&body.username){const lo=require('./billing.cjs').loyalty(store);if(lo.enabled&&lo.visitPoints){const s=store.subscriberByUsername(body.username),day=new Date(now+3*36e5).toISOString().slice(0,10);if(s&&s.lastVisitDay!==day){store.put('subscribers',{...s,lastVisitDay:day},s);require('./billing.cjs').addPoints(store,s.id,lo.visitPoints,'Visit '+day,now);}}}
 // Roaming: a hotspot customer starting a session on a different router than their previous one.
 if(!existing&&body.service==='hotspot'&&body.username){const prev=store.sessionsOf(body.username,now-864e5).filter(x=>x.sessionId!==body.sessionId&&now-x.updatedAt<864e5).sort((a,b)=>b.updatedAt-a.updatedAt)[0],from=prev&&(prev.nasName||prev.nas),to=body.nasName||body.nas;
  if(prev&&from&&to&&from!==to){const rl=store.setting('roamingLog')||{items:[]};rl.items=[{time:now,username:body.username,mac:body.mac,from,to},...rl.items].slice(0,2000);store.setting('roamingLog',rl);}}
 const s=username?store.subscriberByUsername(username):null;if(s)store.put('subscribers',{...s,lastSeen:now,lastMac:body.mac||s.lastMac},s);
 const ae={time:now,status:stopped?'stop':existing?'interim':'start',username:body.username,service:body.service,nas,ip:body.ip,mac:body.mac,upload:body.uploadBytes,download:body.downloadBytes,seconds:Number(attr(req,'Acct-Session-Time'))||0,cause:body.cause};try{require('./hotspot.cjs').add(store,'acct',{...ae,nasName:body.nasName,sessionId:body.sessionId},now);}catch{}
 const al=store.setting('radiusAcctLog')||{items:[]};al.items=[{time:now,status:stopped?'stop':existing?'interim':'start',username:body.username,service:body.service,nas,ip:body.ip,mac:body.mac,upload:body.uploadBytes,download:body.downloadBytes,seconds:Number(attr(req,'Acct-Session-Time'))||0,cause:body.cause},...al.items].slice(0,2000);store.setting('radiusAcctLog',al);
 return {ok:true};
}
// Daily: PPPoE accounts expired longer than the grace period are deactivated (not deleted); paying reactivates them.
function autoDeactivate(store,now=Date.now()){const days=settings(store).deactivateAfterDays;if(!days)return [];const done=[];
 for(const s of store.list('subscribers'))if(s.service==='pppoe'&&s.status==='active'&&s.expiresAt!=null&&now-s.expiresAt>days*DAY){store.put('subscribers',{...s,status:'suspended',deactivatedReason:`Expired more than ${days} days`,deactivatedAt:now},s);done.push(s.id);}
 return done;}
function prune(store,now=Date.now()){store.db.prepare("DELETE FROM records WHERE kind='radiusSessions' AND updated<?").run(now-400*DAY);}
function overview(store,now=Date.now()){
 const plans=store.list('plans'),byPlan=new Map(plans.map(p=>[p.id,p]));
 const sessions=store.sessionsSince(now-STALE).filter(s=>!s.stoppedAt&&now-s.updatedAt<STALE).sort((a,b)=>b.updatedAt-a.updatedAt);
 const online=new Set(sessions.map(s=>s.username));
 // Router: the one on the account, else the one they last connected through. Device: what the WiFi page saw for their MAC.
 const routerNames=new Map(store.list('devices').map(d=>[d.id,d.name])),lastRouter=require('./compensation.cjs').routerOf(store),byMac=store.setting('deviceInfo')?.byMac||{},macKey=m=>String(m||'').toUpperCase().replace(/-/g,':');
 const subscribers=store.list('subscribers').map(s=>{const di=byMac[macKey(s.boundMac||s.lastMac)];return {...s,planName:byPlan.get(s.planId)?.name||'—',online:online.has(s.username),state:stateOf(s,now),hasPassword:!!store.secret('subscriber:'+s.id),routerName:routerNames.get(s.routerId)||routerNames.get(lastRouter.get(s.username))||'',deviceType:di?(di.device&&di.device!=='Unknown'?di.device:di.os||''):''};});
 const history=store.recentStopped(300).sort((a,b)=>b.stoppedAt-a.stoppedAt);
 return {plans,subscribers,sessions,history,acct:(store.setting('radiusAcctLog')?.items||[]).slice(0,500),log:(store.setting('radiusAuthLog')?.items||[]).slice(0,500),settings:settings(store),counts:{subscribers:subscribers.length,active:subscribers.filter(s=>s.state==='active').length,expired:subscribers.filter(s=>s.state==='expired').length,unpaid:subscribers.filter(s=>s.state==='unpaid').length,suspended:subscribers.filter(s=>s.state==='suspended').length,onlineExpired:subscribers.filter(s=>s.online&&(s.state==='expired'||s.state==='unpaid')).length,online:online.size,expiringSoon:subscribers.filter(s=>s.state==='active'&&s.expiresAt!=null&&s.expiresAt-now<3*DAY).length}};
}
function validFreeMode(store,f){if(f&&f.enabled!==true&&f.autoEvict!==undefined)return {enabled:false,autoEvict:f.autoEvict!==false};if(!f||f.enabled!==true)return null;const until=Number(f.until);if(!(until>Date.now()))fail('Free mode needs an end time in the future');if(!store.get('plans',String(f.planId||'')))fail('Choose the package free users get');
 return {enabled:true,until,planId:String(f.planId),routerIds:(Array.isArray(f.routerIds)?f.routerIds:[]).map(String),reason:String(f.reason||'').slice(0,120),startedAt:Date.now(),autoEvict:f.autoEvict!==false};}
function acsUrl(v){const t=String(v||'').trim();if(!t)return '';let u;try{u=new URL(t);}catch{fail('The ACS address must be a full https:// address');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)fail('Use an https:// ACS address without a password or query');return u.href.replace(/\/$/,'');}
function updateSettings(store,input){const cur=settings(store),realm=text(input.realm??cur.realm,'realm',40,false).toLowerCase();if(realm&&!/^[a-z0-9.-]+$/.test(realm))fail('Invalid realm');
 const dd=input.deactivateAfterDays===undefined?cur.deactivateAfterDays:Math.round(Number(input.deactivateAfterDays));if(!(dd===0||(dd>=7&&dd<=365)))fail('Deactivate after 7–365 days, or 0 for never');
 const fee=input.installFeeAmount===undefined?cur.installFeeAmount:Math.round(Number(input.installFeeAmount));if(!(fee>=0&&fee<=1e6))fail('Invalid installation fee');
 const sfee=input.installFeeStaticAmount===undefined?cur.installFeeStaticAmount:Math.round(Number(input.installFeeStaticAmount));if(!(sfee>=0&&sfee<=1e6))fail('Invalid static installation fee');
 const margin=input.usageMarginPct===undefined?cur.usageMarginPct:Number(input.usageMarginPct);if(!(margin>=0&&margin<=100))fail('Network packets margin is 0–100%');
 const blocked=input.blockedMacs===undefined?cur.blockedMacs:(Array.isArray(input.blockedMacs)?input.blockedMacs:[]).slice(0,2000).map(b=>{const m=mac(b.mac);if(!m)fail('Invalid MAC address: '+String(b.mac).slice(0,30));return {mac:m,reason:String(b.reason||'').trim().slice(0,120),by:String(b.by||'').slice(0,60),at:Number(b.at)||Date.now()};}).filter((b,i,a)=>a.findIndex(x=>x.mac===b.mac)===i);
 return store.setting('radiusSettings',{installFeeStatic:input.installFeeStatic===undefined?cur.installFeeStatic:input.installFeeStatic===true,installFeeStaticAmount:sfee,usageMarginPct:Math.round(margin*10)/10,selfPackageChange:input.selfPackageChange===undefined?cur.selfPackageChange:input.selfPackageChange===true,blockedMacs:blocked,deactivateAfterDays:dd,installFeePppoe:input.installFeePppoe===undefined?cur.installFeePppoe:input.installFeePppoe===true,installFeeAmount:fee,freeMode:input.freeMode===undefined?cur.freeMode:validFreeMode(store,input.freeMode),realm,liveApply:input.liveApply===undefined?cur.liveApply:input.liveApply===true,acsPublicUrl:input.acsPublicUrl===undefined?cur.acsPublicUrl||'':acsUrl(input.acsPublicUrl),autoLinkCpe:input.autoLinkCpe===undefined?cur.autoLinkCpe!==false:input.autoLinkCpe===true,macBinding:['off','enforce'].includes(input.macBinding)?input.macBinding:cur.macBinding,roaming:['any','assigned'].includes(input.roaming)?input.roaming:cur.roaming,expiredPppoe:['restrict','reject'].includes(input.expiredPppoe)?input.expiredPppoe:cur.expiredPppoe,restrictList:text(input.restrictList??cur.restrictList,'address list',60),interim:Math.round(number(input.interim??cur.interim,'interim interval',60,3600))});}
module.exports={freeMode,routerOf,stateOf,autoDeactivate,plan,subscriber,setPassword,password,renew,authorize,accounting,overview,prune,settings,updateSettings,planMs,UNITS};
// CSV import (e.g. an ISPman customer export). Columns by header name, any order:
// name, username, password, phone, plan, expires, service, static_ip, email. Plans match by name.
function parseCsv(textIn){const rows=[];let row=[],field='',quoted=false;const t=String(textIn).replace(/^﻿/,'');
 for(let i=0;i<t.length;i++){const c=t[i];if(quoted){if(c==='"'){if(t[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
  else if(c==='"')quoted=true;else if(c===','||c===';'||c==='\t'){row.push(field);field='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&t[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;}
 row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows;}
const ALIASES={name:['name','customer','customer name','full name','fullname'],username:['username','user','login','account','pppoe username'],password:['password','pass','secret'],phone:['phone','phone number','mobile','msisdn','contact'],plan:['plan','package','profile','plan name','package name'],expires:['expires','expiry','expiry date','expires at','expires_at','expiration','paid until','valid until'],service:['service','type','connection'],static_ip:['static_ip','static ip','ip','ip address'],email:['email','e-mail'],balance:['balance','credit','wallet balance','available balance'],status:['status','state','account status'],router_mac:['router_mac','router mac','mac','mac address']};
const planKey=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
function runImport(store,csv,commit,now){
 const rows=parseCsv(csv);if(rows.length<2)fail('The file needs a header row and at least one customer');if(rows.length>5001)fail('Import at most 5,000 customers at a time');
 const header=rows[0].map(h=>h.trim().toLowerCase()),col={};for(const [key,names]of Object.entries(ALIASES)){const i=header.findIndex(h=>names.includes(h));if(i>=0)col[key]=i;}
 if(col.username===undefined||col.plan===undefined)fail('The header must include username and plan (or package) columns');
 // Look everything up once: thousands of rows must not rescan the database for each one.
 const plans=new Map(store.list('plans').map(p=>[planKey(p.name),p])),existingByName=new Map(store.list('subscribers').map(s=>[s.username,s])),usernames=new Map([...existingByName].map(([k,v])=>[k,v.id])),seen=new Set(),results=[];
 for(const [n,r] of rows.slice(1).entries()){const get=k=>col[k]===undefined?'':String(r[col[k]]??'').trim(),line=n+2;
  try{const username=get('username').toLowerCase().replace(/@.*$/,'').replace(/\s+/g,' ').trim();if(seen.has(username))fail('Username appears twice in the file');seen.add(username);
   const plan=plans.get(planKey(get('plan')));if(!plan)fail('No plan named "'+get('plan')+'" (create it under Plans first)');
   const svc=get('service').toLowerCase(),service=/hot/.test(svc)?'hotspot':/ppp/.test(svc)||!svc?(plan.service==='hotspot'?'hotspot':'pppoe'):fail('Service must be PPPoE or Hotspot');
   const raw=get('expires');let expiresAt=null;if(raw){const t=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw+'T23:59:00+03:00':/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)?raw.replace(' ','T').slice(0,16)+':00+03:00':raw);if(!Number.isFinite(t))fail('Expiry "'+raw+'" is not a date (use YYYY-MM-DD)');expiresAt=t;}
   const existing=existingByName.get(username),password=get('password'),balance=get('balance'),statusRaw=get('status').toLowerCase();
   const input={paidEver:!!raw,name:get('name')||username,username,phone:get('phone'),email:get('email'),service,planId:plan.id,staticIp:get('static_ip'),expiresAt:expiresAt??(existing?existing.expiresAt:now),...(balance!==''?{balance:Number(balance)}:{}),...(statusRaw?{status:/deactiv|suspend|disabled|blocked/.test(statusRaw)?'suspended':'active'}:{})};
   if(balance!==''&&!(Number(balance)>=0))fail('Balance "'+balance+'" is not a number');
   const record=subscriber(store,input,existing||{},usernames);
   // PPPoE customers must keep their current password (the router and the customer both use it). Hotspot customers log in
   // through the portal after paying, so a missing password is generated.
   const generate=!existing&&!password&&service==='hotspot';if(!existing&&!password&&!generate)fail('New PPPoE customers need their current password');
   if(commit){let saved=store.put('subscribers',record,existing);const rm=get('router_mac').toUpperCase();if(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(rm))saved=store.put('subscribers',{...saved,lastMac:rm,boundMac:rm},saved);if(password)setPassword(store,saved.id,password);else if(generate)setPassword(store,saved.id,String(crypto.randomInt(0,1000000)).padStart(6,'0'));}
   results.push({line,username,name:record.name,plan:plan.name,expiresAt:record.expiresAt,action:existing?'update':'create',generated:generate});
  }catch(error){results.push({line,username:get('username'),error:error.message});}}
 const errors=results.filter(r=>r.error);
 return {committed:commit,total:results.length,create:results.filter(r=>r.action==='create').length,update:results.filter(r=>r.action==='update').length,generated:results.filter(r=>r.generated).length,errors:errors.length,rows:results.slice(0,1000)};
}
// All or nothing: a file with any error saves nothing.
function importCsv(store,csv,commit=false,now=Date.now()){const preview=runImport(store,csv,false,now);if(!commit||preview.errors)return preview;return store.transaction(()=>runImport(store,csv,true,now));}
module.exports.importCsv=importCsv;module.exports.parseCsv=parseCsv;
