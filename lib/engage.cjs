'use strict';
// Adverts and quizzes on the WiFi page. An advert can just be shown (views and clicks are counted) or can earn
// free minutes after it has been on screen for its full time; a quiz earns free minutes for a right answer.
// Each device (MAC) can earn once per advert or quiz per day, and gets one quiz attempt per day.
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const day=now=>new Date(now+3*36e5).toISOString().slice(0,10);
const macOf=v=>{const m=String(v||'').toUpperCase().replace(/[^0-9A-F]/g,'');return m.length===12?m:null;};
const txt=(v,max,label,required)=>{const s=String(v??'').trim();if(required&&!s)fail('Enter the '+label);if(s.length>max||/[\u0000-\u001f<>]/.test(s))fail('Invalid '+label);return s;};
const url=(v,label)=>{const s=String(v||'').trim();if(!s)return '';let u;try{u=new URL(s);}catch{fail('Invalid '+label);}if(u.protocol!=='https:')fail(label+' must start with https://');return u.href.slice(0,500);};
const date=v=>{if(v===''||v==null)return null;const t=typeof v==='number'?v:Date.parse(v);if(!Number.isFinite(t))fail('Invalid date');return t;};
function earn(store,v){const on=v?.enabled===true||v?.enabled==='on';if(!on)return {enabled:false};const plan=store.get('plans',String(v.planId||''));if(!plan||plan.service==='pppoe')fail('Choose the hotspot package whose speed the free minutes use');
 const minutes=Math.round(Number(v.minutes));if(!(minutes>=1&&minutes<=240))fail('Free minutes must be 1–240');return {enabled:true,planId:plan.id,minutes};}
function saveAd(store,v,existing){const seconds=Math.round(Number(v.seconds??existing?.seconds??15));if(!(seconds>=5&&seconds<=120))fail('Viewing time must be 5–120 seconds');
 const out={title:txt(v.title,60,'title',true),text:txt(v.text,240,'text'),imageUrl:url(v.imageUrl,'Image link'),link:url(v.link,'Advertiser link'),advertiser:txt(v.advertiser,60,'advertiser'),
  active:v.active===true||v.active==='on',from:date(v.from),until:date(v.until),weight:Math.max(1,Math.min(10,Math.round(Number(v.weight)||1))),seconds,earn:earn(store,v.earn)};
 if(out.from&&out.until&&out.until<=out.from)fail('The end must be after the start');
 return existing?store.put('ads',{...existing,...out},existing):store.put('ads',{...out,views:0,clicks:0,earned:0});}
// Picture questions (as in ISPman): each answer may have an https image; with no right answer ("which drink do you
// like?") any pick earns the time and the picks are counted.
function saveQuiz(store,v,existing){const raw=Array.isArray(v.options)?v.options:String(v.options||'').split('\n').map(line=>{const [t,img]=line.split('|');return {text:t,image:img};});
 const parsed=raw.map(o=>typeof o==='string'?{text:o}:o).map(o=>({text:txt(o.text,80,'answer'),image:url(o.image,'Answer image')})).filter(o=>o.text||o.image);
 if(parsed.length<2||parsed.length>6)fail('Give 2 to 6 answers');if(parsed.some(o=>!o.text))fail('Each answer needs a label, even with a picture');
 const options=parsed.map(o=>o.text),images=parsed.map(o=>o.image||''),opinion=v.answer==='any'||v.answer===-1||v.answer==='-1';
 const answer=opinion?-1:Math.round(Number(v.answer));if(!opinion&&!(answer>=0&&answer<options.length))fail('Mark which answer is right, or choose "No right answer"');
 const e=earn(store,{...v.earn,enabled:true});const out={question:txt(v.question,200,'question',true),options,images:images.some(Boolean)?images:[],answer,active:v.active===true||v.active==='on',earn:e};if(existing&&JSON.stringify(existing.options)!==JSON.stringify(options))out.picks=[];
 return existing?store.put('quizzes',{...existing,...out},existing):store.put('quizzes',{...out,attempts:0,correct:0});}
const live=(x,now)=>x.active&&(!x.from||x.from<=now)&&(!x.until||x.until>now);
// What the WiFi page shows: up to two adverts (weighted pick) and one quiz, without the right answer.
function forPortal(store,now=Date.now()){const ads=store.list('ads').filter(a=>live(a,now)),pick=[];const pool=[...ads];
 while(pick.length<2&&pool.length){const total=pool.reduce((n,a)=>n+a.weight,0);let r=Math.random()*total;const i=pool.findIndex(a=>(r-=a.weight)<0);pick.push(pool.splice(i<0?0:i,1)[0]);}
 const quizzes=store.list('quizzes').filter(q=>q.active),q=quizzes.length?quizzes[Math.floor(now/864e5)%quizzes.length]:null;
 return {ads:pick.map(a=>({id:a.id,title:a.title,text:a.text,imageUrl:a.imageUrl,hasLink:!!a.link,advertiser:a.advertiser,earn:a.earn.enabled?{seconds:a.seconds,minutes:a.earn.minutes}:null})),quiz:q?{id:q.id,question:q.question,options:q.options,images:q.images||[],minutes:q.earn.minutes}:null};}
