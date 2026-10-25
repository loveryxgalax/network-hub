'use strict';
// Netops RADIUS: plans, subscribers and the login decision that FreeRADIUS asks for (rlm_rest), plus session
// accounting. FreeRADIUS does the PAP/CHAP/MS-CHAP maths; this module decides who may log in, at what speed
// and until when. Subscriber passwords are kept encrypted in the secrets table because CHAP/MS-CHAP need them.
const crypto=require('node:crypto'),net=require('node:net');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const HOUR=3600000,DAY=24*HOUR,LOG=2000,STALE=15*60000;
const UNITS={hours:HOUR,days:DAY,weeks:7*DAY,months:30*DAY};
const SERVICES=['pppoe','hotspot','both'];
const text=(value,label,max=120,required=true)=>{const v=String(value??'').trim();if(required&&!v)fail(label+' is required');if(v.length>max||/[\u0000-\u001f]/.test(v))fail('Invalid '+label);return v;};
const number=(value,label,min=0,max=1e7)=>{const n=Number(value);if(value===''||value==null||!Number.isFinite(n)||n<min||n>max)fail('Invalid '+label);return n;};
const USERNAME=/^[A-Za-z0-9._-]{2,64}$/;
function settings(store){return {realm:'kade',expiredPppoe:'restrict',restrictList:'no-internet',interim:300,...(store.setting('radiusSettings')||{})};}
function plan(input,existing={}){
 const v={...existing,...input};
 return {name:text(v.name,'plan name'),service:SERVICES.includes(v.service)?v.service:fail('Choose PPPoE, Hotspot or both'),downloadMbps:number(v.downloadMbps,'download speed',0.064,10000),uploadMbps:number(v.uploadMbps,'upload speed',0.064,10000),price:number(v.price,'price',0,1e7),durationValue:number(v.durationValue,'duration',1,1000),durationUnit:UNITS[v.durationUnit]?v.durationUnit:fail('Invalid duration unit'),devices:Math.round(number(v.devices??1,'devices',1,50)),active:v.active!==false&&v.active!=='false',description:text(v.description,'description',500,false)};
}
const planMs=p=>p.durationValue*UNITS[p.durationUnit];
function subscriber(store,input,existing={}){
 const v={...existing,...input},username=text(v.username,'username',64).toLowerCase();
 if(!USERNAME.test(username))fail('Usernames use 2–64 letters, numbers, dots, dashes or underscores');
 if(store.list('subscribers').some(s=>s.username===username&&s.id!==existing.id))fail('That username is already used',409);
 const planId=text(v.planId,'plan',80);if(!store.get('plans',planId))fail('Choose an existing plan');
 const staticIp=text(v.staticIp,'static IP',45,false);if(staticIp&&net.isIP(staticIp)!==4)fail('Static IP must be an IPv4 address');
 const expiresAt=v.expiresAt===''||v.expiresAt==null||v.expiresAt==='never'?null:number(typeof v.expiresAt==='string'&&!/^\d+$/.test(v.expiresAt)?Date.parse(v.expiresAt):v.expiresAt,'expiry date',0,8.64e15);
 // A new subscriber with no expiry starts expired: no free internet until it is renewed (paid).
 const expiry=expiresAt==null&&!existing.id&&!('expiresAt' in input&&input.expiresAt==='never')?Date.now():expiresAt;
 return {name:text(v.name,'customer name'),username,phone:text(v.phone,'phone',30,false),email:text(v.email,'email',120,false),service:['pppoe','hotspot'].includes(v.service)?v.service:fail('Choose PPPoE or Hotspot'),planId,status:['active','suspended'].includes(v.status)?v.status:'active',expiresAt:expiry,staticIp,address:text(v.address,'address',250,false),notes:text(v.notes,'notes',1000,false),lastSeen:existing.lastSeen||null,lastMac:existing.lastMac||''};
}
function setPassword(store,id,password){const p=password==null||password===''?crypto.randomBytes(6).toString('base64url'):text(password,'password',64);if(p.length<4)fail('Use a password of at least 4 characters');store.secret('subscriber:'+id,{password:p});return p;}
const password=(store,id)=>store.secret('subscriber:'+id)?.password||null;
// Extend from the later of now and the current expiry, so early renewals are not lost.
function renew(store,id,periods=1,now=Date.now()){const s=store.get('subscribers',id);if(!s)fail('Subscriber not found',404);const p=store.get('plans',s.planId);if(!p)fail('Subscriber has no plan');const n=Math.round(number(periods,'periods',1,24));return store.put('subscribers',{...s,status:'active',expiresAt:Math.max(now,s.expiresAt||0)+n*planMs(p)},s);}
// FreeRADIUS rlm_rest sends {"Attr":{"type":..,"value":[..]}}; plain {"Attr":"value"} is accepted for tests and tools.
const attr=(req,name)=>{const a=req?.[name];if(a==null)return '';if(typeof a==='object'&&Array.isArray(a.value))return String(a.value[0]??'');return String(a);};
function serviceOf(req){const type=attr(req,'Service-Type').toLowerCase(),proto=attr(req,'Framed-Protocol').toLowerCase();return proto==='ppp'||type==='framed-user'||type==='2'?'pppoe':'hotspot';}
function stripRealm(store,raw){const name=raw.trim().toLowerCase(),realm=settings(store).realm;const at=name.lastIndexOf('@');if(at>0&&(!realm||name.slice(at+1)===realm))return name.slice(0,at);return name;}
function log(store,entry){const l=store.setting('radiusAuthLog')||{items:[]};l.items=[entry,...l.items].slice(0,LOG);store.setting('radiusAuthLog',l);}
const rate=p=>`${mbit(p.uploadMbps)}/${mbit(p.downloadMbps)}`;
function mbit(v){return v>=1?(Math.round(v*100)/100)+'M':Math.round(v*1000)+'k';}
function activeSessions(store,username,now){return store.list('radiusSessions').filter(s=>s.username===username&&!s.stoppedAt&&now-s.updatedAt<STALE);}
// The login decision. Returns {status,attributes,reason}; status 200 accept (with Cleartext-Password for FreeRADIUS), 401 reject, 404 unknown.
function authorize(store,req,now=Date.now()){
 const raw=attr(req,'User-Name'),username=stripRealm(store,raw),service=serviceOf(req),nas=attr(req,'NAS-IP-Address')||attr(req,'NAS-Identifier'),mac=attr(req,'Calling-Station-Id');
 const done=(status,reason,attributes={})=>{log(store,{time:now,username:raw.slice(0,80),service,nas,mac,result:status===200?'accept':'reject',reason});return {status,reason,attributes:status===200?attributes:{'reply:Reply-Message':reason}};};
 const s=store.list('subscribers').find(x=>x.username===username);
 if(!s)return done(404,'Unknown username');
 const secret=password(store,s.id),p=store.get('plans',s.planId),cfg=settings(store);
 if(!secret)return done(401,'No password set');
 if(s.status!=='active')return done(401,'Account suspended');
 if(!p)return done(401,'Account has no plan');
 if(p.service!=='both'&&p.service!==service)return done(401,'Plan is not for '+(service==='pppoe'?'PPPoE':'Hotspot'));
 if(activeSessions(store,s.username,now).length>=p.devices&&service==='hotspot')return done(401,'Device limit reached');
 const reply={'control:Cleartext-Password':secret,'reply:Mikrotik-Rate-Limit':rate(p),'reply:Acct-Interim-Interval':String(cfg.interim)};
 if(s.staticIp)reply['reply:Framed-IP-Address']=s.staticIp;
 const left=s.expiresAt==null?null:s.expiresAt-now;
 if(left!=null&&left<=0){
  // Expired PPPoE customers stay connected but land in the restricted list, so the router's existing redirect shows the payment page.
  if(service==='pppoe'&&cfg.expiredPppoe==='restrict')return done(200,'Expired: restricted',{...reply,'reply:Mikrotik-Address-List':cfg.restrictList,'reply:Mikrotik-Rate-Limit':'512k/512k','reply:Session-Timeout':String(3600)});
  return done(401,'Account expired');
 }
 if(left!=null)reply['reply:Session-Timeout']=String(Math.max(60,Math.min(Math.ceil(left/1000),2147483647)));
 return done(200,'OK',reply);
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
 const body={username:username||existing?.username||'',service:has('Service-Type')||has('Framed-Protocol')?serviceOf(req):existing?.service||serviceOf(req),nas,sessionId:sessionId.slice(0,80),ip:attr(req,'Framed-IP-Address')||existing?.ip||'',mac:attr(req,'Calling-Station-Id').slice(0,40)||existing?.mac||'',startedAt:existing?.startedAt||now-(Number(attr(req,'Acct-Session-Time'))||0)*1000,updatedAt:now,stoppedAt:stopped?now:null,cause:stopped?attr(req,'Acct-Terminate-Cause').slice(0,60):'',
  // Router "input" is what the customer uploaded.
  uploadBytes:octets(req,'Acct-Input-Octets'),downloadBytes:octets(req,'Acct-Output-Octets')};
 if(existing){if(existing.stoppedAt&&!stopped)return {ok:true,ignored:true};store.db.prepare("UPDATE records SET body=?,version=version+1,updated=? WHERE kind='radiusSessions' AND id=?").run(JSON.stringify(body),now,key);}
 else store.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(key,JSON.stringify(body),now,now);
 const s=store.list('subscribers').find(x=>x.username===username);if(s)store.put('subscribers',{...s,lastSeen:now,lastMac:body.mac||s.lastMac},s);
 return {ok:true};
}
function prune(store,now=Date.now()){store.db.prepare("DELETE FROM records WHERE kind='radiusSessions' AND updated<?").run(now-30*DAY);}
function overview(store,now=Date.now()){
 const plans=store.list('plans'),byPlan=new Map(plans.map(p=>[p.id,p]));
 const sessions=store.list('radiusSessions').filter(s=>!s.stoppedAt&&now-s.updatedAt<STALE).sort((a,b)=>b.updatedAt-a.updatedAt);
 const online=new Set(sessions.map(s=>s.username));
 const subscribers=store.list('subscribers').map(s=>({...s,planName:byPlan.get(s.planId)?.name||'—',online:online.has(s.username),state:s.status!=='active'?'suspended':s.expiresAt!=null&&s.expiresAt<=now?'expired':'active',hasPassword:!!store.secret('subscriber:'+s.id)}));
 return {plans,subscribers,sessions,log:(store.setting('radiusAuthLog')?.items||[]).slice(0,500),settings:settings(store),counts:{subscribers:subscribers.length,active:subscribers.filter(s=>s.state==='active').length,expired:subscribers.filter(s=>s.state==='expired').length,online:online.size,expiringSoon:subscribers.filter(s=>s.state==='active'&&s.expiresAt!=null&&s.expiresAt-now<3*DAY).length}};
}
function updateSettings(store,input){const cur=settings(store),realm=text(input.realm??cur.realm,'realm',40,false).toLowerCase();if(realm&&!/^[a-z0-9.-]+$/.test(realm))fail('Invalid realm');
 return store.setting('radiusSettings',{realm,expiredPppoe:['restrict','reject'].includes(input.expiredPppoe)?input.expiredPppoe:cur.expiredPppoe,restrictList:text(input.restrictList??cur.restrictList,'address list',60),interim:Math.round(number(input.interim??cur.interim,'interim interval',60,3600))});}
module.exports={plan,subscriber,setPassword,password,renew,authorize,accounting,overview,prune,settings,updateSettings,planMs,UNITS};
