'use strict';
const position=row=>typeof row?.latitude==='number'&&typeof row?.longitude==='number'?[row.longitude,row.latitude]:null;
function geojson(store){
 const endpoints=new Map(),features=[];
 for(const kind of ['devices','odbs','closures','zones'])for(const row of store.list(kind)){
  const coordinates=position(row);if(!coordinates)continue;endpoints.set(row.id,coordinates);
  features.push({type:'Feature',id:row.id,properties:{id:row.id,name:row.name,kind:kind==='devices'?row.type:kind,status:row.status||''},geometry:{type:'Point',coordinates}});
 }
 for(const row of store.list('cables')){const from=endpoints.get(row.fromId),to=endpoints.get(row.toId);if(!from||!to)continue;features.push({type:'Feature',id:row.id,properties:{id:row.id,name:row.name,kind:'cable',status:row.status,cores:row.cores,geometrySource:'Straight line between recorded endpoints'},geometry:{type:'LineString',coordinates:[from,to]}});}
 return {type:'FeatureCollection',features};
}
const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function kml(collection){return '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Network Hub</name>'+collection.features.map(f=>'<Placemark><name>'+xml(f.properties.name)+'</name><ExtendedData>'+Object.entries(f.properties).map(([k,v])=>'<Data name="'+xml(k)+'"><value>'+xml(v)+'</value></Data>').join('')+'</ExtendedData>'+(f.geometry.type==='Point'?'<Point><coordinates>'+f.geometry.coordinates.join(',')+',0</coordinates></Point>':'<LineString><coordinates>'+f.geometry.coordinates.map(p=>p.join(',')+',0').join(' ')+'</coordinates></LineString>')+'</Placemark>').join('')+'</Document></kml>';}
module.exports={geojson,kml};
