// ไอคอนเส้น (viewBox 24) — ใช้ผ่าน icon('name')
const P = {
  home: 'M3 11l9-8 9 8M5 9.5V21h14V9.5',
  pen: 'M4 20l4-1L19 8l-3-3L5 16z M14 7l3 3',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
  select: 'M5 3l13 8-6 1.5L9 19z',
  text: 'M4 7V5h16v2M12 5v14M9 19h6',
  multiline: 'M4 6h16M4 10h16M4 14h16M4 18h10',
  checkbox: 'M4 4h16v16H4z M8 12l3 3 5-6',
  date: 'M4 5h16v15H4z M4 9.5h16 M8.5 3v4 M15.5 3v4',
  signature: 'M3 16c2.5-5 4.5-6 5.5-3s2 2.5 3.5-.5 2.5-1.5 3.5.5 2 1.5 5 0 M3 20.5h18',
  table: 'M4 4h16v16H4z M4 9.3h16 M4 14.6h16 M9.3 4v16 M14.6 4v16',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 000 11H13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  download: 'M12 3v12 M7 10l5 5 5-5 M5 21h14',
  upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  copy: 'M9 9h11v11H9z M5 15V4h11',
  lock: 'M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 017 0V11',
  unlock: 'M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 016.8-1.2',
  list: 'M9 6h11M9 12h11M9 18h11 M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  file: 'M14 3H6v18h12V7z M14 3v4h4',
  folder: 'M3 6h6l2 2h10v11H3z',
  save: 'M5 4h11l3 3v13H5z M8 4v5h7V4 M8 20v-6h8v6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z',
  wand: 'M4 20L15 9 M13 4v2.5 M18 9h2.5 M17.5 4.5l-1.5 1.5 M19.5 13h-1',
  data: 'M4 5h16v14H4z M4 10h16 M10 10v9',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  paste: 'M9 4h6v3H9z M7 5.5H5V21h14V5.5h-2',
  aL: 'M4 3v18 M8 7h12 M8 15h7',
  aR: 'M20 3v18 M4 7h12 M9 15h7',
  aT: 'M3 4h18 M7 8v12 M15 8v7',
  aB: 'M3 20h18 M7 4v12 M15 9v7',
  aCH: 'M12 3v18 M6 7h12 M8 15h8',
  aCV: 'M3 12h18 M7 6v12 M15 8v8',
  dH: 'M4 3v18 M20 3v18 M10 8h4v8h-4z',
  dV: 'M3 4h18 M3 20h18 M8 10h8v4H8z',
  sameW: 'M4 9h16 M4 15h16 M4 6v6 M20 6v6 M4 12v6 M20 12v6',
  sameH: 'M9 4v16 M15 4v16 M6 4h6 M6 20h6 M12 4h6 M12 20h6',
  check: 'M5 12.5l4.5 4.5L19 7',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M15.5 9.5h.01',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 7.5h.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v6 M12 7.5h.01',
  rotl: 'M4 4v5h5 M4.6 9A8 8 0 1 1 6 16.5',
  rotr: 'M20 4v5h-5 M19.4 9A8 8 0 1 0 18 16.5',
  scissors: 'M6 4a2.5 2.5 0 100 5 2.5 2.5 0 000-5z M6 15a2.5 2.5 0 100 5 2.5 2.5 0 000-5z M8.2 7.8L20 18 M8.2 16.2L20 6',
  zip: 'M6 3h9l4 4v14H6z M11 3v2 M11 7v2 M11 11v2 M10 15h2v3h-2z',
  page: 'M6 3h9l4 4v14H6z M15 3v4h4',
  left2: 'M14 6l-6 6 6 6',
  right2: 'M10 6l6 6-6 6',
};

export function icon(name, cls = '') {
  const d = P[name] || P.info;
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}

// แทนที่ทุก [data-icon] ด้วย svg (คงข้อความเดิมไว้)
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.querySelector(':scope > svg.i')) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}
