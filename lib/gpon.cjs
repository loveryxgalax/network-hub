'use strict';
// GPON/XPON ONT serial numbers. The same ONT shows up in three places, each writing its serial differently:
//   * the label:            HWTC0282729A or 48575443 0282729A (both printed on Huawei boxes)
//   * the OLT (SNMP / CLI): 8 raw bytes, usually read as 16 hex digits 485754430282729A, or "HWTC-0282729A"
//   * TR-069 (the ACS):     DeviceInfo.SerialNumber, on Huawei ONTs normally the 16 hex digits
// The first 4 bytes are the vendor ID in ASCII (48 57 54 43 = "HWTC"), the last 4 are the vendor-specific number.
// canon() turns any of these into one form (HWTC0282729A) so an ONT can be matched across label, OLT and ACS.
const VENDORS={HWTC:'Huawei',HWTT:'Huawei',ZTEG:'ZTE',FHTT:'FiberHome',ALCL:'Nokia',VSOL:'V-SOL',TPLG:'TP-Link',GPON:'Generic GPON',XPON:'Generic XPON',ZNTS:'Zyxel',SCOM:'Sercomm',UBNT:'Ubiquiti',TLNK:'TP-Link',RTKG:'Realtek'};
const isVendorId=s=>/^[A-Z][A-Z0-9]{3}$/.test(s);
function canon(input){
 const raw=String(input??'').trim();if(!raw)return null;
 const s=raw.toUpperCase().replace(/[\s:._-]/g,'');
 let vendorId,number;
 if(/^[0-9A-F]{16}$/.test(s)){const v=Buffer.from(s.slice(0,8),'hex').toString('latin1');if(!isVendorId(v))return null;vendorId=v;number=s.slice(8);}
 else if(/^[A-Z][A-Z0-9]{3}[0-9A-F]{8}$/.test(s)){vendorId=s.slice(0,4);number=s.slice(4);}
 else return null;
 return {serial:vendorId+number,hex:Buffer.from(vendorId,'latin1').toString('hex').toUpperCase()+number,vendorId,vendor:VENDORS[vendorId]||'',number};
}
const key=v=>canon(v)?.serial||String(v??'').trim().toUpperCase();
const same=(a,b)=>!!a&&!!b&&key(a)===key(b);
module.exports={canon,key,same,VENDORS};