function key(store){let k=store.secret('engage:key');if(!k){k={k:crypto.randomBytes(32).toString('hex')};store.secret('engage:key',k);}return k.k;}
// A view returns a signed ticket; claiming free minutes needs a ticket at least the advert's time old.
function view(store,adId,now=Date.now()){const a=store.get('ads',adId);if(!a||!live(a,now))fail('Advert not found',404);store.put('ads',{...a,views:(a.views||0)+1},a);
 const body=adId+'.'+now;return {ticket:body+'.'+crypto.createHmac('sha256',key(store)).update(body).digest('hex').slice(0,32)};}
function click(store,adId){const a=store.get('ads',adId);if(!a||!a.link)fail('Not found',404);store.put('ads',{...a,clicks:(a.clicks||0)+1},a);return a.link;}
function once(store,kind,id,mac,now){const log=store.setting('engageLog')||{},k=`${kind}:${id}:${mac}:${day(now)}`;if(log[k])return false;log[k]=now;const today=day(now);for(const x of Object.keys(log))if(!x.endsWith(today)&&now-log[x]>2*864e5)delete log[x];store.setting('engageLog',log);return true;}
function claimAd(store,grant,adId,{ticket,mac,chapId,chapChallenge},now=Date.now()){const a=store.get('ads',adId);if(!a||!live(a,now)||!a.earn.enabled)fail('This advert does not give free minutes',404);
 const m=macOf(mac);if(!m)fail('Open this page from the WiFi network to get free minutes');const [id,at,sig]=String(ticket||'').split('.');
 if(id!==adId||!sig||crypto.createHmac('sha256',key(store)).update(id+'.'+at).digest('hex').slice(0,32)!==sig)fail('Watch the advert first');
 if(now-Number(at)<a.seconds*1000-500)fail('Keep watching a little longer');if(now-Number(at)>15*60000)fail('Watch the advert again');
 if(!once(store,'ad',adId,m,now))fail('This device already got free minutes from this advert today',429);
 const plan=store.get('plans',a.earn.planId);if(!plan)fail('The package for this advert was removed',409);store.put('ads',{...a,earned:(a.earned||0)+1},a);
 return grant(store,{plan,minutes:a.earn.minutes,mac:m,label:'Ad',kind:'ad',chapId,chapChallenge},now);}
function answer(store,grant,quizId,{choice,mac,chapId,chapChallenge},now=Date.now()){const q=store.get('quizzes',quizId);if(!q||!q.active)fail('Quiz not found',404);
 const m=macOf(mac);if(!m)fail('Open this page from the WiFi network to answer');if(!once(store,'quiz',quizId,m,now))fail('This device already answered today. Come back tomorrow.',429);
 const c=Math.round(Number(choice));if(!(c>=0&&c<q.options.length))fail('Choose an answer');const right=q.answer===-1||c===q.answer,picks=q.options.map((_,i)=>(q.picks?.[i]||0)+(i===c?1:0));store.put('quizzes',{...q,picks,attempts:(q.attempts||0)+1,correct:(q.correct||0)+(right?1:0)},q);const ql=store.setting('quizLog')||{items:[]};ql.items=[{time:now,quizId:q.id,choice:c,right},...ql.items].slice(0,20000);store.setting('quizLog',ql);if(!right)return {correct:false};
 const plan=store.get('plans',q.earn.planId);if(!plan)fail('The package for this quiz was removed',409);return {correct:true,...grant(store,{plan,minutes:q.earn.minutes,mac:m,label:'Quiz',kind:'quiz',chapId,chapChallenge},now)};}
// Quiz results for the last N days: attempts, passed (or answered, for questions with no right answer), and how
// many got online (passed and the free session was granted).
function results(store,days=30,now=Date.now()){const since=now-days*864e5,items=(store.setting('quizLog')?.items||[]).filter(x=>x.time>=since),quizzes=new Map(store.list('quizzes').map(q=>[q.id,q]));
 const per=new Map();for(const x of items){const q=quizzes.get(x.quizId),r=per.get(x.quizId)||{id:x.quizId,question:q?.question||'(removed)',options:q?.options||[],answer:q?.answer,attempts:0,passed:0,picks:(q?.options||[]).map(()=>0)};r.attempts++;if(x.right)r.passed++;if(r.picks[x.choice]!=null)r.picks[x.choice]++;per.set(x.quizId,r);}
 const passed=items.filter(x=>x.right).length;return {days,attempts:items.length,passed,passRate:items.length?Math.round(passed/items.length*100):0,quizzes:[...per.values()].sort((a,b)=>b.attempts-a.attempts)};}
module.exports={results,saveAd,saveQuiz,forPortal,view,click,claimAd,answer};
