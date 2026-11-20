'use strict';
// Support ticket conversation (ISPman's ticket detail): replies on the customer's thread and internal notes that only
// staff see, plus status, priority and assignment changes. Every change is kept in the thread as a system line.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const STATUSES=['Open','In progress','Pending','Resolved','Closed'],PRIORITIES=['Low','Normal','High','Urgent'];
function thread(store,ticketId){return store.list('ticketMessages').filter(m=>m.ticketId===ticketId).sort((a,b)=>a.time-b.time||(a.seq||0)-(b.seq||0));}
function detail(store,id){const t=store.get('tickets',id);if(!t)fail('Ticket not found',404);const msgs=thread(store,id);
 return {ticket:t,replies:msgs.filter(m=>m.kind==='reply'),notes:msgs.filter(m=>m.kind==='note'),events:msgs.filter(m=>m.kind==='event'),
  customer:t.subscriberId?(({id,name,username,phone,service})=>({id,name,username,phone:phone||'',service}))(store.get('subscribers',t.subscriberId)||{}):null};}
function post(store,id,{text,internal},user,now=Date.now()){const t=store.get('tickets',id);if(!t)fail('Ticket not found',404);
 const body=String(text||'').trim();if(!body)fail('Write something first');if(body.length>2000)fail('Keep it under 2,000 characters');
 return store.put('ticketMessages',{ticketId:id,kind:internal?'note':'reply',text:body,author:user?.name||'',authorId:user?.id||'',time:now});}
function update(store,id,input,user,team,now=Date.now()){const t=store.get('tickets',id);if(!t)fail('Ticket not found',404);const next={...t},changes=[];
 if(input.status!==undefined&&input.status!==t.status){if(!STATUSES.includes(input.status))fail('Unknown status');next.status=input.status;changes.push('Status: '+(t.status||'Open')+' → '+input.status);}
 if(input.priority!==undefined&&input.priority!==t.priority){if(!PRIORITIES.includes(input.priority))fail('Unknown priority');next.priority=input.priority;changes.push('Priority: '+(t.priority||'Normal')+' → '+input.priority);}
 if(input.assigneeId!==undefined&&input.assigneeId!==(t.assigneeId||'')){const to=input.assigneeId?team.find(u=>u.id===input.assigneeId&&u.active):null;if(input.assigneeId&&!to)fail('Choose an active team member');next.assigneeId=to?.id||'';changes.push(to?'Assigned to '+to.name:'Unassigned');}
 if(!changes.length)return {ticket:t,changes};
 const saved=store.transaction(()=>{const s=store.put('tickets',next,t);for(const [i,c] of changes.entries())store.put('ticketMessages',{ticketId:id,kind:'event',seq:i,text:c,author:user?.name||'',authorId:user?.id||'',time:now});return s;});
 return {ticket:saved,changes};}
module.exports={STATUSES,PRIORITIES,detail,post,update,thread};
