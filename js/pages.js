// จัดการหน้า PDF: รวมไฟล์ · สลับลำดับ · ลบ · หมุน · ทำซ้ำ · หน้าว่าง · แยกหน้า/แยกไฟล์
// ทำงานในเครื่องทั้งหมด (pdf.js แสดงภาพย่อ, pdf-lib สร้างไฟล์ใหม่) — ไม่แก้ไฟล์ต้นฉบับ
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { h, toast, busy, download } from './ui.js';
import { icon } from './icons.js';

const T = {
  sources: new Map(), // id → { name, bytes, pdf (pdf.js) }
  items: [],          // [{ id, src, idx, rot, w, h, blank }]
  sel: new Set(),
  anchor: null,       // สำหรับ Shift+คลิก
  undo: [], redo: [],
  dirty: false,       // มีการเปลี่ยนที่ยังไม่ได้บันทึกเป็นไฟล์
  zoom: (() => { try { return Math.min(620, Math.max(120, +localStorage.getItem('pfe-ptZoom') || 190)); } catch (e) { return 190; } })(), // ความสูงรูปย่อ (px)
  name: '',
  cards: new Map(),   // id → การ์ด (คงไว้ ไม่วาดใหม่ตอนสลับลำดับ)
  root: null, grid: null, observer: null, opts: null, ready: false,
};
let seq = 0;
const nid = (p = 'i') => p + (++seq);
const A4 = { w: 595.28, h: 841.89 };

export function initPageTool(root, opts) {
  if (T.ready) return;
  T.ready = true;
  T.root = root;
  T.opts = opts;
  root.innerHTML = '';
  root.appendChild(h(`<div class="pt">
    <div class="pt-head">
      <div><h1>จัดการหน้า PDF</h1><p class="muted">รวมหลายไฟล์ · ลากสลับลำดับ · ลบ · หมุน · แยกหน้า — ไฟล์ต้นฉบับไม่ถูกแก้ไข</p></div>
    </div>
    <div class="pt-bar">
      <label class="btn primary" title="เปิด/เพิ่มไฟล์ PDF (เลือกได้หลายไฟล์)">${icon('upload')}<span>เพิ่มไฟล์ PDF</span><input type="file" accept="application/pdf,.pdf" multiple hidden data-file></label>
      <button class="btn" data-a="blank" title="เพิ่มหน้าว่างต่อจากหน้าที่เลือก">${icon('page')}<span>หน้าว่าง</span></button>
      <span class="pt-sep"></span>
      <button class="icon-btn" data-a="rotl" title="หมุนซ้าย 90°">${icon('rotl')}</button>
      <button class="icon-btn" data-a="rotr" title="หมุนขวา 90°">${icon('rotr')}</button>
      <button class="icon-btn" data-a="dup" title="ทำซ้ำหน้าที่เลือก">${icon('copy')}</button>
      <button class="icon-btn" data-a="del" title="ลบหน้าที่เลือก (Delete)">${icon('trash')}</button>
      <button class="icon-btn" data-a="undo" title="ย้อนกลับ (Ctrl+Z)">${icon('undo')}</button>
      <button class="icon-btn" data-a="redo" title="ทำซ้ำ (Ctrl+Y)">${icon('redo')}</button>
      <span class="spacer"></span>
      <button class="btn" data-a="extract" title="สร้าง PDF ใหม่จากหน้าที่เลือก">${icon('scissors')}<span>แยกหน้าที่เลือก</span></button>
      <button class="btn" data-a="split" title="แยกทุกหน้าเป็นไฟล์ละหน้า (ZIP)">${icon('zip')}<span>แยกทุกหน้า (ZIP)</span></button>
      <button class="btn" data-a="toform" title="นำ PDF นี้ไปวางช่องกรอกต่อ">${icon('pen')}<span>เปิดในตัววางช่อง</span></button>
      <button class="btn primary" data-a="save">${icon('download')}<span>บันทึก PDF</span></button>
    </div>
    <div class="pt-info"><div class="grow"><span data-info></span><span class="muted" data-hint></span></div>
      <div class="pt-zoom" data-zoombox title="ขนาดรูปย่อ (Ctrl+ลูกกลิ้งเมาส์บนรายการ)">
        <button class="icon-btn" data-z="-">${icon('minus')}</button>
        <input type="range" min="120" max="620" step="10" data-zr>
        <button class="icon-btn" data-z="+">${icon('plus')}</button>
      </div></div>
    <label class="drop pt-empty" data-empty>
      <input type="file" accept="application/pdf,.pdf" multiple hidden data-file>
      <span class="drop-icon">${icon('upload')}</span>
      <strong>ลากไฟล์ PDF มาวาง (ได้หลายไฟล์)</strong>
      <span class="muted">หรือแตะเพื่อเลือกไฟล์ — ไฟล์ที่เพิ่มทีหลังจะต่อท้าย หรือต่อจากหน้าที่เลือก</span>
    </label>
    <div class="pt-grid" data-grid></div>
  </div>`));
  T.grid = root.querySelector('[data-grid]');
  T.observer = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) { renderThumb(en.target.dataset.id); T.observer.unobserve(en.target); }
  }, { root: null, rootMargin: '400px' });

  root.querySelectorAll('[data-file]').forEach((inp) => inp.addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; }));
  root.querySelector('.pt-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (b && !b.disabled) act(b.dataset.a);
  });
  // ลากไฟล์มาวางในเครื่องมือนี้ → เพิ่มหน้า (ไม่เปิดเป็นงานฟอร์ม)
  root.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); root.classList.add('over'); });
  root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('over'); });
  root.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    root.classList.remove('over');
    addFiles([...(e.dataTransfer?.files || [])]);
  });
  T.grid.addEventListener('pointerdown', onGridDown);
  T.grid.addEventListener('dblclick', (e) => { const c = e.target.closest('.pt-card'); if (c && !e.target.closest('[data-c]')) openPreview(c.dataset.id); });
  const zr = root.querySelector('[data-zr]');
  zr.addEventListener('input', () => setThumbZoom(+zr.value));
  root.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => setThumbZoom(T.zoom * (b.dataset.z === '+' ? 1.25 : 0.8))));
  T.grid.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setThumbZoom(T.zoom * Math.exp(-e.deltaY * 0.002));
  }, { passive: false });
  setThumbZoom(T.zoom, true);
  document.addEventListener('keydown', onKey);
  // ปิด/รีเฟรชแท็บขณะมีงานจัดหน้าที่ยังไม่บันทึก → เบราว์เซอร์ถามยืนยัน (งานนี้ไม่ได้เก็บในเครื่อง)
  window.addEventListener('beforeunload', (e) => { if (T.dirty && T.items.length) { e.preventDefault(); e.returnValue = ''; } });
  refresh();
}

