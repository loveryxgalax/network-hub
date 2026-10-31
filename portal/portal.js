'use strict';
// Hotspot landing page: nine switchable designs, your real packages, M-Pesa checkout, account lookup, and an admin
// design panel (?admin=1, shown only when you are signed into netops as admin). The router passes mac, ip, login,
// dst, chapId, chapChallenge, error in the address; after a payment the customer is logged in through the router.
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const params=new URLSearchParams(location.search);
const router={login:params.get('login')||'',dst:params.get('dst')||'',chapId:params.get('chapId')||'',chapChallenge:params.get('chapChallenge')||'',mac:params.get('mac')||''};
// Live "on the portal now" count for the netops dashboard: the view shown, pinged every 10 s while the page is visible.
const presence={page:'Packages',service:'hotspot',tab:Math.random().toString(36).slice(2,10),timer:null};
function here(page,service){if(page)presence.page=page;if(service)presence.service=service;if(params.get('admin')||params.get('frame'))return;
 fetch('/portal/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({page:presence.page,service:presence.service,mac:router.mac,nas:params.get('nas')||'',tab:presence.tab}),keepalive:true}).catch(()=>{});
 clearTimeout(presence.timer);presence.timer=setTimeout(()=>{if(!document.hidden)here();},10000);}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)here();});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ===================== DESIGNS ===================== */
const THEMES={
 classic:{label:'Classic',swatch:'linear-gradient(#fff 40%,#e2e8f0)',desc:'The standard portal page: account lookup up top, your packages beneath.'},
 spotlight:{label:'Spotlight',swatch:'linear-gradient(var(--brand) 55%,#f1f5f9 55%)',desc:'A bold hero in your brand colour with the account card rising out of it and packages as cards below.'},
 split:{label:'Split Screen',swatch:'linear-gradient(90deg,var(--brand) 45%,#fff 45%)',desc:'Your brand panel beside the sign-in on a laptop, stacked on a phone. Packages read as a clean price list.'},
 minimal:{label:'Minimal',swatch:'repeating-linear-gradient(#fafaf9 0 6px,#d6d3d1 6px 7px)',desc:'Quiet and typographic: lots of white space, thin rules, and packages listed like a menu.'},
 midnight:{label:'Midnight',swatch:'radial-gradient(circle at 50% 0,var(--brand),#05070f 70%)',desc:'A dark canvas lit by a glow in your brand colour, with glass cards. Striking at night and on OLED phones.'},
 christmas:{label:'Christmas',swatch:'linear-gradient(#8f1a20,#5a0b10)',desc:'Falling snow on a deep festive red, twinkling lights, and packages wrapped as gifts.'},
 futuristic:{label:'Futuristic',swatch:'linear-gradient(#03050c 50%,var(--brand))',desc:'A neon grid horizon, HUD-framed panels and monospace readouts, glowing in your brand colour.'},
 bento:{label:'Bento',swatch:'conic-gradient(var(--brand) 0 25%,#0f172a 0 50%,#fff 0 75%,#e2e8f0 0)',desc:'Everything in a tidy grid of rounded tiles, like a modern app home screen.'},
 elegant:{label:'Elegant',swatch:'linear-gradient(#f7f2e9 60%,#b58a3c 60% 64%,#f7f2e9 64%)',desc:'Ivory paper, a serif display face and gold hairlines, with an arched sign-in card and packages set like a fine menu.'}
};
const THEME_COPY={
 classic:{sw:{h:'Simamia Muunganisho Wako',e:'',a:'Akaunti yako',intro:'Karibu! Chagua kifurushi uunganishwe.'},en:{h:'Manage Your Connection',e:'',a:'Your account',intro:'Welcome! Pick a package to get connected.'}},
 spotlight:{sw:{h:'Karibu {brand}',e:'Portal ya wateja',a:'Fikia akaunti yako',intro:'Internet ya kasi, popote ulipo.'},en:{h:'Welcome to {brand}',e:'Customer portal',a:'Access your account',intro:'Fast internet, wherever you are.'}},
 split:{sw:{h:'',e:'',a:'Simamia Muunganisho Wako',intro:'Hotspot na fiber kwa nyumba na biashara.'},en:{h:'',e:'',a:'Manage Your Connection',intro:'Hotspot and fiber for home and business.'}},
 minimal:{sw:{h:'{brand}',e:'Portal ya wateja',a:'Akaunti',intro:'Internet rahisi. Bei wazi.'},en:{h:'{brand}',e:'Customer portal',a:'Account',intro:'Simple internet. Clear prices.'}},
 midnight:{sw:{h:'{brand}',e:'Portal ya wateja',a:'Fikia akaunti yako',intro:'Imeunganishwa mchana na usiku.'},en:{h:'{brand}',e:'Customer portal',a:'Access your account',intro:'Connected day and night.'}},
 christmas:{sw:{h:'Krismasi Njema kutoka {brand}',e:'Salamu za msimu',a:'Fikia akaunti yako',intro:'Endelea kuunganishwa msimu huu wa sikukuu.'},en:{h:'Merry Christmas from {brand}',e:"Season's greetings",a:'Access your account',intro:'Stay connected this festive season.'}},
 futuristic:{sw:{h:'{brand}',e:'Hali ya mtandao: Iko hewani',a:'Kituo cha ufikiaji',intro:'Muunganisho wa kizazi kijacho.'},en:{h:'{brand}',e:'Network status: online',a:'Access terminal',intro:'Next-generation connectivity.'}},
 bento:{sw:{h:'{brand}',e:'',a:'Simamia Muunganisho Wako',intro:'Kila kitu mahali pamoja.'},en:{h:'{brand}',e:'',a:'Manage Your Connection',intro:'Everything in one place.'}},
 elegant:{sw:{h:'{brand}',e:'Karibu',a:'Karibu tena',intro:'Muunganisho wa hali ya juu, kwa utulivu.'},en:{h:'{brand}',e:'Welcome',a:'Welcome back',intro:'Refined connectivity, quietly reliable.'}}
};

