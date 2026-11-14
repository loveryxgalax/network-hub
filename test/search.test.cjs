'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),radius=require('../lib/radius.cjs'),{search}=require('../lib/search.cjs');
const mk=()=>new Store(fs.mkdtempSync(path.join(os.tmpdir(),'se-')));
const admin={id:'a',role:'admin'};
function seed(){const st=mk(),now=Date.now();
 const p=st.put('plans',radius.plan({name:'Home 10',service:'pppoe',downloadMbps:10,uploadMbps:5,price:2000,durationValue:30,durationUnit:'days'}));
 const s=st.put('subscribers',radius.subscriber(st,{name:'Wanjiku Kamau',username:'wanjiku',password:'topsecretpass',phone:'0712345678',service:'pppoe',planId:p.id,expiresAt:now+1e9}));
 st.put('subscriberPayments',{subscriberId:s.id,username:'wanjiku',name:'Wanjiku Kamau',amount:2000,reference:'TKA1B2C3D4',method:'M-Pesa',phone:'254712345678'});
 st.put('devices',{name:'Fibre ONT',type:'cpe',serial:'HWTC0A1B2C3D',macAddress:'aa:bb:cc:dd:ee:01',subscriberId:s.id});
 st.put('vouchers',{code:'VX7Q2',status:'unused'});
 st.put('radiusSessions',{username:'wanjiku',ip:'10.20.0.9',mac:'AA:BB:CC:DD:EE:01',service:'pppoe'});
 return {st,s};}
test('finds customers by name, phone in any form, payments by receipt, devices by serial or MAC, vouchers and live IPs',()=>{
 const {st,s}=seed(),g=(q,u=admin)=>Object.fromEntries(search(st,q,u).groups.map(x=>[x.kind,x]));
 assert.equal(g('wanji').subscribers.items[0].hash,'customer?id='+s.id);
 assert.ok(g('+254 712 345 678').subscribers,'international phone finds the 07… customer');
 assert.ok(g('0712345678').subscriberPayments,'local phone finds the 2547… payment');
 assert.ok(g('tka1b2').subscriberPayments);
 assert.ok(g('hwtc0a1b').devices);
 assert.ok(g('AA-BB-CC-DD-EE-01').devices,'MAC typed with dashes');
 assert.ok(g('vx7q2').vouchers);
 assert.ok(g('10.20.0.9').radiusSessions);
 assert.equal(g('Home 10').plans.items[0].hash,'pp-packages');
});
test('never matches on passwords and hides money from roles without access',()=>{
 const {st}=seed();
 assert.equal(search(st,'topsecretpass',admin).total,0);
 assert.equal(search(st,'tka1b2',{id:'t',role:'network-technician'}).total,0);
 const inst=search(st,'wanjiku',{id:'i',role:'installer'});assert.ok(!inst.groups.some(x=>x.kind==='subscribers'));
 assert.equal(search(st,'a',admin).total,0,'single characters are ignored');
});
