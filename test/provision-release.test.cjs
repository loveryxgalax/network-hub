'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),pv=require('../lib/provision.cjs');
test('ports can leave the factory default bridge, but never all of them',()=>{
 const state={ports:[{name:'ether1',uplink:true,bridge:'',address:''},{name:'ether2',bridge:'bridge',address:''},{name:'ether3',bridge:'bridge',address:''},{name:'ether4',bridge:'bridge',address:''},{name:'wlan1',bridge:'bridge',address:''}],addresses:[]};
 const base={hotspot:true,uplink:'ether1',ports:['ether3','ether4'],hotspotNet:'10.5.0.1/22',dnsName:'wifi.kade'};
 assert.throws(()=>pv.validateServices(base,{portalHost:'netops.example.test',state}),/factory default bridge/);
 const spec=pv.validateServices({...base,releaseDefaultBridge:true},{portalHost:'netops.example.test',state});assert.equal(spec.release,true);
 const body=pv.servicesBody(spec,'https://netops.example.test');
 assert.match(body,/bridge port remove \[find where interface=\$p and bridge="bridge" and comment~"defconf"\]/);assert.match(body,/factory bridge/);
 assert.match(pv.summary(spec).join(' '),/factory default bridge/);
 assert.doesNotMatch(pv.servicesBody(pv.validateServices({...base,ports:['ether3'],releaseDefaultBridge:true},{portalHost:'netops.example.test',state}),'https://netops.example.test'),/is already in a bridge/);
 // taking every other port would lock you out
 assert.throws(()=>pv.validateServices({...base,ports:['ether2','ether3','ether4','wlan1'],releaseDefaultBridge:true},{portalHost:'netops.example.test',state}),/at least one port/);
 // a port in some other bridge is never touched
 const odd={...state,ports:state.ports.map(p=>p.name==='ether4'?{...p,bridge:'lan-custom'}:p)};
 assert.throws(()=>pv.validateServices({...base,releaseDefaultBridge:true},{portalHost:'netops.example.test',state:odd}),/already in bridge lan-custom/);
});
