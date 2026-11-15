'use strict';
// Browser regression tests (run where Playwright is installed; skipped otherwise, e.g. in CI without a browser):
//  * Extend refreshes the open customer profile (expired → active, active → later), shows no success on failure, and a
//    late answer never pulls the screen back to a customer you have left.
//  * Session history shows "Ended · no Stop received" for old unclosed sessions, not "Online".
//  * Router jobs never put a hotspot password in the page.
//  * Dashboard Online now: service split adds up to the total.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
let chromium=null;try{({chromium}=require('playwright'));}catch{}
const skip=chromium?false:'Playwright is not installed here';
test('customer profile, session history, router jobs and Online now in the browser',{skip,timeout:120000},async()=>{
 const {createApp}=require('../server.cjs'),radius=require('../lib/radius.cjs'),jobs=require('../lib/jobs.cjs');
 const app=createApp({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'bp-')),collector:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const o='http://127.0.0.1:'+app.server.address().port;
 const browser=await chromium.launch();
 try{const owner=await fetch(o+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',workspace:'QA',email:'bp@example.test',password:'fixture-owner-password-123'})});
  const cookie=owner.headers.get('set-cookie').split(';')[0],st=app.store,now=Date.now(),PW='Fixture-pw-4420';
  const r=st.put('devices',{name:'LAB-HEX',type:'router',ip:'10.5.0.1'});jobs.enroll(st,r.id);
  const plan=st.put('plans',radius.plan({name:'Lab Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:1,durationValue:1,durationUnit:'days'}));
  const expired=st.put('subscribers',radius.subscriber(st,{name:'Expired Eve',username:'qa-expired',service:'hotspot',planId:plan.id,routerId:r.id,expiresAt:now-3600000}));
  const active=st.put('subscribers',radius.subscriber(st,{name:'Active Ann',username:'qa-active',service:'hotspot',planId:plan.id,routerId:r.id,expiresAt:now+2*3600000}));
  radius.setPassword(st,expired.id,PW);
  // History for qa-active: one live session and one old one that never got a Stop.
  const acct=(t,kind,id,mac)=>radius.accounting(st,{'Acct-Status-Type':kind,'Acct-Session-Id':id,'NAS-IP-Address':'10.5.0.1','NAS-Identifier':'LAB-HEX','User-Name':'qa-active','Calling-Station-Id':mac,'Service-Type':'Login-User'},t);
  acct(now-5*3600000,'Start','old','AA:00:00:00:00:01');acct(now-2*60000,'Start','live','AA:00:00:00:00:02');
  st.put('routerJobs',{routerId:r.id,routerName:r.name,type:'connect',label:'Connect hotspot device',params:{username:'qa-expired',password:PW,mac:'AA:00:00:00:00:03',ip:'10.5.0.30'},status:'failed',attempts:3,maxAttempts:3,nextAttemptAt:now,createdAt:now,createdBy:'QA',output:'',error:'x'});
  const ctx=await browser.newContext({viewport:{width:1280,height:900}});await ctx.addCookies([{name:cookie.split('=')[0],value:cookie.split('=').slice(1).join('='),url:o}]);
  const pg=await ctx.newPage(),errors=[];pg.on('pageerror',e=>errors.push(e.message));
  const head=async()=>(await pg.locator('#cp-host .pf-head').innerText()).replace(/\s+/g,' ');
  const extend=async(step)=>{await pg.click('#cp-host [data-pf="extend"]');await pg.waitForSelector('#editor[open]');await pg.locator(`#editor label.ex-step:has(input[value="${step}"])`).click();await pg.fill('#editor input[name="reason"]','QA regression check');await pg.click('#editor [type=submit]');};
  const open=async id=>{await pg.goto(o+'/#customer?id='+id);await pg.waitForSelector(`#cp-host #pf-root[data-id="${id}"]`);};
  // 1. Expired → active, without a reload.
  await open(expired.id);assert.match(await head(),/Expired/i);
  await extend('1d');await pg.waitForFunction(()=>/Active/i.test(document.querySelector('#cp-host .pf-head')?.innerText||''),null,{timeout:10000});
  assert.ok(st.get('subscribers',expired.id).expiresAt>now+20*3600000);assert.match(await pg.evaluate(()=>document.querySelector('#toast')?.textContent||''),/Now ends/,'success message shown on success');assert.ok(!(await pg.locator('#editor[open]').count()),'form closed after success');
  // 2. Active account: the new expiry is shown at once.
  await open(active.id);const before=st.get('subscribers',active.id).expiresAt;await extend('1w');
  await pg.waitForFunction(b=>window.__pfData?.subscriber?.expiresAt>b,before,{timeout:10000});
  assert.equal((await pg.evaluate(()=>window.__pfData.subscriber.expiresAt)),st.get('subscribers',active.id).expiresAt);
  // 3. Failure: error in the form, no success message, nothing refreshed; one click = one request.
  let calls=0;await pg.route('**/extend',async rt=>{calls++;await new Promise(x=>setTimeout(x,300));await rt.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Simulated failure'})});});
  await pg.evaluate(()=>{const t=document.querySelector('#toast');if(t){t.textContent='';t.hidden=true;}});const shown=await pg.evaluate(()=>window.__pfData.subscriber.expiresAt);await pg.click('#cp-host [data-pf="extend"]');await pg.waitForSelector('#editor[open]');await pg.locator('#editor label.ex-step:has(input[value="1d"])').click();await pg.fill('#editor input[name="reason"]','QA failure check');
  await pg.click('#editor [type=submit]');await pg.keyboard.press('Enter').catch(()=>{});await pg.click('#editor [type=submit]',{force:true,timeout:500}).catch(()=>{});
  await pg.waitForFunction(()=>/Simulated failure/.test(document.querySelector('#editor-error')?.textContent||''),null,{timeout:5000});
  assert.equal(calls,1,'duplicate submissions are blocked while saving');
  assert.ok(!/Now ends/.test(await pg.evaluate(()=>document.querySelector('#toast')?.textContent||'')),'no success message on failure');
  assert.equal(await pg.evaluate(()=>window.__pfData.subscriber.expiresAt),shown);await pg.unroute('**/extend');await pg.keyboard.press('Escape');
  // 4. Leave for another customer while the save is still running: the late answer does not pull the page back.
  await pg.route('**/extend',async rt=>{await new Promise(x=>setTimeout(x,1500));await rt.continue();});
  await extend('1h');await pg.evaluate(()=>document.querySelector('#editor').close());await pg.evaluate(id=>{location.hash='customer?id='+id;},expired.id);
  await pg.waitForSelector(`#cp-host #pf-root[data-id="${expired.id}"]`);await pg.waitForTimeout(2500);
  assert.match(pg.url(),new RegExp(expired.id));assert.equal(await pg.getAttribute('#cp-host #pf-root','data-id'),expired.id,'still on the customer you moved to');await pg.unroute('**/extend');
  // 5. Session history: the live session is Online, the old unclosed one is not.
  await open(active.id);const hist=(await pg.locator('#cp-host').innerText());
  assert.match(hist,/Ended · no Stop received/);assert.equal((await pg.locator('#cp-host .cp-active tbody tr').count()),1,'one active session');
  // 6. Router jobs page: no password in the page.
  await pg.goto(o+'/#router-jobs');await pg.waitForSelector('text=Connect hotspot device');const html=await pg.content();assert.ok(!html.includes(PW),'password not in the DOM');assert.ok(html.includes('••••••'));
  // 7. Dashboard: Online now and its split agree.
  await pg.goto(o+'/#dashboard');await pg.waitForFunction(()=>/hotspot/.test(document.body.innerText)&&/Online now/i.test(document.body.innerText),null,{timeout:15000});
  const d=await pg.evaluate(async()=>{const r=await fetch('/api/overview?range=24h',{credentials:'include'});return r.ok?r.json():null;});
  assert.ok(d?.online,'overview has the reconciled online block');assert.equal(d.online.byService.hotspot+d.online.byService.pppoe,d.online.total);assert.equal(d.online.total,1,'only the live session of qa-active');
  assert.match(await pg.locator('.kd2-kpi, [data-kpi="online"], body').first().innerText(),/1 hotspot · 0 PPPoE/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();app.server.close();}
});
