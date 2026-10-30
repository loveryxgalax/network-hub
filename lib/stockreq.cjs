'use strict';
// Stock requests: field staff ask for items, a manager approves, and issuing takes the items out of stock.
// Issued items are costed first-in-first-out from the receipts (stock movements with a unit cost).
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const moves=(store,stockId)=>store.list('stockMoves').filter(m=>m.stockId===stockId).sort((a,b)=>(a.created||0)-(b.created||0)||(a.seq||0)-(b.seq||0));
function onHand(store,stockId){return moves(store,stockId).reduce((a,m)=>a+Number(m.quantity||0),0);}
// Remaining receipt batches after all issues so far, oldest first.
function batches(store,stockId){const item=store.get('stock',stockId),out=[];let used=0;
 for(const m of moves(store,stockId)){const q=Number(m.quantity||0);if(q>0)out.push({quantity:q,unitCost:m.unitCost!=null?Number(m.unitCost):Number(item?.unitCost||0),at:m.created});else used+=-q;}
 for(const b of out){const take=Math.min(b.quantity,used);b.quantity-=take;used-=take;}return out.filter(b=>b.quantity>0);}
function fifoCost(store,stockId,quantity){let need=quantity,cost=0;for(const b of batches(store,stockId)){const take=Math.min(b.quantity,need);cost+=take*b.unitCost;need-=take;if(!need)break;}if(need>0)fail('Not enough in stock',409);return Math.round(cost*100)/100;}
function receive(store,{stockId,quantity,unitCost,reason},user){const item=store.get('stock',String(stockId||''));if(!item)fail('Item not found',404);const q=Number(quantity),c=unitCost===''||unitCost==null?Number(item.unitCost||0):Number(unitCost);
 if(!(q>0&&q<=1e7))fail('Enter the quantity received');if(!(c>=0&&c<=1e8))fail('Enter the unit cost');return store.put('stockMoves',{stockId:item.id,quantity:q,unitCost:c,reason:String(reason||'Received').slice(0,200),by:user?.email||null});}
function request(store,{stockId,quantity,reason,jobId},user){const item=store.get('stock',String(stockId||''));if(!item)fail('Choose an item',404);const q=Number(quantity);if(!(Number.isInteger(q)&&q>0&&q<=10000))fail('Enter a whole quantity');
 const why=String(reason||'').trim();if(why.length<3)fail('Say what it is for');if(jobId&&!store.get('jobs',jobId))fail('Work order not found',404);
 return store.put('stockRequests',{stockId:item.id,itemName:item.name,quantity:q,reason:why.slice(0,200),jobId:jobId||'',status:'requested',requestedBy:user?.email||null,requestedById:user?.id||null,requestedAt:Date.now()});}
function decide(store,id,action,user,note=''){return store.transaction(()=>{const r=store.get('stockRequests',id);if(!r)fail('Request not found',404);
 if(action==='reject'){if(r.status!=='requested')fail('Already '+r.status,409);return store.put('stockRequests',{...r,status:'rejected',decidedBy:user?.email,decidedAt:Date.now(),note:String(note).slice(0,160)},r);}
 if(action==='approve'){if(r.status!=='requested')fail('Already '+r.status,409);if(onHand(store,r.stockId)<r.quantity)fail(`Only ${onHand(store,r.stockId)} in stock`,409);return store.put('stockRequests',{...r,status:'approved',decidedBy:user?.email,decidedAt:Date.now()},r);}
 if(action==='issue'){if(r.status!=='approved')fail('Approve it first',409);const cost=fifoCost(store,r.stockId,r.quantity);
  const move=store.put('stockMoves',{stockId:r.stockId,quantity:-r.quantity,reason:'Issued: '+r.reason,requestId:r.id,cost,by:user?.email||null,to:r.requestedBy});
  return store.put('stockRequests',{...r,status:'issued',issuedBy:user?.email,issuedAt:Date.now(),cost,moveId:move.id},r);}
 fail('Unknown action');});}
function overview(store){const items=store.list('stock').map(s=>{const q=onHand(store,s.id),b=batches(store,s.id);return {id:s.id,name:s.name,unit:s.unit||'',minimum:s.minimum||0,onHand:q,value:Math.round(b.reduce((a,x)=>a+x.quantity*x.unitCost,0)*100)/100,low:q<=(s.minimum||0)};});
 return {items,requests:store.list('stockRequests').sort((a,b)=>b.requestedAt-a.requestedAt).slice(0,300)};}
module.exports={onHand,batches,fifoCost,receive,request,decide,overview};
