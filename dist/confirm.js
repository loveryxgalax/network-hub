// Modern confirmation dialog in place of the browser's "netops.kadenetworks.com says" box.
// confirm() must answer at once, so when it is asked from a click or form submit we answer "no", show our dialog,
// and if the person presses the confirm button we repeat that same click/submit with the answer "yes".
// Anywhere else (after an await, no event) the browser's own box is used, so nothing ever runs without a yes.
(()=>{
 const nativeConfirm=window.confirm.bind(window);let pass=null;
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const DANGER=/\b(delete|remove|revoke|disconnect|reset|reboot|block|ban|clear|replace|release|forget|turn off|cancel)\b/i;
 function okLabel(m){const w=(String(m).match(/^\s*(Delete|Remove|Revoke|Disconnect|Reset|Reboot|Block|Clear|Replace|Release|Send|Extend|Award|Credit|Copy|Create|Acknowledge|Lift|Change|Turn (?:on|off)|Put back)\b/i)||[])[1];return w?w[0].toUpperCase()+w.slice(1).toLowerCase():'Confirm';}
 function ask(msg){return new Promise(done=>{const d=document.createElement('dialog');const danger=DANGER.test(msg);d.className='kc-dlg'+(danger?' danger':'');
  d.innerHTML=`<form method="dialog"><div class="kc-b"><div class="kc-ic" aria-hidden="true">${danger?'!':'?'}</div><div><h3>${danger?'Are you sure?':'Please confirm'}</h3><p>${esc(msg)}</p></div></div><div class="kc-f"><button value="no" type="submit">Cancel</button><button value="yes" class="kc-ok" type="submit">${esc(okLabel(msg))}</button></div></form>`;
  d.addEventListener('close',()=>{done(d.returnValue==='yes');d.remove();});
  d.addEventListener('click',e=>{if(e.target===d)d.close('no');});
  document.body.appendChild(d);d.showModal();d.querySelector(danger?'button[value=no]':'.kc-ok').focus();});}
 window.kdConfirm=ask;
 window.confirm=function(msg){
  msg=String(msg??'');
  if(pass&&pass===msg){pass=null;return true;}
  const ev=window.event;
  if(!ev||!(ev.type==='click'||ev.type==='submit')||typeof HTMLDialogElement==='undefined')return nativeConfirm(msg);
  const target=ev.target,form=ev.type==='submit'?ev.target:null,submitter=ev.submitter||null;
  ask(msg).then(yes=>{if(!yes)return;pass=msg;try{if(form){if(form.requestSubmit)form.requestSubmit(submitter&&form.contains(submitter)?submitter:undefined);else form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));}else if(target&&target.isConnected)target.click();}finally{setTimeout(()=>{if(pass===msg)pass=null;},0);}});
  return false;
 };
})();
// SMS log: hovering (or tapping) the red ✗ shows why the message was not sent as a toast.
(()=>{let last=null,at=0;const show=e=>{const x=e.target.closest?.('[data-sms-why]');if(!x)return;if(e.type==='mouseover'&&x.contains(e.relatedTarget))return;if(x===last&&Date.now()-at<1500)return;last=x;at=Date.now();window.toast?.(x.dataset.smsWhy);};document.addEventListener('mouseover',show);document.addEventListener('click',show);})();
