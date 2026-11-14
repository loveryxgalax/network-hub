'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {page,DEFAULTS}=require('../lib/status.cjs');
test('all status designs preserve encoded hotspot context for renewal',()=>{
 for(const design of Object.keys(require('../lib/status.cjs').DESIGNS)){
  const html=page({...DEFAULTS,design},'https://netops.example',false);
  const href=html.match(/class="btn buy" href="([^"]+)"/)[1].replaceAll('&amp;','&');
  const values={'mac-esc':'EA%3A6A%3A55%3AD7%3AE4%3AEF','ip-esc':'10.5.3.245','link-login-only-esc':encodeURIComponent('http://wifi.kade/login')};
  const url=new URL(href.replace(/\$\(([^)]+)\)/g,(_,key)=>values[key]));
  assert.equal(url.searchParams.get('mac'),'EA:6A:55:D7:E4:EF');
  assert.equal(url.searchParams.get('login'),'http://wifi.kade/login');
  assert.equal(url.searchParams.get('ip'),'10.5.3.245');
  assert.equal(url.searchParams.get('renew'),'1');
  assert.equal(url.hash,'#hotspotCard');
 }
});
test('status preview never supplies fake device context',()=>{
 const html=page(DEFAULTS,'https://netops.example',true);
 assert.match(html,/class="btn buy" href="https:\/\/netops.example\/portal\/"/);
});
