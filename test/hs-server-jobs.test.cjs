'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../lib/store.cjs'),jobs=require('../lib/jobs.cjs');
test('hotspot server remove/create jobs need the router name, validate names and build fixed scripts',()=>{
 const st=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'hsj-'))),r=st.put('devices',{name:'TEST-1',type:'router',driver:'none'});st.secret('jobs:'+r.id,{hash:'x'});
 assert.throws(()=>jobs.create(st,{routerId:r.id,type:'hotspot-server-remove',params:{name:'netops-hotspot'},user:{name:'a'}}),/Type the router name/);
 assert.throws(()=>jobs.create(st,{routerId:r.id,type:'hotspot-server-remove',params:{name:'x"; /system reboot; "'},confirm:'TEST-1',user:{name:'a'}}),/Invalid name/);
 const j=jobs.create(st,{routerId:r.id,type:'hotspot-server-remove',params:{name:'netops-hotspot'},confirm:'TEST-1',user:{name:'a'}});
 assert.match(jobs.TYPES[j.type].script(j.params),/\/ip hotspot remove \$i/);
 const c=jobs.create(st,{routerId:r.id,type:'hotspot-server-create',params:{name:'netops-hotspot',iface:'netops-bridge',profile:'netops-hs',pool:'netops-hs-pool'},confirm:'TEST-1',user:{name:'a'}});
 assert.match(jobs.TYPES[c.type].script(c.params),/\/ip hotspot add name="netops-hotspot" interface="netops-bridge" address-pool="netops-hs-pool" profile="netops-hs"/);
 assert.equal(jobs.TYPES[c.type].retry,false);
});
