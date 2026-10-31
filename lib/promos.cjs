'use strict';
// Promo codes customers can enter at checkout: a percentage off, a fixed amount off, or bonus days on top of the package.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const norm=v=>String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function validate(input,existing={}){
 const v={...existing,...input},code=norm(v.code);if(!/^[A-Z0-9]{3,20}$/.test(code))fail('Use 3–20 letters or numbers for the code');
 const type=['percent','amount','days'].includes(v.type)?v.type:fail('Choose percent, amount or bonus days'),value=Number(v.value);
 if(!(value>0)||(type==='percent'&&value>100)||(type==='days'&&(value>365||!Number.isInteger(value)))||value>1e6)fail(type==='percent'?'A percentage is between 1 and 100':type==='days'?'Bonus days: a whole number up to 365':'Enter an amount');
 const maxUses=Math.max(0,Math.round(Number(v.maxUses)||0)),validUntil=v.validUntil?Number(v.validUntil):null;if(validUntil!==null&&!Number.isFinite(validUntil))fail('Invalid end date');
 return {code,type,value,maxUses,validUntil,planId:String(v.planId||''),scope:['hotspot','account','both'].includes(v.scope)?v.scope:'both',note:String(v.note||'').slice(0,120),active:v.active!==false,used:Number(existing.used)||0};
}
const find=(store,code)=>store.list('promoCodes').find(p=>p.code===norm(code));
// Returns the checkout amount for a plan, or throws a customer-friendly error.
function apply(store,code,{plan,kind,price},now=Date.now()){
 const p=find(store,code);if(!p||!p.active)fail('That promo code is not valid');
 if(p.validUntil&&now>p.validUntil)fail('That promo code has expired');if(p.maxUses&&p.used>=p.maxUses)fail('That promo code has been fully used');
 if(p.planId&&p.planId!==plan.id)fail('That promo code is not for this package');if(p.scope!=='both'&&p.scope!==kind)fail('That promo code does not apply here');
 let amount=price,bonusDays=0;if(p.type==='percent')amount=Math.max(1,Math.ceil(price*(1-p.value/100)));else if(p.type==='amount')amount=Math.max(1,Math.ceil(price-p.value));else bonusDays=p.value;
 return {promoId:p.id,code:p.code,amount:Math.min(amount,price),discount:Math.max(0,price-amount),bonusDays};
}
// Counts a use and records who used it (one row per payment reference, so a repeated callback is not counted twice).
function redeemed(store,code,who={}){const p=find(store,code);if(!p)return;if(who.reference&&store.list('promoActivations').some(a=>a.promoId===p.id&&a.reference===who.reference))return;
 store.transaction(()=>{const cur=store.get('promoCodes',p.id);store.put('promoCodes',{...cur,used:(cur.used||0)+1,lastUsedAt:Date.now()},cur);
  store.put('promoActivations',{promoId:p.id,code:p.code,campaignId:p.campaignId||'',subscriberId:who.subscriberId||'',username:who.username||'',name:who.name||'',amount:Number(who.amount)||0,discount:Number(who.discount)||0,reference:String(who.reference||''),time:Date.now()});});}
// Campaigns (ISPman's promo campaigns): many single codes sharing a prefix, discount and per-code activation limit.
const ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function campaignInput(v,existing={}){const x={...existing,...v},title=String(x.title||'').trim();if(!title||title.length>80||/[<>]/.test(title))fail('Give the campaign a title (up to 80 characters)');
 const discount=Math.round(Number(x.discount));if(!(discount>=1&&discount<=100))fail('Discount is 1–100%');
 const color=c=>/^#[0-9a-fA-F]{6}$/.test(String(c||''))?String(c).toLowerCase():null;
 const maxActivations=x.maxActivations===''||x.maxActivations==null?0:Math.round(Number(x.maxActivations));if(!(maxActivations>=0&&maxActivations<=100000))fail('Activations per code: 0 (unlimited) or more');
 return {title,description:String(x.description||'').trim().slice(0,300),colorA:color(x.colorA)||'#0032fd',colorB:color(x.colorB)||'#00b4d8',discount,maxActivations,active:x.active!==false&&x.active!=='false',
  scope:['hotspot','account','both'].includes(x.scope)?x.scope:'both',planId:String(x.planId||''),validUntil:x.validUntil?Number(x.validUntil):null};}
function createCampaign(store,v,user){const c=campaignInput(v),prefix=norm(v.prefix);if(prefix.length>8)fail('Prefix: up to 8 letters or numbers');const count=Math.round(Number(v.count));if(!(count>=1&&count<=500))fail('Make 1–500 codes');
 if(c.validUntil!==null&&!Number.isFinite(c.validUntil))fail('Invalid end date');const taken=new Set(store.list('promoCodes').map(p=>p.code)),codes=[];
 while(codes.length<count){let k=prefix;for(let i=0;i<6;i++)k+=ALPHA[require('node:crypto').randomInt(ALPHA.length)];if(!taken.has(k)){taken.add(k);codes.push(k);}}
 return store.transaction(()=>{const camp=store.put('campaigns',{...c,prefix,count,createdBy:user?.name||''});
  for(const code of codes)store.put('promoCodes',{code,type:'percent',value:c.discount,maxUses:c.maxActivations,validUntil:c.validUntil,planId:c.planId,scope:c.scope,note:'Campaign: '+c.title,active:c.active,used:0,campaignId:camp.id});
  return {campaign:camp,codes};});}
function campaignStats(store,camp){const codes=store.list('promoCodes').filter(p=>p.campaignId===camp.id),used=codes.reduce((a,p)=>a+(p.used||0),0),available=codes.filter(p=>p.active&&(!p.maxUses||p.used<p.maxUses)).length,usedCodes=codes.filter(p=>p.used>0).length;
 return {...camp,totalCodes:codes.length,used,usedCodes,available,usage:codes.length?Math.round(usedCodes/codes.length*1000)/10:0};}
function campaigns(store){return store.list('campaigns').map(c=>campaignStats(store,c));}
function campaign(store,id){const c=store.get('campaigns',id);if(!c)fail('Campaign not found',404);return {campaign:campaignStats(store,c),codes:store.list('promoCodes').filter(p=>p.campaignId===id).sort((a,b)=>(b.used||0)-(a.used||0)||a.code.localeCompare(b.code)),activations:store.list('promoActivations').filter(a=>a.campaignId===id).sort((a,b)=>b.time-a.time)};}
// Editing changes the campaign and its codes for future use; past activations stay as they were.
function updateCampaign(store,id,v){const c=store.get('campaigns',id);if(!c)fail('Campaign not found',404);const next=campaignInput(v,c);
 return store.transaction(()=>{const saved=store.put('campaigns',{...c,...next},c);for(const p of store.list('promoCodes').filter(p=>p.campaignId===id))store.put('promoCodes',{...p,value:next.discount,maxUses:next.maxActivations,active:next.active,validUntil:next.validUntil},p);return campaignStats(store,saved);});}
function list(store){return store.list('promoCodes').map(p=>({...p}));}
module.exports={validate,find,apply,redeemed,list,norm,createCampaign,campaigns,campaign,updateCampaign};