const visible = () => T.root && !T.root.hidden && document.body.classList.contains('no-doc');

// ---------- ข้อมูล ----------
function snapshot() {
  T.dirty = true;
  T.undo.push(JSON.stringify(T.items));
  if (T.undo.length > 80) T.undo.shift();
  T.redo = [];
}
function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(T.items));
  T.items = JSON.parse(from.pop());
  for (const id of [...T.sel]) if (!T.items.some((x) => x.id === id)) T.sel.delete(id);
  refresh();
}

async function addFiles(files) {
  const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { if (files.length) toast('รองรับเฉพาะไฟล์ PDF', { type: 'err' }); return; }
  const b = busy('กำลังเปิดไฟล์…');
  const added = [];
  try {
    for (const file of pdfs) {
      b.set(`กำลังเปิด ${file.name}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let pdf;
      try { pdf = await pdfjsLib.getDocument({ data: bytes.slice(), ...T.opts.pdfOpts }).promise; }
      catch (e) { toast(`เปิด “${file.name}” ไม่ได้: ${e.message}`, { type: 'err', ms: 6000 }); continue; }
      const src = nid('s');
      T.sources.set(src, { name: file.name.replace(/\.pdf$/i, ''), bytes, pdf });
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        added.push({ id: nid(), src, idx: i - 1, rot: 0, w: vp.width, h: vp.height });
      }
      if (!T.name) T.name = file.name.replace(/\.pdf$/i, '');
    }
  } finally { b.close(); }
  if (!added.length) return;
  snapshot();
  const at = insertIndex();
  T.items.splice(at, 0, ...added);
  T.sel = new Set(added.map((x) => x.id));
  refresh();
  toast(`เพิ่ม ${added.length} หน้า${pdfs.length > 1 ? ` จาก ${pdfs.length} ไฟล์` : ''}`, { type: 'ok' });
}

// ตำแหน่งแทรก: ต่อจากหน้าที่เลือกตัวสุดท้าย ถ้าไม่ได้เลือกก็ต่อท้าย
function insertIndex() {
  let last = -1;
  T.items.forEach((x, i) => { if (T.sel.has(x.id)) last = i; });
  return last >= 0 ? last + 1 : T.items.length;
}
const selected = () => T.items.filter((x) => T.sel.has(x.id));

function act(a) {
  const sel = selected();
  const need = (msg) => { if (!sel.length) { toast(msg || 'เลือกหน้าก่อน (คลิกที่หน้า · Ctrl/Shift เพื่อเลือกหลายหน้า)'); return true; } return false; };
  switch (a) {
    case 'blank': {
      const ref = sel[sel.length - 1] || T.items[T.items.length - 1];
      const size = ref ? (((ref.rot % 180) === 0) ? { w: ref.w, h: ref.h } : { w: ref.h, h: ref.w }) : A4;
      snapshot();
      const it = { id: nid(), blank: true, rot: 0, w: size.w, h: size.h };
      T.items.splice(insertIndex(), 0, it);
      T.sel = new Set([it.id]);
      refresh();
      break;
    }
    case 'rotl': case 'rotr':
      if (need()) return;
      snapshot();
      for (const x of sel) x.rot = (x.rot + (a === 'rotr' ? 90 : 270)) % 360;
      refresh(sel.map((x) => x.id));
      break;
    case 'dup': {
      if (need()) return;
      snapshot();
      const copies = sel.map((x) => ({ ...x, id: nid() }));
      T.items.splice(insertIndex(), 0, ...copies);
      T.sel = new Set(copies.map((x) => x.id));
      refresh();
      break;
    }
    case 'del':
      if (need()) return;
      snapshot();
      T.items = T.items.filter((x) => !T.sel.has(x.id));
      T.sel.clear();
      refresh();
      toast(`ลบ ${sel.length} หน้า`, { action: 'ย้อนกลับ', onAction: () => restore(T.undo, T.redo) });
      break;
    case 'undo': restore(T.undo, T.redo); break;
    case 'redo': restore(T.redo, T.undo); break;
    case 'extract':
      if (need('เลือกหน้าที่ต้องการแยกออกมาก่อน')) return;
      saveAs(sel, `${T.name || 'เอกสาร'}_หน้า-${rangeLabel(sel)}.pdf`);
      break;
    case 'split': splitAll(); break;
    case 'save': saveAs(T.items, `${T.name || 'เอกสาร'}_จัดหน้า.pdf`); break;
    case 'toform': toForm(); break;
  }
}

function rangeLabel(sel) {
  const nums = sel.map((x) => T.items.indexOf(x) + 1).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
    i = j;
  }
  return out.join('_');
}

// ---------- สร้าง PDF ----------
async function build(items, b) {
  const P = window.PDFLib;
  const out = await P.PDFDocument.create();
  const libs = new Map();
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    b?.set(`กำลังสร้าง PDF… หน้า ${k + 1} / ${items.length}`);
    if (it.blank) {
      const pg = out.addPage([it.w, it.h]);
      if (it.rot) pg.setRotation(P.degrees(it.rot));
      continue;
    }
    let src = libs.get(it.src);
    if (!src) {
      src = await P.PDFDocument.load(T.sources.get(it.src).bytes, { ignoreEncryption: true });
      libs.set(it.src, src);
    }
    const [pg] = await out.copyPages(src, [it.idx]);
    pg.setRotation(P.degrees((pg.getRotation().angle + it.rot) % 360));
    out.addPage(pg);
  }
  return out.save();
}

async function saveAs(items, filename) {
  if (!items.length) { toast('ยังไม่มีหน้า — เพิ่มไฟล์ PDF ก่อน'); return; }
  const b = busy('กำลังสร้าง PDF…');
  try {
    const bytes = await build(items, b);
    download(bytes, safe(filename));
    if (items === T.items) T.dirty = false;
    toast(`บันทึกแล้ว: ${safe(filename)} (${items.length} หน้า)`, { type: 'ok' });
  } catch (e) {
    console.error(e);
    toast('สร้าง PDF ไม่สำเร็จ: ' + (e.message || e), { type: 'err', ms: 7000 });
  } finally { b.close(); }
}

async function splitAll() {
  if (!T.items.length) { toast('ยังไม่มีหน้า — เพิ่มไฟล์ PDF ก่อน'); return; }
  const b = busy('กำลังแยกหน้า…');
  try {
    const files = {};
    const base = safe(T.name || 'เอกสาร');
    const pad = String(T.items.length).length;
    for (let i = 0; i < T.items.length; i++) {
      b.set(`กำลังแยกหน้า ${i + 1} / ${T.items.length}…`);
      files[`${base}_หน้า${String(i + 1).padStart(pad, '0')}.pdf`] = await build([T.items[i]]);
    }
    b.set('กำลังรวมเป็น ZIP…');
    download(window.fflate.zipSync(files, { level: 0 }), `${base}_แยก${T.items.length}หน้า.zip`, 'application/zip');
    toast(`แยกเป็น ${T.items.length} ไฟล์แล้ว (ZIP)`, { type: 'ok' });
  } catch (e) {
    console.error(e);
    toast('แยกหน้าไม่สำเร็จ: ' + (e.message || e), { type: 'err', ms: 7000 });
  } finally { b.close(); }
}

async function toForm() {
  if (!T.items.length) { toast('ยังไม่มีหน้า — เพิ่มไฟล์ PDF ก่อน'); return; }
  const b = busy('กำลังเตรียมไฟล์…');
  let bytes;
  try { bytes = await build(T.items, b); } catch (e) { toast('สร้าง PDF ไม่สำเร็จ: ' + e.message, { type: 'err' }); return; } finally { b.close(); }
  await T.opts.openInForm(new Uint8Array(bytes), `${T.name || 'เอกสาร'}_จัดหน้า`);
  T.dirty = false; // ไฟล์ถูกเก็บเป็นงานฟอร์มในเครื่องแล้ว
}

const safe = (s) => String(s).replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim() || 'เอกสาร.pdf';

// ---------- แสดงผล ----------
function cardFor(it) {
  let c = T.cards.get(it.id);
  if (c) return c;
  c = h(`<div class="pt-card" data-id="${it.id}">
    <div class="pt-thumb"><div class="pt-paper"></div></div>
    <div class="pt-meta"><b class="pt-num"></b><span class="pt-src"></span></div>
    <div class="pt-acts">
      <button class="icon-btn" data-c="left" title="เลื่อนไปก่อนหน้า">${icon('left2')}</button>
      <button class="icon-btn" data-c="view" title="ดูหน้าเต็ม (ดับเบิลคลิก)">${icon('search')}</button>
      <button class="icon-btn" data-c="rotr" title="หมุนขวา">${icon('rotr')}</button>
      <button class="icon-btn" data-c="del" title="ลบหน้านี้">${icon('trash')}</button>
      <button class="icon-btn" data-c="right" title="เลื่อนไปถัดไป">${icon('right2')}</button>
    </div></div>`);
  T.cards.set(it.id, c);
  return c;
}

function paperStyle(it) {
  const r = it.rot % 180 === 0;
  const w = r ? it.w : it.h, hh = r ? it.h : it.w;
  return `aspect-ratio:${w}/${hh};${w > hh ? 'width:100%' : 'height:100%'}`;
}

// ความละเอียดรูปย่อตามขนาดที่แสดง (ปัดเป็นขั้น ไม่ให้วาดใหม่ทุกครั้งที่เลื่อนแถบ)
const thumbRes = () => Math.ceil(Math.max(200, T.zoom * 1.1) / 100) * 100;
const pageKey = (it) => `${it.src}|${it.idx}|${it.rot}|${it.blank ? 'b' : ''}`;
const thumbKey = (it) => `${pageKey(it)}|${thumbRes()}`;

async function renderThumb(id) {
  const it = T.items.find((x) => x.id === id);
  const c = T.cards.get(id);
  if (!it || !c) return;
  const paper = c.querySelector('.pt-paper');
  const key = thumbKey(it);
  if (paper.dataset.key === key) return;
  const samePage = (paper.dataset.key || '').startsWith(pageKey(it) + '|');
  paper.dataset.key = key;
  if (it.blank) { paper.innerHTML = ''; paper.classList.add('blank'); paper.textContent = 'หน้าว่าง'; return; }
  paper.classList.remove('blank');
  if (!samePage) paper.innerHTML = ''; // หน้าเดิมแค่ขยาย → คงภาพเก่าไว้จนภาพใหม่พร้อม (ไม่กะพริบ)
  try {
    const pg = await T.sources.get(it.src).pdf.getPage(it.idx + 1);
    const base = pg.getViewport({ scale: 1, rotation: (pg.rotate + it.rot) % 360 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (thumbRes() / Math.max(base.width, base.height)) * dpr;
    const vp = pg.getViewport({ scale, rotation: (pg.rotate + it.rot) % 360 });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    if (paper.dataset.key === key) { paper.innerHTML = ''; paper.appendChild(cv); }
  } catch (e) { console.warn('thumb', e); }
}

function refresh(rerender = []) {
  if (!T.root) return;
  const empty = !T.items.length;
  T.root.querySelector('[data-empty]').hidden = !empty;
  T.root.querySelectorAll('.pt-bar [data-a]').forEach((b) => {
    const a = b.dataset.a;
    b.disabled = (empty && a !== 'blank') || (a === 'undo' && !T.undo.length) || (a === 'redo' && !T.redo.length);
  });
  const nSel = T.sel.size;
  T.root.querySelector('[data-info]').textContent = empty ? '' : `${T.items.length} หน้า${nSel ? ` · เลือก ${nSel}` : ''}`;
  T.root.querySelector('[data-hint]').textContent = empty ? '' : ' · ลากการ์ดเพื่อสลับลำดับ · Ctrl/Shift+คลิก เลือกหลายหน้า · Delete ลบ';
  // จัดลำดับการ์ดตาม items (ย้าย DOM เดิม ไม่วาดภาพใหม่)
  const ids = new Set(T.items.map((x) => x.id));
  for (const [id, c] of T.cards) if (!ids.has(id)) { c.remove(); T.cards.delete(id); }
  T.items.forEach((it, i) => {
    const c = cardFor(it);
    c.classList.toggle('sel', T.sel.has(it.id));
    c.querySelector('.pt-num').textContent = i + 1;
    const src = it.blank ? 'หน้าว่าง' : `${T.sources.get(it.src).name} · น.${it.idx + 1}`;
    c.querySelector('.pt-src').textContent = src + (it.rot ? ` · ${it.rot}°` : '');
    c.querySelector('.pt-src').title = src;
    c.querySelector('.pt-paper').setAttribute('style', paperStyle(it));
    if (T.grid.children[i] !== c) T.grid.insertBefore(c, T.grid.children[i] || null);
    const pk = c.querySelector('.pt-paper').dataset.key;
    if (!pk) T.observer.observe(c);
    else if (rerender.includes(it.id) || !pk.startsWith(pageKey(it) + '|')) renderThumb(it.id);
    else if (pk !== thumbKey(it)) T.observer.observe(c); // แค่ความละเอียดเปลี่ยน → วาดใหม่เมื่อเห็นบนจอ
  });
}

let zoomTimer = null;
function setThumbZoom(z, init) {
  T.zoom = Math.round(Math.min(620, Math.max(120, z)));
  T.grid.style.setProperty('--ptz', T.zoom);
  const zr = T.root.querySelector('[data-zr]');
  if (zr && +zr.value !== T.zoom) zr.value = T.zoom;
  try { localStorage.setItem('pfe-ptZoom', String(T.zoom)); } catch (e) { /* ignore */ }
  if (init) return;
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => refresh(), 150);
}

// ---------- เลือก / ลากสลับลำดับ ----------
function select(id, e) {
  const ids = T.items.map((x) => x.id);
  if (e.shiftKey && T.anchor && ids.includes(T.anchor)) {
    const [a, b] = [ids.indexOf(T.anchor), ids.indexOf(id)].sort((x, y) => x - y);
    if (!(e.ctrlKey || e.metaKey)) T.sel.clear();
    ids.slice(a, b + 1).forEach((x) => T.sel.add(x));
  } else if (e.ctrlKey || e.metaKey) {
    T.sel.has(id) ? T.sel.delete(id) : T.sel.add(id);
    T.anchor = id;
  } else {
    T.sel = new Set([id]);
    T.anchor = id;
  }
  refresh();
}

function move(ids, toIndex) {
  const moving = T.items.filter((x) => ids.includes(x.id));
  const rest = T.items.filter((x) => !ids.includes(x.id));
  // ตำแหน่งเป้าหมายคิดใน "รายการที่เหลือ"
  let at = 0;
  for (let i = 0; i < toIndex && i < T.items.length; i++) if (!ids.includes(T.items[i].id)) at++;
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (next.every((x, i) => x === T.items[i])) return;
  snapshot();
  T.items = next;
  refresh();
}

function onGridDown(e) {
  const card = e.target.closest('.pt-card');
  if (!card) {
    if (e.target === T.grid && T.sel.size) { T.sel.clear(); refresh(); }
    return;
  }
  const id = card.dataset.id;
  const btn = e.target.closest('[data-c]');
  if (btn) {
    e.preventDefault();
    const i = T.items.findIndex((x) => x.id === id);
    const c = btn.dataset.c;
    if (c === 'view') { openPreview(id); return; }
    if (c === 'del') { snapshot(); T.items.splice(i, 1); T.sel.delete(id); refresh(); }
    if (c === 'rotr') { snapshot(); T.items[i].rot = (T.items[i].rot + 90) % 360; refresh([id]); }
    if (c === 'left' && i > 0) move([id], i - 1);
    if (c === 'right' && i < T.items.length - 1) move([id], i + 2);
    return;
  }
  if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') { select(id, e); return; } // นิ้ว: แตะเพื่อเลือก ใช้ปุ่ม ◀ ▶ เลื่อน
  if (e.button !== 0) return;
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY };
  let dragging = false, ghost = null, target = null;
  const ids = T.sel.has(id) ? T.items.filter((x) => T.sel.has(x.id)).map((x) => x.id) : [id];
  const clearMarks = () => T.grid.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  const onMove = (ev) => {
    if (!dragging) {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      dragging = true;
      if (!T.sel.has(id)) { T.sel = new Set([id]); refresh(); }
      ghost = h(`<div class="pt-ghost">${ids.length > 1 ? `${ids.length} หน้า` : `หน้า ${T.items.findIndex((x) => x.id === id) + 1}`}</div>`);
      document.body.appendChild(ghost);
      document.body.classList.add('pt-dragging');
    }
    ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px';
    clearMarks();
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.pt-card');
    if (!over) { target = null; return; }
    const r = over.getBoundingClientRect();
    const after = ev.clientX > r.left + r.width / 2;
    over.classList.add(after ? 'drop-after' : 'drop-before');
    const oi = T.items.findIndex((x) => x.id === over.dataset.id);
    target = after ? oi + 1 : oi;
    // เลื่อนหน้าจออัตโนมัติเมื่อลากใกล้ขอบ
    const sc = T.root.closest('.home-main');
    if (sc) { if (ev.clientY < 90) sc.scrollTop -= 14; else if (ev.clientY > innerHeight - 60) sc.scrollTop += 14; }
  };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!dragging) { select(id, ev); return; }
    ghost?.remove(); clearMarks();
    document.body.classList.remove('pt-dragging');
    if (target !== null) move(ids, target);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function onKey(e) {
  if (!visible() || !T.items.length || document.querySelector('.backdrop, .pv-back')) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (k === 'delete' || k === 'backspace') { if (T.sel.size) { e.preventDefault(); act('del'); } }
  else if (mod && k === 'a') { e.preventDefault(); T.sel = new Set(T.items.map((x) => x.id)); refresh(); }
  else if (mod && k === 'z') { e.preventDefault(); act(e.shiftKey ? 'redo' : 'undo'); }
  else if (mod && k === 'y') { e.preventDefault(); act('redo'); }
  else if (k === 'escape' && T.sel.size) { T.sel.clear(); refresh(); }
}

// ---------- ดูหน้าเต็ม (ซูม / ก่อน-ถัดไป) ----------
function openPreview(id) {
  let i = T.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  let z = 1; // 1 = พอดีหน้าจอ
  let task = null;
  const bd = h(`<div class="pv-back" role="dialog" aria-modal="true">
    <div class="pv-bar">
      <button class="icon-btn" data-p="prev" title="หน้าก่อน (←)">${icon('left2')}</button>
      <span class="pv-pos" data-pos></span>
      <button class="icon-btn" data-p="next" title="หน้าถัดไป (→)">${icon('right2')}</button>
      <span class="spacer"></span>
      <button class="icon-btn" data-p="out" title="ย่อ (−)">${icon('minus')}</button>
      <button class="pv-zl" data-p="fit" title="พอดีหน้าจอ (0)">100%</button>
      <button class="icon-btn" data-p="in" title="ขยาย (+)">${icon('plus')}</button>
      <button class="icon-btn" data-p="close" title="ปิด (Esc)">${icon('close')}</button>
    </div>
    <div class="pv-stage" data-stage><div class="pv-page" data-page></div></div>
  </div>`);
  document.body.appendChild(bd);
  const stage = bd.querySelector('[data-stage]'), pageEl = bd.querySelector('[data-page]');
  const render = async () => {
    const it = T.items[i];
    bd.querySelector('[data-pos]').textContent = `หน้า ${i + 1} / ${T.items.length}`;
    bd.querySelector('[data-p=fit]').textContent = Math.round(z * 100) + '%';
    const rot = it.rot % 180 === 0;
    const w = rot ? it.w : it.h, hh = rot ? it.h : it.w;
    const fit = Math.min((stage.clientWidth - 32) / w, (stage.clientHeight - 32) / hh);
    const scale = fit * z;
    pageEl.style.width = w * scale + 'px';
    pageEl.style.height = hh * scale + 'px';
    if (it.blank) { pageEl.innerHTML = '<div class="pv-blank">หน้าว่าง</div>'; return; }
    task?.cancel();
    try {
      const pg = await T.sources.get(it.src).pdf.getPage(it.idx + 1);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = pg.getViewport({ scale: scale * dpr, rotation: (pg.rotate + it.rot) % 360 });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      task = pg.render({ canvasContext: ctx, viewport: vp, intent: 'print' });
      await task.promise;
      pageEl.innerHTML = '';
      pageEl.appendChild(cv);
    } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn(e); }
  };
  const zoomTo = (nz, ax, ay) => {
    const old = z;
    z = Math.min(8, Math.max(0.25, nz));
    // ซูมรอบจุดที่ชี้ (หรือกึ่งกลาง)
    const r = stage.getBoundingClientRect();
    const px = (ax ?? r.width / 2) + stage.scrollLeft, py = (ay ?? r.height / 2) + stage.scrollTop;
    render().then(() => {
      stage.scrollLeft = px * (z / old) - (ax ?? r.width / 2);
      stage.scrollTop = py * (z / old) - (ay ?? r.height / 2);
    });
  };
  const go = (d) => { const n = i + d; if (n < 0 || n >= T.items.length) return; i = n; z = 1; stage.scrollTo(0, 0); render(); };
  const close = () => { task?.cancel(); bd.remove(); document.removeEventListener('keydown', onKey2, true); window.removeEventListener('resize', onResize); };
  const onKey2 = (e) => {
    const k = e.key;
    if (k === 'Escape') close();
    else if (k === 'ArrowLeft' || k === 'PageUp') go(-1);
    else if (k === 'ArrowRight' || k === 'PageDown') go(1);
    else if (k === '+' || k === '=') zoomTo(z * 1.25);
    else if (k === '-') zoomTo(z / 1.25);
    else if (k === '0') { z = 1; render(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const onResize = () => render();
  bd.querySelector('.pv-bar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    ({ prev: () => go(-1), next: () => go(1), in: () => zoomTo(z * 1.25), out: () => zoomTo(z / 1.25), fit: () => { z = 1; render(); }, close })[b.dataset.p]();
  });
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomTo(z * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener('dblclick', (e) => { const r = stage.getBoundingClientRect(); zoomTo(z > 1.01 ? 1 : 2, e.clientX - r.left, e.clientY - r.top); });
  bd.addEventListener('click', (e) => { if (e.target === stage) close(); });
  document.addEventListener('keydown', onKey2, true);
  window.addEventListener('resize', onResize);
  render();
}

// ใช้จากภายนอก: ลากไฟล์มาวางที่ส่วนอื่นของหน้าขณะเปิดเครื่องมือนี้
export const addPageFiles = (files) => addFiles(files);
