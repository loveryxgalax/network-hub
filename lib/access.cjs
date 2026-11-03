'use strict';
// Fine-grained access on top of roles. Each capability has the roles that get it by default; the owner can grant
// or deny it per person, and can limit a person to some routers (they then see and change only customers on those
// routers). Administrators always have every capability and every router.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const CAPS={
 'ledger.view':{label:'See the ledger and money totals',roles:['admin','manager']},
 'payments.reverse':{label:'Reverse payments',roles:['admin']},
 'payouts.request':{label:'Request refunds and withdrawals',roles:['admin','manager']},
 'payouts.approve':{label:'Approve and pay out refunds and withdrawals',roles:['admin']},
 'wallet.adjust':{label:'Adjust customer wallets',roles:['admin','manager']},
 'bulk.apply':{label:'Bulk changes to many customers',roles:['admin','manager']},
 'customers.export':{label:'Export customer lists',roles:['admin','manager','operator']},
 'router.jobs':{label:'Queue router jobs (connect, disconnect, backups)',roles:['admin','manager','network-technician']},
 'messages.send':{label:'Send SMS to customers',roles:['admin','manager','operator','support']},
 'packages.edit':{label:'Create and change packages',roles:['admin','manager']}
};
function get(store,userId){const a=(store.setting('userAccess')||{})[userId]||{};return {grant:(a.grant||[]).filter(c=>CAPS[c]),deny:(a.deny||[]).filter(c=>CAPS[c]),routerIds:(a.routerIds||[]).filter(Boolean)};}
function set(store,userId,input){const all=store.setting('userAccess')||{},list=v=>[...new Set((Array.isArray(v)?v:[]).map(String))];
 const grant=list(input.grant),deny=list(input.deny),routerIds=list(input.routerIds);for(const c of [...grant,...deny])if(!CAPS[c])fail('Unknown permission '+c);if(grant.some(c=>deny.includes(c)))fail('A permission cannot be both given and taken away');
 for(const r of routerIds){const d=store.get('devices',r);if(!d||d.type!=='router')fail('Router not found');}
 all[userId]={grant,deny,routerIds};store.setting('userAccess',all);return all[userId];}
function can(store,user,cap){if(!user)return false;if(user.role==='admin')return true;const c=CAPS[cap];if(!c)return false;const a=get(store,user.id);if(a.deny.includes(cap))return false;return roleHas(store,user.role,cap)||a.grant.includes(cap);}
function need(store,user,cap){if(!can(store,user,cap))fail('You do not have permission to '+CAPS[cap].label.toLowerCase(),403);}
// null = every router.
function scope(store,user){if(!user||user.role==='admin')return null;const r=get(store,user.id).routerIds;return r.length?new Set(r):null;}
// A customer is on a router when it is set on the account (static IP, onboarding) or it last connected through it.
function routerOfCustomer(s,routerMap){return s.routerId||routerMap?.get(s.username)||'';}
function allowed(sc,s,routerMap){return !sc||sc.has(routerOfCustomer(s,routerMap));}

// Role defaults can be changed by the owner (Team → Roles → Edit permissions); a change applies to everyone with
// that role, while each person's own grants and removals still win.
const EDITABLE=['manager','network-technician','support','installer','viewer','operator','technician'];
function roleCaps(store){const o=store.setting('roleCaps')||{};return Object.fromEntries(EDITABLE.map(r=>[r,Array.isArray(o[r])?o[r].filter(c=>CAPS[c]):Object.keys(CAPS).filter(c=>CAPS[c].roles.includes(r))]));}
function roleHas(store,role,cap){if(role==='admin')return true;return (roleCaps(store)[role]||[]).includes(cap);}
function setRoleCaps(store,role,caps){if(!EDITABLE.includes(role))fail('This role cannot be changed');const list=[...new Set((Array.isArray(caps)?caps:[]).map(String))];for(const c of list)if(!CAPS[c])fail('Unknown permission '+c);
 const o=store.setting('roleCaps')||{};o[role]=list;store.setting('roleCaps',o);return roleCaps(store)[role];}
function resetRoleCaps(store,role){const o=store.setting('roleCaps')||{};delete o[role];store.setting('roleCaps',o);return roleCaps(store)[role];}
function capabilities(store,user){return Object.keys(CAPS).filter(c=>can(store,user,c));}
module.exports={EDITABLE,roleCaps,roleHas,setRoleCaps,resetRoleCaps,CAPS,get,set,can,need,scope,allowed,routerOfCustomer,capabilities};
