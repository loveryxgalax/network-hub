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
// Customer chat (WiFi page and account page): a chat is a ticket the customer holds a private token for. The customer
// sees their own messages and the team's replies (never internal notes) and can keep writing in the same thread.
const crypto=require('node:crypto'),tokenHash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
function chatOf(store,token){if(typeof token!=='string'||token.length<20||token.length>80)return null;const h=tokenHash(token);return store.list('tickets').find(t=>t.chatHash===h)||null;}
function chatStart(store,{who,phone,text,subscriberId,customer,conn},now=Date.now()){const token=crypto.randomBytes(24).toString('base64url');
 return store.transaction(()=>{const t=store.put('tickets',{title:'Chat: '+who,category:'Chat',details:text+(phone?'\n\nPhone: '+phone:'')+(conn?'\n'+conn:''),priority:'Normal',status:'Open',customer,subscriberId:subscriberId||'',source:'chat',chatHash:tokenHash(token),phone:phone||'',lastCustomerAt:now});
  store.put('ticketMessages',{ticketId:t.id,kind:'reply',from:'customer',text,author:'Customer',authorId:'',time:now});return {token,ticket:t};});}
function chatView(store,token){const t=chatOf(store,token);if(!t)fail('This chat has ended. Start a new one.',404);
 return {status:t.status||'Open',messages:thread(store,t.id).filter(m=>m.kind==='reply').map(m=>({from:m.from==='customer'?'customer':'team',text:m.text,time:m.time,id:m.id}))};}
function chatSend(store,token,text,now=Date.now()){const t=chatOf(store,token);if(!t)fail('This chat has ended. Start a new one.',404);const body=String(text||'').trim();if(body.length<1)fail('Write a message');if(body.length>1000)fail('Keep it under 1,000 characters');
 return store.transaction(()=>{const reopen=['Resolved','Closed'].includes(t.status);store.put('tickets',{...t,lastCustomerAt:now,...(reopen?{status:'Open'}:{})},t);if(reopen)store.put('ticketMessages',{ticketId:t.id,kind:'event',text:'Customer wrote again: reopened',author:'',authorId:'',time:now});
  return store.put('ticketMessages',{ticketId:t.id,kind:'reply',from:'customer',text:body,author:'Customer',authorId:'',time:now});});}
module.exports={STATUSES,PRIORITIES,detail,post,update,thread,chatStart,chatView,chatSend,chatOf};
