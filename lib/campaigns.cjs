'use strict';
// Bulk SMS to a chosen group of subscribers. Sends slowly in the background (5 messages, then a pause) so the
// SMS provider is not flooded; the run can be cancelled and its progress is kept in the settings table.
const billing=require('./billing.cjs');
const SEGMENTS=['all','active','expired','expired7','expired30','expiring3','hotspot','pppoe','plan'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
let running=null;
function recipients(store,segment,planId,now=Date.now()){
 if(!SEGMENTS.includes(segment))fail('Choose who should receive this');
 const state=s=>s.status!=='active'?'suspended':s.expiresAt!=null&&s.expiresAt<=now?'expired':'active';
 const test={all:()=>true,active:s=>state(s)==='active',expired:s=>state(s)==='expired',expired7:s=>state(s)==='expired'&&now-s.expiresAt<=7*864e5,expired30:s=>state(s)==='expired'&&now-s.expiresAt<=30*864e5,expiring3:s=>state(s)==='active'&&s.expiresAt!=null&&s.expiresAt-now<=3*864e5,hotspot:s=>s.service==='hotspot',pppoe:s=>s.service==='pppoe',plan:s=>s.planId===planId}[segment];
 if(segment==='plan'&&!store.get('plans',String(planId||'')))fail('Choose a plan');
 const seen=new Set(),out=[];
 for(const s of store.list('subscribers')){const to=billing.phone(s.phone);if(!to||!test(s)||seen.has(to))continue;seen.add(to);out.push({id:s.id,to,name:s.name,username:s.username});}
 return out;
}
const message=v=>{const m=String(v||'').trim();if(!m||m.length>459)fail('The message must be 1–459 characters');return m;};
function preview(store,input,now=Date.now()){const list=recipients(store,input.segment,input.planId,now);return {count:list.length,sample:list.slice(0,3).map(r=>r.name)};}
function status(store){return store.setting('smsCampaign')||null;}
function start(store,input,user,fetchImpl=fetch,now=Date.now(),pause=3000){
 if(running)fail('A campaign is already sending',409);
 if(!store.secret('sms:config'))fail('Set up the SMS provider first');
 const text=message(input.message),list=recipients(store,input.segment,input.planId,now);if(!list.length)fail('Nobody with a phone number matches');
 if(input.confirm!==list.length)fail('Confirm the number of recipients ('+list.length+')');
 const run={id:now,startedAt:now,by:user?.name||'',segment:input.segment,message:text,total:list.length,sent:0,failed:0,state:'sending'};store.setting('smsCampaign',run);
 const token={cancel:false};
 running=(async()=>{try{
  for(let i=0;i<list.length&&!token.cancel;i++){
   const r=list[i];
   try{await billing.sendSms(store,r.to,billing.fill(text,{name:r.name,username:r.username}),'campaign',fetchImpl,Date.now());run.sent++;}catch{run.failed++;}
   store.setting('smsCampaign',run);
   if((i+1)%5===0&&pause)await new Promise(r=>setTimeout(r,pause));
  }
  run.state=token.cancel?'cancelled':'done';run.finishedAt=Date.now();store.setting('smsCampaign',run);
 }finally{running=null;}})();
 running.token=token;
 return {...run,done:running};
}
function cancel(){if(!running)fail('No campaign is sending',404);running.token.cancel=true;return {ok:true};}
module.exports={SEGMENTS,recipients,preview,start,cancel,status,isRunning:()=>!!running};
