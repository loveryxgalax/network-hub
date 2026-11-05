'use strict';
const fs=require('node:fs');
function boot(){const b=JSON.parse(fs.readFileSync('/private/cpes.json','utf8')).bootstrap;return b&&b.enabled&&typeof b.password==='string'&&b.password.length>=32?b.password:null;}
function entry(args){const serial=String(args[0]||'');const data=JSON.parse(fs.readFileSync('/private/cpes.json','utf8'));return data.devices?.[serial];}
exports.enrolled=(args,callback)=>{try{const e=entry(args);callback(null,!!(e&&e.enabled&&typeof e.password==='string'&&e.password.length>=32)||(!e&&!!boot()));}catch(error){callback(error);}};
exports.password=(args,callback)=>{try{const e=entry(args);callback(null,e?(e.enabled?e.password:null):boot());}catch(error){callback(error);}};