/* ===================== STRINGS ===================== */
const STR={
 sw:{expiredTitle:'Internet yako imeisha muda',expiredSub:'Lipia hapa chini urudi mtandaoni. Weka nambari ya akaunti au nambari ya simu iliyo kwenye akaunti yako.',termsTitle:'Masharti ya huduma',close:'Funga',adLabel:'Tangazo',adEarn:'Tazama kwa sekunde {n} upate dakika {m} bure',adWait:'Endelea kutazama… {n}s',adClaim:'Pata dakika {m} bure',adOpen:'Jua zaidi',quizTitle:'Jibu na utumie bure',quizBtn:'Tuma jibu',quizWin:'Sahihi! Tunakuunganisha kwa dakika {m} bure…',quizWrong:'Si sahihi. Jaribu tena kesho.',quizFor:'Jibu sahihi = dakika {m} bure',needHelp:'Unahitaji msaada?',manageSub:'Weka maelezo ya akaunti yako kufikia muunganisho wako',otgTitle:'Tumia WiFi yetu ya On-the-Go popote ulipo',otgSub:'Vifurushi nafuu kwenye hotspot zetu',
  accountLead:'Weka namba ya akaunti au bandika ujumbe kutoka kwetu.',detecting:'Tunatafuta muunganisho wako kwenye mtandao huu…',notFound:'Hatukupata muunganisho kwenye kifaa hiki. Tumia namba ya akaunti hapa chini.',found:'Tumekupata!',
  connectFind:'Unganisha na akaunti yako ya {brand}.',findBtn:'Tafuta akaunti yangu',howTitle:'Jinsi ya kufikia akaunti yako',how1:'Weka namba yako ya akaunti au jina la mtumiaji',how2:'Au bandika ujumbe wowote kutoka kwetu (uthibitisho wa malipo, SMS, n.k.)',
  accLabel:'Namba ya akaunti ya {brand}, au ujumbe kutoka kwetu',accPh:'Weka namba ya akaunti au bandika ujumbe kutoka kwetu…',accExample:'Mfano: {prefix}-ABC123, au bandika uthibitisho wa malipo tuliokutumia',accessBtn:'Fikia Akaunti Yangu',
  accEmpty:'Tafadhali weka namba ya akaunti au bandika ujumbe.',wantPlan:'Unataka kifurushi kingine?',wantBtn:'Omba kifurushi hiki',wantDone:'Ombi limetumwa. Tutakupigia simu kubadilisha kifurushi.',accFound:'Namba ya akaunti imepatikana: ',searching:'Inatafuta…',noAccount:'Hatukupata akaunti hiyo. Angalia namba na ujaribu tena.',
  hotspotTitle:'Vifurushi vya Hotspot',hotspotSub:'Lipa kwa M-Pesa, unganishwa mara moja',pppoeTitle:'Internet ya Nyumbani (PPPoE)',pppoeSub:'Kwa mwezi',contactTitle:'Wasiliana nasi',call:'Piga simu',whatsapp:'WhatsApp',email:'Barua pepe',
  popular:'MAARUFU',per_month:'/mwezi',splitHeadline:'Internet inayofanya kazi tu.',chipHotspot:'WiFi ya Hotspot',chipFiber:'Fiber ya PPPoE',contact:'Mawasiliano',privacy:'Faragha',terms:'Masharti',rights:'Haki zote zimehifadhiwa.',
  youPicked:'Umechagua',homeInternet:'Internet ya nyumbani',payBuy:'Lipa kwa M-Pesa',buyNote:'Utapokea ombi kwenye simu. Weka PIN yako ya M-Pesa kulipa.',pppoeNote:'Tunaweka internet nyumbani au ofisini kwako. Tupigie au tuandikie WhatsApp tukuunganishe.',
  upTo:'hadi Mbps {n}',msgTitle:'Tuachie ujumbe',msgName:'Jina lako',msgPhone:'Nambari ya simu',msgText:'Ujumbe',msgSend:'Tuma',msgDone:'Asante! Tutakupigia au kukutumia SMS hivi karibuni.',devices:'vifaa {n}',device:'kifaa 1',unlimited:'Bila kikomo',noPlans:'Hakuna vifurushi kwa sasa.',loadFail:'Imeshindwa kupakia vifurushi. Onyesha upya ukurasa.',noMpesa:'Malipo ya M-Pesa bado hayapatikani. Kama una msimbo, ingia nao.',
  checkPhone:'Angalia simu yako',sending:'Tunatuma ombi la M-Pesa…',enterPin:'Weka PIN yako ya M-Pesa kulipa {a}.',stillWaiting:'Bado tunasubiri M-Pesa… inaweza kuchukua dakika moja.',notCompleted:'Malipo hayakukamilika.',
  paid:'Malipo yamepokelewa',accActive:'Akaunti <strong>{u}</strong> iko hai hadi <strong>{d}</strong>.',restart:'Usipounganishwa ndani ya dakika moja, zima na uwashe router yako.',wifiActive:'Wi-Fi yako iko hai hadi <strong>{d}</strong>. Hifadhi hizi uingie kwenye kifaa kingine:',
  code:'Msimbo',password:'Nenosiri',connecting:'Tunakuunganisha sasa…',joinWifi:'Jiunge na Wi-Fi ya {b} na uingie kwa msimbo huu.',ok:'Sawa',valid:'Msimbo huu ni sahihi. Jiunge na Wi-Fi ya {b} kuutumia.',
  statusActive:'Iko hai',statusExpired:'Imeisha muda',statusSuspended:'Imezimwa',until:'Hadi {d}',expiredOn:'Iliisha {d}',suspendedMsg:'Akaunti hii imezimwa. Wasiliana nasi.',passLabel:'Nenosiri',connect:'Unganisha',
  renew:'Lipia {a}',payCard:'Lipa kwa kadi',cardEmail:'Barua pepe (kwa risiti ya kadi)',cardOpening:'Inafungua ukurasa salama wa kadi…',cardChecking:'Tunathibitisha malipo ya kadi…',qty:'Ngapi',qtyOpt:'{n} × ({p})',trialBtn:'Jaribu bure kwa dakika {n}',trialUsed:'Kifaa hiki kimeshajaribu bure.',pinLabel:'PIN (hiari, kuona salio na matumizi)',pinWrong:'PIN si sahihi.',mpesaLabel:'Nambari ya M-Pesa',promo:'Msimbo wa punguzo (hiari)',freeTitle:'WiFi ya bure sasa!',freeUntil:'Mpaka saa {t}.',freeGo:'Unganisha bure',freeNeedWifi:'Fungua ukurasa huu ukiwa kwenye WiFi yetu.',wallet:'Akiba',dataMonth:'Data mwezi huu'},
 en:{expiredTitle:'Your internet has expired',expiredSub:'Renew below to get back online. Enter your account number or the phone number on your account.',termsTitle:'Terms of service',close:'Close',adLabel:'Sponsored',adEarn:'Watch for {n} seconds to get {m} free minutes',adWait:'Keep watching… {n}s',adClaim:'Get {m} free minutes',adOpen:'Learn more',quizTitle:'Answer and browse free',quizBtn:'Submit answer',quizWin:'Correct! Connecting you for {m} free minutes…',quizWrong:'Not quite. Try again tomorrow.',quizFor:'Right answer = {m} free minutes',needHelp:'Need help?',manageSub:'Enter your account details to manage your connection',otgTitle:'Use our On-the-Go WiFi wherever you are',otgSub:'Affordable packages at our hotspots',
  accountLead:'Enter your account number or paste a message from us.',detecting:'Looking for your connection on this network…',notFound:"We couldn't find a connection on this device. Use your account number below.",found:'Found you!',
  connectFind:'Connect to your {brand} account.',findBtn:'Find my account',howTitle:'How to access your account',how1:'Enter your account number or username',how2:'Or paste any message from us (payment confirmation, SMS notification, etc.)',
  accLabel:'Your {brand} account number, or a message from us',accPh:'Enter your account number or paste a message from us…',accExample:'Example: {prefix}-ABC123, or paste a payment confirmation we sent you',accessBtn:'Access My Account',
  accEmpty:'Please enter your account number or paste a message.',wantPlan:'Want a different package?',wantBtn:'Request this package',wantDone:'Request sent. We will contact you to change your package.',accFound:'Account number detected: ',searching:'Searching…',noAccount:"We couldn't find that account. Check the number and try again.",
  hotspotTitle:'Hotspot packages',hotspotSub:'Pay with M-Pesa, connect instantly',pppoeTitle:'Home internet (PPPoE)',pppoeSub:'Monthly',contactTitle:'Contact us',call:'Call us',whatsapp:'WhatsApp',email:'Email',
  popular:'POPULAR',per_month:'/mo',splitHeadline:'Internet that just works.',chipHotspot:'Hotspot WiFi',chipFiber:'PPPoE Fiber',contact:'Contact',privacy:'Privacy',terms:'Terms',rights:'All rights reserved.',
  youPicked:'You picked',homeInternet:'Home internet',payBuy:'Pay with M-Pesa',buyNote:"You'll get a prompt on your phone. Enter your M-Pesa PIN to pay.",pppoeNote:'We install internet at your home or office. Call or WhatsApp us and we will get you connected.',
  upTo:'up to {n} Mbps',msgTitle:'Leave a message',msgName:'Your name',msgPhone:'Phone number',msgText:'Message',msgSend:'Send',msgDone:'Thank you! We will call or text you soon.',devices:'{n} devices',device:'1 device',unlimited:'Unlimited',noPlans:'No packages are on sale right now.',loadFail:'Could not load packages. Refresh the page.',noMpesa:'M-Pesa payments are not available yet. If you have a code, log in with it.',
  checkPhone:'Check your phone',sending:'Sending the M-Pesa prompt…',enterPin:'Enter your M-Pesa PIN to pay {a}.',stillWaiting:'Still waiting for M-Pesa… this can take a minute.',notCompleted:'Payment was not completed.',
  paid:'Payment received',accActive:'Account <strong>{u}</strong> is active until <strong>{d}</strong>.',restart:'If you are not online within a minute, restart your router.',wifiActive:'Your Wi-Fi is active until <strong>{d}</strong>. Save these to log in on another device:',
  code:'Code',password:'Password',connecting:'Connecting you now…',joinWifi:'Join the {b} Wi-Fi and log in with this code.',ok:'OK',valid:'This code is valid. Join the {b} Wi-Fi to use it.',
  statusActive:'Active',statusExpired:'Expired',statusSuspended:'Deactivated',until:'Until {d}',expiredOn:'Expired {d}',suspendedMsg:'This account is deactivated. Please contact us.',passLabel:'Password',connect:'Connect',
  renew:'Renew {a}',payCard:'Pay with card',cardEmail:'Email (for the card receipt)',cardOpening:'Opening the secure card page…',cardChecking:'Checking your card payment…',qty:'How many',qtyOpt:'{n} × ({p})',trialBtn:'Try free for {n} minutes',trialUsed:'This device has already had a free trial.',pinLabel:'PIN (optional, to see balance and usage)',pinWrong:'Wrong PIN.',mpesaLabel:'M-Pesa number',promo:'Promo code (optional)',freeTitle:'Free WiFi now!',freeUntil:'Until {t}.',freeGo:'Connect free',freeNeedWifi:'Open this page while connected to our WiFi.',wallet:'Wallet',dataMonth:'Data this month'}
};
STR.fr={expiredTitle:'Votre internet a expiré',expiredSub:'Renouvelez ci-dessous pour revenir en ligne. Saisissez votre numéro de compte ou le numéro de téléphone du compte.',termsTitle:"Conditions d'utilisation",close:'Fermer',adLabel:'Sponsorisé',adEarn:'Regardez {n} secondes pour obtenir {m} minutes gratuites',adWait:'Continuez à regarder… {n}s',adClaim:'Obtenir {m} minutes gratuites',adOpen:'En savoir plus',quizTitle:'Répondez et naviguez gratuitement',quizBtn:'Envoyer la réponse',quizWin:'Bonne réponse ! Connexion pour {m} minutes gratuites…',quizWrong:'Pas tout à fait. Réessayez demain.',quizFor:'Bonne réponse = {m} minutes gratuites',
 needHelp:"Besoin d'aide ?",manageSub:'Saisissez les informations de votre compte pour gérer votre connexion',otgTitle:'Utilisez notre WiFi nomade où que vous soyez',otgSub:'Forfaits abordables sur nos hotspots',
 accountLead:'Saisissez votre numéro de compte ou collez un message de notre part.',detecting:'Recherche de votre connexion sur ce réseau…',notFound:"Aucune connexion trouvée sur cet appareil. Utilisez votre numéro de compte ci-dessous.",found:'Trouvé !',
 connectFind:'Connectez-vous à votre compte {brand}.',findBtn:'Trouver mon compte',howTitle:'Comment accéder à votre compte',how1:"Saisissez votre numéro de compte ou nom d'utilisateur",how2:"Ou collez n'importe quel message de notre part (confirmation de paiement, SMS, etc.)",
 accLabel:'Votre numéro de compte {brand}, ou un message de notre part',accPh:'Saisissez votre numéro de compte ou collez un message…',accExample:'Exemple : {prefix}-ABC123, ou collez une confirmation de paiement',accessBtn:'Accéder à mon compte',
 accEmpty:'Veuillez saisir votre numéro de compte ou coller un message.',wantPlan:'Un autre forfait ?',wantBtn:'Demander ce forfait',wantDone:'Demande envoyée. Nous vous contacterons pour changer de forfait.',accFound:'Numéro de compte détecté : ',searching:'Recherche…',noAccount:"Compte introuvable. Vérifiez le numéro et réessayez.",
 hotspotTitle:'Forfaits hotspot',hotspotSub:'Payez par M-Pesa, connexion immédiate',pppoeTitle:'Internet à domicile (PPPoE)',pppoeSub:'Mensuel',contactTitle:'Nous contacter',call:'Appelez-nous',whatsapp:'WhatsApp',email:'E-mail',
 popular:'POPULAIRE',per_month:'/mois',splitHeadline:'Un internet qui marche, tout simplement.',chipHotspot:'WiFi hotspot',chipFiber:'Fibre PPPoE',contact:'Contact',privacy:'Confidentialité',terms:'Conditions',rights:'Tous droits réservés.',
 youPicked:'Votre choix',homeInternet:'Internet à domicile',payBuy:'Payer avec M-Pesa',buyNote:'Vous recevrez une demande sur votre téléphone. Saisissez votre code M-Pesa pour payer.',pppoeNote:"Nous installons internet chez vous ou au bureau. Appelez-nous ou écrivez sur WhatsApp et nous vous connecterons.",
 upTo:"jusqu'à {n} Mbps",msgTitle:'Laissez un message',msgName:'Votre nom',msgPhone:'Numéro de téléphone',msgText:'Message',msgSend:'Envoyer',msgDone:'Merci ! Nous vous appellerons ou vous enverrons un SMS bientôt.',devices:'{n} appareils',device:'1 appareil',unlimited:'Illimité',noPlans:"Aucun forfait n'est en vente pour le moment.",loadFail:'Impossible de charger les forfaits. Actualisez la page.',noMpesa:"Les paiements M-Pesa ne sont pas encore disponibles. Si vous avez un code, connectez-vous avec.",
 checkPhone:'Vérifiez votre téléphone',sending:'Envoi de la demande M-Pesa…',enterPin:'Saisissez votre code M-Pesa pour payer {a}.',stillWaiting:'En attente de M-Pesa… cela peut prendre une minute.',notCompleted:"Le paiement n'a pas abouti.",
 paid:'Paiement reçu',accActive:"Le compte <strong>{u}</strong> est actif jusqu'au <strong>{d}</strong>.",restart:"Si vous n'êtes pas en ligne d'ici une minute, redémarrez votre routeur.",wifiActive:"Votre Wi-Fi est actif jusqu'au <strong>{d}</strong>. Gardez ces informations pour vous connecter sur un autre appareil :",
 code:'Code',password:'Mot de passe',connecting:'Connexion en cours…',joinWifi:'Rejoignez le Wi-Fi {b} et connectez-vous avec ce code.',ok:'OK',valid:'Ce code est valide. Rejoignez le Wi-Fi {b} pour l’utiliser.',
 statusActive:'Actif',statusExpired:'Expiré',statusSuspended:'Désactivé',until:"Jusqu'au {d}",expiredOn:'Expiré le {d}',suspendedMsg:'Ce compte est désactivé. Veuillez nous contacter.',passLabel:'Mot de passe',connect:'Se connecter',
 renew:'Renouveler {a}',payCard:'Payer par carte',cardEmail:'E-mail (pour le reçu de carte)',cardOpening:'Ouverture de la page de paiement sécurisée…',cardChecking:'Vérification de votre paiement par carte…',qty:'Combien',qtyOpt:'{n} × ({p})',trialBtn:'Essai gratuit de {n} minutes',trialUsed:'Cet appareil a déjà eu un essai gratuit.',pinLabel:'PIN (facultatif, pour voir le solde et la consommation)',pinWrong:'PIN incorrect.',mpesaLabel:'Numéro M-Pesa',promo:'Code promo (facultatif)',freeTitle:'WiFi gratuit maintenant !',freeUntil:"Jusqu'à {t}.",freeGo:'Se connecter gratuitement',freeNeedWifi:'Ouvrez cette page en étant connecté à notre WiFi.',wallet:'Portefeuille',dataMonth:'Données ce mois-ci'};
