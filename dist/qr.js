'use strict';
// A small QR code maker (byte mode, error correction M, versions 1-10: up to 213 characters), no dependencies.
// kadeQR(text) → {size, dark(x,y)}; kadeQRPng(text, px) → PNG data URL with the standard white border.
(function(root){
 const ECC=[0,10,16,26,18,24,16,18,22,22,26],BLOCKS=[0,1,1,1,2,2,4,4,4,5,5];
 const mul=(x,y)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11D);z^=((y>>>i)&1)*x;}return z;};
 const rawModules=v=>{let r=(16*v+128)*v+64;if(v>=2){const n=Math.floor(v/7)+2;r-=(25*n-10)*n-55;if(v>=7)r-=36;}return r;};
 const dataCodewords=v=>Math.floor(rawModules(v)/8)-ECC[v]*BLOCKS[v];
 function rsDivisor(d){const r=new Array(d).fill(0);r[d-1]=1;let root=1;for(let i=0;i<d;i++){for(let j=0;j<d;j++){r[j]=mul(r[j],root);if(j+1<d)r[j]^=r[j+1];}root=mul(root,2);}return r;}
 function rsRemainder(data,div){const r=new Array(div.length).fill(0);for(const b of data){const f=b^r.shift();r.push(0);div.forEach((c,i)=>{r[i]^=mul(c,f);});}return r;}
 function alignPos(v){if(v===1)return [];const n=Math.floor(v/7)+2,size=v*4+17,step=Math.ceil((v*4+4)/(n*2-2))*2,r=[6];for(let p=size-7;r.length<n;p-=step)r.splice(1,0,p);return r;}
 function make(text){
  const bytes=Array.from(new TextEncoder().encode(String(text)));let v=1;
  for(;v<=10;v++){const cap=dataCodewords(v)*8,need=4+(v<10?8:16)+bytes.length*8;if(need<=cap)break;}
  if(v>10)throw new Error('Text too long for a QR code here');
  const bits=[],put=(val,n)=>{for(let i=n-1;i>=0;i--)bits.push((val>>>i)&1);};
  put(4,4);put(bytes.length,v<10?8:16);bytes.forEach(b=>put(b,8));
  const cap=dataCodewords(v)*8;put(0,Math.min(4,cap-bits.length));put(0,(8-bits.length%8)%8);
  for(let p=0xEC;bits.length<cap;p^=0xEC^0x11)put(p,8);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(parseInt(bits.slice(i,i+8).join(''),2));
  // Error correction blocks, interleaved.
  const nb=BLOCKS[v],el=ECC[v],raw=Math.floor(rawModules(v)/8),nShort=nb-raw%nb,shortLen=Math.floor(raw/nb),div=rsDivisor(el),blocks=[];
  for(let i=0,k=0;i<nb;i++){const len=shortLen-el+(i<nShort?0:1),d=data.slice(k,k+len);k+=len;const e=rsRemainder(d,div);if(i<nShort)d.push(0);blocks.push(d.concat(e));}
  const cw=[];for(let i=0;i<blocks[0].length;i++)blocks.forEach((b,j)=>{if(i!==shortLen-el||j>=nShort)cw.push(b[i]);});
  // Modules.
  const size=v*4+17,m=[...Array(size)].map(()=>new Array(size).fill(false)),fn=[...Array(size)].map(()=>new Array(size).fill(false));
  const set=(x,y,d)=>{m[y][x]=d;fn[y][x]=true;};
  for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
  for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=cx+dx,y=cy+dy,dist=Math.max(Math.abs(dx),Math.abs(dy));if(x>=0&&x<size&&y>=0&&y<size)set(x,y,dist!==2&&dist!==4);}
  const ap=alignPos(v),na=ap.length;
  for(let i=0;i<na;i++)for(let j=0;j<na;j++){if((i===0&&j===0)||(i===0&&j===na-1)||(i===na-1&&j===0))continue;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(ap[i]+dx,ap[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);}
  const format=mask=>{const d=mask;let r=d;for(let i=0;i<10;i++)r=(r<<1)^((r>>>9)*0x537);const b=((d<<10)|r)^0x5412,bit=i=>((b>>>i)&1)===1;
   for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));
   for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true);};
  format(0);
  if(v>=7){let r=v;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1F25);const b=(v<<12)|r;for(let i=0;i<18;i++){const d=((b>>>i)&1)===1,a=size-11+i%3,c=Math.floor(i/3);set(a,c,d);set(c,a,d);}}
  let i=0;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++)for(let j=0;j<2;j++){const x=right-j,up=((right+1)&2)===0,y=up?size-1-vert:vert;if(!fn[y][x]&&i<cw.length*8){m[y][x]=((cw[i>>>3]>>>(7-(i&7)))&1)===1;i++;}}}
  const MASKS=[(x,y)=>(x+y)%2===0,(x,y)=>y%2===0,(x,y)=>x%3===0,(x,y)=>(x+y)%3===0,(x,y)=>(Math.floor(x/3)+Math.floor(y/2))%2===0,(x,y)=>x*y%2+x*y%3===0,(x,y)=>(x*y%2+x*y%3)%2===0,(x,y)=>((x+y)%2+x*y%3)%2===0];
  const apply=k=>{for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!fn[y][x]&&MASKS[k](x,y))m[y][x]=!m[y][x];};
  // Pick the mask with the fewest long runs and the best dark/light balance (a simplified version of the standard score).
  const score=()=>{let p=0,dark=0;for(let a=0;a<size;a++){let rr=1,rc=1;for(let b=1;b<size;b++){if(m[a][b]===m[a][b-1]){rr++;if(rr===5)p+=3;else if(rr>5)p++;}else rr=1;if(m[b][a]===m[b-1][a]){rc++;if(rc===5)p+=3;else if(rc>5)p++;}else rc=1;}for(let b=0;b<size;b++)if(m[a][b])dark++;}
   for(let y=0;y<size-1;y++)for(let x=0;x<size-1;x++){const c=m[y][x];if(c===m[y][x+1]&&c===m[y+1][x]&&c===m[y+1][x+1])p+=3;}
   return p+Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;};
  let best=0,bestScore=Infinity;for(let k=0;k<8;k++){apply(k);format(k);const s=score();if(s<bestScore){bestScore=s;best=k;}apply(k);}
  apply(best);format(best);
  return {size,version:v,dark:(x,y)=>m[y][x]};}
 function png(text,px=8){const q=make(text),b=4,n=q.size+b*2,c=document.createElement('canvas');c.width=c.height=n*px;const g=c.getContext('2d');
  g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#000';for(let y=0;y<q.size;y++)for(let x=0;x<q.size;x++)if(q.dark(x,y))g.fillRect((x+b)*px,(y+b)*px,px,px);return c.toDataURL('image/png');}
 root.kadeQR=make;root.kadeQRPng=png;
 if(typeof module!=='undefined')module.exports={make};
})(typeof window!=='undefined'?window:globalThis);
