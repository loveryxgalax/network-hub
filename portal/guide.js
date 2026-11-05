'use strict';
// Customer-facing PPPoE set-up guide. The username can be passed as ?u=…; the password is never shown here.
(()=>{
const $=s=>document.querySelector(s),q=new URLSearchParams(location.search);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const U=(q.get('u')||'').replace(/[^A-Za-z0-9._@:\- ]/g,'').slice(0,64)||'YOUR_USERNAME';
const code=t=>`<div class="code"><button type="button" data-copy>Copy</button>${esc(t)}</div>`;
const TABS={
 mikrotik:['MikroTik',()=>`<div class="box"><b>MikroTik RouterOS: PPPoE client</b>Use the commands below in Winbox Terminal or SSH. Replace <code class="i">YOUR_PASSWORD</code> with the password from your provider.</div>
  <h2>Option 1: terminal</h2><p>Connect with Winbox terminal or SSH and run (change <code class="i">ether1</code> to the port the fibre or modem is plugged into):</p>
  ${code(`/interface pppoe-client\nadd name=pppoe-out1 interface=ether1 \\\n    user=${U} \\\n    password=YOUR_PASSWORD \\\n    service-name="" \\\n    disabled=no \\\n    add-default-route=yes`)}
  <p>Check that it is up:</p>${code('/interface pppoe-client print detail')}
  <p>The <code class="i">status</code> field should say <b>connected</b> and you will see an assigned IP address.</p>
  <h2>Option 2: Winbox</h2><ol><li>Open Winbox and connect to your router.</li><li>Go to <b>PPP</b>, click <b>+</b> and choose <b>PPPoE Client</b>.</li><li>On <b>General</b>, set <b>Interface</b> to the WAN port (usually <code class="i">ether1</code>).</li><li>On <b>Dial Out</b>, enter <b>User</b> <code class="i">${esc(U)}</code> and your <b>Password</b>, and tick <b>Add Default Route</b>.</li><li>Click <b>OK</b>. The status should change to <b>connected</b>.</li></ol>`],
 tenda:['Tenda router',()=>`<div class="box"><b>Tenda: PPPoE WAN set-up</b>These steps fit most Tenda home and office routers. Menu names can differ slightly between firmware versions.</div>
  <h2>Steps</h2><ol><li>Open a browser and go to the router page:${code('http://192.168.0.1')}Sign in with the router's admin login (often <code class="i">admin</code> / <code class="i">admin</code>).</li>
  <li>Go to <b>Advanced → WAN Settings</b> (some versions: <b>Internet → WAN</b>).</li><li>Set <b>WAN Connection Type</b> to <b>PPPoE</b>.</li><li>Enter your details:${code(`PPPoE Username: ${U}\nPPPoE Password: YOUR_PASSWORD`)}</li><li>Set <b>Connection Mode</b> to <b>Always On</b> (recommended).</li><li>Click <b>Save</b>. The router dials and gets an address from your provider, and the WAN light turns solid.</li></ol>
  <div class="box good"><b>Tip</b>After saving, open <b>Status → WAN</b> and confirm that an IP address has been assigned.</div>`],
 ont:['XPON / GPON ONT',()=>`<div class="box"><b>XPON / GPON ONT: PPPoE WAN set-up</b>These steps fit common ONT devices (Huawei, ZTE, Nokia and others). Menu paths vary by maker and firmware.</div>
  <h2>Steps</h2><ol><li>Sign in to the ONT page. The address is usually:${code('http://192.168.1.1')}</li><li>Go to <b>Network → WAN</b> (on some models <b>Basic → WAN Configuration</b>).</li><li>Click <b>Add</b>, or edit the existing Internet profile, and set:${code(`Connection Type : PPPoE\nService Type    : INTERNET\nPPPoE Username  : ${U}\nPPPoE Password  : YOUR_PASSWORD\nVLAN Mode       : Tag (only if your provider asks)\nVLAN ID         : <as given by your provider>`)}</li><li>Keep <b>NAT</b> on if this ONT also works as your router. In bridge mode NAT stays off.</li><li>Click <b>Apply / Save</b>. The Internet light should turn green within about 30 seconds.</li></ol>
  <div class="box warn"><b>Bridge mode</b>If the ONT is in bridge mode, put the PPPoE details on the router behind it instead (the MikroTik or Tenda guides).</div>
  <h3>Huawei ONT</h3><ol><li>Go to <b>Basic → WAN Configuration</b>.</li><li>Select the <b>INTERNET</b> profile and click <b>Modify</b>.</li><li>Set <b>Connection Type</b> to <b>PPPoE</b>.</li><li>Enter the username and password, then <b>Apply</b>.</li></ol>
  <h3>ZTE ONT</h3><ol><li>Go to <b>Network → WAN → WAN Connection</b>.</li><li>Click <b>New</b> or edit the existing profile.</li><li>Choose <b>PPPoE</b>, enter the details and save.</li></ol>`],
 help:['Troubleshoot',()=>`<div class="box bad"><b>Connection troubleshooting</b>Work through these in order. Most problems are fixed by step 4.</div>
  <h2>Step 1: check your details</h2><ul><li>The username is exactly <code class="i">${esc(U)}</code> (letters and numbers as shown).</li><li>The password has no spaces at the start or end. Ask your provider for it again if you are unsure.</li></ul>
  <h2>Step 2: check the cable</h2><ul><li>The fibre or Ethernet cable is firmly in the WAN port.</li><li>The ONT / modem power light is solid, not blinking red.</li><li>On GPON, the PON light is solid green.</li></ul>
  <h2>Step 3: restart in order</h2><ol><li>Switch off your router and ONT (unplug them).</li><li>Wait 30 seconds.</li><li>Switch on the ONT first and wait for it to settle.</li><li>Then switch on your router and let it dial.</li></ol>
  <h2>Step 4: test the dial on MikroTik</h2><p>This shows the exact reason:</p>${code('/interface pppoe-client print detail')}
  <p>What the messages usually mean:</p>
  <div class="err"><b>"authentication failed" / unknown username</b>The username or password is wrong, or the account does not exist. Check Step 1.</div>
  <div class="err"><b>"Account expired"</b>Your subscription has ended. Pay from your account page to get back online.</div>
  <div class="err"><b>"Account suspended"</b>The account was deactivated. Contact your provider.</div>
  <div class="err"><b>"Connection limit reached" / already connected</b>The account is online on another device. Use <b>Reset connection</b> on your account page, then try again.</div>
  <div class="err"><b>"Router not recognised"</b>The account is tied to a different router. Ask your provider to clear the binding.</div>
  <div class="err"><b>"No response from server"</b>The link to your provider is down. Check the WAN cable and ONT lights.</div>
  <h2>Step 5: after it connects</h2><p>Test the internet:</p>${code('/ping 8.8.8.8 count=4')}<p>If the ping fails but the PPPoE status is connected, check your firewall rules and that a default route exists.</p>`]};
const order=['mikrotik','tenda','ont','help'];let cur=q.get('tab');if(!TABS[cur])cur='mikrotik';
function paint(){
 $('#tabs').innerHTML=order.map(k=>`<button type="button" role="tab" data-tab="${k}" aria-selected="${k===cur}">${esc(TABS[k][0])}</button>`).join('');
 $('#panel').innerHTML=TABS[cur][1]()+`<p class="foot" id="foot"></p>`;foot();
 for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>{cur=b.dataset.tab;paint();window.scrollTo({top:0});};
 for(const b of document.querySelectorAll('[data-copy]'))b.onclick=async()=>{const t=b.parentElement.textContent.replace(/^Copy/,'').trim();try{await navigator.clipboard.writeText(t);b.textContent='Copied';}catch{b.textContent='Select and copy';}setTimeout(()=>{b.textContent='Copy';},1600);};
}
let brand={};function foot(){const el=$('#foot');if(!el)return;const c=[brand.phone&&`call <a href="tel:${esc(String(brand.phone).replace(/\s/g,''))}">${esc(brand.phone)}</a>`,brand.whatsapp&&`WhatsApp <a href="https://wa.me/${esc(String(brand.whatsapp).replace(/\D/g,''))}">${esc(brand.whatsapp)}</a>`].filter(Boolean);el.innerHTML=c.length?'Still stuck? '+c.join(' or ')+'.':'';}
paint();
fetch('/portal/api/config').then(r=>r.json()).then(j=>{const c=j.config||j;brand={phone:c.phone,whatsapp:c.whatsapp};if(c.brandName)$('#brand').textContent=c.brandName;if(c.brandColor)document.documentElement.style.setProperty('--brand',c.brandColor);document.title='How to connect · '+(c.brandName||'PPPoE');foot();
 const h=[c.phone&&`<a href="tel:${esc(String(c.phone).replace(/\s/g,''))}">${esc(c.phone)}</a>`,c.whatsapp&&`<a href="https://wa.me/${esc(String(c.whatsapp).replace(/\D/g,''))}">WhatsApp</a>`].filter(Boolean);$('#help').innerHTML=h.length?'Need help? '+h.join(' '):'';}).catch(()=>{});
})();