const THEME_FR={classic:{h:'Gérez votre connexion',e:'',a:'Votre compte',intro:'Bienvenue ! Choisissez un forfait pour vous connecter.'},spotlight:{h:'Bienvenue chez {brand}',e:'Portail client',a:'Accédez à votre compte',intro:'Internet rapide, où que vous soyez.'},split:{h:'',e:'',a:'Gérez votre connexion',intro:'Hotspot et fibre pour la maison et le bureau.'},minimal:{h:'{brand}',e:'Portail client',a:'Compte',intro:'Internet simple. Prix clairs.'},midnight:{h:'{brand}',e:'Portail client',a:'Accédez à votre compte',intro:'Connecté jour et nuit.'},christmas:{h:'Joyeux Noël de la part de {brand}',e:'Meilleurs vœux',a:'Accédez à votre compte',intro:'Restez connecté pendant les fêtes.'},futuristic:{h:'{brand}',e:'État du réseau : en ligne',a:"Terminal d'accès",intro:'La connexion nouvelle génération.'},bento:{h:'{brand}',e:'',a:'Gérez votre connexion',intro:'Tout au même endroit.'},elegant:{h:'{brand}',e:'Bienvenue',a:'Bon retour',intro:'Une connectivité raffinée et fiable.'}};
for(const k of Object.keys(THEME_FR))THEME_COPY[k].fr=THEME_FR[k];


