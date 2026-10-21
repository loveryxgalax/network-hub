(function(root){
 'use strict';
 const network=['devices','jobs','alerts','zones','odbs','cables','closures','splices','stock','stockMoves','profiles','speeds','presets','tickets'];
 const roles=['admin','manager','network-technician','support','installer','viewer','operator','technician'];
 const labels={admin:'Owner / administrator',manager:'Manager','network-technician':'Technician',support:'Support',installer:'Field installer',viewer:'Viewer',operator:'Operator (legacy)',technician:'Job technician (legacy)'};
 function read(role,kind){if(!roles.includes(role))return false;if(role==='admin')return true;if(role==='installer')return ['devices','jobs','profiles'].includes(kind);return network.includes(kind);}
 function write(role,kind,method='PATCH'){
  if(role==='admin')return true;
  if(['manager','operator'].includes(role))return network.includes(kind);
  if(role==='network-technician')return ['devices','jobs','alerts','zones','odbs','profiles','speeds','presets'].includes(kind);
  if(role==='support')return (kind==='devices'&&method==='PATCH')||(kind==='jobs'&&method==='POST')||(kind==='tickets'&&method!=='DELETE');
  if(role==='installer')return kind==='jobs'&&method==='PATCH';
  if(role==='technician')return ['jobs','tickets'].includes(kind)&&method!=='DELETE';
  return false;
 }
 function equipment(role){return ['admin','manager','operator','network-technician'].includes(role);}
 const value={roles,labels,read,write,equipment};if(typeof module!=='undefined'&&module.exports)module.exports=value;else root.NetworkPermissions=value;
})(typeof window!=='undefined'?window:this);
