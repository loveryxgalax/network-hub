'use strict';
// WiFi page popups: a card (picture, title, text, points, one button) shown to a customer once their payment has
// connected them, and optionally on their account page. One master switch turns them all on or off; each popup has its
// own switch, dates, routers and how often a phone sees it. Views and button taps are counted.
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const KIND='portalPopups',FREQ=['every','day','week','once'];
const txt=(v,max,label,req)=>{const s=String(v??'').trim();if(req&&!s)fail(label+' is required');if(s.length>max)fail(label+': up to '+max+' characters');if(/[<>\u0000-\u0009\u000b-\u001f]/.test(s))fail(label+' cannot contain < or >');return s;};
function link(v){const s=String(v||'').trim();if(!s)return '';let u;try{u=new URL(s);}catch{fail('The button link is not a valid link');}
 if(!['https:','tel:','sms:','mailto:'].includes(u.protocol))fail('The button link must start with https://');return u.href.slice(0,500);}
function image(v,old){if(v===undefined)return old||'';if(v===''||v===null)return '';const s=String(v);
 if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s))fail('The picture must be a JPG, PNG or WebP image');if(s.length>700000)fail('The picture is too large (500 KB at most)');return s;}
const day=v=>{if(!v)return null;const t=Date.parse(String(v).length===10?v+'T00:00:00+03:00':v);if(!Number.isFinite(t))fail('Invalid date');return t;};
function enabled(store){return store.setting('portalPopupsOn')!==false;}
function setEnabled(store,on){store.setting('portalPopupsOn',!!on);return enabled(store);}
function save(store,v,existing){
 const points=(Array.isArray(v.points)?v.points:String(v.points||'').split('\n')).map(x=>String(x).trim()).filter(Boolean);if(points.length>5)fail('Up to 5 points');
 const out={title:txt(v.title,80,'Title',true),text:txt(v.text,300,'Text'),points:points.map((p,i)=>txt(p,90,'Point '+(i+1))),badge:txt(v.badge,30,'Label'),
  buttonText:txt(v.buttonText,40,'Button text'),buttonLink:link(v.buttonLink),image:image(v.image,existing?.image),
  routers:(Array.isArray(v.routers)?v.routers:[]).map(String).filter(id=>store.get('devices',id)),frequency:FREQ.includes(v.frequency)?v.frequency:'day',
  afterPayment:v.afterPayment!==false,onAccount:!!v.onAccount,active:v.active!==false,startsAt:day(v.startsAt),endsAt:day(v.endsAt),order:Math.round(Number(v.order)||0)};
 out.imgVer=existing&&out.image===existing.image?existing.imgVer||1:(existing?.imgVer||0)+1;
 if(out.buttonText&&!out.buttonLink)fail('Add the button link');if(out.buttonLink&&!out.buttonText)out.buttonText='Open';
 if(out.endsAt&&out.startsAt&&out.endsAt<=out.startsAt)fail('The end date must be after the start date');if(out.endsAt)out.endsAt+=86400000-1;
 return existing?store.put(KIND,{...existing,...out},existing):store.put(KIND,{...out,views:0,taps:0});}
const strip=p=>{const {image:img,...r}=p;return {...r,hasImage:!!img};};
function list(store){return store.list(KIND).sort((a,b)=>a.order-b.order||(b.created||0)-(a.created||0)).map(strip);}
function live(p,now){return p.active&&(!p.startsAt||p.startsAt<=now)&&(!p.endsAt||p.endsAt>=now);}
// What a phone on this router should be offered (the page applies "how often" with what it remembers).
function forPortal(store,{routerId='',where='paid',now=Date.now()}={}){if(!enabled(store))return [];
 return store.list(KIND).filter(p=>live(p,now)&&(where==='account'?p.onAccount:p.afterPayment)&&(!p.routers?.length||p.routers.includes(routerId)))
  .sort((a,b)=>a.order-b.order).slice(0,3).map(p=>({id:p.id,v:(p.imgVer||1)+'-'+(p.updated||0),img:p.imgVer||1,title:p.title,text:p.text,points:p.points,badge:p.badge,buttonText:p.buttonText,buttonLink:p.buttonLink,hasImage:!!p.image,frequency:p.frequency}));}
function imageOf(store,id){const p=store.get(KIND,String(id||''));if(!p?.image)return null;const m=/^data:(image\/\w+);base64,(.*)$/.exec(p.image);return {type:m[1],data:Buffer.from(m[2],'base64'),tag:String(p.imgVer||1)};}
function count(store,id,type){const p=store.get(KIND,String(id||''));if(!p||!['view','tap'].includes(type))return false;const k=type==='view'?'views':'taps';store.db.prepare("UPDATE records SET body=json_set(body,'$.'||?,COALESCE(json_extract(body,'$.'||?),0)+1) WHERE kind=? AND id=?").run(k,k,KIND,p.id);return true;}
function remove(store,id){const p=store.get(KIND,id);if(!p)fail('Popup not found',404);store.remove(KIND,id);}
module.exports={enabled,setEnabled,save,list,forPortal,imageOf,count,remove,KIND};
