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
const redeemed=(store,code)=>{const p=find(store,code);if(p)store.put('promoCodes',{...p,used:(p.used||0)+1},p);};
function list(store){return store.list('promoCodes').map(p=>({...p}));}
module.exports={validate,find,apply,redeemed,list,norm};
