'use strict';
const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  router:'M4 10h16v9H4z M8 14h.01 M12 14h.01 M16 14h.01 M7 6l2-3 M17 6l-2-3 M7 19v2 M17 19v2',
  server:'M4 3h16v7H4z M4 14h16v7H4z M8 6h.01 M8 17h.01 M12 6h5 M12 17h5',
  onu:'M5 10h14v9H5z M8 14h.01 M12 14h.01 M16 14h.01 M12 10V5 M8 6a6 6 0 0 1 8 0 M10 3a9 9 0 0 1 4 0',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  search:'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  menu:'M4 5h16 M4 12h16 M4 19h16',
  sun:'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10',
  moon:'M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13',
  plus:'M12 5v14 M5 12h14',
  refresh:'M20 10a8 8 0 0 0-14-5L3 8 M3 3v5h5 M4 14a8 8 0 0 0 14 5l3-3 M21 21v-5h-5',
  arrow:'M5 12h14 M14 7l5 5-5 5',
  check:'M5 12l4 4L19 6',
  warning:'M12 3l10 18H2z M12 9v4 M12 17h.01',
  download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  activity:'M2 12h5l3-8 4 16 3-8h5',
  info:'M12 8h.01 M12 11v6 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  clock:'M12 6v6l4 2 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  chevron:'M9 5l7 7-7 7'
};
const icon = (name,size=17) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.router}"/></svg>`;

