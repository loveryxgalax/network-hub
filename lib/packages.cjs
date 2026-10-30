'use strict';
// Package policy beyond name/speed/price: burst, fair-usage (FUP), purchase windows, visibility, expiry notices.
// Every field is optional and defaults to "off", so packages saved before these settings keep working unchanged.
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const NAIROBI=3*36e5;
const on=v=>v===true||v==='true'||v==='on'||v==='1';
const num=(v,label,min,max,dflt=0)=>{if(v===''||v==null)return dflt;const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)fail('Invalid '+label);return n;};
const NOTICES=[2,5,10,15,30,60,1440,10080];
function policy(v,base){
 const features=(Array.isArray(v.features)?v.features:String(v.features||'').split(/\r?\n|,/)).map(s=>String(s).trim()).filter(Boolean);
 if(features.length>8||features.some(f=>f.length>60||/[<>\u0000-\u001f]/.test(f)))fail('Up to 8 features, each up to 60 characters');
 const b=v.burst||{},burst={enabled:on(b.enabled)};
 if(burst.enabled){burst.upMbps=num(b.upMbps,'burst upload',0.064,10000);burst.downMbps=num(b.downMbps,'burst download',0.064,10000);burst.thresholdUpMbps=num(b.thresholdUpMbps,'upload threshold',0.064,10000);burst.thresholdDownMbps=num(b.thresholdDownMbps,'download threshold',0.064,10000);burst.seconds=Math.round(num(b.seconds,'burst averaging time',1,3600,8));
  if(burst.upMbps<=base.uploadMbps||burst.downMbps<=base.downloadMbps)fail('The burst limit must be higher than the normal speed');
  if(burst.thresholdUpMbps>base.uploadMbps||burst.thresholdDownMbps>base.downloadMbps)fail('The burst threshold must not be higher than the normal speed');}
 const f=v.fup||{},fup={enabled:on(f.enabled)};
 if(fup.enabled){fup.period=f.period==='daily'?'daily':'package';fup.downCapMB=Math.round(num(f.downCapMB,'download cap',0,1e8));fup.upCapMB=Math.round(num(f.upCapMB,'upload cap',0,1e8));fup.timeCapMinutes=Math.round(num(f.timeCapMinutes,'online-time cap',0,525600));
  fup.afterDownMbps=num(f.afterDownMbps,'speed after the cap (download)',0.064,10000);fup.afterUpMbps=num(f.afterUpMbps,'speed after the cap (upload)',0.064,10000);
  if(!fup.downCapMB&&!fup.upCapMB&&!fup.timeCapMinutes)fail('Set a data cap or an online-time cap (0 means unlimited)');
  if(fup.afterDownMbps>=base.downloadMbps||fup.afterUpMbps>=base.uploadMbps)fail('The speed after the cap must be lower than the normal speed');
  // Adaptive steps: further caps that slow the customer down more (each needs a bigger cap and a lower speed).
  fup.tiers=[];let prevCap=fup.downCapMB,prevDown=fup.afterDownMbps,prevUp=fup.afterUpMbps;
  for(const t of (Array.isArray(f.tiers)?f.tiers:[]).slice(0,2)){if(!t||t.downCapMB===''||t.downCapMB==null||Number(t.downCapMB)===0)continue;const cap=Math.round(num(t.downCapMB,'step cap',1,1e8)),d=num(t.afterDownMbps,'step download speed',0.064,10000),u=num(t.afterUpMbps,'step upload speed',0.064,10000);
   if(!prevCap||cap<=prevCap)fail('Each extra step needs a bigger download cap than the one before');if(d>prevDown||u>prevUp)fail('Each extra step must be slower than the one before');fup.tiers.push({downCapMB:cap,afterDownMbps:d,afterUpMbps:u});prevCap=cap;prevDown=d;prevUp=u;}}
 const w=v.window||{},window={hours:on(w.hours),days:on(w.days)};
 if(window.hours){window.fromHour=Math.round(num(w.fromHour,'start hour',0,23));window.toHour=Math.round(num(w.toHour,'end hour',0,24));if(window.fromHour===window.toHour)fail('The purchase hours cannot start and end at the same hour');}
 if(window.days){window.weekdays=[...new Set((Array.isArray(w.weekdays)?w.weekdays:String(w.weekdays||'').split(',')).map(Number).filter(d=>Number.isInteger(d)&&d>=0&&d<=6))].sort();if(!window.weekdays.length)fail('Choose at least one day');}
 const n=v.notices||{},notices={usage:[...new Set((Array.isArray(n.usage)?n.usage:String(n.usage||'').split(',')).map(Number).filter(x=>[50,80,100].includes(x)))].sort((a,b)=>a-b),expired:on(n.expired),before:[...new Set((Array.isArray(n.before)?n.before:String(n.before||'').split(',')).map(Number).filter(m=>NOTICES.includes(m)))].sort((a,b)=>a-b)};
 const routerIds=[...new Set((Array.isArray(v.routerIds)?v.routerIds:String(v.routerIds||'').split(',')).map(String).filter(Boolean))].slice(0,50);
 return {routerIds,features,popular:on(v.popular),hidden:on(v.hidden),order:Math.round(num(v.order,'order',0,9999,0)),idleTimeoutMinutes:Math.round(num(v.idleTimeoutMinutes,'idle timeout',0,1440)),interimSeconds:Math.round(num(v.interimSeconds,'accounting interval',0,3600)),burst,fup,window,notices};
}
// Can this package be bought right now? Purchase windows use Nairobi time and never stop a package already bought.
function buyable(p,now=Date.now()){
 if(p.active===false)return {ok:false,reason:'This package is not on sale'};
 const w=p.window||{},d=new Date(now+NAIROBI),h=d.getUTCHours(),day=d.getUTCDay();
 if(w.hours){const inside=w.fromHour<w.toHour?h>=w.fromHour&&h<w.toHour:h>=w.fromHour||h<w.toHour;if(!inside)return {ok:false,reason:`Available between ${String(w.fromHour).padStart(2,'0')}:00 and ${String(w.toHour%24).padStart(2,'0')}:00`};}
 if(w.days&&!w.weekdays.includes(day))return {ok:false,reason:'Available on '+w.weekdays.map(x=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][x]).join(', ')};
 return {ok:true};
}
// RouterOS rate string: rx/tx [burst-rx/burst-tx threshold-rx/threshold-tx time-rx/time-tx], customer upload first.
const mbit=v=>v>=1?(Math.round(v*100)/100)+'M':Math.round(v*1000)+'k';
function rateLimit(p,{fupActive=false,downMbps,upMbps}={}){
 if(downMbps!=null&&(downMbps!==p.downloadMbps||upMbps!==p.uploadMbps))return `${mbit(upMbps)}/${mbit(downMbps)}`;
 if(fupActive&&p.fup?.enabled)return `${mbit(p.fup.afterUpMbps)}/${mbit(p.fup.afterDownMbps)}`;
 const base=`${mbit(p.uploadMbps)}/${mbit(p.downloadMbps)}`,b=p.burst;
 return b?.enabled?`${base} ${mbit(b.upMbps)}/${mbit(b.downMbps)} ${mbit(b.thresholdUpMbps)}/${mbit(b.thresholdDownMbps)} ${b.seconds}/${b.seconds}`:base;
}
const dayStart=t=>{const d=new Date(t+NAIROBI);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-NAIROBI;};
// Usage inside the customer's current paid period, from RADIUS accounting.
function periodUsage(store,s,periodMs,now=Date.now(),fromOverride=null){
 const from=fromOverride??(s.expiresAt!=null?s.expiresAt-periodMs:now-periodMs);let down=0,up=0,seconds=0;
 for(const x of store.list('radiusSessions')){if(x.username!==s.username)continue;const end=x.stoppedAt||x.updatedAt;if(end<from)continue;down+=Number(x.downloadBytes)||0;up+=Number(x.uploadBytes)||0;seconds+=Math.max(0,((x.stoppedAt||x.updatedAt)-Math.max(x.startedAt||end,from))/1000);}
 return {from,down,up,seconds};
}
function fupState(store,s,p,periodMs,now=Date.now()){
 if(!p.fup?.enabled)return {active:false,downMbps:p.downloadMbps,upMbps:p.uploadMbps};const f=p.fup,MB=1048576;
 const u=f.period==='daily'?periodUsage(store,s,periodMs,now,Math.max(dayStart(now),s.expiresAt!=null?s.expiresAt-periodMs:0)):periodUsage(store,s,periodMs,now);
 const reasons=[];if(f.downCapMB&&u.down>=f.downCapMB*MB)reasons.push('download cap');if(f.upCapMB&&u.up>=f.upCapMB*MB)reasons.push('upload cap');if(f.timeCapMinutes&&u.seconds>=f.timeCapMinutes*60)reasons.push('online-time cap');
 let downMbps=reasons.length?f.afterDownMbps:p.downloadMbps,upMbps=reasons.length?f.afterUpMbps:p.uploadMbps,step=reasons.length?1:0;
 for(const [i,t] of (f.tiers||[]).entries())if(u.down>=t.downCapMB*MB){downMbps=t.afterDownMbps;upMbps=t.afterUpMbps;step=i+2;}
 if(step>1)reasons.push('step '+step);
 return {active:reasons.length>0,reasons,usage:u,downMbps,upMbps,step,percent:f.downCapMB?Math.round(u.down/(f.downCapMB*MB)*100):null};
}
function restrictions(p){const r=[];const w=p.window||{};if(w.hours)r.push(`${String(w.fromHour).padStart(2,'0')}:00–${String(w.toHour%24).padStart(2,'0')}:00`);if(w.days)r.push(w.weekdays.map(x=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][x]).join('/'));if(p.fup?.enabled)r.push('FUP');if(p.burst?.enabled)r.push('Burst');if(p.hidden)r.push('Hidden');if(p.active===false)r.push('Off sale');return r;}
module.exports={policy,buyable,rateLimit,fupState,periodUsage,restrictions,NOTICES};
