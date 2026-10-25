'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const sites=require('../lib/sites.cjs');
const memory=(devices=[])=>{const values=new Map();return {values,setting(k,v){if(v===undefined)return values.get(k);if(v===null)values.delete(k);else values.set(k,v);},list:()=>devices};};
const router={id:'r1',name:'hEX',type:'router'};
const line=(time,ip,domain,type='A')=>({time,message:`query from ${ip}: #12 ${domain}. ${type}`});
test('DNS log lines parse into client, domain and type; anything else is ignored',()=>{
 assert.deepEqual(sites.parseQuery('query from 10.0.0.5: #54 WWW.Google.com. A'),{client:'10.0.0.5',domain:'www.google.com',type:'A'});
 assert.equal(sites.parseQuery('query from 10.0.0.5: #54 localhost. A'),null);
 assert.equal(sites.parseQuery('done query: #54 www.google.com 1.2.3.4'),null);
 assert.equal(sites.parseQuery('query from bad: #1 a.com. A'),null);
});
test('reports are bounded and connection endpoints validated',()=>{
 assert.throws(()=>sites.normalize({dns:new Array(sites.MAX_DNS+1).fill(line('1','10.0.0.1','a.com'))}));
 assert.throws(()=>sites.normalize({conns:new Array(sites.MAX_CONNS+1).fill({})}));
 const value=sites.normalize({conns:[{src:'10.0.0.5:51000',dst:'1.2.3.4:443',proto:'tcp',bytes:'900000',origRate:'1.5Mbps',replRate:'800kbps'},{src:'bad',dst:'1.2.3.4'}]});
 assert.equal(value.conns.length,1);
 const split=sites.normalize({conns:[{src:'10.111.3.181',srcPort:'36188',dst:'23.44.131.201',dstPort:'443',proto:'tcp',bytes:450790,origRate:'0',replRate:'2400000'}]}).conns[0];assert.deepEqual(split.dst,{ip:'23.44.131.201',port:443});assert.equal(split.upBps,0);assert.equal(split.downBps,2400000);assert.deepEqual(value.conns[0].dst,{ip:'1.2.3.4',port:443});assert.equal(value.conns[0].upBps,1.5e6);assert.equal(value.conns[0].downBps,8e5);
});
test('ingest dedupes repeated log lines and report names subscribers from discovery',()=>{
 const store=memory([router]),now=Date.parse('2026-10-25T10:00:00Z');
 store.setting('customerDiscovery:r1',{observations:[{evidence:{ppp:{ip:'10.0.0.5',name:'kamau.home'},dhcp:{ip:'10.0.0.5',name:'phone'}}}]});
 const batch=sites.normalize({dns:[line('10:00:01','10.0.0.5','youtube.com'),line('10:00:02','10.0.0.5','youtube.com'),line('10:00:03','10.0.0.9','netflix.com')],conns:[{src:'10.0.0.5:5000',dst:'1.2.3.4:443',proto:'tcp',bytes:500000}]});
 assert.equal(sites.ingest(store,router,batch,now).dnsAdded,3);
 assert.equal(sites.ingest(store,router,batch,now+1000).dnsAdded,0);
 const r=sites.report(store,new URLSearchParams('range=1'),now+2000);
 assert.equal(r.lookups,3);assert.equal(r.uniqueSites,2);assert.equal(r.topSites[0].domain,'youtube.com');
 assert.equal(r.topClients[0].name,'kamau.home');assert.equal(r.topClients[0].source,'ppp');
 assert.equal(r.live[0].name,'kamau.home');assert.equal(r.live[0].remote,'1.2.3.4');
 const one=sites.report(store,new URLSearchParams('range=1&client=r1|10.0.0.9'),now+2000);assert.equal(one.lookups,1);assert.equal(one.live.length,0);
 assert.equal(sites.report(store,new URLSearchParams('range=1'),now+11*60000).live.length,0,'stale live snapshots are hidden');
});
test('old days expire after 30 days',()=>{
 const store=memory([router]),start=Date.parse('2026-09-01T10:00:00Z');
 sites.ingest(store,router,sites.normalize({dns:[line('1','10.0.0.5','a.com')]}),start);
 sites.ingest(store,router,sites.normalize({dns:[line('2','10.0.0.5','b.com')]}),start+40*86400000);
 assert.equal(store.setting('siteStats:r1:2026-09-01'),undefined);assert.deepEqual(store.setting('siteDays:r1').days,['2026-10-11']);
});
test('router script reads DNS logs and connections only; setup is shown, not sent',()=>{
 assert.match(sites.SCRIPT,/\/log find where topics~"dns" and message~"query from"/);assert.doesNotMatch(sites.SCRIPT,/log print/);assert.ok(sites.SCRIPT.includes(':pick $ids ([:len $ids]-800)'));assert.match(sites.SCRIPT,/\/ip firewall connection find where \(orig-bytes>1048576 or repl-bytes>1048576\)/);assert.doesNotMatch(sites.SCRIPT,/connection print/);
 assert.doesNotMatch(sites.SCRIPT,/\b(set|add|remove|disable)\b \[?\//);
 assert.ok(sites.SETUP.every(c=>/^\/(system logging|ip dns set)/.test(c)));
});
