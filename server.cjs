'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Store,hashPassword,checkPassword}=require('./lib/store.cjs');
const {fields,validate,applyPreset}=require('./lib/domain.cjs');
const connectors=require('./lib/connectors.cjs');
const permissions=require('./dist/permissions.js');
const acs=require('./lib/acs.cjs');
const gis=require('./lib/gis.cjs');
const routerAgent=require('./lib/router-agent.cjs');
const customers=require('./lib/customers.cjs');
const sites=require('./lib/sites.cjs');
const radius=require('./lib/radius.cjs');
const backupsLib=require('./lib/backups.cjs'),upgrades=require('./lib/upgrades.cjs'),summary=require('./lib/summary.cjs'),promoCodes=require('./lib/promos.cjs'),receipts=require('./lib/receipts.cjs'),revenue=require('./lib/revenue.cjs'),health=require('./lib/health.cjs'),oltDetect=require('./lib/oltdetect.cjs'),vouchers=require('./lib/vouchers.cjs'),campaigns=require('./lib/campaigns.cjs'),reports=require('./lib/reports.cjs');
const billing=require('./lib/billing.cjs');
const mpesa=require('./lib/mpesa.cjs');
const portal=require('./lib/portal.cjs');
const c2b=require('./lib/c2b.cjs');
const landing=require('./lib/landing.cjs'),statusPage=require('./lib/status.cjs');
const overview=require('./lib/overview.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const error=(status,message)=>Object.assign(new Error(message),{status});
const publicUser=u=>({id:u.id,email:u.email,name:u.name,role:u.role,active:!!u.active});
const mutating=new Set(['POST','PATCH','PUT','DELETE']);
function createApp(options={}){
 const store=new Store(options.dataDir||process.env.NETWORK_DATA_DIR||path.join(__dirname,'data'));
 for(const operation of store.list('acsTasks').filter(t=>t.status==='Sending'))store.put('acsTasks',{...operation,status:'Uncertain',error:'The server restarted before the ACS receipt was saved. Check the ACS and device before reconciling.'},operation);
 const publicOrigin=options.publicOrigin??process.env.NETWORK_PUBLIC_ORIGIN;
 const publicUrl=publicOrigin?new URL(publicOrigin):null;
 if(publicUrl&&(publicUrl.protocol!=='https:'||publicUrl.username||publicUrl.password||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash))throw new Error('NETWORK_PUBLIC_ORIGIN must be an HTTPS origin');
 const root=path.join(__dirname,'dist'),busy=new Set(),attempts=new Map(),agentAccepted=new Map(),customerUploads=new Map(),overviewCache=new Map();let timer,closing=false,collecting=false,lastPrune=0,lastReminders=0;
 const pollMs=Number(options.pollMs||process.env.NETWORK_POLL_MS||30000);if(!Number.isFinite(pollMs)||pollMs<1000)throw new Error('Polling interval must be at least 1000ms');
 const users=()=>store.db.prepare('SELECT * FROM users ORDER BY created').all();
 const text=(value,label,max=250)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw error(400,'Invalid '+label);return value.trim();};
 const password=value=>{if(typeof value!=='string'||value.length<12||value.length>256)throw error(400,'Use a password of 12–256 characters');return value;};
 const email=value=>{const e=text(value,'email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))throw error(400,'Enter a valid email');return e;};
 const role=(user,allowed)=>{if(!allowed.includes(user.role))throw error(403,'Your role cannot perform this action');};
 function session(res,user,secure){const token=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url');store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),user.id,csrf,Date.now()+12*3600000);res.setHeader('Set-Cookie',`network_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`);return {user:publicUser(user),csrf,workspace:store.setting('workspace')};}
 function auth(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('network_session='))?.slice('network_session='.length);if(!token)return null;return store.db.prepare('SELECT u.*,s.csrf,s.token FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1').get(hash(token),Date.now());}
 async function body(req,maximum=65536){let length=0,chunks=[];for await(const chunk of req){length+=chunk.length;if(length>maximum)throw error(413,'Request is too large');chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw error(400,'Invalid JSON');}}
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 function readDevice(d){const configured=!!store.db.prepare('SELECT device_id FROM secrets WHERE device_id=?').get(d.driver==='routeros-script'?'agent:'+d.id:d.id),stale=!d.lastCheck||Date.now()-d.lastCheck>Math.max(pollMs*3,60000);return {...d,connectionConfigured:configured,status:d.driver==='routeros-script'?(!configured?'unconfigured':!d.lastSeen?'pending':Date.now()-d.lastSeen>90000?'offline':'online'):d.type==='onu'&&d.parentId?(stale?'stale':d.status||'unknown'):d.driver==='none'?'unconfigured':!d.lastCheck?'pending':stale?'stale':d.status||'unknown'};}
 function dashboard(){const devices=store.list('devices').map(readDevice),counts=type=>({total:devices.filter(d=>d.type===type).length,online:devices.filter(d=>d.type===type&&d.status==='online').length});return {sampledAt:Date.now(),availability:store.availability(),workspace:store.setting('workspace'),devices,cards:{routers:counts('router'),olts:counts('olt'),onus:counts('onu')},alerts:store.list('alerts').filter(a=>a.status!=='Resolved'),jobs:store.list('jobs'),audit:store.db.prepare('SELECT a.*,COALESCE(u.name,\'Collector\') user FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 20').all(),balance:store.db.prepare('SELECT COALESCE(sum(amount),0) amount FROM ledger').get().amount/100};}
 function recordSnapshot(device,snapshot){const current=store.get('devices',device.id);if(!current||current.driver!==device.driver||current.endpoint!==device.endpoint)return {online:false};
   const previous=store.history(device.id,Date.now()-600000).at(-1);let traffic=null;
   if(snapshot.interfaces&&previous?.interfaces&&snapshot.source===previous.source){const elapsed=(Date.now()-previous.time)/1000;let rx=0,tx=0,n=0;for(const nic of snapshot.interfaces){const old=previous.interfaces.find(i=>i.name===nic.name);if(old&&nic.rx!==null&&nic.tx!==null&&old.rx!==null&&old.tx!==null&&nic.rx>=old.rx&&nic.tx>=old.tx){rx+=nic.rx-old.rx;tx+=nic.tx-old.tx;n++;}}if(n&&elapsed>0)traffic={rxMbps:rx*8/elapsed/1e6,txMbps:tx*8/elapsed/1e6};}
   const metrics={...snapshot,traffic};delete metrics.onus;delete metrics.unconfigured;
   store.transaction(()=>{
    store.measure(device.id,true,metrics);store.put('devices',{...current,status:'online',lastCheck:Date.now(),lastSeen:Date.now(),lastError:'',metrics},current);
    const alert=store.list('alerts').find(a=>a.deviceId===device.id&&a.source==='collector'&&a.status!=='Resolved');if(alert)store.put('alerts',{...alert,status:'Resolved'},alert);
    if(['olt-gateway','snmp'].includes(device.driver)&&Array.isArray(snapshot.onus))for(const onu of snapshot.onus){if(!onu.serial||typeof onu.online!=='boolean')continue;const existing=store.list('devices').find(d=>d.type==='onu'&&d.parentId===device.id&&d.serial===onu.serial),metric={power:Number.isFinite(onu.power)?onu.power:null,oltPower:Number.isFinite(onu.oltPower)?onu.oltPower:null};let inventory={...(existing||{}),name:existing?.name||String(onu.name||onu.serial),type:'onu',parentId:device.id,serial:String(onu.serial),pon:String(onu.pon||''),driver:'none'};const preset=!existing&&store.get('presets',store.setting('defaultPresetId'));if(preset)inventory=applyPreset(store,inventory,preset,{auto:true});const valid=validate('devices',inventory,existing,store);const saved=store.put('devices',{...valid,status:onu.online?'online':'offline',lastCheck:Date.now(),lastSeen:onu.online?Date.now():existing?.lastSeen||null,metrics:metric},existing);store.measure(saved.id,onu.online,metric);}
    if(device.driver==='olt-gateway')store.setting('discovery:'+device.id,Array.isArray(snapshot.unconfigured)?snapshot.unconfigured.map(o=>({serial:String(o.serial||''),pon:String(o.pon||''),name:String(o.name||o.serial||'')})).filter(o=>o.serial):[]);
   });return {online:true,snapshot:metrics};
 }
 async function poll(device){
  if(device.driver==='routeros-script')throw error(409,'This router reports every 30 seconds. Wait for its next check-in; direct polling is unavailable.');
  if(busy.has(device.id))throw error(409,'A check is already running');if(device.driver==='none')throw error(409,'Configure a device connector first');busy.add(device.id);
  try{
   const snapshot=await connectors.snapshot(device,store.secret(device.id)),current=store.get('devices',device.id);if(!current)return {online:false};
   return recordSnapshot(device,snapshot);
  }catch(cause){const current=store.get('devices',device.id);if(current)store.transaction(()=>{store.measure(device.id,false,{});store.put('devices',{...current,status:'offline',lastCheck:Date.now(),lastError:cause.message},current);if(!store.list('alerts').some(a=>a.deviceId===device.id&&a.source==='collector'&&a.status!=='Resolved'))store.put('alerts',{title:device.name+' is unreachable',details:cause.message,deviceId:device.id,severity:'critical',status:'Open',source:'collector'});});return {online:false,error:cause.message};}finally{busy.delete(device.id);}
 }
 async function collect(){if(collecting)return;collecting=true;try{if(Date.now()-lastPrune>3600000){store.prune();radius.prune(store);lastPrune=Date.now();}if(Date.now()-lastReminders>60000){lastReminders=Date.now();billing.runReminders(store).catch(()=>{});summary.run(store).catch(()=>{});}for(const d of store.list('devices').filter(d=>d.driver!=='none'&&d.type!=='onu')){if(closing)break;if(d.driver==='routeros-script'){if(d.lastSeen&&Date.now()-d.lastSeen>90000&&store.secret('agent:'+d.id))store.transaction(()=>{store.measure(d.id,false,{source:'routeros-script'});const latest=store.get('devices',d.id);if(latest.status!=='offline')store.put('devices',{...latest,status:'offline',lastError:'No authenticated script check-in for 90 seconds'},latest);if(!store.list('alerts').some(a=>a.deviceId===d.id&&a.source==='collector'&&a.status!=='Resolved'))store.put('alerts',{title:d.name+' stopped checking in',deviceId:d.id,source:'collector',severity:'critical',status:'Open',details:'No authenticated script check-in for 90 seconds'});});continue;}if(!busy.has(d.id))await poll(d);}}finally{collecting=false;}}
 async function api(req,res,url){
  const route=url.pathname,method=req.method,isPublic=!!publicUrl&&req.headers.host===publicUrl.host,secure=isPublic||!!req.socket.encrypted||process.env.NETWORK_SECURE_COOKIE==='1';
  if(publicUrl&&!isPublic&&!['127.0.0.1','localhost','[::1]'].includes(new URL('http://'+req.headers.host).hostname))throw error(403,'Unrecognized dashboard hostname');
  if(mutating.has(method)){const origin=req.headers.origin;if(origin&&origin!==`http${secure?'s':''}://${req.headers.host}`)throw error(403,'Cross-origin requests are not allowed');if(!String(req.headers['content-type']||'').startsWith('application/json'))throw error(415,'Send application/json');}
  const checkIn=route.match(/^\/api\/router-agent\/check-in\/([a-f0-9-]{36})$/);
  const customerCheckIn=route.match(/^\/api\/customer-agent\/check-in\/([a-f0-9-]{36})$/);
  if(customerCheckIn&&method==='POST'){
   const device=store.get('devices',customerCheckIn[1]),token=String(req.headers.authorization||'').replace(/^Bearer /,''),credentialId='discovery:'+customerCheckIn[1];
   if(!device||device.type!=='router'||!routerAgent.validToken(token,store.secret(credentialId)))throw error(401,'Customer discovery enrollment denied');
   if(Date.now()-(agentAccepted.get(credentialId)||0)<30000)throw error(429,'Wait at least thirty seconds between discovery reports');
   const report=await body(req,1048576);if(!routerAgent.validToken(token,store.secret(credentialId)))throw error(401,'Customer discovery enrollment denied');
   let accepted;try{accepted=customers.receive(store,device,report,customerUploads);}catch(cause){if(cause.status===400){store.setting('customerDiscoveryError:'+device.id,{time:Date.now(),message:cause.message});console.warn('Customer discovery report rejected for '+device.name+': '+cause.message);}throw cause;}
   if(accepted.completed){agentAccepted.set(credentialId,Date.now());store.setting('customerDiscoveryError:'+device.id,null);}return json(res,200,accepted);
  }
  // Upgrade path: a router that already has discovery installed fetches the current script with its own token (no new token issued).
  const scriptRoute=route.match(/^\/api\/customer-agent\/script\/([a-f0-9-]{36})$/);
  if(scriptRoute&&method==='GET'){
   const device=store.get('devices',scriptRoute[1]),token=String(req.headers.authorization||'').replace(/^Bearer /,'');
   if(!publicUrl||!device||device.type!=='router'||!routerAgent.validToken(token,store.secret('discovery:'+device.id)))throw error(401,'Customer discovery enrollment denied');
   limit(req,'agent-script',20,600000,device.id);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});return res.end(customers.generate(publicUrl.origin,device.id,token));
  }
  if(route==='/api/customer-agent/upgrade.rsc'&&method==='GET'){
   if(!publicUrl)throw error(409,'Configure the HTTPS public origin first');
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="netops-upgrade.rsc"'});return res.end(customers.upgradeScript(publicUrl.origin));
  }
  if(checkIn&&method==='POST'){
   const device=store.get('devices',checkIn[1]),token=String(req.headers.authorization||'').replace(/^Bearer /,'');
   if(!device||device.driver!=='routeros-script'||!routerAgent.validToken(token,store.secret('agent:'+device.id)))throw error(401,'Router enrollment denied');
   if(Date.now()-(agentAccepted.get(device.id)||0)<5000)throw error(429,'Wait at least five seconds between check-ins');
   const snapshot=routerAgent.normalize(await body(req));if(!routerAgent.validToken(token,store.secret('agent:'+device.id)))throw error(401,'Router enrollment denied');
   const accepted=recordSnapshot(device,snapshot);if(!accepted.online)throw error(409,'The router connection changed. Install its current script');agentAccepted.set(device.id,Date.now());return json(res,200,{ok:true,nextCheckInSeconds:30});
  }
  if(route==='/api/session'&&method==='GET'){const user=auth(req);return json(res,200,user?{user:publicUser(user),csrf:user.csrf,workspace:store.setting('workspace')}:{user:null,setup:!users().length,publicOrigin:publicUrl?.origin||null});}
  if(route==='/api/setup'&&method==='POST'){
   if(isPublic)throw error(403,'Create the owner account locally at http://127.0.0.1:4317 before enabling public access');
   if(users().length)throw error(409,'Setup has already been completed');const input=await body(req);const user={id:crypto.randomUUID(),email:email(input.email),name:text(input.name,'name'),role:'admin',password:hashPassword(password(input.password)),created:Date.now()};
   store.transaction(()=>{if(users().length)throw error(409,'Setup has already been completed');store.db.prepare('INSERT INTO users(id,email,name,role,password,created) VALUES(?,?,?,?,?,?)').run(user.id,user.email,user.name,user.role,user.password,user.created);store.setting('workspace',{name:text(input.workspace,'workspace'),currency:'KES',timezone:'Africa/Nairobi'});store.audit(user,'Created workspace',user.id);});return json(res,201,session(res,user,secure));
  }
  if(route==='/api/login'&&method==='POST'){
   const key=req.socket.remoteAddress,a=attempts.get(key);if(a&&a.until>Date.now()&&a.n>=8)throw error(429,'Too many attempts. Try again in 15 minutes.');const input=await body(req),user=typeof input.email==='string'?store.db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(input.email.toLowerCase().trim()):null;
   const valid=checkPassword(typeof input.password==='string'?input.password.slice(0,257):'',user?.password||hashPassword('constant-dummy-password'));if(!user||!valid){attempts.set(key,{n:a&&a.until>Date.now()?a.n+1:1,until:Date.now()+900000});throw error(401,'Email or password is incorrect');}attempts.delete(key);return json(res,200,session(res,user,secure));
  }
  const user=auth(req);if(!user)throw error(401,'Sign in to continue');if(mutating.has(method)&&req.headers['x-csrf-token']!==user.csrf)throw error(403,'Session verification failed. Reload the page.');
  if(route==='/api/customers'&&method==='GET'){if(user.role==='installer')throw error(403,'Customer discovery is not available to field installers');return json(res,200,customers.list(store,url.searchParams));}
  if(route==='/api/pppoe'&&method==='GET'){if(user.role==='installer')throw error(403,'PPPoE monitoring is not available to field installers');return json(res,200,customers.pppoe(store,url.searchParams));}
  if(route==='/api/overview'&&method==='GET'){if(user.role==='installer')throw error(403,'The overview is not available to field installers');const range=url.searchParams.get('range')||'24h',key=range+(user.role==='admin'?'a':'n'),hit=overviewCache.get(key);if(hit&&Date.now()-hit.at<15000)return json(res,200,hit.value);const value=overview.build(store,range);if(user.role!=='admin')value.revenue={today:null,week:null,month:null,days:[],byMethod:{},recent:[]};overviewCache.set(key,{at:Date.now(),value});return json(res,200,value);}
  if(route==='/api/sites'&&method==='GET'){if(user.role==='installer')throw error(403,'Sites & traffic is not available to field installers');return json(res,200,{...sites.report(store,url.searchParams),setup:sites.SETUP});}
  if(route==='/api/portal/status'){if(method==='GET')return json(res,200,{config:statusPage.get(store),designs:statusPage.DESIGNS});role(user,['admin']);if(method==='PUT'){const saved=statusPage.save(store,await body(req));store.audit(user,'Updated hotspot status page','portal');return json(res,200,saved);}}
  if(route==='/api/portal/status.html'&&method==='GET'){role(user,['admin','operator','manager','network-technician']);const q=url.searchParams,preview=q.get('preview')==='1';let cfg=statusPage.get(store);if(preview){try{cfg=statusPage.validate({...cfg,...JSON.parse(q.get('cfg')||'{}')});}catch{}}
   const head={'Content-Type':'text/html; charset=utf-8'};if(!preview)head['Content-Disposition']='attachment; filename="status.html"';res.writeHead(200,head);return res.end(statusPage.page(cfg,publicUrl?.origin||'https://netops.kadenetworks.com',preview,q.get('frame')==='phone'));}
  if(route==='/api/portal/landing'){
   if(method==='GET')return json(res,200,{config:landing.get(store),themes:landing.THEMES});
   role(user,['admin']);if(method==='PUT'){const saved=landing.save(store,await body(req));store.audit(user,'Updated landing page design',saved.theme);return json(res,200,saved);}
  }
  if(route==='/api/mpesa'){
   if(user.role==='installer')throw error(403,'Billing is not available to field installers');
   if(method==='GET')return json(res,200,{config:mpesa.publicConfig(store),c2b:mpesa.config(store)?c2b.overview(store,publicUrl?.origin||'http://'+req.headers.host):null,portal:portal.settings(store),portalUrl:(publicUrl?.origin||'http://'+req.headers.host)+'/portal/',payments:store.list('portalPayments').slice(0,300).map(({tokenHash,checkoutRequestId,...p})=>p)});
   role(user,['admin']);if(method==='PUT'&&url.searchParams.get('section')==='portal'){const saved=portal.updateSettings(store,await body(req));store.audit(user,'Updated portal settings','portal');return json(res,200,saved);}
   if(method==='PUT'){const saved=mpesa.setConfig(store,await body(req));store.audit(user,'Updated M-Pesa settings','mpesa');return json(res,200,saved);}
  }
  if(route==='/api/mpesa/c2b/register'&&method==='POST'){role(user,['admin']);const r=await c2b.register(store,publicUrl?.origin||'http://'+req.headers.host);store.audit(user,'Registered paybill URLs',r.ok?'ok':'failed');return json(res,200,r);}
  const assignRoute=route.match(/^\/api\/mpesa\/c2b\/([a-f0-9-]{36})\/assign$/);
  if(assignRoute&&method==='POST'){role(user,['admin','manager']);const r=c2b.assign(store,assignRoute[1],(await body(req)).subscriberId);store.audit(user,'Assigned paybill payment',assignRoute[1]);return json(res,200,r);}
  const recheckRoute=route.match(/^\/api\/mpesa\/payments\/([a-f0-9]{32})\/recheck$/);
  if(recheckRoute&&method==='POST'){role(user,['admin']);const r=await portal.recheck(store,recheckRoute[1]);store.audit(user,'Rechecked portal payment',recheckRoute[1]);return json(res,200,r);}
  if(route==='/api/portal/hotspot-login.html'&&method==='GET'){role(user,['admin','operator','manager','network-technician']);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="login.html"'});return res.end(portal.hotspotLoginPage(publicUrl?.origin||'https://netops.kadenetworks.com'));}
  if(route.startsWith('/api/billing/')||route==='/api/billing'){
   if(user.role==='installer')throw error(403,'Billing is not available to field installers');
   if(route==='/api/billing'&&method==='GET')return json(res,200,billing.overview(store));
   role(user,['admin']);
   if(route==='/api/billing/settings'&&method==='PUT'){const saved=billing.updateSettings(store,await body(req));store.audit(user,'Updated SMS reminders','billing');return json(res,200,saved);}
   if(route==='/api/billing/sms'&&method==='PUT'){const saved=billing.setSmsConfig(store,await body(req));store.audit(user,'Updated SMS provider','billing');return json(res,200,saved);}
   if(route==='/api/billing/sms/send'&&method==='POST'){role(user,['admin','manager','operator']);const input=await body(req),sub=store.get('subscribers',String(input.subscriberId||''));if(!sub)throw error(404,'Subscriber not found');const text=String(input.message||'').trim();if(!text||text.length>459)throw error(400,'The message must be 1–459 characters');if(!billing.phone(sub.phone))throw error(400,'This customer has no valid phone number');const r=await billing.sendSms(store,sub.phone,billing.fill(text,billing.values(store,sub)),'manual');store.audit(user,'Sent SMS to customer',sub.id);return json(res,200,r);}
   if(route==='/api/billing/sms/test'&&method==='POST'){const input=await body(req);const result=await billing.sendSms(store,input.to,String(input.message||'Test message from Kade Networks netops.').slice(0,459),'test');store.audit(user,'Sent test SMS','billing');return json(res,200,result);}
   throw error(404,'API endpoint not found');
  }
  const receiptRoute=route.match(/^\/api\/receipt\/([a-f0-9-]{36})$/);
  if(receiptRoute&&method==='GET'){if(user.role==='installer')throw error(403,'Not available to field installers');const sub=store.get('subscribers',receiptRoute[1]);if(!sub)throw error(404,'Subscriber not found');const inf=portal.info(store),cfg=landing.get(store);
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(receipts.build(store,sub,{kind:url.searchParams.get('kind')==='invoice'?'invoice':'receipt',ref:String(url.searchParams.get('ref')||'').slice(0,40),cfg:{phone:cfg.phone||inf.support,email:cfg.email}}));}
  if(route==='/api/promos'&&method==='GET'){role(user,['admin','manager']);return json(res,200,{items:promoCodes.list(store)});}
  if(route==='/api/promos'&&method==='POST'){role(user,['admin','manager']);const v=promoCodes.validate(await body(req));if(promoCodes.find(store,v.code))throw error(409,'That code already exists');const saved=store.put('promoCodes',v);store.audit(user,'Created promo code '+v.code,saved.id);return json(res,201,saved);}
  const promoRoute=route.match(/^\/api\/promos\/([a-f0-9-]{36})$/);
  if(promoRoute){role(user,['admin','manager']);const ex=store.get('promoCodes',promoRoute[1]);if(!ex)throw error(404,'Promo code not found');
   if(method==='PATCH'){const saved=store.put('promoCodes',promoCodes.validate(await body(req),ex),ex);store.audit(user,'Updated promo code '+ex.code,ex.id);return json(res,200,saved);}
   if(method==='DELETE'){store.remove('promoCodes',ex.id);store.audit(user,'Deleted promo code '+ex.code,ex.id);return json(res,200,{ok:true});}}
  if(route==='/api/loyalty'&&method==='GET'){role(user,['admin','manager']);return json(res,200,billing.loyalty(store));}
  if(route==='/api/loyalty'&&method==='PUT'){role(user,['admin']);const saved=billing.setLoyalty(store,await body(req));store.audit(user,'Updated loyalty points','billing');return json(res,200,saved);}
  if(route==='/api/summary'&&method==='GET'){role(user,['admin','manager']);return json(res,200,{settings:summary.settings(store),preview:summary.build(store)});}
  if(route==='/api/summary'&&method==='PUT'){role(user,['admin']);const saved=summary.update(store,await body(req));store.audit(user,'Updated daily summary','billing');return json(res,200,{settings:saved,preview:summary.build(store)});}
  if(route==='/api/summary/send'&&method==='POST'){role(user,['admin']);const s=summary.settings(store);if(!s.phone)throw error(400,'Save a phone number first');const r=await billing.sendSms(store,s.phone,summary.build(store),'summary');return json(res,200,r);}
  if(route==='/api/backups'&&method==='GET'){role(user,['admin','manager','network-technician','operator']);return json(res,200,{routers:backupsLib.overview(store)});}
  const backupRoute=route.match(/^\/api\/backups\/([a-f0-9-]{36})\/([a-f0-9]{12})(?:\/(download))?$/);
  if(backupRoute&&method==='GET'){role(user,['admin','manager','network-technician']);const b=backupsLib.get(store,backupRoute[1],backupRoute[2]);if(!b)throw error(404,'Backup not found');
   if(backupRoute[3]){const r=store.get('devices',backupRoute[1]);store.audit(user,'Downloaded router backup',backupRoute[1]);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${String(r?.name||'router').replace(/[^\w.-]+/g,'-')}-${new Date(b.time).toISOString().slice(0,10)}.rsc"`});return res.end(b.text);}
   return json(res,200,{id:b.id,time:b.time,size:b.size,diff:b.diff,text:b.text});}
  if(route==='/api/upgrades'&&method==='GET'){role(user,['admin','manager','network-technician','operator']);return json(res,200,await upgrades.overview(store,url.searchParams.get('channel')||'stable'));}
  if(route==='/api/audit'&&method==='GET'){role(user,['admin']);const q=String(url.searchParams.get('q')||'').toLowerCase().slice(0,80),names=new Map(users().map(u=>[u.id,u.name])),rows=store.db.prepare('SELECT id,time,user_id,action,target FROM audit ORDER BY id DESC LIMIT 1500').all().map(r=>({id:r.id,time:r.time,user:names.get(r.user_id)||(r.user_id==='collector'?'System':'Unknown user'),action:r.action,target:r.target})).filter(r=>!q||(r.user+' '+r.action+' '+r.target).toLowerCase().includes(q)).slice(0,500);return json(res,200,{items:rows});}
  if(route==='/api/overdue'&&method==='GET'){if(user.role==='installer')throw error(403,'Not available to field installers');return json(res,200,revenue.overdue(store));}
  if(route==='/api/portal-payments'&&method==='GET'){if(user.role==='installer')throw error(403,'Not available to field installers');return json(res,200,revenue.payments(store));}
  const profileRoute=route.match(/^\/api\/customers\/([a-f0-9-]{36})\/profile$/);
  if(profileRoute&&method==='GET'){if(user.role==='installer')throw error(403,'Not available to field installers');return json(res,200,revenue.profile(store,profileRoute[1]));}
  if(route==='/api/health'&&method==='GET'){if(user.role==='installer')throw error(403,'Not available to field installers');return json(res,200,health.overview(store));}
  if(route==='/api/neighbour-map'&&method==='GET'){if(user.role==='installer')throw error(403,'Not available to field installers');return json(res,200,oltDetect.map(store));}
  if(route==='/api/olts/detect'&&method==='GET'){if(user.role==='installer')throw error(403,'Not available to field installers');return json(res,200,oltDetect.detect(store));}
  if(route==='/api/reports'&&method==='GET'){if(user.role==='installer')throw error(403,'Reports are not available to field installers');return json(res,200,reports.build(store,{period:url.searchParams.get('period')||'month',from:url.searchParams.get('from'),to:url.searchParams.get('to')}));}
  if(route==='/api/nav-counts'&&method==='GET'){const o=user.role==='installer'?null:radius.overview(store);return json(res,200,o?{customers:o.counts.subscribers,hotspot:o.subscribers.filter(x=>x.service==='hotspot').length,pppoe:o.subscribers.filter(x=>x.service==='pppoe').length,inactive:o.counts.expired,online:o.counts.online,onlineHotspot:o.sessions.filter(x=>x.service==='hotspot').length,onlinePppoe:o.sessions.filter(x=>x.service==='pppoe').length,requests:store.list('portalPayments').filter(x=>x.status==='failed'||(x.status==='pending'&&Date.now()-x.createdAt>180000)).length,overdue:o.subscribers.filter(x=>x.state==='expired').length}:{});}
  if(route.startsWith('/api/radius')){
   if(user.role==='installer')throw error(403,'Subscribers are not available to field installers');
   const write=()=>role(user,['admin','operator','manager']);
   if(route==='/api/radius'&&method==='GET')return json(res,200,radius.overview(store));
   if(route==='/api/radius/manual-connect'&&method==='POST'){write();const input=await body(req);const plan=store.get('plans',String(input.planId||''));if(!plan||plan.service==='pppoe')throw error(400,'Choose a hotspot plan');
    const code=require('./lib/vouchers.cjs').generate(store,{planId:plan.id,count:1,length:6,name:'Manual connects',manual:true},user).codes[0],sub=require('./lib/vouchers.cjs').redeem(store,code);
    store.put('subscribers',{...sub,name:String(input.name||'').trim().slice(0,80)||sub.name,phone:String(input.phone||'').trim().slice(0,20)},sub);store.audit(user,'Manual connect '+code,sub.id);
    let sms=null;if(input.sms===true&&billing.phone(input.phone))sms=await billing.sendSms(store,input.phone,'Your Kade Networks '+plan.name+' code: '+code+'. Enter it on the WiFi page.','manual');
    return json(res,201,{code,plan:plan.name,expiresAt:sub.expiresAt,sms});}
   if(route==='/api/radius/vouchers'&&method==='GET'){return json(res,200,{batches:vouchers.batches(store)});}
   if(route==='/api/radius/vouchers'&&method==='POST'){role(user,['admin','manager']);const out=vouchers.generate(store,await body(req),user);store.audit(user,'Generated '+out.codes.length+' vouchers',out.batch.id);return json(res,201,out);}
   const vRoute=route.match(/^\/api\/radius\/vouchers\/([a-f0-9-]{36})$/);
   if(vRoute){if(method==='GET')return json(res,200,{codes:vouchers.codes(store,vRoute[1])});if(method==='DELETE'){role(user,['admin','manager']);const out=vouchers.removeBatch(store,vRoute[1]);store.audit(user,'Deleted voucher batch',vRoute[1]);return json(res,200,out);}}
   if(route==='/api/radius/campaign'&&method==='GET')return json(res,200,{campaign:campaigns.status(store),running:campaigns.isRunning(),segments:campaigns.SEGMENTS});
   if(route==='/api/radius/campaign/preview'&&method==='POST')return json(res,200,campaigns.preview(store,await body(req)));
   if(route==='/api/radius/campaign'&&method==='POST'){role(user,['admin','manager']);const run=campaigns.start(store,await body(req),user);store.audit(user,'Started SMS campaign to '+run.total,'campaign');const {done,...out}=run;return json(res,202,out);}
   if(route==='/api/radius/campaign'&&method==='DELETE'){role(user,['admin','manager']);return json(res,200,campaigns.cancel());}
   if(route==='/api/radius/settings'&&method==='PUT'){role(user,['admin']);const saved=radius.updateSettings(store,await body(req));store.audit(user,'Updated RADIUS settings','radius');return json(res,200,saved);}
   if(route==='/api/radius/import'&&method==='POST'){role(user,['admin','manager']);const input=await body(req,4194304);const result=radius.importCsv(store,input.csv,input.commit===true);if(result.committed)store.audit(user,'Imported '+result.total+' subscribers','radius');return json(res,200,result);}
   if(route==='/api/radius/plans'&&method==='POST'){write();const saved=store.put('plans',radius.plan(await body(req)));store.audit(user,'Created plan',saved.id);return json(res,201,saved);}
   const planRoute=route.match(/^\/api\/radius\/plans\/([a-f0-9-]{36})$/);
   if(planRoute){write();const existing=store.get('plans',planRoute[1]);if(!existing)throw error(404,'Plan not found');
    if(method==='PATCH'){const saved=store.put('plans',radius.plan(await body(req),existing),existing);store.audit(user,'Updated plan',saved.id);return json(res,200,saved);}
    if(method==='DELETE'){if(store.list('subscribers').some(s=>s.planId===existing.id))throw error(409,'Move this plan\'s subscribers to another plan first');store.remove('plans',existing.id);store.audit(user,'Deleted plan',existing.id);return json(res,200,{ok:true});}}
   if(route==='/api/radius/subscribers'&&method==='POST'){write();const input=await body(req);let saved,secret;store.transaction(()=>{saved=store.put('subscribers',radius.subscriber(store,input));secret=radius.setPassword(store,saved.id,input.password);});store.audit(user,'Created subscriber',saved.id);return json(res,201,{...saved,password:secret});}
   const subRoute=route.match(/^\/api\/radius\/subscribers\/([a-f0-9-]{36})(?:\/(renew|password|payments|points|stk))?$/);
   if(subRoute){const existing=store.get('subscribers',subRoute[1]);if(!existing)throw error(404,'Subscriber not found');
    if(subRoute[2]==='password'&&method==='GET'){role(user,['admin','operator','manager']);store.audit(user,'Viewed subscriber password',existing.id);return json(res,200,{password:radius.password(store,existing.id)});}
    write();
    if(subRoute[2]==='payments'&&method==='POST'){const result=billing.pay(store,existing.id,await body(req));store.audit(user,'Recorded payment '+result.payment.reference,existing.id);const sms=await billing.receipt(store,result);return json(res,201,{...result,sms});}
    if(subRoute[2]==='stk'&&method==='POST'){if(!publicUrl)throw error(409,'Configure the HTTPS public origin first');const input=await body(req),phoneNo=String(input.phone||existing.phone||'');limit(req,'staff-stk',30,600000,existing.id);
     const r=await portal.start(store,{kind:'account',username:existing.username,phone:phoneNo,promo:input.promo||''},publicUrl.origin);store.audit(user,'Sent M-Pesa payment request (KSh '+r.amount+')',existing.id);return json(res,201,{id:r.id,amount:r.amount,message:'Payment request sent to '+phoneNo+'. The customer enters their M-Pesa PIN; the account renews when Safaricom confirms.'});}
    if(subRoute[2]==='points'&&method==='POST'){const saved=billing.redeemPoints(store,existing.id,(await body(req)).points);store.audit(user,'Redeemed loyalty points',existing.id);return json(res,200,saved);}
    if(subRoute[2]==='renew'&&method==='POST'){const saved=radius.renew(store,existing.id,(await body(req)).periods||1);store.audit(user,'Renewed subscriber',existing.id);return json(res,200,saved);}
    if(!subRoute[2]&&method==='PATCH'){const input=await body(req);let saved,secret;store.transaction(()=>{saved=store.put('subscribers',radius.subscriber(store,input,existing),existing);if(input.password)secret=radius.setPassword(store,existing.id,input.password);});store.audit(user,'Updated subscriber',existing.id);return json(res,200,secret?{...saved,password:secret}:saved);}
    if(!subRoute[2]&&method==='DELETE'){store.transaction(()=>{store.remove('subscribers',existing.id);store.db.prepare('DELETE FROM secrets WHERE device_id=?').run('subscriber:'+existing.id);});store.audit(user,'Deleted subscriber',existing.id);return json(res,200,{ok:true});}}
   throw error(404,'API endpoint not found');
  }
  if(route==='/api/router-events'&&method==='GET'){if(user.role==='installer')throw error(403,'Router events are not available to field installers');return json(res,200,customers.routerEvents(store,url.searchParams));}
  const customerLabel=route.match(/^\/api\/customers\/([a-f0-9]{64})$/);
  if(customerLabel&&method==='PATCH'){if(!permissions.equipment(user.role))throw error(403,'Your role cannot classify discovered devices');const saved=customers.annotate(store,customerLabel[1],await body(req));store.audit(user,'Classified discovered customer device',customerLabel[1]);return json(res,200,saved);}
  if(route==='/api/customer-agent/enroll'&&method==='POST'){
   if(!permissions.equipment(user.role))throw error(403,'Your role cannot enable customer discovery');if(!publicUrl)throw error(409,'Configure the HTTPS public origin first');const input=await body(req),device=store.get('devices',input.deviceId);if(!device||device.type!=='router')throw error(404,'Router not found');
   const credentialId='discovery:'+device.id,existing=store.secret(credentialId);if(existing&&input.replace!==true)throw error(409,'Discovery is already configured. Confirm replacement to issue another script.');
   const token=crypto.randomBytes(32).toString('base64url'),script=customers.generate(publicUrl.origin,device.id,token);store.secret(credentialId,{tokenHash:routerAgent.hash(token),issuedAt:Date.now()});agentAccepted.delete(credentialId);store.audit(user,'Issued customer discovery script',device.id);return json(res,201,{device:{id:device.id,name:device.name},script,intervalSeconds:120});
  }
  const revokeDiscovery=route.match(/^\/api\/customer-agent\/([a-f0-9-]{36})\/credential$/);
  if(revokeDiscovery&&method==='DELETE'){if(!permissions.equipment(user.role))throw error(403,'Your role cannot revoke customer discovery');const device=store.get('devices',revokeDiscovery[1]);if(!device||device.type!=='router')throw error(404,'Router not found');const key='discovery:'+device.id;store.db.prepare('DELETE FROM secrets WHERE device_id=?').run(key);agentAccepted.delete(key);store.audit(user,'Revoked customer discovery credential',device.id);return json(res,200,{ok:true});}
  if(route==='/api/router-agent/enroll'&&method==='POST'){
   if(!permissions.equipment(user.role))throw error(403,'Your role cannot enroll routers');if(!publicUrl)throw error(409,'Set NETWORK_PUBLIC_ORIGIN to your HTTPS hostname before enrolling routers');const input=await body(req),existing=input.deviceId?store.get('devices',input.deviceId):null;if(input.deviceId&&!existing)throw error(404,'Router not found');if(existing&&existing.type!=='router')throw error(400,'Select a router');
   const token=crypto.randomBytes(32).toString('base64url');let saved,script;store.transaction(()=>{const valid=validate('devices',{...(existing||{}),name:existing?.name||text(input.name,'router name'),type:'router',driver:'routeros-script',endpoint:''},existing,store);saved=store.put('devices',{...valid,status:'pending',lastCheck:null,lastSeen:null,lastError:'',metrics:{}},existing);script=routerAgent.generate(publicUrl?.origin||'',saved.id,token);store.db.prepare('DELETE FROM secrets WHERE device_id IN (?,?)').run(saved.id,'agent:'+saved.id);store.secret('agent:'+saved.id,{tokenHash:routerAgent.hash(token),issuedAt:Date.now()});store.audit(user,existing?'Replaced router script enrollment':'Created router script enrollment',saved.id);});agentAccepted.delete(saved.id);return json(res,201,{device:readDevice(saved),script,intervalSeconds:30,minimumRouterOS:'7.16',scope:'Monitoring check-ins only; no command execution, VPN or RADIUS changes'});
  }
  const revokeAgent=route.match(/^\/api\/router-agent\/([a-f0-9-]{36})\/credential$/);
  if(revokeAgent&&method==='DELETE'){if(!permissions.equipment(user.role))throw error(403,'Your role cannot revoke router enrollment');const device=store.get('devices',revokeAgent[1]);if(!device||device.driver!=='routeros-script')throw error(404,'Script router not found');store.transaction(()=>{store.db.prepare('DELETE FROM secrets WHERE device_id=?').run('agent:'+device.id);store.put('devices',{...device,status:'pending',lastCheck:null,lastSeen:null,metrics:{},lastError:''},device);store.audit(user,'Revoked router script enrollment',device.id);});agentAccepted.delete(device.id);return json(res,200,{ok:true});}
  const installerJob=deviceId=>store.list('jobs').some(j=>j.assigneeId===user.id&&j.deviceId===deviceId);
  if(route==='/api/map/export'&&method==='GET'){
   if(user.role==='installer')throw error(403,'Map export is not available to field installers');const format=url.searchParams.get('format');if(!['geojson','kml'].includes(format))throw error(400,'Choose geojson or kml');const collection=gis.geojson(store);res.setHeader('Content-Disposition','attachment; filename="network-map.'+format+'"');res.setHeader('Content-Type',format==='kml'?'application/vnd.google-earth.kml+xml; charset=utf-8':'application/geo+json; charset=utf-8');res.writeHead(200);return res.end(format==='kml'?gis.kml(collection):JSON.stringify(collection));
  }
  if(route==='/api/logout'&&method==='POST'){store.db.prepare('DELETE FROM sessions WHERE token=?').run(user.token);res.setHeader('Set-Cookie','network_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json(res,200,{ok:true});}
  if(route==='/api/dashboard'&&method==='GET'){if(user.role==='installer')throw error(403,'Field installers can access discovery and their assigned jobs');const result=dashboard();if(user.role!=='admin')delete result.balance;return json(res,200,result);}
  if(route==='/api/workspace'&&method==='PATCH'){role(user,['admin']);const input=await body(req);store.setting('workspace',{...store.setting('workspace'),name:text(input.name,'workspace')});store.audit(user,'Updated workspace','workspace');return json(res,200,store.setting('workspace'));}
  if(route.startsWith('/api/acs/')){
   if(user.role==='installer')throw error(403,'TR-069 is not available to field installers');
   if(route==='/api/acs/config'){
    if(method==='GET')return json(res,200,acs.config(store));
    if(method==='POST'){role(user,['admin']);const input=await body(req);try{const result=await acs.configure(store,input);store.audit(user,'Connected independent ACS','acs');return json(res,200,result);}catch(cause){throw error(400,cause.message);}}
   }
   if(route==='/api/acs/devices'&&method==='GET'){try{return json(res,200,await acs.list(store));}catch(cause){throw error(502,cause.message);}}
   if(route==='/api/acs/faults'&&method==='GET'){try{return json(res,200,await acs.faults(store));}catch(cause){throw error(502,cause.message);}}
   if(route==='/api/acs/tasks'&&method==='GET')return json(res,200,store.list('acsTasks'));
   const tracking=route.match(/^\/api\/acs\/tasks\/([^/]+)\/reconcile$/);if(tracking&&method==='POST'){
    if(!permissions.equipment(user.role))throw error(403,'Your role cannot reconcile device operations');const input=await body(req),operation=store.get('acsTasks',tracking[1]);if(!operation)throw error(404,'Operation not found');if(input.checked!==true)throw error(400,'Check the device and ACS before reconciling an operation');const result=store.put('acsTasks',{...operation,status:'Reconciled by operator',reconciledBy:user.id},operation);store.audit(user,'Reconciled ACS operation',operation.id);return json(res,200,result);
   }
   const deviceMatch=route.match(/^\/api\/acs\/devices\/([^/]+)(?:\/(reboot|refresh|wifi))?$/);if(deviceMatch){
    let deviceId;try{deviceId=decodeURIComponent(deviceMatch[1]);}catch{throw error(400,'Invalid device ID');}const action=deviceMatch[2];
    if(!action&&method==='GET'){try{return json(res,200,await acs.detail(store,deviceId));}catch(cause){throw error(502,cause.message);}}
    if(action&&method==='POST'){
     if(!permissions.equipment(user.role))throw error(403,'Your role cannot change CPEs');const input=await body(req);
     if(action==='wifi'){if(typeof input.networkId!=='string'||!/^TR-(098|181):\d{1,2}$/.test(input.networkId))throw error(400,'Select an observed Wi-Fi network');if(input.password&&(typeof input.password!=='string'||input.password.length<8||input.password.length>63))throw error(400,'Wi-Fi password must contain 8–63 characters');if(input.ssid!==undefined&&(typeof input.ssid!=='string'||!input.ssid||Buffer.byteLength(input.ssid)>32))throw error(400,'SSID must contain 1–32 bytes');}
     if(store.list('acsTasks').some(t=>t.deviceId===deviceId&&t.action===action&&['Queued','Sending','Uncertain'].includes(t.status)))throw error(409,'An earlier request is still pending. Check the ACS and device before reconciling it');
     const operation=store.put('acsTasks',{deviceId,action,status:'Sending',requestedBy:user.id});store.audit(user,'Requested CPE '+action,operation.id);
     try{const receipt=await acs.task(store,deviceId,action,input);return json(res,receipt.httpStatus,store.put('acsTasks',{...operation,...receipt},operation));}catch(cause){store.put('acsTasks',{...operation,status:cause.mayHaveApplied?'Uncertain':'Rejected',error:cause.message},operation);throw error(502,cause.mayHaveApplied?'The ACS outcome is uncertain. Check the device before retrying.':cause.message);}
    }
   }
   throw error(404,'ACS endpoint not found');
  }
  if(route==='/api/presets/default'){
   if(method==='GET'){if(!permissions.read(user.role,'presets'))throw error(403,'Presets are not available to your role');return json(res,200,{id:store.setting('defaultPresetId')});}
   if(method==='POST'){if(!permissions.equipment(user.role))throw error(403,'Your role cannot change presets');const input=await body(req);if(input.id&&!store.get('presets',input.id))throw error(400,'Preset not found');store.setting('defaultPresetId',input.id||null);store.audit(user,'Changed default ONU preset',input.id||'none');return json(res,200,{id:input.id||null});}
  }
  if(route==='/api/presets/apply'&&method==='POST'){
   if(!permissions.equipment(user.role))throw error(403,'Your role cannot apply presets');const input=await body(req),preset=store.get('presets',input.presetId);if(!preset)throw error(400,'Select a preset');if(input.renameOnDevice)throw error(409,'Equipment renaming requires a verified vendor operation; this action updates workspace records only');
   if(!Array.isArray(input.deviceIds)||!input.deviceIds.length||input.deviceIds.length>500)throw error(400,'Select 1–500 ONUs');let saved=[];store.transaction(()=>{for(const deviceId of new Set(input.deviceIds)){const device=store.get('devices',deviceId);if(!device||device.type!=='onu')throw error(400,'Select existing ONUs');const prepared=applyPreset(store,device,preset,{useNamePattern:input.useNamePattern!==false});const valid=validate('devices',prepared,device,store);saved.push(store.put('devices',valid,device));store.audit(user,'Applied local ONU preset',deviceId);}});return json(res,200,{devices:saved.map(readDevice),equipmentChanged:false});
  }
  if(route==='/api/team'){
   if(method==='GET')return json(res,200,user.role==='admin'?users().map(publicUser):user.role==='installer'?[publicUser(user)]:users().filter(u=>u.active).map(u=>({id:u.id,name:u.name,role:u.role,active:true})));role(user,['admin']);if(method==='POST'){const input=await body(req),r=input.role||'viewer';if(!permissions.roles.includes(r))throw error(400,'Invalid role');const u={id:crypto.randomUUID(),name:text(input.name,'name'),email:email(input.email),role:r};try{store.db.prepare('INSERT INTO users(id,email,name,role,password,created) VALUES(?,?,?,?,?,?)').run(u.id,u.email,u.name,r,hashPassword(password(input.password)),Date.now());}catch(cause){if(cause.code?.includes('CONSTRAINT'))throw error(409,'Email already exists');throw cause;}store.audit(user,'Added team member',u.id);return json(res,201,u);}
  }
  const teamMatch=route.match(/^\/api\/team\/([^/]+)$/);if(teamMatch&&method==='PATCH'){
   role(user,['admin']);const input=await body(req),target=users().find(u=>u.id===teamMatch[1]);if(!target)throw error(404,'User not found');const r=input.role||target.role,active=input.active===undefined?target.active:input.active?1:0;if(!permissions.roles.includes(r))throw error(400,'Invalid role');if(target.id===user.id&&(!active||r!=='admin'))throw error(409,'You cannot remove your own admin access');
   store.transaction(()=>{store.db.prepare('UPDATE users SET role=?,active=?,password=? WHERE id=?').run(r,active,input.password?hashPassword(password(input.password)):target.password,target.id);store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);store.audit(user,'Updated team access',target.id);});return json(res,200,{...publicUser(target),role:r,active:!!active});
  }
  if(route==='/api/audit'&&method==='GET'){role(user,['admin']);return json(res,200,store.db.prepare('SELECT a.*,COALESCE(u.name,\'Collector\') user FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all());}
  const match=route.match(/^\/api\/records\/([a-zA-Z]+)(?:\/([^/]+))?(?:\/(connection|poll|history|discover|authorize))?$/);
  if(!match)throw error(404,'API endpoint not found');const [,kind,recordId,action]=match;if(!fields[kind])throw error(404,'Collection not found');const existing=recordId?store.get(kind,recordId):null;if(recordId&&!existing)throw error(404,'Record not found');
  if(!permissions.read(user.role,kind))throw error(403,'This collection is not available to your role');
  if(user.role==='installer'&&kind==='jobs'&&recordId&&existing.assigneeId!==user.id)throw error(403,'This job is not assigned to you');
  if(user.role==='installer'&&kind==='devices'&&recordId&&existing.type!=='olt'&&!installerJob(recordId))throw error(403,'This device is outside your assigned jobs');
  if(action){if(kind!=='devices')throw error(404,'Device action not found');
   if(action==='history'&&method==='GET'){if(user.role==='installer'&&!installerJob(recordId))throw error(403,'This device is outside your assigned jobs');return json(res,200,store.history(recordId));}
   if(action==='connection'&&method==='POST'){if(existing.driver==='routeros-script')throw error(409,'Use Generate connection script to enroll this router');if(!permissions.equipment(user.role))throw error(403,'Your role cannot configure equipment credentials');const input=await body(req);let secret;if(existing.driver==='snmp'){if(input.version==='2c')secret={version:'2c',community:text(input.community,'SNMP community',4096)};else{if(!['sha','sha256'].includes(input.authProtocol||'sha256'))throw error(400,'Choose SHA or SHA-256');secret={version:'3',username:text(input.username,'SNMP username'),authProtocol:input.authProtocol||'sha256',authKey:text(input.authKey,'SNMP authentication key',4096),privKey:text(input.privKey,'SNMP privacy key',4096)};if(secret.authKey.length<8||secret.privKey.length<8)throw error(400,'SNMPv3 passphrases must contain at least 8 characters');}}else secret=input.token?{token:text(input.token,'gateway token',4096)}:{username:text(input.username,'device username'),password:text(input.password,'device password',4096)};store.secret(recordId,secret);store.audit(user,'Saved device credentials',recordId);return json(res,200,{configured:true});}
   if(action==='poll'&&method==='POST'){role(user,['admin','operator','technician','manager','network-technician','installer']);if(user.role==='installer'&&existing.type!=='olt'&&!installerJob(recordId))throw error(403,'This device is outside your assigned jobs');const outcome=await poll(existing);return json(res,200,user.role==='installer'?{online:outcome.online,error:outcome.error}:outcome);}
   if(action==='discover'&&method==='GET'){if(existing.driver!=='olt-gateway')throw error(409,'Configure the OLT gateway connector');return json(res,200,{observedAt:existing.lastCheck||null,onus:store.setting('discovery:'+recordId)||[]});}
   if(action==='authorize'&&method==='POST'){
    role(user,['admin','operator','manager','network-technician','installer']);if(existing.driver!=='olt-gateway')throw error(409,'An OLT vendor gateway is required');const input=await body(req),serial=text(input.serial,'serial'),discovered=store.setting('discovery:'+recordId)||[];if(!discovered.some(o=>o.serial===serial&&o.pon===input.pon))throw error(409,'Refresh discovery and select an observed ONU');if(existing.status!=='online'||!existing.lastSeen||Date.now()-existing.lastSeen>60000)throw error(409,'Refresh OLT discovery before authorization');const profile=store.get('profiles',input.profileId);if(!profile)throw error(400,'Select a service profile');
    if(store.list('alerts').some(a=>a.source==='provisioning'&&a.deviceId===recordId&&a.serial===serial&&a.status!=='Resolved'))throw error(409,'An earlier authorization needs reconciliation. Check the OLT and resolve its alert before retrying');
    const operation=store.put('alerts',{title:'ONU authorization requested',details:serial,serial,deviceId:recordId,severity:'info',status:'Open',source:'provisioning'});store.audit(user,'Requested ONU authorization',operation.id);
    try{const result=await connectors.authorize(existing,store.secret(recordId),{serial,pon:input.pon,profileId:profile.id,profile},operation.id);store.put('alerts',{...operation,title:'ONU authorization verified',status:'Resolved'},operation);store.setting('discovery:'+recordId,discovered.filter(o=>o.serial!==serial));await poll(existing);store.audit(user,'Verified ONU authorization',operation.id);return json(res,200,result);}catch{store.put('alerts',{...operation,title:'ONU authorization needs reconciliation',details:'Outcome unknown. Check the OLT before retrying.',severity:'warning'},operation);throw error(502,'Authorization was not verified. Check the OLT before retrying.');}
   }
   throw error(405,'Method not allowed');
  }
  if(method==='GET'){
   let result=recordId?[existing]:store.list(kind);
   if(user.role==='installer'&&kind==='jobs')result=result.filter(j=>j.assigneeId===user.id);
   if(kind==='devices'){if(user.role==='installer')result=result.filter(d=>d.type==='olt'||installerJob(d.id));result=result.map(d=>{const full=readDevice(d);if(user.role!=='installer'||d.type!=='olt')return full;return {id:d.id,name:d.name,type:d.type,driver:d.driver,status:full.status,lastCheck:d.lastCheck,lastSeen:d.lastSeen,version:d.version};});}
   return json(res,200,recordId?result[0]:result);
  }
  if(!permissions.write(user.role,kind,method))throw error(403,'Your role cannot perform this action');
  if(method==='DELETE'){
   if(!existing)throw error(400,'Select a record');if(['stockMoves','payments'].includes(kind))throw error(409,'Accounting entries are immutable');for(const k of Object.keys(fields))if(store.list(k).some(row=>row.id!==recordId&&Object.entries(row).some(([key,value])=>key.endsWith('Id')&&value===recordId)))throw error(409,'This record has links. Remove its links first');
   store.transaction(()=>{store.remove(kind,recordId);if(kind==='devices'){store.db.prepare('DELETE FROM secrets WHERE device_id IN (?,?,?)').run(recordId,'agent:'+recordId,'discovery:'+recordId);agentAccepted.delete(recordId);agentAccepted.delete('discovery:'+recordId);store.setting('customerDiscovery:'+recordId,null);for(const label of store.list('customerLabels').filter(x=>x.routerId===recordId))store.remove('customerLabels',label.id);}if(kind==='presets'&&store.setting('defaultPresetId')===recordId)store.setting('defaultPresetId',null);store.audit(user,'Deleted '+kind,recordId);});return json(res,200,{ok:true});
  }
  if(!['POST','PATCH'].includes(method)||(method==='POST'&&recordId)||(method==='PATCH'&&!recordId))throw error(405,'Method not allowed');if(existing&&['stockMoves','payments'].includes(kind))throw error(409,'Accounting entries are immutable');const input=await body(req);
  if(user.role==='support'&&kind==='devices'&&Object.keys(input).some(k=>!['version','customer','phone','address'].includes(k)))throw error(403,'Support can edit customer contact details only');
  if(user.role==='support'&&kind==='jobs'&&input.status&&input.status!=='Open')throw error(403,'Support can create open work orders only');
  if(user.role==='installer'&&kind==='jobs'&&Object.keys(input).some(k=>!['version','status','details'].includes(k)))throw error(403,'Field installers can update the status and notes of assigned jobs only');
  if(existing&&input.version!==existing.version)throw error(409,'This record changed. Reload before saving');const result=validate(kind,input,existing,store);if(kind==='devices'&&['routeros-rest','olt-gateway'].includes(result.driver))result.endpoint=connectors.endpoint(result.endpoint);
  if(kind==='jobs'&&result.status==='Done'&&existing?.status!=='Done'){
   const target=store.get('devices',result.deviceId);if(target){if(target.type==='cpe'&&target.driver==='none'){result.verification='Field checklist recorded; CPE remote management remains unverified';}else{let online=false;if(target.type==='onu'&&target.parentId){const olt=store.get('devices',target.parentId);const started=Date.now();const check=olt&&olt.driver!=='none'?await poll(olt):null;const actual=store.get('devices',target.id);online=check?.online&&actual?.lastCheck>=started&&actual.status==='online';}else if(target.driver==='routeros-script')online=!!store.secret('agent:'+target.id)&&target.lastSeen&&Date.now()-target.lastSeen<=45000;else if(target.driver!=='none')online=(await poll(target)).online;if(!online)throw error(409,'Completion requires a successful device check. Keep the job in progress until connectivity is verified');result.verification=target.driver==='routeros-script'?'Authenticated router check-in at '+new Date(target.lastSeen).toISOString():'Device online at '+new Date().toISOString();}}else result.verification='No device linked; field completion recorded';
  }
  let saved;store.transaction(()=>{
   if(kind==='devices'&&!existing&&result.type==='onu'){const defaultPreset=store.get('presets',store.setting('defaultPresetId'));if(defaultPreset){const prepared=applyPreset(store,result,defaultPreset,{auto:true});Object.assign(result,validate('devices',prepared,null,store));}}
   if(kind==='payments'){
    if(store.list('payments').some(p=>p.reference===result.reference))throw error(409,'Payment reference already recorded');if(result.invoiceId){const invoice=store.get('invoices',result.invoiceId);if(invoice.status!=='Unpaid')throw error(409,'Invoice is not unpaid');const paid=store.list('payments').filter(p=>p.invoiceId===invoice.id).reduce((n,p)=>n+p.amount,0);if(Math.round((paid+result.amount)*100)>Math.round(invoice.amount*100))throw error(400,'Payment exceeds invoice balance');if(Math.round((paid+result.amount)*100)===Math.round(invoice.amount*100))store.put('invoices',{...invoice,status:'Paid'},invoice);}
   }
   if(kind==='devices'&&existing){const changed=existing.driver!==result.driver||existing.endpoint!==result.endpoint||(result.driver==='snmp'&&(existing.ip!==result.ip||existing.snmpPort!==result.snmpPort));if(changed||existing.snmpMapping!==result.snmpMapping){result.status='pending';result.metrics={};result.lastCheck=null;result.lastSeen=null;result.lastError='';}if(changed){store.db.prepare('DELETE FROM secrets WHERE device_id IN (?,?)').run(existing.id,'agent:'+existing.id);agentAccepted.delete(existing.id);}}
   saved=store.put(kind,result,existing);
   if(kind==='stock'&&!existing&&input.initialQuantity!==undefined&&input.initialQuantity!==''){const quantity=Number(input.initialQuantity);if(!Number.isFinite(quantity)||quantity<0||quantity>1e12)throw error(400,'Initial stock must be a nonnegative quantity');if(quantity>0)store.put('stockMoves',{stockId:saved.id,quantity,reason:'Opening stock'});}
   store.audit(user,(existing?'Updated ':'Created ')+kind,saved.id);
  });return json(res,existing?200:201,kind==='devices'?readDevice(saved):saved);
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  try{const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/'))return await api(req,res,url);if(url.pathname.startsWith('/portal/api/'))return await portalApi(req,res,url);if(url.pathname==='/portal'){res.writeHead(301,{Location:'/portal/'+url.search});return res.end();}if(url.pathname.startsWith('/portal/')&&['GET','HEAD'].includes(req.method)){const rel=url.pathname==='/portal/'?'/index.html':url.pathname.slice('/portal'.length),file=path.resolve(portalRoot,'.'+rel);if(!file.startsWith(portalRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw error(404,'Not found');const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});return res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));}if(!['GET','HEAD'].includes(req.method))throw error(405,'Method not allowed');let requested;try{requested=decodeURIComponent(url.pathname);}catch{throw error(400,'Invalid URL');}const file=path.resolve(root,'.'+(requested==='/'?'/index.html':requested));if(!file.startsWith(root+path.sep))throw error(403,'Invalid path');if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw error(404,'Not found');const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.statusCode=200;if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
  }catch(cause){json(res,cause.status||500,{error:cause.status?cause.message:'Server could not complete this request'});if(!cause.status)console.error(cause.name+': server operation failed');}
 });
 // Public captive portal (no login). Limits per client address keep the M-Pesa prompt and code checks from abuse.
 const portalRoot=path.join(__dirname,'portal'),portalHits=new Map();
 // Customers on one hotspot share a public IP, so per-IP limits are generous; the tight limits are per phone, per payment and per login name.
 const limit=(req,bucket,max,windowMs,who)=>{const ip=String(req.headers['cf-connecting-ip']||req.socket.remoteAddress||''),key=bucket+'|'+(who??ip),now=Date.now(),hit=portalHits.get(key);if(!hit||now>hit.until){portalHits.set(key,{n:1,until:now+windowMs});if(portalHits.size>50000)portalHits.clear();return;}if(++hit.n>max)throw error(429,'Too many attempts. Wait a few minutes and try again.');};
 async function portalApi(req,res,url){
  const route=url.pathname,method=req.method,origin=publicUrl?.origin||'http://'+req.headers.host;
  if(route==='/portal/api/info'&&method==='GET')return json(res,200,portal.info(store));
  // The landing page: design settings plus real packages in one call, and the two visitor lookups (rate limited; no contact details returned).
  if(route==='/portal/api/config'&&method==='GET'){const cfg=landing.get(store),inf=portal.info(store);return json(res,200,{config:{...cfg,brandName:cfg.brandName||inf.name,phone:cfg.phone||inf.support,whatsapp:cfg.whatsapp||cfg.phone||inf.support},plans:inf.plans,pppoePlans:inf.pppoePlans,mpesa:inf.mpesa});}
  if(route==='/portal/api/account'&&method==='POST'){limit(req,'account',240,600000);const input=await body(req,2048),q=String(input.query||'').slice(0,400);limit(req,'account-q',12,600000,q.toLowerCase().slice(0,60)||'empty');return json(res,200,landing.account(store,q));}
  if(route==='/portal/api/session'&&method==='GET'){limit(req,'session',240,600000);return json(res,200,landing.session(store,url.searchParams.get('mac')));}
  if(route==='/portal/api/pay'&&method==='POST'){limit(req,'pay',120,600000);const input=await body(req,4096);limit(req,'pay-phone',5,600000,billing.phone(input.phone)||'invalid');return json(res,201,await portal.start(store,input,origin));}
  const st=route.match(/^\/portal\/api\/pay\/([a-f0-9]{32})$/);
  if(st&&method==='GET'){limit(req,'status',3000,600000);limit(req,'status-id',300,600000,st[1]);return json(res,200,await portal.status(store,st[1],url.searchParams.get('t')));}
  if(route==='/portal/api/login'&&method==='POST'){limit(req,'login',600,600000);const input=await body(req,4096);limit(req,'login-user',10,600000,String(input.username||'').trim().toLowerCase().slice(0,64));return json(res,200,portal.login(store,input));}
  const pay=route.match(/^\/portal\/api\/c2b\/([0-9a-f]{32})\/(confirmation|validation)$/);
  // Safaricom paybill notifications. Always answer "Accepted" (it retries otherwise); problems are logged instead.
  if(pay&&method==='POST'){if(!c2b.validSecret(store,pay[1]))throw error(404,'Not found');const input=await body(req,16384);
   if(pay[2]==='validation')return json(res,200,c2b.validate(store,input));
   try{c2b.confirm(store,input);}catch(cause){console.warn('Paybill payment not applied: '+cause.message);}return json(res,200,{ResultCode:0,ResultDesc:'Accepted'});}
  const cb=route.match(/^\/portal\/api\/mpesa\/([A-Za-z0-9_-]{20,64})$/);
  // Always answer Safaricom with success so it does not retry forever; errors are logged instead.
  if(cb&&method==='POST'){try{await portal.callback(store,cb[1],await body(req,65536));}catch(cause){if(cause.status!==404)console.warn('M-Pesa callback not applied: '+cause.message);else throw cause;}return json(res,200,{ResultCode:0,ResultDesc:'Accepted'});}
  throw error(404,'Not found');
 }
 // FreeRADIUS bridge (rlm_rest). Separate port that only the private Compose network reaches; never routed by the tunnel.
 const radiusToken=options.radiusToken??process.env.NETWORK_RADIUS_TOKEN;
 const bridge=radiusToken?http.createServer(async(req,res)=>{
  try{const header=String(req.headers.authorization||''),basic=/^Basic /.test(header)?Buffer.from(header.slice(6),'base64').toString().replace(/^[^:]*:/,''):null,given=Buffer.from(basic??header.replace(/^Bearer /,'')),expected=Buffer.from(radiusToken);if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))throw error(401,'RADIUS bridge denied');
   if(req.method!=='POST')throw error(405,'Method not allowed');const where=new URL(req.url,"http://localhost").pathname,input=await body(req);
   if(where==="/radius/authorize"){const r=radius.authorize(store,input);res.writeHead(r.status,{'Content-Type':'application/json'});return res.end(JSON.stringify(r.attributes));}
   if(where==="/radius/accounting"){radius.accounting(store,input);res.writeHead(204);return res.end();}
   if(where==="/radius/post-auth"){res.writeHead(204);return res.end();}
   throw error(404,'Not found');
  }catch(cause){json(res,cause.status||500,{error:cause.status?cause.message:'RADIUS bridge error'});if(!cause.status)console.error(cause.name+': RADIUS bridge failed');}
 }):null;
 server.on('listening',()=>{if(options.collector!==false){timer=setInterval(()=>collect().catch(()=>{}),pollMs);timer.unref();collect().catch(()=>{});}});
 return {server,bridge,store,poll,close:async()=>{closing=true;clearInterval(timer);await new Promise(resolve=>server.close(resolve));if(bridge?.listening)await new Promise(resolve=>bridge.close(resolve));while(busy.size)await new Promise(resolve=>setTimeout(resolve,50));store.close();}};
}
if(require.main===module){const app=createApp(),port=Number(process.env.PORT||4317),host=process.env.HOST||'127.0.0.1';app.server.listen(port,host,()=>console.log(`Network Hub: http://${host}:${port}`));if(app.bridge){const radiusPort=Number(process.env.NETWORK_RADIUS_PORT||4318);app.bridge.listen(radiusPort,process.env.NETWORK_RADIUS_HOST||host,()=>console.log('RADIUS bridge listening on port '+radiusPort));}for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit(0)));}
module.exports={createApp};