/* ===================== STATE ===================== */
let CFG={theme:'midnight',brandName:'Kade Networks',brandColor:'#0032fd',intro:'',defaultLang:'sw',phone:'',whatsapp:'',email:'info@kadenetworks.com',accountPrefix:'KNE',popular:'',
 show:{pppoe:true,hotspot:true,findAccount:true,accessAccount:true,onTheGo:true,contact:true}};
let plans=[],pppoePlans=[],mpesaOn=true,cardOn=false,state='loading',LANG='sw',selected=null,polling=null,lastKind='hotspot',csrf='',isAdmin=false;
try{const s=localStorage.getItem('portal-lang');if(s&&STR[s])LANG=s;}catch{}
const fmt=s=>String(s||'').replaceAll('{brand}',CFG.brandName).replaceAll('{prefix}',CFG.accountPrefix);
const t=(k,vars={})=>fmt(STR[LANG][k]??STR.en[k]??k).replace(/\{(\w+)\}/g,(m,v)=>vars[v]??m);
const tc=k=>fmt(THEME_COPY[CFG.theme][LANG][k]);
const kes=n=>'KES '+Number(n).toLocaleString();
const when=ms=>ms?new Date(ms).toLocaleString('en-KE',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';
const ICON={
 wifi:'<svg class="i" viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/></svg>',
 arrow:'<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
 phone:'<svg class="i" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
 chat:'<svg class="i" viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/></svg>',
 mail:'<svg class="i" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>'
};
async function call(path,options={}){const r=await fetch('/portal/api/'+path,{...options,headers:{'Content-Type':'application/json'}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Something went wrong. Try again.');return data;}
function inkFor(hex){const n=parseInt(hex.replace('#',''),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;return (0.299*r+0.587*g+0.114*b)>170?'#0f172a':'#ffffff';}
const digits=s=>String(s||'').replace(/\D/g,''),intl=s=>{const d=digits(s);return d.startsWith('0')?'254'+d.slice(1):d;};

/* ===================== RENDER ===================== */
function packageList(list,monthly,hotspot){
 return list.length?list.map(p=>{const sp=CFG.show.speed!==false?t('upTo',{n:p.downloadMbps}):'',meta=(hotspot?[p.duration,sp,p.devices>1?t('devices',{n:p.devices}):t('device')]:[sp,t('unlimited')]).filter(Boolean);
  const pop=p.popular||(CFG.popular&&p.name.toLowerCase()===CFG.popular.toLowerCase()),off=p.available===false;
  if(p.features?.length)meta.splice(0,meta.length,...p.features.slice(0,3));
  return `<button class="pkg ${pop?'pop':''} ${off?'off':''}" ${off?`disabled title="${esc(p.availability||'')}"`:''} data-badge="${esc(t('popular'))}" data-pkg="${esc(p.id)}" data-kind="${hotspot?'hotspot':'pppoe'}" type="button"><span class="name">${esc(p.name)}</span><span class="meta">${esc(meta.join(' · '))}</span>${off?`<span class="meta">${esc(p.availability||'')}</span>`:''}<span class="price">${kes(p.price)}${monthly?` <small>${esc(p.duration==='30 days'||p.duration==='1 month'?t('per_month'):'/ '+p.duration)}</small>`:''}</span></button>`;}).join(''):`<p class="empty-pkgs">${esc(state==='error'?t('loadFail'):t('noPlans'))}</p>`;}
function render(){
 const b=document.body;b.dataset.theme=CFG.theme;b.dataset.layout=CFG.packageLayout||'auto';if(params.get('frame')==='phone')b.classList.add('phone-frame');document.documentElement.style.setProperty('--brand',CFG.brandColor);document.documentElement.style.setProperty('--brand-ink',inkFor(CFG.brandColor));document.documentElement.lang=LANG;
 document.title=`${CFG.brandName} Wi-Fi`;const intro=CFG.intro?.trim()?CFG.intro:tc('intro');
 $$('[data-bind=brandName]').forEach(e=>e.textContent=CFG.brandName);$$('[data-bind=intro]').forEach(e=>e.textContent=intro);
 $$('[data-i18n]').forEach(e=>e.textContent=t(e.dataset.i18n));$$('[data-i18n-ph]').forEach(e=>e.placeholder=t(e.dataset.i18nPh));
 $$('[data-i18n-theme=eyebrow]').forEach(e=>{e.textContent=tc('e');e.classList.toggle('hide',!tc('e'));});$$('[data-i18n-theme=accountTitle]').forEach(e=>e.textContent=tc('a'));$$('[data-headline]').forEach(e=>e.textContent=tc('h')||CFG.brandName);
 $$('[data-logo]').forEach(e=>e.innerHTML=`<img src="${esc(CFG.logoUrl||'/img/kade-mark.png')}" alt="">`);
 $$('[data-phone]').forEach(e=>{e.classList.toggle('hide',!CFG.phone);e.href=`tel:${CFG.phone.replace(/\s/g,'')}`;e.textContent=CFG.phone;});
 $$('[data-whatsapp]').forEach(e=>{e.classList.toggle('hide',!CFG.whatsapp);e.href=`https://wa.me/${intl(CFG.whatsapp)}`;e.textContent=`WhatsApp ${CFG.whatsapp}`;});
 const otg=`<span class="ico">${ICON.wifi}</span><span><b>${esc(t('otgTitle'))}</b><small>${esc(t('otgSub'))}</small></span><span class="arrow">${ICON.arrow}</span>`;
 $$('[data-otg]').forEach(e=>{e.href='#packages';e.innerHTML=otg;e.classList.toggle('hide',!CFG.show.onTheGo);});
 $$('[data-otg-tile]').forEach(e=>{e.href='#packages';e.innerHTML=`<span class="ico">${ICON.wifi}</span><b>${esc(t('otgTitle'))}</b><small>${esc(t('otgSub'))}</small>`;e.style.display=CFG.show.onTheGo?'':'none';});
 $$('[data-lang]').forEach(e=>e.innerHTML=['sw','en','fr'].map(l=>`<button type="button" data-l="${l}" class="${l===LANG?'on':''}">${{sw:'Kiswahili',en:'English',fr:'Français'}[l]}</button>`).join(''));
 $('#hotspotPkgs').innerHTML=state==='loading'?'<div class="pkg skeleton"></div><div class="pkg skeleton"></div><div class="pkg skeleton"></div><div class="pkg skeleton"></div>':packageList(plans,false,true);
 $('#pppoePkgs').innerHTML=packageList(pppoePlans,true,false);
 const contactItems=[];if(CFG.phone)contactItems.push(`<a href="tel:${esc(CFG.phone.replace(/\s/g,''))}"><span class="ico">${ICON.phone}</span><span><b>${t('call')}</b><small>${esc(CFG.phone)}</small></span></a>`);
 if(CFG.whatsapp)contactItems.push(`<a href="https://wa.me/${esc(intl(CFG.whatsapp))}" rel="noopener"><span class="ico">${ICON.chat}</span><span><b>${t('whatsapp')}</b><small>${esc(CFG.whatsapp)}</small></span></a>`);
 if(CFG.email)contactItems.push(`<a href="mailto:${esc(CFG.email)}"><span class="ico">${ICON.mail}</span><span><b>${t('email')}</b><small>${esc(CFG.email)}</small></span></a>`);
 $('#contact').innerHTML=contactItems.join('')+(CFG.show.message?`<form id="msg-form" class="msg-form"><h3>${esc(t('msgTitle'))}</h3><label class="fl">${esc(t('msgName'))}<input name="name" maxlength="60" autocomplete="name" required></label><label class="fl">${esc(t('msgPhone'))}<input name="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" required></label><label class="fl">${esc(t('msgText'))}<textarea name="message" maxlength="600" rows="3" required></textarea></label><button class="btn" type="submit"><span>${esc(t('msgSend'))}</span> ${ICON.arrow}</button></form>`:'');
 const mf=$('#msg-form');if(mf)mf.onsubmit=async e=>{e.preventDefault();const b=mf.querySelector('button');b.disabled=true;try{await call('message',{method:'POST',body:JSON.stringify({name:mf.name.value,phone:mf.phone.value,message:mf.message.value})});mf.innerHTML=`<p class="msg">${esc(t('msgDone'))}</p>`;}catch(err){b.disabled=false;alertBox(err.message,true);}};
 $('#footer').innerHTML=`<span>© ${new Date().getFullYear()} ${esc(CFG.brandName)}. ${t('rights')}</span><span class="spacer"></span>${CFG.terms?`<a href="#" id="terms-link">${t('terms')}</a>`:''}${CFG.email?`<a href="mailto:${esc(CFG.email)}">${t('contact')}</a>`:''}`;
 const tl=$('#terms-link');if(tl)tl.onclick=e=>{e.preventDefault();showTerms();};
 renderExpired();renderEngage();
 $('#hotspotCard').parentElement.classList.toggle('hide',!CFG.show.hotspot);$('#pppoeWrap').classList.toggle('hide',!(CFG.show.pppoe&&pppoePlans.length));
 $('#findBtn').classList.toggle('hide',!CFG.show.findAccount);$('#detect').classList.toggle('hide',!CFG.show.findAccount);
 $('#accForm').classList.toggle('hide',!CFG.show.accessAccount);$('#howto').classList.toggle('hide',!CFG.show.accessAccount);$('#accResult').classList.toggle('hide',!CFG.show.accessAccount);
 $('#accountCol').classList.toggle('hide',!CFG.show.findAccount&&!CFG.show.accessAccount);$('.contactCard').classList.toggle('hide',!CFG.show.contact||!(contactItems.length||CFG.show.message));
 $('.lights').innerHTML=Array.from({length:24},()=>'<i></i>').join('');CFG.theme==='christmas'?startSnow():stopSnow();
 if(isAdmin)renderAdmin();
 renderFree();
}

/* ===================== ACCOUNT ===================== */
function extractAccount(text){const m=new RegExp(`\\b${CFG.accountPrefix}[-\\s]?[A-Z0-9]{3,}\\b`,'i').exec(text);return m?m[0].toUpperCase().replace(/\s/,'-'):null;}
function showMsg(text,err=false){const m=$('#accMsg');m.className='msg'+(err?' err':'');m.textContent=text||'';}
function alertBox(text,ok=false){const el=$('#portal-alert');if(!el)return;el.textContent=text;el.classList.toggle('ok',ok);el.hidden=!text;if(text)el.scrollIntoView({block:'center',behavior:'smooth'});}
function renderAccount(a){here('Account');
 setTimeout(()=>{const w=$('#want-form');if(w)w.onsubmit=async e=>{e.preventDefault();const b=w.querySelector('button');b.disabled=true;try{await call('interest',{method:'POST',body:JSON.stringify({account:a.account,planId:w.planId.value,pin:($('#acc-pin')?.value||'').trim()||undefined})});w.innerHTML=`<p class="msg">${esc(t('wantDone'))}</p>`;}catch(err){b.disabled=false;alertBox(err.message,true);}};},0);
 const box=$('#accResult');
 if(!a.found){box.innerHTML='';return showMsg(t('noAccount'),true);}
 showMsg(a.pinError?t('pinWrong'):'',!!a.pinError);
 const label={active:t('statusActive'),expired:t('statusExpired'),suspended:t('statusSuspended'),unpaid:t('statusExpired')}[a.status]||a.status,when2=a.status==='active'?t('until',{d:when(a.expiresAt)}):a.status==='expired'?(a.expiresAt?t('expiredOn',{d:when(a.expiresAt)}):''):'';
 let html=`<div class="acc-result"><div class="top"><b>${esc(a.account.toUpperCase())}</b><span class="badge ${esc(a.status)}">${esc(label)}</span></div><div class="facts">${esc([a.plan,when2].filter(Boolean).join(' · '))}</div>`;
 if(a.verified)html+=`<div class="facts">${esc(t('wallet'))}: ${kes(a.balance||0)}${a.points?' · '+a.points+' pts':''}${CFG.show.usage!==false&&(a.monthDown||a.monthUp)?' · '+esc(t('dataMonth'))+': '+(((a.monthDown||0)+(a.monthUp||0))/1073741824).toFixed(1)+' GB':''}</div>`;
 if(a.status==='suspended')html+=`<p class="muted small">${esc(t('suspendedMsg'))}</p>`;
 else{
  if(a.service==='hotspot'&&a.status==='active')html+=`<form id="login-form" autocomplete="off"><label class="fl">${esc(t('passLabel'))}<input name="password" type="password" required autocomplete="current-password"></label><button class="btn" type="submit"><span>${esc(t('connect'))}</span> ${ICON.arrow}</button></form>`;
  if(a.price&&mpesaOn)html+=`<form id="renew-form"><label class="fl">${esc(t('mpesaLabel'))}<input name="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" required></label><label class="fl">${esc(t('promo'))}<input name="promo" autocomplete="off" maxlength="24" autocapitalize="characters"></label><button class="btn ${a.service==='hotspot'&&a.status==='active'?'ghost':''}" type="submit"><span>${esc(t('renew',{a:kes(a.price)}))}</span> ${ICON.arrow}</button></form>`;
 }
 // PPPoE customers can ask for another package (ISPman's "interested in another package"); staff see it in netops.
 if(a.service==='pppoe'&&a.status!=='suspended'&&pppoePlans.length>1)html+=`<form id="want-form" class="want-form"><label class="fl">${esc(t('wantPlan'))}<select name="planId">${pppoePlans.filter(p=>p.name!==a.plan).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${kes(p.price)}</option>`).join('')}</select></label><button class="btn ghost" type="submit">${esc(t('wantBtn'))}</button></form>`;
 box.innerHTML=html+'</div>';
 const lf=$('#login-form');if(lf)lf.onsubmit=async e=>{e.preventDefault();const btn=lf.querySelector('button');btn.disabled=true;alertBox('');try{if(!(await routerLogin(a.account,lf.password.value)))alertBox(t('valid',{b:CFG.brandName}),true);}catch(error){alertBox(error.message);}finally{btn.disabled=false;}};
 const rf=$('#renew-form');if(rf)rf.onsubmit=e=>{e.preventDefault();pay({kind:'account',username:a.account,phone:rf.phone.value,promo:rf.promo?rf.promo.value:''});};
}
$('#acc').addEventListener('input',e=>{const v=e.target.value,acc=extractAccount(v),box=$('#detectedAcc');if(acc&&acc!==v.trim().toUpperCase()){box.textContent=t('accFound')+acc;box.classList.remove('hide');}else box.classList.add('hide');});
$('#accForm').addEventListener('submit',async e=>{e.preventDefault();const raw=$('#acc').value.trim();if(!raw){$('#accResult').innerHTML='';return showMsg(t('accEmpty'),true);}
 showMsg(t('searching'));try{const pin=($('#acc-pin')?.value||'').trim();renderAccount(await call('account',{method:'POST',body:JSON.stringify({query:extractAccount(raw)||raw,pin:pin||undefined})}));}catch(error){showMsg(error.message,true);}});
async function detectSession(){
 const box=$('#detect');box.className='detect';box.innerHTML=`<div class="spin"></div><span>${esc(t('detecting'))}</span>`;
 const notFound=()=>{box.innerHTML=`<span>${ICON.wifi}</span><span>${esc(t('notFound'))}</span>`;};
 if(!router.mac)return setTimeout(notFound,1400);
 try{const d=await call('session?mac='+encodeURIComponent(router.mac));if(!d.found)throw 0;box.classList.add('found');box.innerHTML=`<span style="color:#16a34a">${ICON.wifi}</span><span><b>${esc(t('found'))}</b> ${esc(d.account.toUpperCase())}</span>`;$('#acc').value=d.account.toUpperCase();renderAccount(d);}
 catch{setTimeout(notFound,900);}
}
$('#findBtn').addEventListener('click',detectSession);

/* ===================== BUY SHEET & PAYMENT ===================== */
function openSheet(id,kind){
 const p=(kind==='pppoe'?pppoePlans:plans).find(x=>x.id===id);if(!p)return;selected={id,kind};here(kind==='pppoe'?'PPPoE Package':'Purchase Package',kind==='pppoe'?'pppoe':'hotspot');
 const home=kind==='pppoe';$('#sheet-kicker').textContent=home?t('homeInternet'):t('youPicked');$('#sheet-name').textContent=p.name;$('#sheet-price').textContent=kes(p.price);
 const sp=CFG.show.speed!==false?t('upTo',{n:p.downloadMbps}):'';$('#sheet-facts').innerHTML=(home?[sp,t('unlimited'),p.duration]:[p.duration,sp,p.devices>1?t('devices',{n:p.devices}):t('device')]).filter(Boolean).map(f=>`<li>${esc(f)}</li>`).join('');
 const qs=$('#sheet-qty'),ql=$('#sheet-qty-label'),cu=!home&&p.custom;ql.classList.toggle('hide',!cu);if(cu){const price=n=>{const d=[...(p.custom.discounts||[])].reverse().find(x=>n>=x.minQty);return n===1?p.price:Math.max(1,Math.ceil(p.price*n*(1-(d?d.percent:0)/100)));};qs.innerHTML=Array.from({length:p.custom.maxQty},(_,i)=>i+1).map(n=>`<option value="${n}">${esc(t('qtyOpt',{n,p:kes(price(n))}))}</option>`).join('');qs.value='1';qs.onchange=()=>{$('#sheet-price').textContent=kes(price(Number(qs.value)));};}else qs.innerHTML='<option value="1">1</option>';
 const tb=$('#sheet-trial'),tr=!home&&p.trial;tb.classList.toggle('hide',!tr);if(tr){tb.textContent=t('trialBtn',{n:p.trial.minutes});tb.onclick=async()=>{alertBox('');if(!router.login||!router.mac){alertBox(t('freeNeedWifi'),true);return;}tb.disabled=true;try{const r=await call('trial',{method:'POST',body:JSON.stringify({planId:p.id,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge})});closeSheet();const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});location.href=router.login+(router.login.includes('?')?'&':'?')+q;}catch(e){closeSheet();alertBox(e.message);}finally{tb.disabled=false;}};}
 $('#sheet-card').classList.toggle('hide',home||!cardOn);$('#sheet-phone-label').classList.toggle('hide',home);$('#sheet-pay').classList.toggle('hide',home);$('#sheet-note').textContent=home?t('pppoeNote'):t('buyNote');
 $('#sheet-phone-text').textContent=t('mpesaLabel');$('#sheet-pay-text').textContent=t('payBuy');
 const c=$('#sheet-contact');c.classList.toggle('hide',!home);c.innerHTML=home?[CFG.phone&&`<a href="tel:${esc(CFG.phone.replace(/\s/g,''))}"><span class="ico">${ICON.phone}</span><span><b>${t('call')}</b><small>${esc(CFG.phone)}</small></span></a>`,CFG.whatsapp&&`<a href="https://wa.me/${esc(intl(CFG.whatsapp))}" rel="noopener"><span class="ico">${ICON.chat}</span><span><b>${t('whatsapp')}</b><small>${esc(CFG.whatsapp)}</small></span></a>`].filter(Boolean).join(''):'';
 $('#sheet').hidden=false;document.body.style.overflow='hidden';if(!home)setTimeout(()=>{const i=$('#buy-form input[name=phone]');if(i&&!i.value)i.focus();},260);
}
function closeSheet(){$('#sheet').hidden=true;here('Packages','hotspot');if($('#portal-wait').hidden&&$('#portal-done').hidden)document.body.style.overflow='';}
function busy(on){$('#portal-wait').hidden=!on;if(on){closeSheet();$('#portal-done').hidden=true;}document.body.style.overflow=on?'hidden':'';}
function done(html){busy(false);$('#done-card').innerHTML=html;$('#portal-done').hidden=false;document.body.style.overflow='hidden';const back=$('#done-back');if(back)back.onclick=()=>{$('#portal-done').hidden=true;document.body.style.overflow='';};}
function fail(kind,message){busy(false);$('#portal-done').hidden=true;if(kind!=='account'&&selected)openSheet(selected.id,selected.kind);alertBox(message);}
// A top-level GET to the router's own login page (a form post to its plain-HTTP address would trigger a browser warning).
let freeMode=null;
function renderFree(){let el=$('#free-banner');if(!freeMode){if(el)el.remove();return;}if(!el){el=document.createElement('div');el.id='free-banner';el.className='free-banner';document.body.prepend(el);}
 const until=new Date(freeMode.until).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});el.innerHTML=`<span><b>${esc(t('freeTitle'))}</b> ${esc(t('freeUntil',{t:until}))}${freeMode.reason?' · '+esc(freeMode.reason):''}</span><button type="button" class="btn" id="free-go">${esc(t('freeGo'))}</button>`;
 $('#free-go').onclick=async()=>{alertBox('');try{if(!router.login){alertBox(t('freeNeedWifi'),true);return;}const r=await call('login',{method:'POST',body:JSON.stringify({free:true,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge})});const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});location.href=router.login+(router.login.includes('?')?'&':'?')+q;}catch(e){alertBox(e.message);}};}
async function routerLogin(username,password){
 if(!router.login){await call('login',{method:'POST',body:JSON.stringify({username,password})});return false;}
 const r=await call('login',{method:'POST',body:JSON.stringify({username,password,chapId:router.chapId,chapChallenge:router.chapChallenge})});
 const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});location.href=router.login+(router.login.includes('?')?'&':'?')+q;return true;
}
async function pay(input){here('Paying');
 alertBox('');lastKind=input.kind;busy(true);$('#wait-title').textContent=t('checkPhone');$('#wait-text').textContent=t('sending');
 try{const start=await call('pay',{method:'POST',body:JSON.stringify({...input,mac:router.mac})});$('#wait-text').textContent=t('enterPin',{a:kes(start.amount)});poll(start.id,start.token,Date.now());}catch(error){fail(input.kind,error.message);}
}
// Card: the page leaves for Paystack and comes back with ?ps=<id>&pt=<token>; the server checks with Paystack.
async function payCard(input){const email=(input.email||'').trim();
 alertBox('');busy(true);$('#wait-title').textContent=t('payCard');$('#wait-text').textContent=t('cardOpening');
 try{const r=await call('pay',{method:'POST',body:JSON.stringify({...input,email,provider:'paystack',mac:router.mac,router:{login:router.login,dst:router.dst,mac:router.mac}})});location.href=r.redirect;}catch(error){fail(input.kind,error.message);}}
function poll(id,token,started){clearTimeout(polling);polling=setTimeout(async()=>{
 try{
  const s=await call('pay/'+id+'?t='+encodeURIComponent(token));
  if(s.status==='pending'){if(Date.now()-started>40000)$('#wait-text').textContent=t('stillWaiting');return poll(id,token,started);}
  if(s.status==='failed')return fail(s.kind||lastKind,s.reason||t('notCompleted'));
  const until=when(s.expiresAt),tick='<div class="pulse ok"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>';
  if(!s.password)return done(`${tick}<h2>${esc(t('paid'))}</h2><p>${t('accActive',{u:esc(s.username),d:esc(until)})}</p><p class="muted small">${esc(t('restart'))}</p><button type="button" class="btn ghost" id="done-back">${esc(t('ok'))}</button>`);
  done(`${tick}<h2>${esc(t('paid'))}</h2><p>${t('wifiActive',{d:esc(until)})}</p><dl class="code-box"><div><dt>${esc(t('code'))}</dt><dd>${esc(s.username)}</dd></div><div><dt>${esc(t('password'))}</dt><dd>${esc(s.password)}</dd></div></dl><p class="muted small" id="connecting">${esc(router.login?t('connecting'):t('joinWifi',{b:CFG.brandName}))}</p>${router.login?'':`<button type="button" class="btn ghost" id="done-back">${esc(t('ok'))}</button>`}`);
  if(router.login)await routerLogin(s.username,s.password).catch(e=>{$('#connecting').textContent=e.message;});
 }catch(error){if(Date.now()-started<240000)return poll(id,token,started);fail(lastKind,error.message);}
},3000);}


/* ===================== TERMS, EXPIRED PAGE, ADVERTS & QUIZ ===================== */
let engage={ads:[],quiz:null};
function showTerms(){let d=$('#terms-dialog');if(!d){d=document.createElement('dialog');d.id='terms-dialog';d.className='terms-dialog';document.body.append(d);}
 d.innerHTML=`<h2>${esc(t('termsTitle'))}</h2><div class="terms-text">${esc(CFG.terms)}</div><button type="button" class="btn" id="terms-close">${esc(t('close'))}</button>`;$('#terms-close').onclick=()=>d.close();d.showModal();}
// Routers send expired PPPoE customers to /portal/?expired=1: lead with the renewal.
function renderExpired(){const on=params.get('expired')==='1';let b=$('#expired-banner');if(!on){if(b)b.remove();return;}
 if(!b){b=document.createElement('div');b.id='expired-banner';b.className='expired-banner';const col=$('#accountCol');col.parentElement.insertBefore(b,col);}
 b.innerHTML=`<b>${esc(t('expiredTitle'))}</b><span>${esc(t('expiredSub'))}</span>`;}
async function hotspotGo(r){const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});location.href=router.login+(router.login.includes('?')?'&':'?')+q;}
function renderEngage(){let box=$('#engage');if(!engage.ads.length&&!engage.quiz){if(box)box.remove();return;}
 if(!box){box=document.createElement('div');box.id='engage';box.className='engage';$('#packagesCol').append(box);}
 const ad=a=>`<div class="card ad-card" data-ad="${esc(a.id)}"><small class="ad-label">${esc(t('adLabel'))}${a.advertiser?' · '+esc(a.advertiser):''}</small>${a.imageUrl?`<img src="${esc(a.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}<b>${esc(a.title)}</b>${a.text?`<p>${esc(a.text)}</p>`:''}<div class="ad-actions">${a.hasLink?`<a class="btn ghost" href="/portal/api/ads/${esc(a.id)}/click" target="_blank" rel="noopener sponsored">${esc(t('adOpen'))}</a>`:''}${a.earn?`<button type="button" class="btn" data-ad-earn="${esc(a.id)}">${esc(t('adEarn',{n:a.earn.seconds,m:a.earn.minutes}))}</button>`:''}</div></div>`;
 const q=engage.quiz;box.innerHTML=engage.ads.map(ad).join('')+(q?`<form class="card quiz-card" id="quiz-form"><div class="section-head"><h2>${esc(t('quizTitle'))}</h2><small>${esc(t('quizFor',{m:q.minutes}))}</small></div><p><b>${esc(q.question)}</b></p><div class="${q.images?.some(Boolean)?'quiz-pics':''}">${q.options.map((o,i)=>`<label class="quiz-opt"><input type="radio" name="choice" value="${i}" required>${q.images?.[i]?`<img src="${esc(q.images[i])}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''} <span>${esc(o)}</span></label>`).join('')}</div><button class="btn" type="submit">${esc(t('quizBtn'))}</button><p class="msg" id="quiz-msg"></p></form>`:'');
 for(const el of box.querySelectorAll('[data-ad]'))call('ads/'+el.dataset.ad+'/view',{method:'POST',body:'{}'}).then(r=>{el.dataset.ticket=r.ticket;}).catch(()=>{});
 for(const b of box.querySelectorAll('[data-ad-earn]'))b.onclick=()=>{const a=engage.ads.find(x=>x.id===b.dataset.adEarn),card=b.closest('[data-ad]');if(!router.login||!router.mac){alertBox(t('freeNeedWifi'),true);return;}
  b.disabled=true;let left=a.earn.seconds;card.classList.add('watching');card.scrollIntoView({block:'center',behavior:'smooth'});b.textContent=t('adWait',{n:left});
  const tick=setInterval(()=>{left--;if(left>0){b.textContent=t('adWait',{n:left});return;}clearInterval(tick);b.disabled=false;b.textContent=t('adClaim',{m:a.earn.minutes});
   b.onclick=async()=>{b.disabled=true;try{const r=await call('ads/'+a.id+'/claim',{method:'POST',body:JSON.stringify({ticket:card.dataset.ticket,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge})});hotspotGo(r);}catch(e){alertBox(e.message);b.disabled=false;}};},1000);};
 const qf=$('#quiz-form');if(qf)qf.onsubmit=async e=>{e.preventDefault();const m=$('#quiz-msg');if(!router.login||!router.mac){alertBox(t('freeNeedWifi'),true);return;}const btn=qf.querySelector('button');btn.disabled=true;
  try{const r=await call('quiz/'+q.id,{method:'POST',body:JSON.stringify({choice:Number(new FormData(qf).get('choice')),mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge})});
   if(!r.correct){m.className='msg err';m.textContent=t('quizWrong');return;}m.className='msg';m.textContent=t('quizWin',{m:q.minutes});hotspotGo(r);}catch(err){m.className='msg err';m.textContent=err.message;}finally{btn.disabled=false;}};}
function bootDone(){const b=$('#boot');if(b){b.classList.add('gone');setTimeout(()=>b.remove(),400);}}
/* ===================== SNOW (Christmas) ===================== */
let snowRAF=null;
function startSnow(){if(snowRAF||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const c=$('#snow'),ctx=c.getContext('2d');let W,H,flakes;
 const size=()=>{W=c.width=innerWidth;H=c.height=innerHeight;flakes=Array.from({length:Math.min(140,W/8)},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*2.6+0.8,s:Math.random()*0.8+0.3,d:Math.random()*Math.PI*2}));};size();addEventListener('resize',size);
 const tick=()=>{ctx.clearRect(0,0,W,H);ctx.fillStyle='rgba(255,255,255,.85)';for(const f of flakes){f.y+=f.s;f.d+=0.01;f.x+=Math.sin(f.d)*0.4;if(f.y>H){f.y=-5;f.x=Math.random()*W;}ctx.beginPath();ctx.arc(f.x,f.y,f.r,0,Math.PI*2);ctx.fill();}snowRAF=requestAnimationFrame(tick);};tick();}
function stopSnow(){if(snowRAF){cancelAnimationFrame(snowRAF);snowRAF=null;const c=$('#snow');c.getContext('2d').clearRect(0,0,c.width,c.height);}}

/* ===================== ADMIN PANEL ===================== */
function renderAdmin(){
 $('#themeGrid').innerHTML=Object.entries(THEMES).map(([k,v])=>`<button type="button" data-theme-pick="${k}" class="${k===CFG.theme?'on':''}"><span class="sw" style="background:${v.swatch}"></span>${v.label}</button>`).join('');
 $('#themeDesc').innerHTML=`<b>${esc(THEMES[CFG.theme].label)}:</b> ${esc(THEMES[CFG.theme].desc)}`;
 for(const [id,key] of [['cfgName','brandName'],['cfgIntro','intro'],['cfgPhone','phone'],['cfgWhatsapp','whatsapp'],['cfgEmail','email'],['cfgPopular','popular']]){const el=$('#'+id);if(document.activeElement!==el)el.value=CFG[key]||'';}
 $('#cfgColor').value=CFG.brandColor;$('#cfgLang').value=CFG.defaultLang;
 for(const [id,key] of [['tPppoe','pppoe'],['tHotspot','hotspot'],['tFind','findAccount'],['tAccess','accessAccount'],['tOtg','onTheGo'],['tContact','contact'],['tSpeed','speed'],['tUsage','usage'],['tMessage','message']])$('#'+id).checked=!!CFG.show[key];
 $('#presetColors').innerHTML=['#0a3cff','#1d4ed8','#0891b2','#059669','#7c3aed','#db2777','#ea580c','#0f172a'].map(c=>`<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
}
function wireAdmin(){
 $('#adminFab').classList.remove('hide');$('#adminFab').onclick=()=>$('#admin').classList.add('open');$('#closeAdmin').onclick=()=>$('#admin').classList.remove('open');
 $('#admin').addEventListener('click',e=>{const tp=e.target.closest('[data-theme-pick]');if(tp){CFG.theme=tp.dataset.themePick;render();}const cp=e.target.closest('[data-color]');if(cp){CFG.brandColor=cp.dataset.color;render();}});
 const text=(id,key,fallback='')=>{$('#'+id).oninput=e=>{CFG[key]=e.target.value||fallback;render();};};
 text('cfgName','brandName','Kade Networks');text('cfgIntro','intro');text('cfgPhone','phone');text('cfgWhatsapp','whatsapp');text('cfgEmail','email');text('cfgPopular','popular');
 $('#cfgColor').oninput=e=>{CFG.brandColor=e.target.value;render();};$('#cfgLang').onchange=e=>{CFG.defaultLang=e.target.value;LANG=e.target.value;render();};
 for(const [id,key] of [['tPppoe','pppoe'],['tHotspot','hotspot'],['tFind','findAccount'],['tAccess','accessAccount'],['tOtg','onTheGo'],['tContact','contact'],['tSpeed','speed'],['tUsage','usage'],['tMessage','message']])$('#'+id).onchange=e=>{CFG.show[key]=e.target.checked;render();};
 $('#saveCfg').onclick=async()=>{const btn=$('#saveCfg');btn.textContent='Saving…';
  try{const body={theme:CFG.theme,brandName:CFG.brandName,brandColor:CFG.brandColor,intro:CFG.intro,defaultLang:CFG.defaultLang,phone:CFG.phone,whatsapp:CFG.whatsapp,email:CFG.email,accountPrefix:CFG.accountPrefix,popular:CFG.popular,packageLayout:CFG.packageLayout,loadingStyle:CFG.loadingStyle,loadingText:CFG.loadingText,terms:CFG.terms,show:CFG.show};
   const r=await fetch('/api/portal/landing',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
   const data=await r.json().catch(()=>({}));btn.textContent=r.ok?'Saved ✓':(data.error||'Save failed');}catch{btn.textContent='Save failed';}setTimeout(()=>btn.textContent='Save',2200);};
 $('#copyCfg').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(CFG,null,2));$('#copyCfg').textContent='Copied ✓';}catch{$('#copyCfg').textContent='Copy failed';}setTimeout(()=>$('#copyCfg').textContent='Copy JSON',1500);};
}
window.addEventListener('message',e=>{if(e.origin!==location.origin||!params.has('preview')||e.data?.kade!=='config')return;const c=e.data.config||{};CFG={...CFG,...c,show:{...CFG.show,...(c.show||{})}};if(c.defaultLang)LANG=c.defaultLang;render();});
async function checkAdmin(){
 if(params.has('preview')){try{parent.postMessage({kade:'ready'},location.origin);}catch{}return;}
 if(params.has('admin')){location.replace('/#captive');return;}
 return;
 try{const r=await fetch('/api/session',{credentials:'same-origin'}),d=await r.json();if(d.user?.role==='admin'){csrf=d.csrf;isAdmin=true;wireAdmin();render();return;}}catch{}
 $('#adminNote').classList.remove('hide');
}

/* ===================== EVENTS & BOOT ===================== */
document.addEventListener('click',e=>{
 const l=e.target.closest('[data-l]');if(l){LANG=l.dataset.l;try{localStorage.setItem('portal-lang',LANG);}catch{}render();detectSession();return;}
 const p=e.target.closest('[data-pkg]');if(p){openSheet(p.dataset.pkg,p.dataset.kind);}
 if(e.target.closest('#sheet-close')||e.target.id==='sheet')closeSheet();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#sheet').hidden)closeSheet();});
$('#sheet-card-pay').addEventListener('click',()=>{const f=$('#buy-form');if(!selected||selected.kind==='pppoe')return;payCard({kind:'hotspot',planId:selected.id,qty:Number(f.qty?.value||1),phone:f.phone.value,promo:f.promo.value,email:f.email.value});});
$('#buy-form').addEventListener('submit',e=>{e.preventDefault();if(!selected||selected.kind==='pppoe')return;pay({kind:'hotspot',planId:selected.id,qty:Number(e.target.qty?.value||1),phone:e.target.phone.value,promo:e.target.promo.value});});
async function boot(){
 render();
 const q=params.get('theme');
 try{
  const d=await call('config'+(router.mac?'?mac='+encodeURIComponent(router.mac):''));CFG={...CFG,...d.config,show:{...CFG.show,...(d.config.show||{})}};plans=d.plans||[];pppoePlans=d.pppoePlans||[];mpesaOn=!!d.mpesa;cardOn=!!d.paystack;freeMode=d.freeMode||null;engage=d.engage||{ads:[],quiz:null};state='ok';
  try{if(!localStorage.getItem('portal-lang'))LANG=CFG.defaultLang||LANG;}catch{LANG=CFG.defaultLang||LANG;}
 }catch{state='error';}
 if(q&&THEMES[q])CFG.theme=q;
 render();bootDone();if(params.get('expired')==='1')setTimeout(()=>{const f=$('#acc');if(f){f.scrollIntoView({block:'center'});f.focus();}},300);if(params.get('ps')&&params.get('pt')){busy(true);$('#wait-title').textContent=t('payCard');$('#wait-text').textContent=t('cardChecking');poll(params.get('ps'),params.get('pt'),Date.now());}const err=params.get('error');if(err)alertBox(err);else if(state==='ok'&&!mpesaOn)alertBox(t('noMpesa'));
 detectSession();checkAdmin();here();
 // Self-service link from netops (?account=USERNAME): open that account straight away.
 const deep=(params.get('account')||'').trim().slice(0,64);if(deep&&CFG.show.accessAccount!==false){$('#acc').value=deep;setTimeout(()=>{$('#acc').scrollIntoView({block:'center'});$('#accForm').requestSubmit();},200);}
}
boot();
