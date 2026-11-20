'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),pn=require('../lib/payername.cjs');
const mk=()=>new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'pn-')),'db.sqlite'));
test('payer names: tidy, only replace the automatic Hotspot 07… name',()=>{
 assert.equal(pn.pretty('254712345678 - JOHN DOE KAMAU'),'John Doe Kamau');assert.equal(pn.pretty('MAURINE'),'Maurine');assert.equal(pn.pretty("BRIAN O'NEIL"),"Brian O'Neil");assert.equal(pn.pretty('254712345678'),'');
 const st=mk(),plan=st.put('plans',radius.plan({name:'P',service:'hotspot',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'hours'}));
 const a=st.put('subscribers',radius.subscriber(st,{name:'Hotspot 0794196289',username:'kne-a1',service:'hotspot',planId:plan.id,phone:'0794196289'}));
 const b=st.put('subscribers',radius.subscriber(st,{name:'Grace Wanjiru',username:'kne-b1',service:'hotspot',planId:plan.id,phone:'0700000001'}));
 st.put('c2bPayments',{transId:'TKA1',amount:1,payer:'MAURINE',status:'credited',subscriberId:a.id});st.put('c2bPayments',{transId:'TKA2',amount:1,payer:'OTHER NAME',status:'credited',subscriberId:b.id});
 assert.equal(pn.backfill(st),1);assert.equal(st.get('subscribers',a.id).name,'Maurine');assert.equal(st.get('subscribers',b.id).name,'Grace Wanjiru');assert.equal(pn.backfill(st),0);
});
test('STK payer name comes from the Transaction Status result, once per receipt, only with B2C set up',async()=>{
 const st=mk(),plan=st.put('plans',radius.plan({name:'P',service:'hotspot',downloadMbps:5,uploadMbps:5,price:10,durationValue:1,durationUnit:'hours'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Hotspot 0702805605',username:'kne-q1',service:'hotspot',planId:plan.id,phone:'0702805605'}));
 st.put('portalPayments',{status:'paid',provider:'mpesa',receipt:'TKQ9XY12AB',subscriberId:s.id,paidAt:Date.now(),kind:'hotspot'});
 const calls=[];const fake=async(url,opt)=>{calls.push(url);if(/oauth/.test(url))return {ok:true,status:200,json:async()=>({access_token:'t',expires_in:3599}),text:async()=>JSON.stringify({access_token:'t',expires_in:'3599'})};return {ok:true,status:200,json:async()=>({ConversationID:'AG_1',OriginatorConversationID:'OC_1',ResponseCode:'0'}),text:async()=>JSON.stringify({ConversationID:'AG_1',OriginatorConversationID:'OC_1',ResponseCode:'0'})};};
 assert.equal(await pn.lookup(st,'https://netops.example',fake),0,'no B2C initiator: nothing asked');
 require('../lib/mpesa.cjs');st.secret('mpesa:config',{env:'sandbox',type:'paybill',shortcode:'505958',consumerKey:'k',consumerSecret:'s',passkey:'p',callbackSecret:'c'});
 st.secret('mpesa:b2c',{initiatorName:'api',shortcode:'505958',securityCredential:'x'.repeat(120),commandId:'BusinessPayment',resultSecret:'a'.repeat(36)});
 assert.equal(await pn.lookup(st,'https://netops.example',fake),1);assert.ok(calls.some(u=>/transactionstatus/.test(u)));
 assert.equal(await pn.lookup(st,'https://netops.example',fake),0,'each receipt is asked once');
 pn.result(st,{Result:{ResultCode:0,ConversationID:'AG_1',OriginatorConversationID:'OC_1',ResultParameters:{ResultParameter:[{Key:'DebitPartyName',Value:'254702805605 - BRIAN OTIENO'},{Key:'ReceiptNo',Value:'TKQ9XY12AB'}]}}});
 assert.equal(st.get('subscribers',s.id).name,'Brian Otieno');
});
