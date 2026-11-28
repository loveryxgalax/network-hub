// Modern confirmation dialog in place of the browser's "cloud.kadenetworks.com says" box.
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
 // Type-to-confirm: the word to type is shown as a chip with a copy button (click copies it).
 const COPY='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',TICK='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
 window.kdChip=t=>`<span class="kc-chip" role="button" tabindex="0" data-kc-copy="${esc(t)}" title="Copy">${esc(t)}<i>${COPY}</i></span>`;
 const copy=async t=>{try{await navigator.clipboard.writeText(t);return true;}catch{const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;opacity:0';(document.querySelector('dialog[open]')||document.body).append(a);a.select();let ok=false;try{ok=document.execCommand('copy');}catch{}a.remove();return ok;}};
 const onChip=async e=>{const c=e.target.closest?.('[data-kc-copy]');if(!c||(e.type==='keydown'&&e.key!=='Enter'&&e.key!==' '))return;e.preventDefault();e.stopPropagation();
  const ok=await copy(c.dataset.kcCopy);const i=c.querySelector('i');if(i){i.innerHTML=ok?TICK:COPY;c.classList.toggle('done',ok);setTimeout(()=>{i.innerHTML=COPY;c.classList.remove('done');},1400);}window.toast?.(ok?'Copied':'Could not copy');};
 document.addEventListener('click',onChip,true);document.addEventListener('keydown',onChip,true);
 // kdType(message, word): resolves with what was typed once it matches, or null if cancelled (a drop-in for prompt()).
 window.kdType=(msg,word,ok)=>new Promise(done=>{word=String(word);const d=document.createElement('dialog');d.className='kc-dlg danger kc-type';
  d.innerHTML=`<form method="dialog"><div class="kc-b"><div class="kc-ic" aria-hidden="true">!</div><div><h3>Are you sure?</h3><p class="kc-msg">${esc(msg)}</p><p class="kc-red">This cannot be undone.</p><p class="kc-ty">Type ${window.kdChip(word)} to confirm.</p><input class="kc-in" autocomplete="off" spellcheck="false" placeholder="${esc(word)}"></div></div><div class="kc-f"><button value="no" type="submit">Cancel</button><button value="yes" class="kc-ok" type="submit" disabled>${esc(ok||okLabel(msg))}</button></div></form>`;
  const inp=d.querySelector('.kc-in'),btn=d.querySelector('.kc-ok'),match=()=>inp.value.trim()===word;
  inp.addEventListener('input',()=>{btn.disabled=!match();});
  d.querySelector('form').addEventListener('submit',e=>{if(e.submitter?.value==='yes'||!e.submitter){if(!match()){e.preventDefault();return;}d.returnValue='yes';}});
  d.addEventListener('close',()=>{done(d.returnValue==='yes'?inp.value.trim():null);d.remove();});
  d.addEventListener('click',e=>{if(e.target===d)d.close('no');});
  document.body.appendChild(d);d.showModal();inp.focus();});
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
