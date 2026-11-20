'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),ins=require('../lib/insights.cjs');
const DAY=864e5,mk=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'in-')));
const plan=(st,o)=>st.put('plans',radius.plan({name:'P',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days',...o}));
// One RADIUS session per day with the given MB.
function sessions(st,user,mbPerDay,now){mbPerDay.forEach((mb,i)=>{const t=now-(mbPerDay.length-1-i)*DAY-36e5;const id='s'+user+i;
 st.db.prepare("INSERT INTO records(kind,id,body,created,updated) VALUES('radiusSessions',?,?,?,?)").run(id,JSON.stringify({username:user,sessionId:id,startedAt:t-36e5,stoppedAt:t,updatedAt:t,downloadBytes:mb*1e6,uploadBytes:0}),t,t);});}
test('churn: a PPPoE customer whose use collapsed near expiry is flagged; a steady one is not',()=>{
 const st=mk(),now=Date.now(),p=plan(st,{});
 const a=st.put('subscribers',radius.subscriber(st,{name:'Ann',username:'ann',phone:'0712345678',service:'pppoe',planId:p.id,expiresAt:now+5*DAY}));
 const b=st.put('subscribers',radius.subscriber(st,{name:'Ben',username:'ben',service:'pppoe',planId:p.id,expiresAt:now+5*DAY}));
 sessions(st,'ann',[...Array(21).fill(1500),...Array(7).fill(200)],now);sessions(st,'ben',Array(28).fill(1500),now);
 const c=ins.churn(st,now);assert.deepEqual(c.map(x=>x.username),['ann']);assert.ok(c[0].dropPct>=80);assert.match(c[0].reason,/fell/);});
test('win-back: a hotspot regular who stopped buying is listed; an active one is not',()=>{
 const st=mk(),now=Date.now(),p=plan(st,{service:'hotspot',durationValue:1,durationUnit:'days',price:50});
 const a=st.put('subscribers',radius.subscriber(st,{name:'Amy',username:'amy',phone:'0712345678',service:'hotspot',planId:p.id,expiresAt:now-10*DAY}));
 const b=st.put('subscribers',radius.subscriber(st,{name:'Bo',username:'bo',service:'hotspot',planId:p.id,expiresAt:now+DAY}));
 for(let i=0;i<4;i++){st.put('subscriberPayments',{subscriberId:a.id,amount:50,time:now-(12+i)*DAY});st.put('subscriberPayments',{subscriberId:b.id,amount:50,time:now-i*DAY});}
 const w=ins.winback(st,now);assert.deepEqual(w.map(x=>x.username),['amy']);assert.match(w[0].reason,/4 packages/);});
test('capacity: busiest 10 minutes against the uplink, and an alert opens and closes',()=>{
 const st=mk(),now=Date.now(),r=st.put('devices',{name:'Core',type:'router',uplinkMbps:100});
 const obs=[1,2,3,4,5,6,7,8,9,10].map(i=>({key:'ppp:u'+i,lastObserved:now,evidence:{ppp:{name:'u'+i}},trafficHistory:[{time:now-36e5,downloadMbps:9.5,uploadMbps:1},{time:now-2*36e5,downloadMbps:2,uploadMbps:1}]}));
 st.setting('customerDiscovery:'+r.id,{observations:obs});
 const c=ins.capacity(st,now)[0];assert.equal(c.peakMbps,95);assert.equal(c.peakPct,95);assert.equal(c.level,'critical');
 ins.raiseAlerts(st,now);assert.equal(st.list('alerts').filter(a=>a.logKey==='capacity'&&a.status==='Open').length,1);
 st.put('devices',{...st.get('devices',r.id),uplinkMbps:1000},st.get('devices',r.id));ins.raiseAlerts(st,now);assert.equal(st.list('alerts').filter(a=>a.logKey==='capacity'&&a.status==='Open').length,0,'closes when there is room again');});
test('fibre: a falling ONU signal and a weak TR-069 ONT are flagged, a good one is not',()=>{
 const st=mk(),now=Date.now(),olt=st.put('devices',{name:'OLT',type:'olt'});
 const bad=st.put('devices',{name:'ONU-A',type:'onu',parentId:olt.id,serial:'HWTC1'}),good=st.put('devices',{name:'ONU-B',type:'onu',parentId:olt.id,serial:'HWTC2'});
 const ins_=(id,t,power)=>st.db.prepare('INSERT INTO measurements(device_id,time,online,body) VALUES(?,?,?,?)').run(id,t,1,JSON.stringify({power}));
 for(let d=14;d>=8;d--){ins_(bad.id,now-d*DAY,-21);ins_(good.id,now-d*DAY,-20);}ins_(bad.id,now-36e5,-24.5);ins_(good.id,now-36e5,-20.2);
 for(let h=0;h<4;h++)ins.recordSignal(st,[{id:'acs-1',rxPower:-27.5,serial:'ZTE1',model:'F660',ppp:[]}],now-(4-h)*2*36e5);
 const f=ins.fibre(st,now);assert.deepEqual(f.map(x=>x.name).sort(),['F660','ONU-A']);
 assert.equal(f.find(x=>x.name==='ONU-A').fall,3.5);assert.equal(f.find(x=>x.name==='F660').level,'critical');
 ins.raiseAlerts(st,now);assert.equal(st.list('alerts').filter(a=>a.logKey==='fibre-signal'&&a.status==='Open').length,1,'alert for the OLT ONU (TR-069 rows have no device record)');});
test('messages: churn check-in includes the account link; contacting again within 14 days needs force',async()=>{
 const st=mk(),now=Date.now(),p=plan(st,{}),s=st.put('subscribers',radius.subscriber(st,{name:'Ann Lee',username:'ann',phone:'0712345678',service:'pppoe',planId:p.id}));
 assert.match(ins.text(st,'churn',s,'https://x/s/abc'),/^Hi Ann, .*https:\/\/x\/s\/abc$/);
 await ins.contact(st,'churn',s.id,{origin:'https://netops.example.test'},now).catch(()=>{});
 st.put('subscribers',{...st.get('subscribers',s.id),insight:{churn:now}},st.get('subscribers',s.id));
 await assert.rejects(()=>ins.contact(st,'churn',s.id,{},now+DAY),/14 days/);});
