'use strict';
const test=require('node:test'),assert=require('node:assert');const jobs=require('../lib/jobs.cjs');
test('hotspot-standard job sets login-by, DNS name and pages, and is risky (typed confirmation)',()=>{const t=jobs.TYPES['hotspot-standard'];assert.equal(t.risky,true);assert.equal(t.retry,false);
 const s=t.script({profile:'kade-hotspot',origin:'https://cloud.kadenetworks.com',host:'cloud.kadenetworks.com',dns:'wifi.kadenetworks.com'});
 assert.match(s,/login-by=http-chap,http-pap,mac-cookie dns-name="wifi.kadenetworks.com"/);for(const f of ['login','status','logout','buy','account'])assert.match(s,new RegExp(f+'\\.html'));assert.doesNotMatch(s,/netops/);
 assert.ok(!t.params.profile.test('x"; /system reset'));});
