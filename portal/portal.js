'use strict';
// Hotspot landing page: nine switchable designs, your real packages, M-Pesa checkout, account lookup, and an admin
// design panel (?admin=1, shown only when you are signed into netops as admin). The router passes mac, ip, login,
// dst, chapId, chapChallenge, error in the address; after a payment the customer is logged in through the router.
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const params=new URLSearchParams(location.search);
const ADM=!!params.get('viewas');
const router={login:params.get('login')||'',dst:params.get('dst')||'',chapId:params.get('chapId')||'',chapChallenge:params.get('chapChallenge')||'',mac:params.get('mac')||''};
// Live "on the portal now" count for the netops dashboard: the view shown, pinged every 10 s while the page is visible.
const presence={page:'Packages',service:'hotspot',tab:Math.random().toString(36).slice(2,10),timer:null};
function here(page,service){if(page)presence.page=page;if(service)presence.service=service;if(params.get('admin')||params.get('frame')||ADM)return;
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
 elegant:{label:'Elegant',swatch:'linear-gradient(#f7f2e9 60%,#b58a3c 60% 64%,#f7f2e9 64%)',desc:'Ivory paper, a serif display face and gold hairlines, with an arched sign-in card and packages set like a fine menu.'},
 essential:{label:'Essential',swatch:'linear-gradient(#fff 55%,var(--brand) 55% 60%,#fff 60%)',desc:'Clean and quick: a bold headline, tabs for Buy a plan and Reconnect, and packages as one tidy list with radio buttons.'},
 studio:{label:'Studio',swatch:'linear-gradient(135deg,#fbf6f2 55%,#6366f1 55%)',desc:'Warm paper tones with an indigo accent, compact two-column plan cards and a dark pay button.'},
 festive:{label:'Festive',swatch:'linear-gradient(#14532d 50%,#fff 50%)',desc:'A fresh green seasonal look with a greeting banner, plan icons and a pine-green pay button.'},
 blueprint:{label:'Blueprint',swatch:'linear-gradient(var(--brand) 35%,#e8efff 35%)',desc:'A solid brand header, then plans as a grid of tiles with the price in your brand colour.'},
 showcase:{label:'Showcase',swatch:'linear-gradient(#142046 60%,#fff 60%)',desc:'Your most popular plan as a dark hero card, other plans in a slim list below.'},
 night:{label:'Night',swatch:'linear-gradient(#10141f 60%,var(--brand) 60%)',desc:'A dark, calm screen with a glowing blue selection. Easy on the eyes after dark.'},
 celebrate:{label:'Celebrate',swatch:'linear-gradient(#312e81 55%,#fbbf24 55%)',desc:'A bright indigo and gold look with a fresh-start banner and a deep-indigo highlighted plan.'},
 daypass:{label:'Day Pass',swatch:'repeating-linear-gradient(90deg,#dbeafe 0 8px,#fff 8px 12px)',desc:'Plans styled like tickets with a perforated edge, in strong blue.'},
 edition:{label:'Edition',swatch:'linear-gradient(#f7f2e9 70%,#111 70%)',desc:'A magazine layout: large serif headline, numbered plans, a black pay button.'},
 social:{label:'Social',swatch:'linear-gradient(#5b21b6 50%,#ede9fe 50%)',desc:'Three plans side by side as tiles, with the popular one filled in deep purple.'},
 together:{label:'Together',swatch:'linear-gradient(#9f1239 50%,#ffe4e6 50%)',desc:'A warm crimson design with a friendly line, soft pink totals and rounded plan rows.'}
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
 elegant:{sw:{h:'{brand}',e:'Karibu',a:'Karibu tena',intro:'Muunganisho wa hali ya juu, kwa utulivu.'},en:{h:'{brand}',e:'Welcome',a:'Welcome back',intro:'Refined connectivity, quietly reliable.'}},
 essential:{sw:{h:'Unganika na siku yako.',e:'',a:'Unganika tena',intro:'Chagua kifurushi. Lipa. Uko mtandaoni.'},en:{h:'Connect to your day.',e:'',a:'Reconnect',intro:'Choose a plan. Pay. You\'re online.'}},
 studio:{sw:{h:'Unganika na siku yako.',e:'',a:'Unganika tena',intro:'Chagua kifurushi. Lipa. Uko mtandaoni.'},en:{h:'Connect to your day.',e:'',a:'Reconnect',intro:'Choose a plan. Pay. You\'re online.'}},
 festive:{sw:{h:'Unganika na siku yako.',e:'A little more connection this season.',a:'Unganika tena',intro:'Chagua kifurushi. Lipa. Uko mtandaoni.'},en:{h:'Connect to your day.',e:'A little more connection this season.',a:'Reconnect',intro:'Choose a plan. Pay. You\'re online.'}},
 blueprint:{sw:{h:'Chagua muunganisho wako.',e:'Wi-Fi available',a:'Unganika tena',intro:'Chagua kifurushi na ulipe kwa M-Pesa.'},en:{h:'Choose your connection.',e:'Wi-Fi available',a:'Reconnect',intro:'Pick a plan and pay with M-Pesa.'}},
 showcase:{sw:{h:'Karibu sana.',e:'',a:'Unganika tena',intro:'Thamani bora kwa matumizi ya siku nzima.'},en:{h:'Good to have you here.',e:'',a:'Reconnect',intro:'Our best value for all-day access.'}},
 night:{sw:{h:'Tukuunganishe.',e:'',a:'Unganika tena',intro:'Chagua kifurushi, lipa, uko mtandaoni.'},en:{h:'Let\'s get you online.',e:'',a:'Reconnect',intro:'Pick a plan, pay, and you\'re connected.'}},
 celebrate:{sw:{h:'Muunganisho wako ujao.',e:'A fresh start. A stronger connection.',a:'Unganika tena',intro:'Chagua, lipa, unganika.'},en:{h:'Your next connection.',e:'A fresh start. A stronger connection.',a:'Reconnect',intro:'Choose, pay, connect.'}},
 daypass:{sw:{h:'Pasi yako ya Wi-Fi.',e:'',a:'Unganika tena',intro:'Chagua pasi ya data, lipa kwa M-Pesa uingie mtandaoni.'},en:{h:'Your pass to Wi-Fi.',e:'',a:'Reconnect',intro:'Choose a data pass, pay with M-Pesa and get online.'}},
 edition:{sw:{h:'Jisikie nyumbani.',e:'',a:'Unganika tena',intro:'Ingia mtandaoni kwa pasi ya Wi-Fi. Lipa kwa usalama kwa M-Pesa.'},en:{h:'Make yourself at home.',e:'',a:'Reconnect',intro:'Get online with a Wi-Fi pass. Pay securely with M-Pesa.'}},
 social:{sw:{h:'Chagua kifurushi. Umeingia.',e:'',a:'Unganika tena',intro:'Chagua pasi, lipa kwa M-Pesa ufurahie Wi-Fi.'},en:{h:'Pick a plan. You\'re in.',e:'',a:'Reconnect',intro:'Choose a pass, pay with M-Pesa and enjoy Wi-Fi.'}},
 together:{sw:{h:'Chagua kifurushi chako cha Wi-Fi',e:'A little closer, wherever you are.',a:'Unganika tena',intro:'Ingia mtandaoni kwa pasi ya data, lipa kwa M-Pesa uunganike.'},en:{h:'Choose your Wi-Fi plan',e:'A little closer, wherever you are.',a:'Reconnect',intro:'Get online with a data pass, pay with M-Pesa and connect.'}}
};

