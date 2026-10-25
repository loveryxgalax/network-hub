'use strict';
// Revenue and growth for the Reports page, from recorded payments (cash, bank and M-Pesa) and subscriber records.
const day=t=>new Date(t+3*36e5).toISOString().slice(0,10); // Nairobi calendar day
function build(store,days=30,now=Date.now()){
 days=Math.max(1,Math.min(365,Math.round(Number(days))||30));
 const from=now-days*864e5,plans=new Map(store.list('plans').map(p=>[p.id,p])),subs=new Map(store.list('subscribers').map(s=>[s.id,s]));
 const pays=store.list('subscriberPayments').filter(p=>(p.time||p.created)>=from);
 const byDay=new Map(),byPlan=new Map(),byMethod=new Map();let total=0;
 for(let i=days-1;i>=0;i--)byDay.set(day(now-i*864e5),0);
 for(const p of pays){const t=p.time||p.created,a=Number(p.amount)||0,s=subs.get(p.subscriberId),plan=plans.get(s?.planId)?.name||'Other';
  total+=a;if(byDay.has(day(t)))byDay.set(day(t),byDay.get(day(t))+a);byPlan.set(plan,(byPlan.get(plan)||0)+a);byMethod.set(p.method||'other',(byMethod.get(p.method||'other')||0)+a);}
 const sorted=m=>[...m].map(([name,amount])=>({name,amount:Math.round(amount*100)/100})).sort((a,b)=>b.amount-a.amount);
 const newSubs=[...subs.values()].filter(s=>s.created>=from);
 return {days,total:Math.round(total*100)/100,count:pays.length,average:pays.length?Math.round(total/pays.length*100)/100:0,
  perDay:[...byDay].map(([date,amount])=>({date,amount:Math.round(amount*100)/100})),byPlan:sorted(byPlan),byMethod:sorted(byMethod),
  newCustomers:newSubs.length,newHotspot:newSubs.filter(s=>s.service==='hotspot').length,newPppoe:newSubs.filter(s=>s.service==='pppoe').length};
}
module.exports={build};
