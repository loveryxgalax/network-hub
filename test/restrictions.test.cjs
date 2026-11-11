'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),rx=require('../lib/restrictions.cjs'),trash=require('../lib/trash.cjs');
const mk=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'rx-')));
test('a ban is permanent: login refused, its devices blocked, kept on record with who and why, and can be lifted',()=>{
 const st=mk(),now=Date.now(),admin={id:'a',email:'owner@example.test',name:'Owner'};
 const p=st.put('plans',radius.plan({name:'Day',service:'hotspot',downloadMbps:5,uploadMbps:5,price:50,durationValue:1,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Mallory',username:'mal',service:'hotspot',planId:p.id,phone:'0712000000',expiresAt:now+864e5}));radius.setPassword(st,s.id,'pass1234');
 st.put('subscribers',{...st.get('subscribers',s.id),lastMac:'aa-bb-cc-00-00-01'},st.get('subscribers',s.id));
 st.put('radiusSessions',{username:'mal',mac:'AA:BB:CC:00:00:02',service:'hotspot',updatedAt:now});
 assert.throws(()=>rx.ban(st,s.id,{reason:'',user:admin}),/Say why/);
 const r=rx.ban(st,s.id,{reason:'Fraud: reversed payments',user:admin,now});
 assert.deepEqual(r.blocked.sort(),['AA:BB:CC:00:00:01','AA:BB:CC:00:00:02']);
 assert.equal(radius.stateOf(st.get('subscribers',s.id)),'suspended');
 const l=rx.list(st);assert.equal(l.counts.banned,1);assert.equal(l.banned[0].reason,'Fraud: reversed payments');assert.equal(l.banned[0].by,'Owner');
 assert.equal(l.devices.length,2);assert.ok(l.devices.every(d=>d.viaBan&&d.customer.username==='mal'));
 assert.throws(()=>rx.ban(st,s.id,{reason:'again',user:admin}),/already banned/);
 const u=rx.ban(st,s.id,{unban:true,user:admin});assert.equal(u.unblocked.length,2);assert.equal(st.get('subscribers',s.id).banned,undefined);assert.equal(rx.list(st).counts.devices,0);
 // Deactivated and deleted accounts show up in the same register.
 const d=st.put('subscribers',radius.subscriber(st,{name:'Dan',username:'dan',service:'hotspot',planId:p.id,expiresAt:now+864e5}));st.put('subscribers',{...st.get('subscribers',d.id),status:'suspended',deactivatedReason:'Asked to pause'},st.get('subscribers',d.id));
 const e=st.put('subscribers',radius.subscriber(st,{name:'Eve',username:'eve',service:'hotspot',planId:p.id,expiresAt:now+864e5}));trash.remove(st,e,admin);
 const l2=rx.list(st);assert.equal(l2.counts.deleted,1);assert.equal(l2.deleted[0].username,'eve');assert.equal(l2.counts.deactivated,1);assert.equal(l2.deactivated[0].reason,'Asked to pause');
});