/* ===================== STRINGS ===================== */
const STR={
 sw:{expiredTitle:'Internet yako imeisha muda',expiredSub:'Lipia hapa chini urudi mtandaoni. Weka nambari ya akaunti au nambari ya simu iliyo kwenye akaunti yako.',termsTitle:'Masharti ya huduma',close:'Funga',adLabel:'Tangazo',adEarn:'Tazama kwa sekunde {n} upate dakika {m} bure',adWait:'Endelea kutazama… {n}s',adClaim:'Pata dakika {m} bure',adOpen:'Jua zaidi',quizTitle:'Jibu na utumie bure',quizBtn:'Tuma jibu',quizWin:'Sahihi! Tunakuunganisha kwa dakika {m} bure…',quizWrong:'Si sahihi. Jaribu tena kesho.',quizFor:'Jibu sahihi = dakika {m} bure',needHelp:'Unahitaji msaada?',helpCall:'Piga simu',helpOr:'au',manageSub:'Weka maelezo ya akaunti yako kufikia muunganisho wako',otgTitle:'Tumia WiFi yetu ya On-the-Go popote ulipo',otgSub:'Vifurushi nafuu kwenye hotspot zetu',
  accountLead:'Weka namba ya akaunti au bandika ujumbe kutoka kwetu.',detecting:'Tunatafuta muunganisho wako kwenye mtandao huu…',notFound:'Hatukupata muunganisho kwenye kifaa hiki. Tumia namba ya akaunti hapa chini.',found:'Tumekupata!',
  connectFind:'Unganisha na akaunti yako ya {brand}.',findBtn:'Tafuta akaunti yangu',howTitle:'Jinsi ya kufikia akaunti yako',how1:'Weka namba yako ya akaunti au jina la mtumiaji',how2:'Au bandika ujumbe wowote kutoka kwetu (uthibitisho wa malipo, SMS, n.k.)',
  accLabel:'Namba ya akaunti ya {brand}, au ujumbe kutoka kwetu',accPh:'Weka namba ya akaunti au bandika ujumbe kutoka kwetu…',accExample:'Mfano: {prefix}-ABC123, au bandika uthibitisho wa malipo tuliokutumia',accessBtn:'Fikia Akaunti Yangu',
  accEmpty:'Tafadhali weka namba ya akaunti au bandika ujumbe.',wantPlan:'Unataka kifurushi kingine?',wantBtn:'Omba kifurushi hiki',wantDone:'Ombi limetumwa. Tutakupigia simu kubadilisha kifurushi.',accFound:'Namba ya akaunti imepatikana: ',searching:'Inatafuta…',noAccount:'Hatukupata akaunti hiyo. Angalia namba na ujaribu tena.',
  hotspotTitle:'Vifurushi vya Hotspot',hotspotSub:'Lipa kwa M-Pesa, unganishwa mara moja',pppoeTitle:'Internet ya Nyumbani (PPPoE)',pppoeSub:'Kwa mwezi',contactTitle:'Wasiliana nasi',call:'Piga simu',whatsapp:'WhatsApp',email:'Barua pepe',
  popular:'MAARUFU',per_month:'/mwezi',splitHeadline:'Internet inayofanya kazi tu.',chipHotspot:'WiFi ya Hotspot',chipFiber:'Fiber ya PPPoE',contact:'Mawasiliano',privacy:'Faragha',terms:'Masharti',rights:'Haki zote zimehifadhiwa.',
  youPicked:'Umechagua',homeInternet:'Internet ya nyumbani',payBuy:'Lipa kwa M-Pesa',buyNote:'Utapokea ombi kwenye simu. Weka PIN yako ya M-Pesa kulipa.',pppoeNote:'Tunaweka internet nyumbani au ofisini kwako. Tupigie au tuandikie WhatsApp tukuunganishe.',
  upTo:'hadi Mbps {n}',advLink:'Tangaza hapa',advTitle:'Tangaza biashara yako hapa',advIntro:'Chagua mpango, tuma tangazo lako. Tutakupigia kuthibitisha malipo kabla tangazo kuonekana.',advEveryDay:'Kila siku',advDays:'siku',advBusiness:'Jina la biashara',advAdTitle:'Kichwa cha tangazo',advAdText:'Maandishi ya tangazo',advImage:'Kiungo cha picha (https, si lazima)',advWebsite:'Tovuti (https, si lazima)',advCancel:'Funga',advSend:'Tuma ombi',advThanks:'Asante!',advNext:'Ombi lako {ref} limepokelewa. Bei ni {price}. Tangazo litaonekana baada ya malipo na ukaguzi.',advCall:'Maswali: {phone}.',msgTitle:'Tuachie ujumbe',msgName:'Jina lako',msgPhone:'Nambari ya simu',msgText:'Ujumbe',msgSend:'Tuma',msgDone:'Asante! Tutakupigia au kukutumia SMS hivi karibuni.',devices:'vifaa {n}',device:'kifaa 1',unlimited:'Bila kikomo',noPlans:'Hakuna vifurushi kwa sasa.',loadFail:'Imeshindwa kupakia vifurushi. Onyesha upya ukurasa.',noMpesa:'Malipo ya M-Pesa bado hayapatikani. Kama una msimbo, ingia nao.',
  checkPhone:'Angalia simu yako',sending:'Tunatuma ombi la M-Pesa…',enterPin:'Weka PIN yako ya M-Pesa kulipa {a}.',stillWaiting:'Bado tunasubiri M-Pesa… inaweza kuchukua dakika moja.',notCompleted:'Malipo hayakukamilika.',
  paid:'Malipo yamepokelewa',accActive:'Akaunti <strong>{u}</strong> iko hai hadi <strong>{d}</strong>.',restart:'Usipounganishwa ndani ya dakika moja, zima na uwashe router yako.',wifiActive:'Wi-Fi yako iko hai hadi <strong>{d}</strong>. Hifadhi hizi uingie kwenye kifaa kingine:',
  code:'Msimbo',password:'Nenosiri',connecting:'Tunakuunganisha sasa…',joinWifi:'Jiunge na Wi-Fi ya {b} na uingie kwa msimbo huu.',ok:'Sawa',valid:'Msimbo huu ni sahihi. Jiunge na Wi-Fi ya {b} kuutumia.',
  statusActive:'Iko hai',statusExpired:'Imeisha muda',statusSuspended:'Imezimwa',until:'Hadi {d}',expiredOn:'Iliisha {d}',suspendedMsg:'Akaunti hii imezimwa. Wasiliana nasi.',passLabel:'Nenosiri',connect:'Unganisha',
  renew:'Lipia {a}',payCard:'Lipa kwa kadi',cardEmail:'Barua pepe (kwa risiti ya kadi)',cardOpening:'Inafungua ukurasa salama wa kadi…',cardChecking:'Tunathibitisha malipo ya kadi…',qty:'Ngapi',qtyOpt:'{n} × ({p})',trialBtn:'Jaribu bure kwa dakika {n}',trialUsed:'Kifaa hiki kimeshajaribu bure.',pinLabel:'PIN (hiari, kuona salio na matumizi)',pinWrong:'PIN si sahihi.',mpesaLabel:'Nambari ya M-Pesa',promo:'Msimbo wa punguzo (hiari)',freeTitle:'WiFi ya bure sasa!',freeUntil:'Mpaka saa {t}.',freeGo:'Unganisha bure',freeNeedWifi:'Fungua ukurasa huu ukiwa kwenye WiFi yetu.',wallet:'Akiba',dataMonth:'Data mwezi huu'},
 en:{expiredTitle:'Your internet has expired',expiredSub:'Renew below to get back online. Enter your account number or the phone number on your account.',termsTitle:'Terms of service',close:'Close',adLabel:'Sponsored',adEarn:'Watch for {n} seconds to get {m} free minutes',adWait:'Keep watching… {n}s',adClaim:'Get {m} free minutes',adOpen:'Learn more',quizTitle:'Answer and browse free',quizBtn:'Submit answer',quizWin:'Correct! Connecting you for {m} free minutes…',quizWrong:'Not quite. Try again tomorrow.',quizFor:'Right answer = {m} free minutes',needHelp:'Need help?',helpCall:'Call',helpOr:'or',manageSub:'Enter your account details to manage your connection',otgTitle:'Use our On-the-Go WiFi wherever you are',otgSub:'Affordable packages at our hotspots',
  accountLead:'Enter your account number or paste a message from us.',detecting:'Looking for your connection on this network…',notFound:"We couldn't find a connection on this device. Use your account number below.",found:'Found you!',
  connectFind:'Connect to your {brand} account.',findBtn:'Find my account',howTitle:'How to access your account',how1:'Enter your account number or username',how2:'Or paste any message from us (payment confirmation, SMS notification, etc.)',
  accLabel:'Your {brand} account number, or a message from us',accPh:'Enter your account number or paste a message from us…',accExample:'Example: {prefix}-ABC123, or paste a payment confirmation we sent you',accessBtn:'Access My Account',
  accEmpty:'Please enter your account number or paste a message.',wantPlan:'Want a different package?',wantBtn:'Request this package',wantDone:'Request sent. We will contact you to change your package.',accFound:'Account number detected: ',searching:'Searching…',noAccount:"We couldn't find that account. Check the number and try again.",
  hotspotTitle:'Hotspot packages',hotspotSub:'Pay with M-Pesa, connect instantly',pppoeTitle:'Home internet (PPPoE)',pppoeSub:'Monthly',contactTitle:'Contact us',call:'Call us',whatsapp:'WhatsApp',email:'Email',
  popular:'POPULAR',per_month:'/mo',splitHeadline:'Internet that just works.',chipHotspot:'Hotspot WiFi',chipFiber:'PPPoE Fiber',contact:'Contact',privacy:'Privacy',terms:'Terms',rights:'All rights reserved.',
  youPicked:'You picked',homeInternet:'Home internet',payBuy:'Pay with M-Pesa',buyNote:"You'll get a prompt on your phone. Enter your M-Pesa PIN to pay.",pppoeNote:'We install internet at your home or office. Call or WhatsApp us and we will get you connected.',
  upTo:'up to {n} Mbps',advLink:'Advertise here',advTitle:'Advertise on our WiFi',advIntro:'Pick a plan and send your advert. We will contact you to confirm payment; it shows after payment and a quick review.',advEveryDay:'Every day',advDays:'days',advBusiness:'Business name',advAdTitle:'Advert title',advAdText:'Advert text',advImage:'Image link (https, optional)',advWebsite:'Website (https, optional)',advCancel:'Close',advSend:'Send request',advThanks:'Thank you!',advNext:'Your request {ref} is in. The price is {price}. Your advert shows after payment and review.',advCall:'Questions: {phone}.',msgTitle:'Leave a message',msgName:'Your name',msgPhone:'Phone number',msgText:'Message',msgSend:'Send',msgDone:'Thank you! We will call or text you soon.',devices:'{n} devices',device:'1 device',unlimited:'Unlimited',noPlans:'No packages are on sale right now.',loadFail:'Could not load packages. Refresh the page.',noMpesa:'M-Pesa payments are not available yet. If you have a code, log in with it.',
  checkPhone:'Check your phone',sending:'Sending the M-Pesa prompt…',enterPin:'Enter your M-Pesa PIN to pay {a}.',stillWaiting:'Still waiting for M-Pesa… this can take a minute.',notCompleted:'Payment was not completed.',
  paid:'Payment received',accActive:'Account <strong>{u}</strong> is active until <strong>{d}</strong>.',restart:'If you are not online within a minute, restart your router.',wifiActive:'Your Wi-Fi is active until <strong>{d}</strong>. Save these to log in on another device:',
  code:'Code',password:'Password',connecting:'Connecting you now…',joinWifi:'Join the {b} Wi-Fi and log in with this code.',ok:'OK',valid:'This code is valid. Join the {b} Wi-Fi to use it.',
  statusActive:'Active',statusExpired:'Expired',statusSuspended:'Deactivated',until:'Until {d}',expiredOn:'Expired {d}',suspendedMsg:'This account is deactivated. Please contact us.',passLabel:'Password',connect:'Connect',
  renew:'Renew {a}',payCard:'Pay with card',cardEmail:'Email (for the card receipt)',cardOpening:'Opening the secure card page…',cardChecking:'Checking your card payment…',qty:'How many',qtyOpt:'{n} × ({p})',trialBtn:'Try free for {n} minutes',trialUsed:'This device has already had a free trial.',pinLabel:'PIN (optional, to see balance and usage)',pinWrong:'Wrong PIN.',mpesaLabel:'M-Pesa number',promo:'Promo code (optional)',freeTitle:'Free WiFi now!',freeUntil:'Until {t}.',freeGo:'Connect free',freeNeedWifi:'Open this page while connected to our WiFi.',wallet:'Wallet',dataMonth:'Data this month'}
};
STR.fr={expiredTitle:'Votre internet a expiré',expiredSub:'Renouvelez ci-dessous pour revenir en ligne. Saisissez votre numéro de compte ou le numéro de téléphone du compte.',termsTitle:"Conditions d'utilisation",close:'Fermer',adLabel:'Sponsorisé',adEarn:'Regardez {n} secondes pour obtenir {m} minutes gratuites',adWait:'Continuez à regarder… {n}s',adClaim:'Obtenir {m} minutes gratuites',adOpen:'En savoir plus',quizTitle:'Répondez et naviguez gratuitement',quizBtn:'Envoyer la réponse',quizWin:'Bonne réponse ! Connexion pour {m} minutes gratuites…',quizWrong:'Pas tout à fait. Réessayez demain.',quizFor:'Bonne réponse = {m} minutes gratuites',
 needHelp:"Besoin d'aide ?",helpCall:'Appelez le',helpOr:'ou',manageSub:'Saisissez les informations de votre compte pour gérer votre connexion',otgTitle:'Utilisez notre WiFi nomade où que vous soyez',otgSub:'Forfaits abordables sur nos hotspots',
 accountLead:'Saisissez votre numéro de compte ou collez un message de notre part.',detecting:'Recherche de votre connexion sur ce réseau…',notFound:"Aucune connexion trouvée sur cet appareil. Utilisez votre numéro de compte ci-dessous.",found:'Trouvé !',
 connectFind:'Connectez-vous à votre compte {brand}.',findBtn:'Trouver mon compte',howTitle:'Comment accéder à votre compte',how1:"Saisissez votre numéro de compte ou nom d'utilisateur",how2:"Ou collez n'importe quel message de notre part (confirmation de paiement, SMS, etc.)",
 accLabel:'Votre numéro de compte {brand}, ou un message de notre part',accPh:'Saisissez votre numéro de compte ou collez un message…',accExample:'Exemple : {prefix}-ABC123, ou collez une confirmation de paiement',accessBtn:'Accéder à mon compte',
 accEmpty:'Veuillez saisir votre numéro de compte ou coller un message.',wantPlan:'Un autre forfait ?',wantBtn:'Demander ce forfait',wantDone:'Demande envoyée. Nous vous contacterons pour changer de forfait.',accFound:'Numéro de compte détecté : ',searching:'Recherche…',noAccount:"Compte introuvable. Vérifiez le numéro et réessayez.",
 hotspotTitle:'Forfaits hotspot',hotspotSub:'Payez par M-Pesa, connexion immédiate',pppoeTitle:'Internet à domicile (PPPoE)',pppoeSub:'Mensuel',contactTitle:'Nous contacter',call:'Appelez-nous',whatsapp:'WhatsApp',email:'E-mail',
 popular:'POPULAIRE',per_month:'/mois',splitHeadline:'Un internet qui marche, tout simplement.',chipHotspot:'WiFi hotspot',chipFiber:'Fibre PPPoE',contact:'Contact',privacy:'Confidentialité',terms:'Conditions',rights:'Tous droits réservés.',
 youPicked:'Votre choix',homeInternet:'Internet à domicile',payBuy:'Payer avec M-Pesa',buyNote:'Vous recevrez une demande sur votre téléphone. Saisissez votre code M-Pesa pour payer.',pppoeNote:"Nous installons internet chez vous ou au bureau. Appelez-nous ou écrivez sur WhatsApp et nous vous connecterons.",
 upTo:"jusqu'à {n} Mbps",advLink:'Faire de la publicité',advTitle:'Votre publicité sur notre WiFi',advIntro:'Choisissez une offre et envoyez votre annonce. Nous vous contacterons pour le paiement; elle s’affiche après paiement et vérification.',advEveryDay:'Tous les jours',advDays:'jours',advBusiness:'Nom de l’entreprise',advAdTitle:'Titre de l’annonce',advAdText:'Texte de l’annonce',advImage:'Lien de l’image (https, facultatif)',advWebsite:'Site web (https, facultatif)',advCancel:'Fermer',advSend:'Envoyer la demande',advThanks:'Merci !',advNext:'Votre demande {ref} est reçue. Prix : {price}. L’annonce s’affiche après paiement et vérification.',advCall:'Questions : {phone}.',msgTitle:'Laissez un message',msgName:'Votre nom',msgPhone:'Numéro de téléphone',msgText:'Message',msgSend:'Envoyer',msgDone:'Merci ! Nous vous appellerons ou vous enverrons un SMS bientôt.',devices:'{n} appareils',device:'1 appareil',unlimited:'Illimité',noPlans:"Aucun forfait n'est en vente pour le moment.",loadFail:'Impossible de charger les forfaits. Actualisez la page.',noMpesa:"Les paiements M-Pesa ne sont pas encore disponibles. Si vous avez un code, connectez-vous avec.",
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
const tc=k=>fmt((THEME_COPY[CFG.theme][LANG]||THEME_COPY[CFG.theme].en)[k]);
const kes=n=>'KES '+Number(n).toLocaleString();
const when=ms=>ms?new Date(ms).toLocaleString('en-KE',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';
const ICON={
 wifi:'<svg class="i" viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/></svg>',
 arrow:'<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
 phone:'<svg class="i" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
 chat:'<svg class="i" viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/></svg>',
 mail:'<svg class="i" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>'
};
// The device secret (issued by the server the first time it recognises this device) proves a MAC in the link really is this browser's.
const DTK='portal-dt',getDT=()=>{if(ADM)return params.get('pv')||'';try{return localStorage.getItem(DTK)||'';}catch{return '';}};
async function call(path,options={}){
 const mac=/^(session|active|usage)\?mac=/.test(path)?'&dt='+encodeURIComponent(getDT()):'';
 let opt=options;if(opt.body&&/^(connect-now|redeem-points|code-login|account)$/.test(path)){try{const b=JSON.parse(opt.body);b.dt=getDT();if(path==='code-login'&&params.get('nas'))b.nas=params.get('nas');opt={...opt,body:JSON.stringify(b)};}catch{}}
 const r=await fetch('/portal/api/'+path+mac,{...opt,headers:{'Content-Type':'application/json'}});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Something went wrong. Try again.');
 if(data&&data.dt){try{localStorage.setItem(DTK,data.dt);}catch{}}return data;}
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
 // Bento: the logo is exactly as tall as the brand name + tagline beside it, on any screen and in any language.
 {const tb=document.querySelector('.tile-brand'),tx=tb&&tb.querySelector('.tb-text'),lg=tb&&tb.querySelector('.logo');
  if(tx&&lg&&!tb.dataset.sized){tb.dataset.sized='1';const fit=()=>{const h=Math.round(tx.getBoundingClientRect().height);if(h>0){const v=Math.max(40,Math.min(h,120))+'px';lg.style.width=v;lg.style.height=v;}};
   fit();if(window.ResizeObserver)new ResizeObserver(fit).observe(tx);else window.addEventListener('resize',fit);}}
 const HI_PH='<svg class="hi" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.6 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.6 3.6a1 1 0 01-.25 1z"/></svg>',HI_WA='<svg class="hi wa" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 2a8 8 0 11-4.3 14.7l-.4-.2-2.6.7.7-2.5-.3-.4A8 8 0 0112 4zm-3 3.5c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.7.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.4l-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.3-.1-1.1-.4-2.1-1.3-.8-.7-1.3-1.5-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5.3-.4v-.5l-.8-1.9c-.2-.5-.4-.5-.6-.5z"/></svg>';
 $$('[data-phone]').forEach(e=>{e.classList.toggle('hide',!CFG.phone);e.href=`tel:${CFG.phone.replace(/\s/g,'')}`;e.innerHTML=HI_PH+esc(CFG.phone);});
 $$('[data-whatsapp]').forEach(e=>{e.classList.toggle('hide',!CFG.whatsapp);e.href=`https://wa.me/${intl(CFG.whatsapp)}`;e.innerHTML=(CFG.phone?'<span class="or">or</span> ':'')+HI_WA+esc(CFG.whatsapp);});
 // Bento help tile: one line, "Need help? Call 0181… or WhatsApp 0181…".
 $$('.tile-help').forEach(e=>{const ph=CFG.phone||'',wa=CFG.whatsapp||'',tel=ph?`<a href="tel:${esc(ph.replace(/\s/g,''))}">${esc(ph)}</a>`:'',w=wa?`<a href="https://wa.me/${esc(intl(wa))}">WhatsApp ${esc(wa)}</a>`:'';
  e.innerHTML=`<small>${esc(t('needHelp'))}</small> <span class="help-line">${tel?esc(t('helpCall'))+' '+tel:''}${tel&&w?' '+esc(t('helpOr'))+' ':''}${w}</span>`;e.style.display=ph||wa?'':'none';});
 const otg=`<span class="ico">${ICON.wifi}</span><span><b>${esc(t('otgTitle'))}</b><small>${esc(t('otgSub'))}</small></span><span class="arrow">${ICON.arrow}</span>`;
 $$('[data-otg]').forEach(e=>{e.href='#packages';e.innerHTML=otg;e.classList.toggle('hide',!CFG.show.onTheGo);});
 $$('[data-otg-tile]').forEach(e=>{e.href='#packages';e.innerHTML=`<span class="ico">${ICON.wifi}</span><b>${esc(t('otgTitle'))}</b><small>${esc(t('otgSub'))}</small>`;e.style.display=CFG.show.onTheGo?'':'none';});
 document.addEventListener('click',e=>{if(!e.target.closest('.lg-menu,.lg-btn'))for(const x of document.querySelectorAll('.lg-menu'))x.hidden=true;if(!e.target.closest('.help-pop,.help-btn'))for(const x of document.querySelectorAll('.help-pop'))x.hidden=true;if(!e.target.closest('#chat-pop,#chat-fab')){const c=document.getElementById('chat-pop');if(c)c.hidden=true;}}); /*lg-close*/
 const LN={sw:'Kiswahili',en:'English',fr:'Français'};
 $$('[data-lang]').forEach(e=>{e.innerHTML=`<button type="button" class="lg-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Language: ${LN[LANG]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg><b>${LANG.toUpperCase()}</b><svg class="lg-car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.500" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button><div class="lg-menu" role="listbox" hidden>${['sw','en','fr'].map(l=>`<button type="button" role="option" data-l="${l}" class="lg-i ${l===LANG?'on':''}" aria-selected="${l===LANG}"><span class="lg-code">${l.toUpperCase()}</span><span>${LN[l]}</span><svg class="lg-ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></button>`).join('')}</div>`;
  const b=e.querySelector('.lg-btn'),m=e.querySelector('.lg-menu');b.onclick=ev=>{ev.stopPropagation();const open=m.hidden;const cp=document.getElementById('chat-pop');if(cp)cp.hidden=true;for(const x of $$('.lg-menu'))x.hidden=true;for(const x of $$('.lg-btn'))x.setAttribute('aria-expanded','false');m.hidden=!open;b.setAttribute('aria-expanded',String(open));};});
 // Header help: tap the number to call, tap the green WhatsApp icon to chat. No menu.
 {const ph=CFG.phone||'',wa=CFG.whatsapp||'';
  for(const hp of $$('.topbar .help')){if(!ph&&!wa){hp.innerHTML='';continue;}
   hp.innerHTML=`<span class="help-t">${esc(t('needHelp'))}</span>`+(wa?`<a class="help-wa" href="https://wa.me/${esc(intl(wa))}" rel="noopener" aria-label="${esc(t('whatsapp'))} ${esc(wa)}" title="${esc(t('whatsapp'))} ${esc(wa)}">${HI_WA}${ph?'':`<b>${esc(wa)}</b>`}</a>`:'')+(ph?`<a class="help-num" href="tel:${esc(ph.replace(/\s/g,''))}" aria-label="${esc(t('call'))} ${esc(ph)}">${HI_PH}<b>${esc(ph)}</b></a>`:'');}}
 // Chat button: type a message to us (becomes a support ticket), or call / WhatsApp from the same card.
 {const ph=CFG.phone||'',wa=CFG.whatsapp||'',on=CFG.show.chat!==false,saved=(()=>{try{return JSON.parse(localStorage.getItem('portal-chat')||'{}');}catch{return {};}})();
  const links=[ph&&`<a href="tel:${esc(ph.replace(/\s/g,''))}">${ICON.phone}<span>${t('call')}</span></a>`,wa&&`<a href="https://wa.me/${esc(intl(wa))}" rel="noopener">${ICON.chat}<span>${t('whatsapp')}</span></a>`].filter(Boolean).join('');
  let fab=$('#chat-fab');if(!fab){fab=document.createElement('button');fab.id='chat-fab';fab.type='button';fab.className='chat-fab';fab.setAttribute('aria-label','Chat with us');fab.innerHTML=ICON.chat;document.body.append(fab);const pop=document.createElement('div');pop.id='chat-pop';pop.className='chat-pop';pop.hidden=true;document.body.append(pop);fab.onclick=ev=>{ev.stopPropagation();for(const x of $$('.lg-menu,.help-pop'))x.hidden=true;pop.hidden=!pop.hidden;if(!pop.hidden){const f=pop.querySelector('textarea');if(f&&matchMedia('(hover:hover)').matches)f.focus();}};}
  fab.hidden=!(on||links);const pop=$('#chat-pop');
  pop.innerHTML=(on?`<form class="chat-form"><div class="chat-head"><b>${esc(t('msgTitle'))}</b><button type="button" class="chat-x" aria-label="Close">&times;</button></div><textarea name="message" rows="3" maxlength="600" placeholder="${esc(t('msgText'))}" required></textarea><div class="chat-two"><input name="name" maxlength="60" autocomplete="name" placeholder="${esc(t('msgName'))}" value="${esc(saved.name||'')}" required><input name="phone" inputmode="tel" autocomplete="tel" placeholder="${esc(t('msgPhone'))}" value="${esc(saved.phone||'')}" required></div><button class="btn chat-send" type="submit"><span>${esc(t('msgSend'))}</span> ${ICON.arrow}</button><div class="chat-err" role="alert"></div></form>`:'')+(links?`<div class="chat-links">${links}</div>`:'');
  const cf=pop.querySelector('form'),cx=pop.querySelector('.chat-x');if(cx)cx.onclick=()=>{pop.hidden=true;};
  if(cf)cf.onsubmit=async e=>{e.preventDefault();const b=cf.querySelector('.chat-send');b.disabled=true;cf.querySelector('.chat-err').textContent='';try{await call('message',{method:'POST',body:JSON.stringify({chat:true,name:cf.name.value,phone:cf.phone.value,message:cf.message.value})});try{localStorage.setItem('portal-chat',JSON.stringify({name:cf.name.value,phone:cf.phone.value}));}catch{}cf.innerHTML=`<div class="chat-done"><b>✔</b><p>${esc(t('msgDone'))}</p></div>`;}catch(err){b.disabled=false;cf.querySelector('.chat-err').textContent=err.message;}};}
 $('#hotspotPkgs').innerHTML=state==='loading'?'<div class="pkg skeleton"></div><div class="pkg skeleton"></div><div class="pkg skeleton"></div><div class="pkg skeleton"></div>':packageList(plans,false,true);
 $('#pppoePkgs').innerHTML=packageList(pppoePlans,true,false);
 const contactItems=[];if(CFG.phone)contactItems.push(`<a href="tel:${esc(CFG.phone.replace(/\s/g,''))}"><span class="ico">${ICON.phone}</span><span><b>${t('call')}</b><small>${esc(CFG.phone)}</small></span></a>`);
 if(CFG.whatsapp)contactItems.push(`<a href="https://wa.me/${esc(intl(CFG.whatsapp))}" rel="noopener"><span class="ico">${ICON.chat}</span><span><b>${t('whatsapp')}</b><small>${esc(CFG.whatsapp)}</small></span></a>`);
 if(CFG.email)contactItems.push(`<a href="mailto:${esc(CFG.email)}"><span class="ico">${ICON.mail}</span><span><b>${t('email')}</b><small>${esc(CFG.email)}</small></span></a>`);
 $('#contact').innerHTML=contactItems.join('')+(CFG.show.message?`<form id="msg-form" class="msg-form"><h3>${esc(t('msgTitle'))}</h3><label class="fl">${esc(t('msgName'))}<input name="name" maxlength="60" autocomplete="name" required></label><label class="fl">${esc(t('msgPhone'))}<input name="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" required></label><label class="fl">${esc(t('msgText'))}<textarea name="message" maxlength="600" rows="3" required></textarea></label><button class="btn" type="submit"><span>${esc(t('msgSend'))}</span> ${ICON.arrow}</button></form>`:'');
 const mf=$('#msg-form');if(mf)mf.onsubmit=async e=>{e.preventDefault();const b=mf.querySelector('button');b.disabled=true;try{await call('message',{method:'POST',body:JSON.stringify({name:mf.name.value,phone:mf.phone.value,message:mf.message.value})});mf.innerHTML=`<p class="msg">${esc(t('msgDone'))}</p>`;}catch(err){b.disabled=false;alertBox(err.message,true);}};
 $('#footer').innerHTML=`<span>© ${new Date().getFullYear()} ${esc(CFG.brandName)}. ${t('rights')}</span><span class="spacer"></span>${CFG.terms?`<a href="#" id="terms-link">${t('terms')}</a>`:''}${CFG.email?`<a href="mailto:${esc(CFG.email)}">${t('contact')}</a>`:''}${adPlans.length?`<a href="#" id="adv-link">${t('advLink')}</a>`:''}`;
 const al=$('#adv-link');if(al)al.onclick=e=>{e.preventDefault();openAdvertise();};
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
const SXL={en:{found:'Account found!',redir:'Taking you to your account…',usePin:'Use my PIN instead',usePhone:'Use my phone number instead',pinP:'Enter the 4 to 6 digit PIN for {a}.',t:'Confirm it is you',p:'For your security, enter the phone number saved on {a} (it ends {h}).',b:'Verify',w:'That phone number does not match this account.'},sw:{found:'Akaunti imepatikana!',redir:'Inakupeleka kwenye akaunti yako…',usePin:'Tumia PIN yangu',usePhone:'Tumia nambari ya simu',pinP:'Weka PIN ya tarakimu 4 hadi 6 ya {a}.',t:'Thibitisha ni wewe',p:'Kwa usalama wako, weka nambari ya simu iliyohifadhiwa kwenye {a} (inaishia {h}).',b:'Thibitisha',w:'Nambari hiyo haiendani na akaunti hii.'},fr:{found:'Compte trouvé !',redir:'Redirection vers votre compte…',usePin:'Utiliser mon code PIN',usePhone:'Utiliser mon numéro de téléphone',pinP:'Saisissez le code PIN de 4 à 6 chiffres de {a}.',t:'Confirmez que c’est vous',p:'Pour votre sécurité, saisissez le numéro de téléphone enregistré sur {a} (il se termine par {h}).',b:'Vérifier',w:'Ce numéro ne correspond pas à ce compte.'}};
function renderAccount(a){here('Account');
 setTimeout(()=>{const w=$('#want-form');if(w)w.onsubmit=async e=>{e.preventDefault();const b=w.querySelector('button');b.disabled=true;try{await call('interest',{method:'POST',body:JSON.stringify({account:a.account,planId:w.planId.value,pin:($('#acc-pin')?.value||'').trim()||undefined})});w.innerHTML=`<p class="msg">${esc(t('wantDone'))}</p>`;}catch(err){b.disabled=false;alertBox(err.message,true);}};},0);
 const box=$('#accResult');
 if(!a.found){box.innerHTML='';return showMsg(t('noAccount'),true);}
 // Not this account's own device: ask for the phone number saved on the account before showing anything.
 if(a.link){const T0=SXL[(LANG||'en').slice(0,2)]||SXL.en;box.innerHTML=`<div class="lock-card"><h3>✔ ${esc(T0.found)}</h3><p>${esc(T0.redir)}</p></div>`;setTimeout(()=>{location.href=a.link;},500);return;}
 if(a.locked){const L=(LANG||'en').slice(0,2),T=SXL[L]||SXL.en;const am=$('#accMsg');if(am)am.textContent='';
  box.innerHTML=`<div class="lock-card"><h3>${esc(T.t)}</h3><p>${esc(T.p.replace('{a}',String(a.account).toUpperCase()).replace('{h}',a.phoneHint))}</p><form id="lock-form" novalidate><input name="phone" inputmode="tel" autocomplete="tel" placeholder="0712 345 678" required><input name="pin" class="lock-pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="• • • •" hidden><button class="btn" type="submit"><span>${esc(T.b)}</span></button><div class="msg ${a.wrong?'bad':''}" id="lock-msg">${a.wrong?esc(T.w):''}</div>${a.hasPin?`<button type="button" class="lock-alt" id="lock-alt">${esc(T.usePin)}</button>`:''}</form></div>`;
  if(a.hasPin){const lf0=$('#lock-form'),alt=$('#lock-alt');let mode='pin';const set=m=>{mode=m;lf0.phone.hidden=m==='pin';lf0.pin.hidden=m!=='pin';lf0.phone.required=m!=='pin';lf0.pin.required=m==='pin';alt.textContent=m==='pin'?T.usePhone:T.usePin;box.querySelector('p').textContent=(m==='pin'?T.pinP:T.p).replace('{a}',String(a.account).toUpperCase()).replace('{h}',a.phoneHint);};alt.onclick=()=>set(mode==='pin'?'phone':'pin');set('pin');lf0.dataset.mode='pin';alt.addEventListener('click',()=>{lf0.dataset.mode=mode;});}
  const lf=$('#lock-form');lf.onsubmit=async e=>{e.preventDefault();const b=lf.querySelector('button');b.disabled=true;try{renderAccount(await call('account',{method:'POST',body:JSON.stringify(lf.dataset.mode==='pin'?{query:a.account,pin:lf.pin.value,mac:router.mac||undefined}:{query:a.account,phone:lf.phone.value,mac:router.mac||undefined})}));}catch(err){b.disabled=false;$('#lock-msg').textContent=err.message;}};return;}
 // A friend's sharing code: join that package on this device (counts as one of its devices).
 if(a.share){const L=(LANG||'en').slice(0,2),T={en:['Join {o}\'s package','{p} · up to {n} devices · until {d}','Connect this device','This package has ended. Ask {o} to renew it.','Connect to the Wi-Fi first, then open this page again.'],sw:['Jiunge na kifurushi cha {o}','{p} · hadi vifaa {n} · hadi {d}','Unganisha kifaa hiki','Kifurushi hiki kimeisha. Mwambie {o} akilipie tena.','Unganisha kwenye Wi-Fi kwanza, kisha ufungue ukurasa huu tena.']}[L]||null,w=T||['Join {o}\'s package','{p} · up to {n} devices · until {d}','Connect this device','This package has ended. Ask {o} to renew it.','Connect to the Wi-Fi first, then open this page again.'],f=(x,v)=>x.replace(/\{(\w)\}/g,(m,k)=>esc(v[k]??''));
  showMsg('');box.innerHTML=`<div class="acc-result"><div class="top"><b>${f(w[0],{o:a.owner})}</b></div><div class="facts">${f(w[1],{p:a.plan,n:a.devices,d:a.expiresAt?when(a.expiresAt):''})}</div>${a.active?`<button type="button" class="btn" id="share-go"><span>${esc(w[2])}</span> ${ICON.arrow}</button>`:`<p class="muted small">${f(w[3],{o:a.owner})}</p>`}</div>`;
  const g=$('#share-go');if(g)g.onclick=async()=>{if(!router.login){alertBox(w[4],true);return;}g.disabled=true;try{await routerLogin(a.code,a.code.toLowerCase());}catch(e){g.disabled=false;alertBox(e.message,true);}};return;}
 showMsg(a.pinError?t('pinWrong'):'',!!a.pinError);
 const label={active:t('statusActive'),expired:t('statusExpired'),suspended:t('statusSuspended'),unpaid:t('statusExpired')}[a.status]||a.status,when2=a.status==='active'?t('until',{d:when(a.expiresAt)}):a.status==='expired'?(a.expiresAt?t('expiredOn',{d:when(a.expiresAt)}):''):'';
 let html=`<div class="acc-result"><div class="top"><b>${esc(a.account.toUpperCase())}</b><span class="badge ${esc(a.status)}">${esc(label)}</span></div><div class="facts">${esc([a.plan,when2].filter(Boolean).join(' · '))}</div>`;
 if(a.verified)html+=`<div class="facts">${esc(t('wallet'))}: ${kes(a.balance||0)}${a.points?' · '+a.points+' pts':''}${CFG.show.usage!==false&&(a.monthDown||a.monthUp)?' · '+esc(t('dataMonth'))+': '+(((a.monthDown||0)+(a.monthUp||0))/1073741824).toFixed(1)+' GB':''}</div>`;
 if(a.verified&&a.shareCode)html+=`<div class="share-code"><span>${esc((LANG||'en').startsWith('sw')?'Nambari ya kushiriki':'Sharing code')}</span><b>${esc(a.shareCode)}</b><small>${esc((LANG||'en').startsWith('sw')?`Mpe rafiki: aiandike kwenye ukurasa huu kutumia kifaa kimoja kati ya ${a.shareDevices} vya kifurushi chako.`:`Give it to a friend: they type it on this page to use one of your ${a.shareDevices} devices.`)}</small></div>`;
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
 showMsg(t('searching'));try{const pin=($('#acc-pin')?.value||'').trim();renderAccount(await call('account',{method:'POST',body:JSON.stringify({query:extractAccount(raw)||raw,pin:pin||undefined,mac:router.mac||undefined})}));}catch(error){showMsg(error.message,true);}});
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
 const r=await call('login',{method:'POST',body:JSON.stringify({username,password,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge})});
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
 for(const el of box.querySelectorAll('[data-ad]'))call('ads/'+el.dataset.ad+'/view',{method:'POST',body:JSON.stringify({mac:router.mac||''})}).then(r=>{el.dataset.ticket=r.ticket;}).catch(()=>{});
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
 for(const [id,key] of [['tPppoe','pppoe'],['tHotspot','hotspot'],['tFind','findAccount'],['tAccess','accessAccount'],['tOtg','onTheGo'],['tContact','contact'],['tSpeed','speed'],['tUsage','usage'],['tMessage','message'],['tChat','chat']])$('#'+id).checked=!!CFG.show[key];
 $('#presetColors').innerHTML=['#0a3cff','#1d4ed8','#0891b2','#059669','#7c3aed','#db2777','#ea580c','#0f172a'].map(c=>`<button type="button" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
}
function wireAdmin(){
 $('#adminFab').classList.remove('hide');$('#adminFab').onclick=()=>$('#admin').classList.add('open');$('#closeAdmin').onclick=()=>$('#admin').classList.remove('open');
 $('#admin').addEventListener('click',e=>{const tp=e.target.closest('[data-theme-pick]');if(tp){CFG.theme=tp.dataset.themePick;render();}const cp=e.target.closest('[data-color]');if(cp){CFG.brandColor=cp.dataset.color;render();}});
 const text=(id,key,fallback='')=>{$('#'+id).oninput=e=>{CFG[key]=e.target.value||fallback;render();};};
 text('cfgName','brandName','Kade Networks');text('cfgIntro','intro');text('cfgPhone','phone');text('cfgWhatsapp','whatsapp');text('cfgEmail','email');text('cfgPopular','popular');
 $('#cfgColor').oninput=e=>{CFG.brandColor=e.target.value;render();};$('#cfgLang').onchange=e=>{CFG.defaultLang=e.target.value;LANG=e.target.value;render();};
 for(const [id,key] of [['tPppoe','pppoe'],['tHotspot','hotspot'],['tFind','findAccount'],['tAccess','accessAccount'],['tOtg','onTheGo'],['tContact','contact'],['tSpeed','speed'],['tUsage','usage'],['tMessage','message'],['tChat','chat']])$('#'+id).onchange=e=>{CFG.show[key]=e.target.checked;render();};
 $('#saveCfg').onclick=async()=>{const btn=$('#saveCfg');btn.textContent='Saving…';
  try{const body={theme:CFG.theme,brandName:CFG.brandName,brandColor:CFG.brandColor,intro:CFG.intro,defaultLang:CFG.defaultLang,phone:CFG.phone,whatsapp:CFG.whatsapp,email:CFG.email,accountPrefix:CFG.accountPrefix,popular:CFG.popular,packageLayout:CFG.packageLayout,loadingStyle:CFG.loadingStyle,loadingText:CFG.loadingText,terms:CFG.terms,show:CFG.show};
   const r=await fetch('/api/portal/landing',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
   const data=await r.json().catch(()=>({}));btn.textContent=r.ok?'Saved ✓':(data.error||'Save failed');}catch{btn.textContent='Save failed';}setTimeout(()=>btn.textContent='Save',2200);};
 $('#copyCfg').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(CFG,null,2));$('#copyCfg').textContent='Copied ✓';}catch{$('#copyCfg').textContent='Copy failed';}setTimeout(()=>$('#copyCfg').textContent='Copy JSON',1500);};
}
// Preview inside the netops editor: the editor's unsaved settings win over the saved ones, whichever arrives first.
let previewCfg=null;const applyPreview=()=>{const c=previewCfg;if(!c)return;CFG={...CFG,...c,show:{...CFG.show,...(c.show||{})}};if(c.defaultLang)LANG=c.defaultLang;};
window.addEventListener('message',e=>{if(e.origin!==location.origin||!params.has('preview')||e.data?.kade!=='config')return;previewCfg=e.data.config||{};applyPreview();render();});
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
// "Advertise here": a business picks a plan and sends its advert; staff confirm payment and review it.
let adPlans=[],adContact='';
async function loadAdPlans(){if(params.has('preview'))return;try{const r=await call('adplans');adPlans=r.plans||[];adContact=r.contact||'';if(adPlans.length)render();}catch{}}
function openAdvertise(){let d=$('#adv-dialog');if(!d){d=document.createElement('dialog');d.id='adv-dialog';d.className='adv-dialog';document.body.appendChild(d);}
 const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],sched=p=>(p.weekdays.length?p.weekdays.map(x=>DAYS[x]).join(' '):t('advEveryDay'))+' · '+String(p.fromHour).padStart(2,'0')+':00–'+String(p.toHour).padStart(2,'0')+':00';
 d.innerHTML=`<form id="adv-form" method="dialog"><h2>${esc(t('advTitle'))}</h2><p class="muted small">${esc(t('advIntro'))}</p>${adPlans.map((p,i)=>`<label class="adv-plan"><input type="radio" name="planId" value="${esc(p.id)}" ${i?'':'checked'}><span><b>${esc(p.name)} · ${kes(p.price)}</b><small>${p.days} ${esc(t('advDays'))} · ${esc(sched(p))}</small>${p.description?`<small>${esc(p.description)}</small>`:''}</span></label>`).join('')}
  <label class="fl">${esc(t('advBusiness'))}<input name="business" maxlength="80" required></label><label class="fl">${esc(t('msgPhone'))}<input name="phone" inputmode="tel" required placeholder="0712 345 678"></label><label class="fl">Email<input name="email" type="email" maxlength="120"></label>
  <label class="fl">${esc(t('advAdTitle'))}<input name="title" maxlength="60"></label><label class="fl">${esc(t('advAdText'))}<textarea name="text" rows="3" maxlength="240"></textarea></label><label class="fl">${esc(t('advImage'))}<input name="imageUrl" placeholder="https://"></label><label class="fl">${esc(t('advWebsite'))}<input name="link" placeholder="https://"></label>
  <p class="adv-msg" id="adv-msg"></p><div class="adv-actions"><button type="button" class="btn ghost" id="adv-close">${esc(t('advCancel'))}</button><button class="btn" type="submit"><span>${esc(t('advSend'))}</span></button></div></form>`;
 d.showModal();$('#adv-close').onclick=()=>d.close();
 $('#adv-form').onsubmit=async e=>{e.preventDefault();const f=e.target,b=f.querySelector('[type=submit]');b.disabled=true;$('#adv-msg').textContent='';
  try{const r=await call('adorders',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});f.innerHTML=`<h2>${esc(t('advThanks'))}</h2><p>${esc(t('advNext',{ref:r.ref,price:kes(r.price)}))}${adContact?' '+esc(t('advCall',{phone:adContact})):''}</p><div class="adv-actions"><button type="button" class="btn" id="adv-done">OK</button></div>`;$('#adv-done').onclick=()=>d.close();}
  catch(err){b.disabled=false;$('#adv-msg').textContent=err.message;}};}
// Scheduled maintenance notice (set in netops → Settings → Scheduled maintenance).
let MAINT=null;
// "Login or purchase" landing: customers who already paid go straight to their account instead of hunting past prices.
function loginChoice(){if(!CFG.show?.loginChoice||params.get('account')||params.get('expired')||params.get('ps')||document.getElementById('lc-sheet'))return;try{if(sessionStorage.getItem('lc-done'))return;}catch{}
 const L=(LANG||'en').slice(0,2),tx={en:['Welcome','I already paid','Log in with my account, code or payment','Buy a package','See packages and prices'],sw:['Karibu','Nimeshalipa','Ingia kwa akaunti, nambari au malipo','Nunua kifurushi','Angalia vifurushi na bei'],fr:['Bienvenue','J’ai déjà payé','Connexion avec mon compte, code ou paiement','Acheter un forfait','Voir les forfaits et les prix']}[L]||null;const w=tx||['Welcome','I already paid','Log in with my account, code or payment','Buy a package','See packages and prices'];
 const esc2=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const d=document.createElement('div');d.id='lc-sheet';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-label',w[0]);
 d.innerHTML=`<div class="lc-box"><h2>${esc2(CFG.brandName||w[0])}</h2><button type="button" data-lc="login"><b>${esc2(w[1])}</b><span>${esc2(w[2])}</span></button><button type="button" data-lc="buy"><b>${esc2(w[3])}</b><span>${esc2(w[4])}</span></button></div>`;
 d.style.cssText='position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(10,20,30,.55)';document.body.append(d);
 const done=()=>{try{sessionStorage.setItem('lc-done','1');}catch{}d.remove();};
 d.querySelector('[data-lc=login]').onclick=()=>{done();const f=document.getElementById('acc');if(f){f.scrollIntoView({block:'center'});f.focus();}};d.querySelector('[data-lc=buy]').onclick=done;
 d.querySelector('[data-lc=login]').focus();}
function showMaint(){if(!MAINT||document.getElementById('maint-note'))return;const n=document.createElement('div');n.id='maint-note';n.setAttribute('role','status');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 n.innerHTML=`<strong>${esc(MAINT.title)}</strong><span>${esc(MAINT.message)}${MAINT.until?' · until '+esc(new Date(MAINT.until).toLocaleString([], {weekday:'short',hour:'2-digit',minute:'2-digit'})):''}</span>`;
 n.style.cssText='position:sticky;top:0;z-index:50;display:flex;flex-wrap:wrap;gap:4px 10px;justify-content:center;align-items:center;padding:10px 14px;background:#fff4e0;color:#7a4b00;border-bottom:1px solid #f0d49a;font-size:14px;line-height:1.4;text-align:center';
 document.body.prepend(n);}
async function boot(){
 render();
 const q=params.get('theme');
 try{
  const cq=new URLSearchParams();if(router.mac)cq.set('mac',router.mac);if(params.get('ip'))cq.set('ip',params.get('ip'));if(params.get('nas'))cq.set('nas',params.get('nas'));const d=await call('config'+(cq.toString()?'?'+cq:''));MAINT=d.maintenance||null;CFG={...CFG,...d.config,show:{...CFG.show,...(d.config.show||{})}};applyPreview();plans=d.plans||[];pppoePlans=d.pppoePlans||[];mpesaOn=!!d.mpesa;cardOn=!!d.paystack;freeMode=d.freeMode||null;engage=d.engage||{ads:[],quiz:null};state='ok';
  try{if(!localStorage.getItem('portal-lang'))LANG=CFG.defaultLang||LANG;}catch{LANG=CFG.defaultLang||LANG;}
 }catch{state='error';}
 if(q&&THEMES[q])CFG.theme=q;
 render();bootDone();showMaint();loginChoice();hotspotExtras();if(params.get('expired')==='1')setTimeout(()=>{const f=$('#acc');if(f){f.scrollIntoView({block:'center'});f.focus();}},300);if(params.get('ps')&&params.get('pt')){busy(true);$('#wait-title').textContent=t('payCard');$('#wait-text').textContent=t('cardChecking');poll(params.get('ps'),params.get('pt'),Date.now());}const err=params.get('error');if(err)alertBox(err);else if(state==='ok'&&!mpesaOn)alertBox(t('noMpesa'));
 detectSession();checkAdmin();here();loadAdPlans();
 // Self-service link from netops (?account=USERNAME): open that account straight away.
 const deep=(params.get('account')||'').trim().slice(0,64);if(deep&&CFG.show.accessAccount!==false){$('#acc').value=deep;setTimeout(()=>{$('#acc').scrollIntoView({block:'center'});$('#accForm').requestSubmit();},200);}
}

/* ===================== HOTSPOT EXTRAS: connect now, voucher / M-Pesa code, My usage ===================== */
const HX={en:{active:'You have an active connection!',pkg:'Package',exp:'Expires in {t}',auto:'You will be connected automatically in {n}s',now:'Connect now',stay:'Stay here',all:'Extend package',voucher:'Use voucher',code:'Connect with M-Pesa code',welcome:'Welcome to our Hotspot service!',paidHint:'If you already paid, just click the package paid for to auto-connect.',loyalty:'Loyalty points balance',pts:'pts',redeem:'Redeem',redeemed:'Added KES {n} to your wallet',backActive:'Back to active connection',usageT:'My usage',usageS:'Data used, payments and subscription history',back:'Back',total:'Total data used (all time)',last30:'Used in the last 30 days',history:'History',payments:'Payments',connects:'Connects',sessions:'Sessions',recent:'Recent payments',viewAll:'View all',none:'Nothing yet',codeT:'Connect with your M-Pesa code',codeS:'Enter the confirmation code from your M-Pesa message.',codePh:'e.g. UK3IF0TW26',voucherT:'Use a voucher',voucherS:'Enter the voucher code you were given.',voucherPh:'Voucher code',go:'Connect',cancel:'Cancel',needWifi:'Connect to the Wi-Fi first, then open this page again.',active2:'Active',expired:'Expired',expIn:'Exp in {t}',min:'min',hr:'h',day:'d',down:'down',up:'up'},
 sw:{active:'Una muunganisho unaoendelea!',pkg:'Kifurushi',exp:'Kinaisha baada ya {t}',auto:'Utaunganishwa kiotomatiki baada ya sekunde {n}',now:'Unganisha sasa',stay:'Baki hapa',all:'Ongeza kifurushi',voucher:'Tumia vocha',code:'Unganisha kwa msimbo wa M-Pesa',welcome:'Karibu kwenye huduma yetu ya Hotspot!',paidHint:'Ikiwa umeshalipa, bofya kifurushi ulicholipia ili kuunganishwa.',loyalty:'Salio la pointi',pts:'pointi',redeem:'Tumia pointi',redeemed:'Umeongezewa KES {n} kwenye pochi',backActive:'Rudi kwenye muunganisho unaoendelea',usageT:'Matumizi yangu',usageS:'Data iliyotumika, malipo na historia',back:'Rudi',total:'Jumla ya data iliyotumika',last30:'Siku 30 zilizopita',history:'Historia',payments:'Malipo',connects:'Miunganisho',sessions:'Vipindi',recent:'Malipo ya hivi karibuni',viewAll:'Ona yote',none:'Bado hakuna',codeT:'Unganisha kwa msimbo wa M-Pesa',codeS:'Weka msimbo wa uthibitisho kutoka ujumbe wa M-Pesa.',codePh:'mf. UK3IF0TW26',voucherT:'Tumia vocha',voucherS:'Weka msimbo wa vocha uliyopewa.',voucherPh:'Msimbo wa vocha',go:'Unganisha',cancel:'Ghairi',needWifi:'Unganisha kwenye Wi-Fi kwanza, kisha fungua ukurasa huu tena.',active2:'Inatumika',expired:'Imeisha',expIn:'Inaisha {t}',min:'dak',hr:'saa',day:'siku',down:'pakua',up:'pakia'}};
const hx=(k,v={})=>String((HX[(LANG||'en').slice(0,2)]||HX.en)[k]??HX.en[k]??k).replace(/\{(\w)\}/g,(m,x)=>v[x]??'');
const leftText=ms=>{const m=Math.max(1,Math.round(ms/60000));return m<60?m+' '+hx('min'):m<1440?Math.round(m/60)+' '+hx('hr'):Math.round(m/1440)+' '+hx('day');};
const gb=n=>{n=Number(n)||0;for(const [u,d] of [['GB',1073741824],['MB',1048576],['KB',1024]])if(n>=d)return (n/d).toFixed(2)+' '+u;return n+' B';};
const dur=ms=>{const m=Math.round(ms/60000);return m<1?'<1m':m<60?m+'m':m<1440?Math.floor(m/60)+'h '+(m%60)+'m':Math.floor(m/1440)+'d '+Math.floor(m%1440/60)+'h';};
const dt=t=>t?new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Nairobi'}):'';
async function hxJoin(path,body){const r=await call(path,{method:'POST',body:JSON.stringify({...body,mac:router.mac,chapId:router.chapId,chapChallenge:router.chapChallenge})});
 if(r.alreadyConnected){document.getElementById('hx-sheet')?.remove();alertBox('Payment code verified. You are already connected.',true);return;}
 const q=new URLSearchParams({username:r.username,password:r.password,dst:router.dst||'http://www.google.com',popup:'false'});location.href=router.login+(router.login.includes('?')?'&':'?')+q;}
function hxSheet(title,sub,ph,onGo,inputmode){document.getElementById('hx-sheet')?.remove();
 const d=document.createElement('div');d.id='hx-sheet';d.className='hx-bg';d.innerHTML=`<div class="hx-sheet" role="dialog" aria-modal="true"><button class="hx-x" type="button" aria-label="${esc(hx('cancel'))}">×</button><h3>${esc(title)}</h3><p>${esc(sub)}</p><div class="hx-err" hidden></div><input autocomplete="off" autocapitalize="characters" ${inputmode?`inputmode="${inputmode}"`:''} placeholder="${esc(ph)}"><button class="btn" type="button"><span>${esc(hx('go'))}</span> ${ICON.arrow}</button></div>`;
 document.body.append(d);const close=()=>d.remove(),inp=d.querySelector('input'),err=d.querySelector('.hx-err'),go=d.querySelector('.btn');d.querySelector('.hx-x').onclick=close;d.onclick=e=>{if(e.target===d)close();};inp.focus();
 const run=async()=>{err.hidden=true;go.disabled=true;try{await onGo(inp.value.trim());}catch(e){err.textContent=e.message;err.hidden=false;go.disabled=false;}};go.onclick=run;inp.onkeydown=e=>{if(e.key==='Enter')run();};}
function hxBar(){const card=$('#hotspotCard');if(!card||card.querySelector('.hx-bar')||CFG.show?.hotspot===false)return;
 const bar=document.createElement('div');bar.className='hx-bar';bar.innerHTML=`<p class="hx-hint">${esc(hx('paidHint'))}</p><div class="hx-btns"><button type="button" class="hx-btn" id="hx-voucher">${esc(hx('voucher'))}</button><button type="button" class="hx-btn" id="hx-code">${esc(hx('code'))}</button></div>`;
 card.querySelector('.section-head').after(bar);
 if(CFG.show?.vouchers===false)$('#hx-voucher').remove();else $('#hx-voucher').onclick=()=>hxSheet(hx('voucherT'),hx('voucherS'),hx('voucherPh'),async v=>{if(!v)throw new Error(hx('voucherPh'));if(!router.login)throw new Error(hx('needWifi'));await routerLogin(v,v.toLowerCase());});
 $('#hx-code').onclick=()=>hxSheet(hx('codeT'),hx('codeS'),hx('codePh'),async v=>{if(!router.login)throw new Error(hx('needWifi'));await hxJoin('code-login',{code:v});});}
let hxTimer=null;
async function hxActive(){if(params.get('renew')==='1')return;if(!router.mac||(!ADM&&(!router.login||!router.chapId))||CFG.show?.autoConnect===false)return;
 let a;try{a=await call('active?mac='+encodeURIComponent(router.mac));}catch{return;}if(!a.found||!a.trusted)return;
 const mark=()=>{for(const b of document.querySelectorAll('.pkg[data-pkg]'))if(b.dataset.pkg===a.planId&&!b.querySelector('.hx-chip')){b.classList.add('hx-cur');const c=document.createElement('span');c.className='hx-chip';c.textContent=a.left!=null?hx('expIn',{t:leftText(a.left)}):hx('active2');b.append(c);}};
 mark();new MutationObserver(mark).observe($('#hotspotPkgs'),{childList:true});
 const col=$('#packagesCol');if(!col||document.getElementById('hx-active'))return;let n=4;
 const card=document.createElement('div');card.id='hx-active';card.className='card hx-active';
 card.innerHTML=`<h2>✓ ${esc(hx('active'))}</h2><p class="hx-pkg">${esc(hx('pkg'))}: <b>${esc(a.plan)}</b></p>${a.left!=null?`<p class="muted small">${esc(hx('exp',{t:leftText(a.left)}))}</p>`:''}<p class="muted small" id="hx-auto">${esc(hx('auto',{n}))}</p><button type="button" class="btn" id="hx-now"><span>${esc(hx('now'))} (<b id="hx-n">${n}</b>)</span></button><div class="hx-row"><button type="button" class="hx-link" id="hx-stay">${esc(hx('stay'))}</button><a class="hx-link" href="#hotspotCard" id="hx-all">${esc(hx('all'))}</a></div><div class="msg" id="hx-msg"></div>`;
 ($('#hx-loy')||$('#portal-alert')||col).after(card);{const hc=$('#hotspotCard');if(hc&&!hc.querySelector('.hx-back-active')){const bk=document.createElement('a');bk.className='hx-link hx-back-active';bk.href='#hx-active';bk.textContent='← '+hx('backActive');bk.onclick=e=>{e.preventDefault();document.getElementById('hx-active').scrollIntoView({behavior:'smooth'});};hc.append(bk);}}
 const go=async()=>{clearInterval(hxTimer);const b=$('#hx-now');b.disabled=true;try{await hxJoin('connect-now',{});}catch(e){b.disabled=false;$('#hx-msg').textContent=e.message;}};
 if(ADM){clearInterval(hxTimer);const bn=document.createElement('div');bn.className='hx-adm';bn.innerHTML='👁 Admin preview as <b>'+esc(params.get('viewas'))+'</b>. You are not on the hotspot WiFi, so Connect now is disabled.';card.before(bn);const au=$('#hx-auto');if(au)au.remove();const st=$('#hx-stay');if(st)st.remove();const nb=$('#hx-now');nb.disabled=true;nb.innerHTML='<span>Connect now (hotspot WiFi only)</span>';}
 $('#hx-now').onclick=go;if($('#hx-stay'))$('#hx-stay').onclick=()=>{clearInterval(hxTimer);$('#hx-auto').remove();$('#hx-n').parentElement.textContent=hx('now');};$('#hx-all').onclick=e=>{e.preventDefault();clearInterval(hxTimer);$('#hotspotCard').scrollIntoView({behavior:'smooth'});};
 if(!ADM)hxTimer=setInterval(()=>{n--;const el=$('#hx-n');if(el)el.textContent=n;const au=$('#hx-auto');if(au)au.textContent=hx('auto',{n:Math.max(n,0)});if(n<=0)go();},1000);}
async function hxUsageCard(){if(!router.mac||CFG.show?.myUsage===false||document.getElementById('hx-usage-card'))return;
 let u;try{u=await call('usage?mac='+encodeURIComponent(router.mac));}catch{return;}if(!u.found)return;
 if(u.loyalty?.enabled&&!document.getElementById('hx-loy')){const lb=document.createElement('div');lb.id='hx-loy';lb.className='hx-loy';lb.innerHTML=`<span class="hx-ic">★</span><span><small>${esc(hx('loyalty'))}</small><b>${u.points} ${esc(hx('pts'))}</b></span><button type="button" class="hx-redeem" ${u.points>0?'':'disabled'}>${esc(hx('redeem'))}</button>`;($('#portal-alert')||$('#packagesCol')).after(lb);
  lb.querySelector('.hx-redeem').onclick=async e=>{const b=e.currentTarget;b.disabled=true;try{const r=await call('redeem-points',{method:'POST',body:JSON.stringify({mac:router.mac})});lb.querySelector('b').textContent=r.points+' '+hx('pts');alertBox(hx('redeemed',{n:Math.round((u.points-r.points)*(u.loyalty.pointValue||0))}),true);}catch(x){b.disabled=false;alertBox(x.message);}};}
 const col=$('#packagesCol');if(!col)return;const c=document.createElement('button');c.id='hx-usage-card';c.type='button';c.className='hx-usage-card';c.innerHTML=`<span class="hx-ic">${ICON.wifi}</span><span><b>${esc(hx('usageT'))}</b><small>${esc(hx('usageS'))}</small></span><span class="hx-chev">›</span>`;col.append(c);c.onclick=()=>hxUsagePage(u);}
function hxUsagePage(u,tab){document.getElementById('hx-usage')?.remove();
 const page=document.createElement('div');page.id='hx-usage';page.className='hx-page';
 const row=(l,r,m)=>`<div class="hx-r"><div><b>${esc(l)}</b>${m?`<small>${esc(m)}</small>`:''}</div><div class="hx-rr">${r}</div></div>`;
 const view=()=>{const T=tab;let body='';
  if(!T){body=`<div class="hx-tot"><small>${esc(hx('total'))}</small><b>${esc(gb(u.total.down+u.total.up))}</b><span>↓ ${esc(gb(u.total.down))} ${esc(hx('down'))} · ↑ ${esc(gb(u.total.up))} ${esc(hx('up'))}</span><em>${esc(hx('last30'))}: ${esc(gb(u.last30.down+u.last30.up))}</em></div>
   <h4>${esc(hx('history'))}</h4><div class="hx-tabs">${[['payments',hx('payments')],['connects',hx('connects')],['sessions',hx('sessions')]].map(([k,l])=>`<button type="button" data-t="${k}">${esc(l)}</button>`).join('')}</div>
   <div class="hx-rh"><h4>${esc(hx('recent'))}</h4><button type="button" class="hx-link" data-t="payments">${esc(hx('viewAll'))}</button></div>${u.payments.slice(0,3).map(p=>row(p.ref||p.plan,esc(kes(p.amount)),dt(p.time))).join('')||`<p class="muted">${esc(hx('none'))}</p>`}`;}
  else if(T==='payments')body=`<h3 class="hx-h">${esc(hx('payments'))}</h3>`+(u.payments.map(p=>row(p.ref||p.plan,esc(kes(p.amount)),dt(p.time))).join('')||`<p class="muted">${esc(hx('none'))}</p>`);
  else if(T==='connects')body=`<h3 class="hx-h">${esc(hx('connects'))}</h3>`+(u.connects.map(c=>row(c.plan||'—',`<span class="hx-b ${c.status}">${esc(c.status==='active'?hx('active2'):hx('expired'))}</span><br>${esc(kes(c.amount))}`,dt(c.time)+' · ↓ '+gb(c.down)+' ↑ '+gb(c.up))).join('')||`<p class="muted">${esc(hx('none'))}</p>`);
  else body=`<h3 class="hx-h">${esc(hx('sessions'))}</h3>`+(u.sessions.map(x=>row(dt(x.start),esc(x.open?hx('active2'):dur(x.end-x.start)),'↓ '+gb(x.down)+' ↑ '+gb(x.up))).join('')||`<p class="muted">${esc(hx('none'))}</p>`);
  page.innerHTML=`<header><button type="button" class="hx-back">← ${esc(hx('back'))}</button><b>${esc(u.account.toUpperCase())}</b></header><main>${T?'':`<h3 class="hx-h">${esc(hx('usageT'))}</h3>`}${body}</main>`;
  page.querySelector('.hx-back').onclick=()=>{if(tab){tab=null;view();}else page.remove();};for(const b of page.querySelectorAll('[data-t]'))b.onclick=()=>{tab=b.dataset.t;view();};};
 view();document.body.append(page);}
// Which view a customer gets depends on where they are and what we know about their device:
//   offwifi      not on the hotspot: look up, pay and check; WiFi-only tools are hidden
//   wifi-active  on the hotspot with a live package: connect card, short "extend" row
//   wifi-expired on the hotspot, package ended: welcome back + packages, voucher and M-Pesa code
//   wifi-new     on the hotspot, unknown device: the normal page
const SX={en:{custPortal:'Customer Portal',types:'Works with all connection types',tHot:'Hotspot WiFi',tPpp:'PPPoE Fiber',offNote:'Buy from anywhere with M-Pesa, then join the WiFi to connect.',offTitle:'Manage your connection',offSub:'Find your account to check your package, pay or renew.',tStatus:'Check status',tPay:'Pay / renew',tUsage:'View usage',tAcct:'My account',back:'Welcome back, {a}.',ended:'Your {p} package ended on {d}. Pick a package below, or use a voucher or an M-Pesa code.',endedNoPlan:'Your package has ended. Pick a package below, or use a voucher or an M-Pesa code.'},
 sw:{custPortal:'Portal ya Mteja',types:'Inafanya kazi na aina zote za muunganisho',tHot:'Hotspot WiFi',tPpp:'PPPoE Fiber',offNote:'Nunua popote kwa M-Pesa, kisha unganisha WiFi ili uunganishwe.',offTitle:'Simamia muunganisho wako',offSub:'Tafuta akaunti yako kuangalia kifurushi, kulipa au kuongeza.',tStatus:'Angalia hali',tPay:'Lipa / ongeza',tUsage:'Matumizi',tAcct:'Akaunti yangu',back:'Karibu tena, {a}.',ended:'Kifurushi chako cha {p} kiliisha tarehe {d}. Chagua kifurushi hapa chini, au tumia vocha au msimbo wa M-Pesa.',endedNoPlan:'Kifurushi chako kimeisha. Chagua kifurushi hapa chini, au tumia vocha au msimbo wa M-Pesa.'}};
const sx=(k,v={})=>String((SX[(LANG||'en').slice(0,2)]||SX.en)[k]??SX.en[k]??k).replace(/\{(\w)\}/g,(m,x)=>v[x]??'');
let sitDone=false;
async function sitInit(){if(sitDone)return;sitDone=true;
 const onWifi=!!router.login||ADM;let d=null;
 if(router.mac){try{const r=await call('session?mac='+encodeURIComponent(router.mac));if(r.found)d=r;}catch{}}
 const sit=!onWifi?'offwifi':d?(d.status==='active'?'wifi-active':'wifi-expired'):'wifi-new';document.body.dataset.sit=sit;
 if(sit==='offwifi'){
  const grid=$('.main-grid');if(grid&&!$('#sit-tiles')){const t=document.createElement('div');t.id='sit-tiles';t.className='sit-tiles';
   t.innerHTML=[['status','✔',sx('tStatus')],['pay','💳',sx('tPay')],['usage','📊',sx('tUsage')],['acct','👤',sx('tAcct')]].map(([k,i,l])=>`<button type="button" class="sit-tile" data-sit="${k}"><span>${i}</span>${esc(l)}</button>`).join('');grid.before(t);
   const go=k=>{const target=$('#accountCard');if(target)target.scrollIntoView({behavior:'smooth',block:'start'});if(k!=='pay')setTimeout(()=>$('#acc')?.focus({preventScroll:true}),400);};
   for(const b of t.querySelectorAll('[data-sit]'))b.onclick=()=>go(b.dataset.sit);}
  // Not on the hotspot: this is the customer portal for everyone (PPPoE, static, or a hotspot customer away from the WiFi). Hotspot
  // packages are only sold to people on the hotspot WiFi, so they are not shown here.
  const h1=$('.hero h1');if(h1)h1.textContent=sx('custPortal');const sub=$('.hero .sub');if(sub)sub.textContent=sx('offSub');
  const ac=$('#accountCard');if(ac&&!$('#sit-types'))ac.after(Object.assign(document.createElement('p'),{id:'sit-types',className:'sit-types',innerHTML:esc(sx('types'))+'<br><span><i></i>'+esc(sx('tHot'))+'</span><span><i></i>'+esc(sx('tPpp'))+'</span>'}));
 }
 if(sit==='wifi-expired'){
  const col=$('#packagesCol');if(col&&!$('#sit-note')){const n=document.createElement('div');n.id='sit-note';n.className='card sit-note';
   const dt=d.expiresAt?new Date(d.expiresAt).toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';
   n.innerHTML=`<b>${esc(sx('back',{a:String(d.account||'').toUpperCase()}))}</b> ${esc(d.plan&&dt?sx('ended',{p:d.plan,d:dt}):sx('endedNoPlan'))}`;col.before(n);}
 }
 if(sit==='wifi-active'){
  const hc=$('#hotspotCard');if(hc&&params.get('renew')!=='1')hc.classList.add('sit-collapsed');
  document.addEventListener('click',e=>{if(e.target.closest('#hx-all')){const c=$('#hotspotCard');if(c){c.classList.remove('sit-collapsed');setTimeout(()=>c.scrollIntoView({behavior:'smooth',block:'start'}),50);}}});
 }
}
function hotspotExtras(){hxBar();hxActive();hxUsageCard();sitInit();}

boot();
