'use strict';
// Upgrade suggestions learned from each customer's own use. Nothing is sent unless staff press Send, or turn on
// automatic offers (off by default; one offer per customer per 30 days at most).
//  PPPoE:   how often the line runs at its full speed (router traffic samples every 10 minutes, last 7 days) and how many
//           devices sit behind the customer's router (TR-069 host count, when the router is on the ACS).
//  Hotspot: what the customer spent on short packages in the last 30 days compared with a longer package, and how much
//           data they use per day.
const radius=require('./radius.cjs'),packages=require('./packages.cjs');
const DAY=864e5,FULL=0.85;
const planMs=p=>radius.planMs(p);
const buyable=(p,now)=>p.active!==false&&!p.hidden&&!p.trial?.enabled&&packages.buyable(p,now).ok;
function bare(store,n){try{return radius.stripRealm(store,String(n||''));}catch{return String(n||'').toLowerCase();}}
// username -> 10-minute download samples (Mbps) from every router's reports.
function traffic(store){const out=new Map();
 for(const r of store.list('devices').filter(d=>d.type==='router'))for(const o of store.setting('customerDiscovery:'+r.id)?.observations||[]){
  const n=o.evidence?.ppp?.name;if(!n||!o.trafficHistory?.length)continue;const u=bare(store,n);out.set(u,[...(out.get(u)||[]),...o.trafficHistory]);}
 return out;}
// username -> latest and peak number of devices behind the customer's router (from the ACS host count).
function hostsOf(store,subId){const h=store.setting('cpeHosts')||{};const rows=Object.values(h).filter(x=>x.subscriberId===subId).flatMap(x=>x.points||[]);
 if(!rows.length)return null;const last=rows.sort((a,b)=>b.time-a.time)[0];return {now:last.count,peak:Math.max(...rows.map(x=>x.count)),time:last.time};}
function pppoe(store,s,plan,samples,now){
 const recent=(samples||[]).filter(x=>x.time>now-7*DAY);if(recent.length<12)return null;
 const full=recent.filter(x=>x.downloadMbps>=plan.downloadMbps*FULL),share=full.length/recent.length,hours=Math.round(full.length/6*10)/10;
 const days=new Set(full.map(x=>new Date(x.time+3*36e5).toISOString().slice(0,10))).size,hosts=hostsOf(store,s.id);
 if(!(hours>=3&&days>=2))return null;
 const up=store.list('plans').filter(p=>p.service==='pppoe'&&buyable(p,now)&&p.downloadMbps>plan.downloadMbps&&p.price>=plan.price).sort((a,b)=>a.downloadMbps-b.downloadMbps||a.price-b.price)[0];
 const why=`Ran at full speed (${plan.downloadMbps} Mbps) for about ${hours} h on ${days} of the last 7 days`+(hosts?`, ${hosts.now} device${hosts.now===1?'':'s'} on their router now (peak ${hosts.peak})`:'');
 return {score:Math.round(hours*10+(hosts?.peak||0)*5),reason:why,suggest:up||null,detail:{fullHours:hours,fullDays:days,sharePct:Math.round(share*100),devices:hosts}};}
function hotspot(store,s,plan,now){
 const pays=store.list('subscriberPayments').filter(p=>p.subscriberId===s.id&&!p.reversedAt&&(p.time||p.created)>now-30*DAY);if(pays.length<3)return null;
 const spent=pays.reduce((a,p)=>a+(Number(p.amount)||0),0),cur=planMs(plan),first=Math.min(...pays.map(p=>p.time||p.created)),span=Math.max(7*DAY,Math.min(30*DAY,now-first+DAY));
 // A longer package that would have cost less than what they actually spent over the same time.
 const best=store.list('plans').filter(p=>p.service!=='pppoe'&&p.service!=='static'&&buyable(p,now)&&planMs(p)>cur&&p.downloadMbps>=plan.downloadMbps*0.99)
  .map(p=>{const covered=Math.min(30*DAY,planMs(p)),spentSame=spent*covered/span;return {p,save:Math.round(spentSame-p.price)};})
  .filter(x=>x.save>0).sort((a,b)=>b.save-a.save)[0];
 let gb=0;try{const u=require('./usage.cjs').summary(store,s,now);gb=(u.last30.down+u.last30.up)/1e9;}catch{}
 if(!best&&gb<15)return null;
 const faster=!best&&store.list('plans').filter(p=>p.service!=='pppoe'&&p.service!=='static'&&buyable(p,now)&&p.downloadMbps>plan.downloadMbps&&Math.abs(planMs(p)-cur)<DAY).sort((a,b)=>a.downloadMbps-b.downloadMbps)[0];
 const reason=`Bought ${pays.length} packages for KES ${Math.round(spent)} in ${Math.round(span/DAY)} days`+(gb>=1?`, used ${Math.round(gb*10)/10} GB`:'')+(best?`. ${best.p.name} would have saved about KES ${best.save}`:'');
 return {score:Math.round(pays.length*5+gb+(best?.save||0)/10),reason,suggest:best?.p||faster||null,save:best?.save||0,detail:{purchases:pays.length,spent:Math.round(spent),gb:Math.round(gb*10)/10}};}
