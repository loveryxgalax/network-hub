'use strict';
// What a hotspot customer can do from the WiFi page without typing a password, based on the device they are on:
// connect straight away when their package is still running, connect with an M-Pesa code, and see their usage.
// Logins are only ever handed out as a CHAP response (never the plain password), and every lookup is rate limited by the caller.
const landing=require('./landing.cjs'),portal=require('./portal.cjs'),radius=require('./radius.cjs');
const norm=m=>landing.mac(m)||'';
const live=(s,now)=>s.status==='active'&&(s.expiresAt==null||s.expiresAt>now);
function byMac(store,macValue,now=Date.now()){
 const m=norm(macValue);if(!m)return null;
 const hit=store.sessionsSince(now-15*60000).filter(x=>norm(x.mac)===m&&now-x.updatedAt<15*60000).sort((a,b)=>b.updatedAt-a.updatedAt)[0];
 const subs=store.list('subscribers').filter(s=>s.service==='hotspot');
 return (hit&&subs.find(s=>s.username===hit.username))||subs.find(s=>norm(s.lastMac)===m)||null;}
const chapOnly=input=>{if(!(typeof input.chapId==='string'&&input.chapId&&typeof input.chapChallenge==='string'&&input.chapChallenge)){const e=new Error('Open this page from the WiFi network to connect');e.status=400;throw e;}};
function active(store,macValue,now=Date.now()){
 const s=byMac(store,macValue,now);if(!s||!live(s,now))return {found:false};
 const p=store.get('plans',s.planId);return {found:true,account:s.username,plan:p?.name||'',planId:s.planId,expiresAt:s.expiresAt??null,left:s.expiresAt==null?null:s.expiresAt-now};}
function connectNow(store,input,now=Date.now()){
 chapOnly(input);const s=byMac(store,input.mac,now);if(!s||!live(s,now)){const e=new Error('No active package found for this device');e.status=404;throw e;}
 return portal.login(store,{username:s.username,password:radius.password(store,s.id),chapId:input.chapId,chapChallenge:input.chapChallenge});}
// "Connect with M-Pesa code": the confirmation code from an M-Pesa payment that credited a hotspot account.
function codeLogin(store,input,now=Date.now()){
 chapOnly(input);const code=String(input.code||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(code.length<8||code.length>14){const e=new Error('Enter the M-Pesa confirmation code, like UK3IF0TW26');e.status=400;throw e;}
 let sub=null;
 for(const p of store.list('subscriberPayments'))if(String(p.reference||'').toUpperCase().replace(/[^A-Z0-9]/g,'')===code){sub=store.get('subscribers',p.subscriberId);break;}
 if(!sub)for(const p of store.list('portalPayments'))if(p.status==='paid'&&String(p.mpesaReceipt||'').toUpperCase()===code){sub=store.list('subscribers').find(s=>s.id===p.subscriberId||s.username===p.username)||null;break;}
 if(!sub||sub.service!=='hotspot'||!live(sub,now)){const e=new Error('We could not connect with that code. It may be wrong, or the package has ended.');e.status=404;throw e;}
 return portal.login(store,{username:sub.username,password:radius.password(store,sub.id),chapId:input.chapId,chapChallenge:input.chapChallenge});}
const mask=r=>{const t=String(r||'');return t.length>5?'•'.repeat(t.length-4)+t.slice(-4):t;};
function usage(store,macValue,now=Date.now()){
 const s=byMac(store,macValue,now);if(!s)return {found:false};
 const all=store.sessionsOf(s.username,0),ses=all.map(x=>({start:x.startedAt||x.updatedAt,end:x.stoppedAt||x.updatedAt,down:Number(x.downloadBytes)||0,up:Number(x.uploadBytes)||0,open:!x.stoppedAt&&now-x.updatedAt<=15*60000})).sort((a,b)=>b.start-a.start);
 const since=now-30*86400000,sum=(f,t)=>ses.filter(x=>x.start>=f&&x.start<t).reduce((a,x)=>({down:a.down+x.down,up:a.up+x.up}),{down:0,up:0});
 const pays=store.list('subscriberPayments').filter(p=>p.subscriberId===s.id).map(p=>({time:p.time||p.created,amount:p.amount,ref:mask(p.reference),plan:p.planName||''})).sort((a,b)=>b.time-a.time);
 const asc=[...pays].reverse(),connects=asc.map((p,i)=>{const end=asc[i+1]?.time??now+1,u=sum(p.time,end);return {time:p.time,plan:p.plan,amount:p.amount,down:u.down,up:u.up,status:i===asc.length-1&&live(s,now)?'active':'expired'};}).reverse();
 const tot=ses.reduce((a,x)=>({down:a.down+x.down,up:a.up+x.up}),{down:0,up:0}),l30=sum(since,now+1);
 const lo=require('./billing.cjs').loyalty(store);return {found:true,account:s.username,points:s.points||0,loyalty:{enabled:!!lo.enabled,pointValue:lo.pointValue},wallet:s.balance||0,total:tot,last30:l30,payments:pays.slice(0,60),connects:connects.slice(0,60),sessions:ses.slice(0,60)};}
function redeem(store,input){const s=byMac(store,input.mac);if(!s){const e=new Error('We could not find your account on this device');e.status=404;throw e;}
 const saved=require('./billing.cjs').redeemPoints(store,s.id,s.points||0);return {points:saved.points||0,wallet:saved.balance||0};}
module.exports={redeem,active,connectNow,codeLogin,usage,byMac};
