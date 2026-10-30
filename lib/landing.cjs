'use strict';
// Hotspot landing page: the admin-editable design settings (9 themes), plus the two lookups the page makes for
// visitors: "find my connection" (by the device the router reports) and "access my account" (by account number,
// username, phone or a pasted SMS). Lookups return only what is needed to renew or log in, never contact details.
const billing=require('./billing.cjs');
const THEMES=['classic','spotlight','split','minimal','midnight','christmas','futuristic','bento','elegant'];
const DEFAULTS={theme:'midnight',brandName:'',brandColor:'#0a3cff',intro:'',defaultLang:'sw',phone:'',whatsapp:'',email:'info@kadenetworks.com',accountPrefix:'KNE',popular:'',packageLayout:'auto',loadingStyle:'spinner',loadingText:'',terms:'',
 show:{pppoe:true,hotspot:true,findAccount:true,accessAccount:true,onTheGo:true,contact:true}};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const clean=(v,max,label)=>{const s=String(v??'').trim();if(s.length>max||/[\u0000-\u001f<>]/.test(s))fail('Invalid '+label);return s;};
function get(store){const c=store.setting('landingConfig')||{};return {...DEFAULTS,...c,show:{...DEFAULTS.show,...(c.show||{})}};}
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Expected an object');
 const out={};
 if(!THEMES.includes(input.theme))fail('Choose one of the nine designs');out.theme=input.theme;
 out.brandName=clean(input.brandName,40,'business name');
 if(!/^#[0-9a-fA-F]{6}$/.test(String(input.brandColor||'')))fail('Brand colour must be like #0a3cff');out.brandColor=String(input.brandColor).toLowerCase();
 out.intro=clean(input.intro,240,'intro');
 out.defaultLang=['en','sw','fr'].includes(input.defaultLang)?input.defaultLang:'sw';
 out.loadingStyle=['spinner','dots','logo','progress','none'].includes(input.loadingStyle)?input.loadingStyle:'spinner';
 out.loadingText=clean(input.loadingText,40,'loading text');
 out.terms=String(input.terms??'').replace(/\r/g,'').trim();if(out.terms.length>8000||/<[a-z!\/]/i.test(out.terms))fail('Terms must be plain text up to 8000 characters');
 for(const k of ['phone','whatsapp'])out[k]=clean(input[k],20,k).replace(/[^\d+ ]/g,'');
 out.email=clean(input.email,80,'email');if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))fail('Enter a valid email');
 out.accountPrefix=clean(input.accountPrefix||'KNE',8,'account prefix').toUpperCase().replace(/[^A-Z0-9]/g,'')||'KNE';
 out.popular=clean(input.popular,60,'popular package');
 out.packageLayout=['auto','list','grid','swipe'].includes(input.packageLayout)?input.packageLayout:'auto';
 out.show={};for(const k of Object.keys(DEFAULTS.show))out.show[k]=input.show?.[k]===undefined?DEFAULTS.show[k]:input.show[k]===true;
 return out;
}
function save(store,input){return store.setting('landingConfig',validate(input));}
const mac=v=>{const m=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');return m.length===12?m.match(/.{2}/g).join(':'):null;};
const accountKey=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,'').replace(/@[a-z0-9.-]+$/,'');
function summary(store,s,now=Date.now()){const p=store.get('plans',s.planId),state=s.status!=='active'?'suspended':s.expiresAt!=null&&s.expiresAt<=now?'expired':'active';
 return {found:true,account:s.username,service:s.service,plan:p?.name||'',price:p?.price??null,status:state,expiresAt:s.expiresAt};}
// Account number, username, phone, or a whole pasted message: try the usual account-number pattern first.
// With the customer's PIN the lookup also shows wallet, points, this month's data and recent payments.
function verified(store,sub,now){const start=new Date(now);start.setUTCDate(1);start.setUTCHours(0,0,0,0);let down=0,up=0;for(const x of store.sessionsOf(sub.username,start.getTime()))if((x.stoppedAt||x.updatedAt)>=start.getTime()){down+=Number(x.downloadBytes)||0;up+=Number(x.uploadBytes)||0;}
 const pays=store.list('subscriberPayments').filter(p=>p.subscriberId===sub.id).sort((a,b)=>(b.time||b.created)-(a.time||a.created)).slice(0,5).map(p=>({time:p.time||p.created,amount:p.amount,method:p.method}));
 return {verified:true,balance:sub.balance||0,points:sub.points||0,monthDown:down,monthUp:up,payments:pays};}
function account(store,query,now=Date.now(),pin=''){
 if(pin){const r=accountRaw(store,query,now);if(!r.found)return r;const sub=store.list('subscribers').find(s=>s.username===r.account),sec=store.secret('pin:'+sub?.id);if(!sec||String(pin)!==sec.pin)return {...r,pinError:'Wrong PIN'};return {...r,...verified(store,sub,now)};}
 return accountRaw(store,query,now);
}
function accountRaw(store,query,now=Date.now()){
 const raw=String(query??'').slice(0,400),cfg=get(store),prefix=cfg.accountPrefix||'KNE',subs=store.list('subscribers'),candidates=[];
 const token=new RegExp('\\b'+prefix+'[-\\s]?[A-Z0-9]{3,}\\b','i').exec(raw);if(token)candidates.push(token[0].toUpperCase().replace(/\s/,'-'));
 candidates.push(raw.trim());
 for(const c of candidates){const key=accountKey(c);if(!key)continue;const hit=subs.find(s=>s.username===c.toLowerCase().trim().replace(/\s+/g,' ')||accountKey(s.username)===key);if(hit)return summary(store,hit,now);}
 const phone=billing.phone(raw.trim());if(phone){const hits=subs.filter(s=>billing.phone(s.phone)===phone);if(hits.length===1)return {...summary(store,hits[0],now),...verified(store,hits[0],now)};}
 return {found:false};
}
// The router passes the device's MAC to the portal; an active or recent hotspot session from that device identifies the account.
function session(store,macValue,now=Date.now()){
 const m=mac(macValue);if(!m)return {found:false};
 const live=store.sessionsSince(now-15*60000).filter(x=>String(x.mac||'').toUpperCase().replace(/-/g,':')===m&&now-x.updatedAt<15*60000).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
 const sub=live?store.list('subscribers').find(s=>s.username===live.username):store.list('subscribers').find(s=>s.service==='hotspot'&&String(s.lastMac||'').toUpperCase().replace(/-/g,':')===m);
 return sub&&sub.service==='hotspot'?summary(store,sub,now):{found:false};
}
module.exports={THEMES,DEFAULTS,get,save,validate,account,session,mac};