function suggestions(store,now=Date.now()){const t=traffic(store),plans=new Map(store.list('plans').map(p=>[p.id,p])),out=[];
 for(const s of store.list('subscribers')){if(s.parentId||s.service==='static'||s.status!=='active')continue;const plan=plans.get(s.planId);if(!plan)continue;
  const r=s.service==='pppoe'?pppoe(store,s,plan,t.get(String(s.username).toLowerCase()),now):hotspot(store,s,plan,now);if(!r||!r.suggest)continue;
  out.push({id:s.id,name:s.name,username:s.username,phone:s.phone||'',service:s.service,plan:plan.name,planPrice:plan.price,planMbps:plan.downloadMbps,...r,suggest:{id:r.suggest.id,name:r.suggest.name,price:r.suggest.price,downMbps:r.suggest.downloadMbps,duration:r.suggest.durationValue+' '+r.suggest.durationUnit},lastOffer:s.upsellAt||null});}
 return out.sort((a,b)=>b.score-a.score);}
function settings(store){return {auto:false,template:'',...(store.setting('upsellSettings')||{})};}
function message(store,x,link){const first=String(x.name||'').split(' ')[0]||'there',cfg=settings(store);
 const def=x.service==='pppoe'?`Hi {first}, your {plan} internet is often running at its full speed. {next} gives you {speed} Mbps for KES {price}. Upgrade here: {link}`
  :`Hi {first}, you bought {count} WiFi packages this month. {next} (KES {price}) covers you longer{save}. Get it here: {link}`;
 return (cfg.template||def).replace(/\{first\}/g,first).replace(/\{plan\}/g,x.plan).replace(/\{next\}/g,x.suggest.name).replace(/\{speed\}/g,String(x.suggest.downMbps)).replace(/\{price\}/g,String(x.suggest.price))
  .replace(/\{count\}/g,String(x.detail?.purchases||'')).replace(/\{save\}/g,x.save?` and saves about KES ${x.save}`:'').replace(/\{link\}/g,link).slice(0,459);}
// Send one offer by SMS (the link is shortened by sendSms). Records the time so a customer gets at most one per 30 days.
async function offer(store,id,{origin,force=false,user}={},now=Date.now()){const x=suggestions(store,now).find(y=>y.id===id);if(!x)throw Object.assign(new Error('No upgrade suggestion for this customer right now'),{status:404});
 const s=store.get('subscribers',id);if(!force&&s.upsellAt&&now-s.upsellAt<30*DAY)throw Object.assign(new Error('This customer had an offer in the last 30 days'),{status:409});
 const billing=require('./billing.cjs');if(!billing.phone(s.phone))throw Object.assign(new Error('This customer has no valid phone number'),{status:400});
 const link=x.service==='pppoe'&&origin?origin+'/portal/account.html?t='+require('./selfservice.cjs').token(store,s,now):(origin?origin+'/portal/':'');
 const r=await billing.sendSms(store,s.phone,message(store,x,link),'upsell');const cur=store.get('subscribers',id);store.put('subscribers',{...cur,upsellAt:now,upsellPlanId:x.suggest.id},cur);
 store.audit(user||{id:'system'},`Upgrade offer (${x.suggest.name}) sent to ${s.username}`,id);return {sent:r?.status==='sent',detail:r?.detail||'',suggestion:x};}
// Daily, when automatic offers are on: the best candidates who have not had an offer in 30 days (at most 20 a day).
async function autoRun(store,origin,now=Date.now()){if(!settings(store).auto||process.env.NETWORK_PASSIVE==='1')return [];const done=[];
 for(const x of suggestions(store,now).filter(y=>y.phone&&(!y.lastOffer||now-y.lastOffer>=30*DAY)).slice(0,20)){try{await offer(store,x.id,{origin},now);done.push(x.id);}catch{}}
 return done;}
module.exports={suggestions,offer,autoRun,settings,message,traffic};
