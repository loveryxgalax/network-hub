'use strict';
// Selling advert space on the WiFi page (ISPman's advertising plans and placed-ads board). A business picks a plan
// under "Advertise here" and sends its advert; staff confirm the payment, review the artwork and approve or turn it
// down. Payment, review and showing are separate steps: being paid never puts an advert live by itself. An order keeps
// a copy of the plan it was bought on, so later plan edits do not change it.
const engage=require('./engage.cjs');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const STATUSES=['awaiting-payment','paid-no-artwork','review','running','finished','declined'];
const txt=(v,max,label,req)=>{const s=String(v??'').trim();if(req&&!s)fail(label+' is required');if(s.length>max||/[<>\u0000-\u001f]/.test(s))fail(label+': up to '+max+' characters');return s;};
function savePlan(store,v,existing){const price=Number(v.price),days=Math.round(Number(v.days)),from=Math.round(Number(v.fromHour??0)),to=Math.round(Number(v.toHour??24));
 if(!(price>=1&&price<=1e6))fail('Enter a price');if(!(days>=1&&days<=365))fail('Duration is 1–365 days');if(!(from>=0&&from<=23&&to>=1&&to<=24&&from!==to))fail('Choose valid daily hours');
 const weekdays=(Array.isArray(v.weekdays)?v.weekdays:String(v.weekdays||'').split(',')).filter(x=>x!=='').map(Number).filter(d=>d>=0&&d<=6);
 const out={name:txt(v.name,60,'Name',true),description:txt(v.description,240,'Description'),price:Math.round(price),days,weekdays:[...new Set(weekdays)].sort(),fromHour:from,toHour:to,adsPerOrder:Math.max(1,Math.min(5,Math.round(Number(v.adsPerOrder)||1))),order:Math.round(Number(v.order)||0),offered:v.offered===true||v.offered==='on'||v.offered==='true'};
 return existing?store.put('adPlans',{...existing,...out},existing):store.put('adPlans',out);}
const schedule=p=>({days:p.weekdays.length?p.weekdays:[0,1,2,3,4,5,6],fromHour:p.fromHour,toHour:p.toHour});
function offered(store){return store.list('adPlans').filter(p=>p.offered).sort((a,b)=>a.order-b.order||a.price-b.price).map(p=>({id:p.id,name:p.name,description:p.description,price:p.price,days:p.days,weekdays:p.weekdays,fromHour:p.fromHour,toHour:p.toHour}));}
function artwork(v){const out={title:txt(v.title,60,'Advert title'),text:txt(v.text,240,'Advert text'),imageUrl:'',link:''};
 for(const k of ['imageUrl','link']){const s=String(v[k]||'').trim();if(!s)continue;let u;try{u=new URL(s);}catch{fail('Invalid '+(k==='link'?'website link':'image link'));}if(u.protocol!=='https:')fail((k==='link'?'Website':'Image')+' link must start with https://');out[k]=u.href.slice(0,500);}
 return out;}
const hasArt=o=>!!(o.title&&(o.text||o.imageUrl));
// From the WiFi page: no money is taken here.
function order(store,v,now=Date.now()){const billing=require('./billing.cjs'),p=store.get('adPlans',String(v.planId||''));if(!p||!p.offered)fail('Choose an advertising plan');
 const phone=billing.phone(v.phone);if(!phone)fail('Enter a phone number we can call');const email=String(v.email||'').trim().toLowerCase();if(email&&!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/.test(email))fail('Enter a valid email or leave it empty');
 const art=artwork(v),ref='AD'+String(store.list('adOrders').length+1).padStart(4,'0');
 return store.put('adOrders',{ref,planId:p.id,plan:{name:p.name,price:p.price,days:p.days,weekdays:p.weekdays,fromHour:p.fromHour,toHour:p.toHour},business:txt(v.business,80,'Business name',true),phone,email,...art,status:'awaiting-payment',createdAt:now,history:[{time:now,text:'Requested on the WiFi page'}]});}
function step(store,id,action,v,user,now=Date.now()){const o=store.get('adOrders',id);if(!o)fail('Order not found',404);const log=t=>[...(o.history||[]),{time:now,text:t,by:user?.name||''}];let next;
 if(action==='paid'){if(o.status!=='awaiting-payment')fail('Only an order awaiting payment can be marked paid',409);const reference=txt(v.reference,40,'Payment reference',true);next={...o,paymentRef:reference,paidAt:now,status:hasArt(o)?'review':'paid-no-artwork',history:log('Payment confirmed: '+reference)};}
 else if(action==='artwork'){if(!['awaiting-payment','paid-no-artwork','review'].includes(o.status))fail('The advert can no longer be changed',409);const art=artwork({...o,...v});next={...o,...art,status:o.status==='paid-no-artwork'&&hasArt(art)?'review':o.status,history:log('Advert updated')};}
 else if(action==='approve'){if(o.status!=='review')fail('Only a paid order with an advert can be approved',409);if(!hasArt(o))fail('The advert needs a title and text or an image',409);
  const start=v.startsAt?Date.parse(v.startsAt):now;if(!Number.isFinite(start))fail('Invalid start');const ad=engage.saveAd(store,{title:o.title,text:o.text,imageUrl:o.imageUrl,link:o.link,advertiser:o.business,active:true,from:start,until:start+o.plan.days*864e5,seconds:15});
  store.put('ads',{...ad,schedule:schedule(o.plan),orderId:o.id},ad);next={...o,status:'running',adId:ad.id,startsAt:start,endsAt:start+o.plan.days*864e5,history:log('Approved; showing from '+new Date(start).toISOString().slice(0,10))};}
 else if(action==='decline'){if(['running','finished','declined'].includes(o.status))fail('This order can no longer be turned down',409);const reason=txt(v.reason,200,'Reason',true);next={...o,status:'declined',declineReason:reason,history:log('Turned down: '+reason+(o.paidAt?' (paid — refund it)':''))};}
 else if(action==='finish'){if(o.status!=='running')fail('Only a running advert can be ended',409);const ad=o.adId&&store.get('ads',o.adId);if(ad)store.put('ads',{...ad,active:false,until:Math.min(ad.until||now,now)},ad);next={...o,status:'finished',endsAt:now,history:log('Ended early')};}
 else fail('Unknown action');return store.put('adOrders',next,o);}
// Running orders whose time is up become finished.
function sweep(store,now=Date.now()){for(const o of store.list('adOrders').filter(o=>o.status==='running'&&o.endsAt<=now))store.put('adOrders',{...o,status:'finished',history:[...(o.history||[]),{time:now,text:'Finished'}]},o);}
function board(store,now=Date.now()){sweep(store,now);const ads=new Map(store.list('ads').map(a=>[a.id,a]));
 return {plans:store.list('adPlans').sort((a,b)=>a.order-b.order||a.price-b.price),orders:store.list('adOrders').map(o=>({...o,views:ads.get(o.adId)?.views||0,clicks:ads.get(o.adId)?.clicks||0})),statuses:STATUSES};}
module.exports={savePlan,offered,order,step,sweep,board,STATUSES,schedule};
