'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../lib/oltpresets.cjs'),snmp=require('../lib/snmp.cjs');
test('every built-in mapping is accepted by the SNMP mapping validator, and vendors are known by enterprise number',()=>{
 for(const [id,p] of Object.entries(P.PRESETS))if(p.mapping)assert.doesNotThrow(()=>snmp.profile(JSON.stringify(p.mapping)),id);
 assert.equal(P.presetFromSysObjectId('1.3.6.1.4.1.2011.2.248'),'huawei');assert.equal(P.presetFromSysObjectId('.1.3.6.1.4.1.3902.1082.1001'),'zte');
 assert.equal(P.presetFromSysObjectId('1.3.6.1.4.1.14988.1'),null,'a MikroTik is not an OLT preset');
 assert.equal(P.list().length,6);
});
test('finds the ONU serial column, its state column and a name column in an unknown OLT walk',()=>{
 const base='1.3.6.1.4.1.37950.1.1.5.12.1',vb=[];const hex=['485754431A2B3C4D','5A54454700112233','56534F4C00AABBCC'];
 const ifx=['268501248','268501504'];let i=0;
 for(const p of ifx)for(const onu of [1,2]){if(i>=3)break;const idx=p+'.'+onu;
  vb.push({oid:base+'.1.'+idx,value:onu}); // index column
  vb.push({oid:base+'.3.'+idx,value:Buffer.from(hex[i],'hex')});
  vb.push({oid:base+'.5.'+idx,value:i===2?2:1});
  vb.push({oid:base+'.7.'+idx,value:Buffer.from('cust-'+i)});
  vb.push({oid:base+'.9.'+idx,value:-2150-i});i++;}
 vb.push({oid:'1.3.6.1.4.1.37950.1.1.9.1.0',value:Buffer.from('V1600G')});
 const a=P.analyse(vb);
 assert.equal(a.found,true);assert.equal(a.serialOid,base+'.3');assert.equal(a.onus,3);assert.equal(a.serialEncoding,'hex');
 assert.deepEqual(a.sample,['HWTC1A2B3C4D','ZTEG00112233','VSOL00AABBCC']);
 assert.ok(a.states.some(s=>s.oid===base+'.5'&&s.values[1]===2&&s.values[2]===1));
 assert.equal(a.nameOid,base+'.7');
 assert.doesNotThrow(()=>snmp.profile(JSON.stringify({serialOid:a.serialOid,statusOid:base+'.5',nameOid:a.nameOid,onlineValues:[1],serialEncoding:a.serialEncoding})));
});
test('EPON MACs are recognised and nothing is invented when there is no ONU table',()=>{
 assert.equal(P.ident(Buffer.from('a4b1c2d3e4f5','hex')).kind,'epon');
 assert.deepEqual(P.analyse([{oid:'1.3.6.1.4.1.9.1.1.0',value:Buffer.from('router')}]),{found:false,candidates:[]});
});
