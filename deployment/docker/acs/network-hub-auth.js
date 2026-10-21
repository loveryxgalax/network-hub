'use strict';
const fs=require('node:fs');
function entry(args){const serial=String(args[0]||'');const data=JSON.parse(fs.readFileSync('/private/cpes.json','utf8'));return data.devices?.[serial];}
exports.enrolled=(args,callback)=>{try{const e=entry(args);callback(null,!!(e&&e.enabled&&typeof e.password==='string'&&e.password.length>=32));}catch(error){callback(error);}};
exports.password=(args,callback)=>{try{const e=entry(args);callback(null,e&&e.enabled?e.password:null);}catch(error){callback(error);}};
