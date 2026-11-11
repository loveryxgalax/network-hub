'use strict';
// A small PDF writer (no dependencies) for printable documents such as invoices: A4 pages, Helvetica text, lines and
// filled boxes. Text is drawn in the PDF's built-in WinAnsi encoding; characters outside it become "?".
const A4={w:595.28,h:841.89};
const WIN={'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
function enc(text){let out='';for(const ch of String(text??'')){const c=ch.codePointAt(0);let b=WIN[ch]??(c<128||(c>=160&&c<=255)?c:63);
 const s=String.fromCharCode(b);out+=s==='('||s===')'||s==='\\'?'\\'+s:b<32||b>126?'\\'+b.toString(8).padStart(3,'0'):s;}return out;}
// Helvetica widths (per 1000 units) for the printable ASCII range, so text can be right-aligned and measured.
const HW=[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HB=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
function width(text,size,bold=false){let w=0;for(const ch of String(text??'')){const c=ch.charCodeAt(0);w+=(c>=32&&c<=126?(bold?HB:HW)[c-32]:556);}return w*size/1000;}
// Cut text so it fits a width, adding "…" when shortened.
function fit(text,max,size,bold){let s=String(text??'');if(width(s,size,bold)<=max)return s;while(s&&width(s+'…',size,bold)>max)s=s.slice(0,-1);return s+'…';}
// Split text into lines no wider than max.
function wrap(text,max,size,bold){const out=[];for(const para of String(text??'').split(/\r?\n/)){let line='';for(const word of para.split(/\s+/)){const t=line?line+' '+word:word;if(width(t,size,bold)<=max)line=t;else{if(line)out.push(line);line=width(word,size,bold)>max?fit(word,max,size,bold):word;}}out.push(line);}return out;}
const rgb=hex=>{const m=/^#?([0-9a-f]{6})$/i.exec(hex||'');const n=m?parseInt(m[1],16):0;return [(n>>16&255)/255,(n>>8&255)/255,(n&255)/255].map(v=>v.toFixed(3)).join(' ');};
class Doc{
 constructor(){this.pages=[];this.add();}
 add(){this.ops=[];this.pages.push(this.ops);return this;}
 // y is measured from the top of the page (easier to lay out), converted to PDF's bottom-left origin here.
 text(x,y,s,{size=10,bold=false,color='#111827',align='left'}={}){const w=width(s,size,bold),xx=align==='right'?x-w:align==='center'?x-w/2:x;
  this.ops.push(`BT /${bold?'F2':'F1'} ${size} Tf ${rgb(color)} rg ${xx.toFixed(2)} ${(A4.h-y).toFixed(2)} Td (${enc(s)}) Tj ET`);return this;}
 line(x1,y1,x2,y2,{color='#d1d5db',w=0.8}={}){this.ops.push(`${rgb(color)} RG ${w} w ${x1.toFixed(2)} ${(A4.h-y1).toFixed(2)} m ${x2.toFixed(2)} ${(A4.h-y2).toFixed(2)} l S`);return this;}
 box(x,y,w,h,{fill='#f3f4f6'}={}){this.ops.push(`${rgb(fill)} rg ${x.toFixed(2)} ${(A4.h-y-h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);return this;}
 build(title='Document'){const objs=[],font=(n,b)=>`<< /Type /Font /Subtype /Type1 /BaseFont /${b} /Encoding /WinAnsiEncoding >>`;
  objs[1]='<< /Type /Catalog /Pages 2 0 R >>';objs[3]=font('F1','Helvetica');objs[4]=font('F2','Helvetica-Bold');
  objs[5]=`<< /Title (${enc(title)}) /Producer (netops) >>`;const kids=[];let n=6;
  for(const ops of this.pages){const stream=ops.join('\n'),len=Buffer.byteLength(stream,'latin1');objs[n]=`<< /Length ${len} >>\nstream\n${stream}\nendstream`;
   objs[n+1]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${n} 0 R >>`;kids.push(`${n+1} 0 R`);n+=2;}
  objs[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out='%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';const offs=[];
  for(let i=1;i<objs.length;i++){offs[i]=Buffer.byteLength(out,'latin1');out+=`${i} 0 obj\n${objs[i]}\nendobj\n`;}
  const x=Buffer.byteLength(out,'latin1');out+=`xref\n0 ${objs.length}\n0000000000 65535 f \n`+offs.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
  out+=`trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${x}\n%%EOF\n`;return Buffer.from(out,'latin1');}
}
// ---- Invoice ---------------------------------------------------------------------------------------------------------
function invoice(inv,{ws={},payments=[],brand='#1d4ed8'}={}){
 const d=new Doc(),L=48,R=A4.w-48,cur=ws.currency||'KES',money=n=>cur+' '+Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 let items=[];try{items=JSON.parse(inv.items||'[]');}catch{}items=Array.isArray(items)?items.filter(x=>x&&typeof x==='object'):[];
 if(!items.length)items=[{d:inv.notes&&inv.notes.length<120?inv.notes:'Internet service',q:1,p:Number(inv.amount)||0}];
 const sub=items.reduce((a,x)=>a+(Number(x.q)||0)*(Number(x.p)||0),0),rate=Number(inv.taxRate)||0,tax=Math.round(sub*rate)/100,total=Number(inv.amount)||sub+tax,paid=payments.reduce((a,p)=>a+(Number(p.amount)||0),0),due=Math.max(0,total-paid);
 const issued=new Date((inv.created||Date.now())+3*36e5).toISOString().slice(0,10);
 const head=(first)=>{d.box(0,0,A4.w,6,{fill:brand});let y=58;d.text(L,y,fit(ws.name||'Kade Networks',300,20,true),{size:20,bold:true,color:brand});
  d.text(R,y,'INVOICE',{size:22,bold:true,align:'right',color:'#111827'});y+=18;
  for(const t of [ws.address,[ws.phone,ws.email].filter(Boolean).join('  ·  '),ws.country].filter(Boolean)){d.text(L,y,fit(t,300,9.5),{size:9.5,color:'#4b5563'});y+=13;}
  if(!first)d.text(R,76,'continued',{size:9,align:'right',color:'#6b7280'});return Math.max(y,110);};
 let y=head(true)+8;
 // Invoice facts (right) and bill-to (left)
 const facts=[['Invoice no.',inv.name||'—'],['Issued',issued],['Due',inv.due||'—'],['Status',inv.status||'Unpaid'],...(inv.reference?[['Reference',inv.reference]]:[])];
 d.text(L,y,'BILL TO',{size:8.5,bold:true,color:'#6b7280'});let fy=y;for(const [k,v] of facts){d.text(R-150,fy,k,{size:9.5,color:'#6b7280'});d.text(R,fy,fit(v,140,9.5,true),{size:9.5,bold:true,align:'right',color:k==='Status'?(v==='Paid'?'#047857':v==='Cancelled'?'#6b7280':'#b42318'):'#111827'});fy+=15;}
 let by=y+15;for(const t of [inv.customer||'Customer',inv.phone,inv.address].filter(Boolean)){d.text(L,by,fit(t,260,by===y+15?11:9.5,by===y+15),{size:by===y+15?11:9.5,bold:by===y+15});by+=14;}
 y=Math.max(fy,by)+18;
 // Line items
 const cols={d:L+10,q:R-230,p:R-130,t:R-10},row=()=>{d.box(L,y,R-L,22,{fill:'#eef2ff'});d.text(cols.d,y+15,'DESCRIPTION',{size:8.5,bold:true,color:'#374151'});d.text(cols.q,y+15,'QTY',{size:8.5,bold:true,align:'right',color:'#374151'});d.text(cols.p,y+15,'UNIT PRICE',{size:8.5,bold:true,align:'right',color:'#374151'});d.text(cols.t,y+15,'AMOUNT',{size:8.5,bold:true,align:'right',color:'#374151'});y+=22;};
 row();
 for(const x of items){const lines=wrap(x.d||'Item',cols.q-cols.d-60,10),h=Math.max(22,lines.length*13+9);
  if(y+h>A4.h-160){d.add();y=head(false)+10;row();}
  lines.forEach((t,i)=>d.text(cols.d,y+15+i*13,t,{size:10}));d.text(cols.q,y+15,String(Number(x.q)||0),{size:10,align:'right'});d.text(cols.p,y+15,money(x.p),{size:10,align:'right'});d.text(cols.t,y+15,money((Number(x.q)||0)*(Number(x.p)||0)),{size:10,align:'right'});
  y+=h;d.line(L,y,R,y);}
 // Totals
 if(y>A4.h-200){d.add();y=head(false)+10;}
 y+=14;const tot=[['Subtotal',money(sub)],...(rate?[[`Tax (${rate}%)`,money(tax)]]:[]),['Total',money(total)],...(paid?[['Paid',money(paid)]]:[]),['Balance due',money(due)]];
 for(const [k,v] of tot){const strong=k==='Total'||k==='Balance due';if(k==='Balance due'){d.box(R-230,y-4,230,24,{fill:due>0?'#fef2f2':'#ecfdf5'});}
  d.text(R-220,y+12,k,{size:strong?11:10,bold:strong,color:'#374151'});d.text(R-10,y+12,v,{size:strong?11:10,bold:strong,align:'right',color:k==='Balance due'?(due>0?'#b42318':'#047857'):'#111827'});y+=k==='Balance due'?26:18;}
 // Payments received and notes
 if(payments.length){y+=10;d.text(L,y,'PAYMENTS RECEIVED',{size:8.5,bold:true,color:'#6b7280'});y+=14;for(const p of payments.slice(0,8)){d.text(L,y,fit(`${new Date((p.created||0)+3*36e5).toISOString().slice(0,10)}  ·  ${p.reference||''}`,330,9.5),{size:9.5,color:'#374151'});d.text(R-10,y,money(p.amount),{size:9.5,align:'right'});y+=13;}}
 if(inv.notes&&items[0]?.d!==inv.notes){y+=12;d.text(L,y,'NOTES',{size:8.5,bold:true,color:'#6b7280'});y+=14;for(const t of wrap(inv.notes,R-L,9.5).slice(0,8)){d.text(L,y,t,{size:9.5,color:'#374151'});y+=13;}}
 // Footer on every page
 d.pages.forEach((ops,i)=>{d.ops=ops;d.line(L,A4.h-52,R,A4.h-52);d.text(L,A4.h-36,fit(`Thank you for your business. ${ws.name||''}`.trim(),380,8.5),{size:8.5,color:'#6b7280'});d.text(R,A4.h-36,`Page ${i+1} of ${d.pages.length}`,{size:8.5,align:'right',color:'#6b7280'});});
 return d.build('Invoice '+(inv.name||''));}
module.exports={Doc,invoice,width,wrap,fit,enc};
