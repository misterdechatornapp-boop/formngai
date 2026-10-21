import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { Store } from './store.js';
import { icon, hydrateIcons } from './icons.js';
import { h, esc, toast, dialog, confirmBox, promptBox, popMenu, busy, download } from './ui.js';
import { loadFont, layoutText } from './textlayout.js';
import { FONTS, hasBold, cssFamily, weightOf, onFontLoaded, loadFont as loadFontFace } from './fonts.js';
import { DEFAULT_PRESETS, STYLE_KEYS, isSet, resolveField, allGroups, groupOf, presetOf, newPresetId } from './styles.js';
import { analyzePage, smartRect, findBoxAt, findBoxIn, findCell, innerRect, boxRect, gridIn, snapCandidates, snapMove, snapValue, defaultSize } from './detect.js';
import { DATE_FORMATS, DATE_FORMATS_BY_LANG, DEFAULT_DATE_FORMAT, formatDate, parseDateLoose, todayISO, isISO, fmtStamp } from './thai.js';
import { parseDelimited, autoMap, truthy, fetchGoogleSheet } from './merge.js';
import { buildPdf, concatPdfs, displayText } from './exporter.js';
import { openSignatureDialog } from './sigpad.js';
import { findCandidates, nameCandidates, pageText, AUTO_COLORS, BRUSHES, BRUSH_CODE } from './auto.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
const PDFJS_OPTS = {
  cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href,
  isEvalSupported: false,
};

const TYPES = {
  text: { label: 'ข้อความ', icon: 'text', prefix: 'ข้อความ' },
  multiline: { label: 'หลายบรรทัด', icon: 'multiline', prefix: 'ข้อความยาว' },
  checkbox: { label: 'ติ๊กถูก', icon: 'checkbox', prefix: 'ติ๊ก' },
  date: { label: 'วันที่', icon: 'date', prefix: 'วันที่' },
  signature: { label: 'ลายเซ็น/รูป', icon: 'signature', prefix: 'ลายเซ็น' },
};
const TOOLS = [
  { id: 'select', label: 'เลือก/ย้าย', icon: 'select', key: 'v' },
  { id: 'text', label: 'ข้อความ', icon: 'text', key: 't' },
  { id: 'multiline', label: 'หลายบรรทัด', icon: 'multiline', key: 'm' },
  { id: 'checkbox', label: 'ติ๊กถูก', icon: 'checkbox', key: 'c' },
  { id: 'date', label: 'วันที่', icon: 'date', key: 'd' },
  { id: 'signature', label: 'ลายเซ็น', icon: 'signature', key: 's' },
  '-',
  { id: 'table', label: 'ตาราง', icon: 'table', key: 'g' },
  { id: 'auto', label: 'อัตโนมัติ', icon: 'wand', key: 'a' },
];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => `<i class="h" data-h="${d}"></i>`).join('');

const S = {
  doc: null, pdf: null, bytes: null, pages: [], zoom: 1, mode: 'design', tool: 'select',
  sel: new Set(), undo: [], redo: [], clip: null, snap: true, showLines: false,
  designTab: 'props', fillTab: 'fields', editor: null, lastDateFormat: 'd mmmm bbbb',
  brush: 'auto', brushSize: 14, auto: null, autoScope: 'page', autoNames: true,
  autoKinds: { checkbox: true, line: true, cell: true },
  presets: JSON.parse(JSON.stringify(DEFAULT_PRESETS)),
  edgeGap: (() => { try { const v = parseFloat(localStorage.getItem('pfe-edgeGap')); return Number.isFinite(v) ? v : 0; } catch (e) { return 0; } })(),
};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (v) => Math.round(v * 10) / 10;
const uid = () => Math.random().toString(36).slice(2, 10);
const isSmall = () => matchMedia('(max-width: 860px)').matches;
const fontReady = loadFont().catch((e) => { console.error(e); toast('โหลดฟอนต์ไม่สำเร็จ', { type: 'err' }); });

// ======================================================================
// หน้าแรก
// ======================================================================
async function renderRecent() {
  const box = $('#recent');
  let docs = [];
  try { docs = await Store.listDocs(); } catch (e) { console.warn(e); }
  if (!docs.length) { box.innerHTML = ''; return; }
  box.innerHTML = '<h2>งานล่าสุด</h2><div class="cards"></div>';
  const cards = box.querySelector('.cards');
  for (const d of docs) {
    const c = h(`<div class="card" role="button" tabindex="0">
      <div class="th">${d.thumb ? `<img src="${d.thumb}" alt="">` : icon('file')}</div>
      <div class="meta"><b>${esc(d.name)}</b><span>${d.fields?.length || 0} ช่อง · ${d.pageCount || '?'} หน้า</span><span>${d.updatedAt ? fmtStamp(d.updatedAt) : ''}</span></div>
      <button class="icon-btn del" title="ลบงานนี้ออกจากเครื่อง">${icon('trash')}</button></div>`);
    c.onclick = async (e) => {
      if (e.target.closest('.del')) {
        e.stopPropagation();
        if (await confirmBox('ลบงานนี้?', `“${d.name}” และช่องที่วางไว้จะถูกลบออกจากเครื่องนี้`, 'ลบ', true)) {
          await Store.deleteDoc(d.id); renderRecent();
        }
        return;
      }
      openFromStore(d.id);
    };
    c.onkeydown = (e) => { if (e.key === 'Enter') c.click(); };
    cards.appendChild(c);
  }
}

async function showHome() {
  await flushSave();
  closeDoc();
  document.body.classList.add('no-doc');
  renderRecent();
}

// ======================================================================
// เปิดเอกสาร
// ======================================================================
async function openFile(file) {
  if (!file) return;
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('รองรับเฉพาะไฟล์ PDF', { type: 'err' }); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await openBytes(bytes, file.name.replace(/\.pdf$/i, ''), false);
}

async function openFromStore(id) {
  const bytes = await Store.getFile(id);
  if (!bytes) { toast('ไม่พบไฟล์ต้นฉบับในเครื่อง', { type: 'err' }); return; }
  const doc = await Store.getDoc(id);
  await openBytes(new Uint8Array(bytes), doc?.name || 'เอกสาร', true);
}

async function openBytes(bytes, name, fromStore) {
  const b = busy('กำลังเปิดไฟล์…');
  try {
    await fontReady;
    await flushSave();
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
    const id = pdf.fingerprints?.[0] || 'doc-' + Date.now();
    let doc = await Store.getDoc(id);
    const isNew = !doc;
    if (!doc) doc = { id, name, fields: [], values: {}, createdAt: Date.now() };
    doc.fields ||= []; doc.values ||= {};
    closeDoc();
    S.pdf = pdf; S.bytes = bytes; S.doc = doc;
    await buildPages();
    doc.pageCount = pdf.numPages;
    doc.pages = S.pages.map((p) => ({ w: r1(p.w), h: r1(p.h) }));
    if (isNew) {
      await Store.putFile(id, bytes);
      doc.thumb = await makeThumb();
      doc.updatedAt = Date.now();
      await Store.putDoc(doc);
    }
    $('#docName').value = doc.name;
    document.body.classList.remove('no-doc');
    setMode(doc.fields.length && !isNew ? S.mode : 'design', true);
    setTool('select');
    fitWidth();
    renderAll();
    updateUndoBtns();
    setSaveState(isNew ? 'บันทึกในเครื่องแล้ว' : 'บันทึกแล้ว');
    if (!isNew && !fromStore) toast('เปิดงานเดิมของไฟล์นี้ — ช่องที่วางไว้ยังอยู่ครบ', { type: 'ok' });
    if (!doc.fields.length) setTimeout(() => suggestFieldSources(), 400);
  } catch (e) {
    console.error(e);
    toast('เปิดไฟล์ไม่ได้: ' + (e.message || e), { type: 'err', ms: 6000 });
  } finally { b.close(); }
}

function closeDoc() {
  closeEditor();
  S.observer?.disconnect();
  for (const p of S.pages) p.task?.cancel();
  S.pdf?.destroy();
  S.pdf = null; S.doc = null; S.bytes = null; S.pages = [];
  S.sel.clear(); S.undo = []; S.redo = [];
  $('#pages').innerHTML = '';
  document.body.classList.remove('sheet-open');
}

async function makeThumb() {
  const page = S.pages[0].page;
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 260 / vp1.width });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  return cv.toDataURL('image/jpeg', 0.72);
}

// ======================================================================
// หน้าเอกสาร: สร้าง เรนเดอร์ ซูม ตรวจเส้น
// ======================================================================
async function buildPages() {
  const wrap = $('#pages');
  wrap.innerHTML = '';
  const n = S.pdf.numPages;
  S.observer = new IntersectionObserver((ents) => {
    for (const en of ents) {
      const p = S.pages[+en.target.dataset.page - 1];
      if (!p) continue;
      p.visible = en.isIntersecting;
      if (p.visible) { renderPage(p); ensureLines(p); }
    }
  }, { root: $('#viewer'), rootMargin: '900px 0px' });
  for (let i = 1; i <= n; i++) {
    const page = await S.pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const el = h(`<div class="page" data-page="${i}"><div class="lines-layer"></div><div class="overlay"></div><div class="page-num">หน้า ${i} / ${n}</div></div>`);
    el.style.setProperty('--pw', vp.width);
    el.style.setProperty('--ph', vp.height);
    const p = {
      num: i, page, w: vp.width, h: vp.height, transform: vp.transform, el,
      overlay: el.querySelector('.overlay'), linesEl: el.querySelector('.lines-layer'),
      canvas: null, scale: 0, pending: 0, task: null, lines: null, analyzing: null, visible: false,
    };
    S.pages.push(p);
    wrap.appendChild(el);
    bindOverlay(p);
    S.observer.observe(el);
  }
}

async function renderPage(p) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let scale = S.zoom * dpr;
  const maxPx = 14e6;
  if (p.w * p.h * scale * scale > maxPx) scale = Math.sqrt(maxPx / (p.w * p.h));
  if (Math.abs(p.scale - scale) < 0.01 || p.pending === scale) return;
  p.pending = scale;
  p.task?.cancel();
  const vp = p.page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
  const task = p.page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
  p.task = task;
  try { await task.promise; } catch (e) { if (p.pending === scale) p.pending = 0; return; }
  if (p.task !== task) return;
  p.task = null; p.pending = 0; p.scale = scale;
  if (p.canvas) p.canvas.replaceWith(cv); else p.el.prepend(cv);
  p.canvas = cv;
}

let analysisChain = Promise.resolve();
function ensureLines(p) {
  if (p.lines || p.analyzing) return p.analyzing;
  p.analyzing = analysisChain = analysisChain.then(async () => {
    try { p.lines = await analyzePage(p.page); } catch (e) { console.warn('analyze', e); p.lines = { hLines: [], vLines: [] }; }
    if (S.showLines) drawLines(p);
  });
  return p.analyzing;
}

function drawLines(p) {
  p.linesEl.innerHTML = '';
  if (!S.showLines || !p.lines) return;
  const z = 'var(--z)';
  let html = '';
  for (const l of p.lines.hLines) html += `<i style="left:calc(${l.x1}px*${z});top:calc(${l.y}px*${z} - 1px);width:calc(${l.x2 - l.x1}px*${z});height:2px;${l.dotted ? 'opacity:.6' : ''}"></i>`;
  for (const l of p.lines.vLines) html += `<i style="left:calc(${l.x}px*${z} - 1px);top:calc(${l.y1}px*${z});height:calc(${l.y2 - l.y1}px*${z});width:2px"></i>`;
  for (const b of p.lines.boxes || []) html += `<i style="left:calc(${b.x1}px*${z});top:calc(${b.y1}px*${z});width:calc(${b.x2 - b.x1}px*${z});height:calc(${b.y2 - b.y1}px*${z});background:rgba(24,135,90,.25);outline:1.5px solid rgba(24,135,90,.9)"></i>`;
  p.linesEl.innerHTML = html;
}

let zoomTimer = null;
function setZoom(z, anchor) {
  z = clamp(z, 0.3, 5);
  const v = $('#viewer');
  const a = anchor || { x: v.clientWidth / 2, y: v.clientHeight / 2 };
  const k = z / S.zoom;
  const cx = v.scrollLeft + a.x, cy = v.scrollTop + a.y;
  S.zoom = z;
  $('#pages').style.setProperty('--z', z);
  v.scrollLeft = cx * k - a.x;
  v.scrollTop = cy * k - a.y;
  $('#zoomLabel').textContent = Math.round(z * 100) + '%';
  if (S.editor) positionEditor();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => S.pages.forEach((p) => p.visible && renderPage(p)), 160);
}

function fitWidth() {
  const v = $('#viewer');
  const maxW = Math.max(...S.pages.map((p) => p.w));
  const pad = isSmall() ? 20 : 48;
  setZoom(clamp((v.clientWidth - pad) / maxW, 0.3, 2.2));
  v.scrollTop = 0;
}

// ======================================================================
// ช่อง (fields) — วาดบนหน้า
// ======================================================================
const byId = (id) => S.doc.fields.find((f) => f.id === id);
const fieldsOn = (n) => S.doc.fields.filter((f) => f.page === n);
const elOf = (f) => S.pages[f.page - 1]?.overlay.querySelector(`.fld[data-id="${f.id}"]`);
const valOf = (f) => S.doc.values[f.name] ?? '';
const isEmptyVal = (f, v) => (f.type === 'checkbox' ? !truthy(v) : !String(v ?? '').trim());

// ช่องที่รวมสไตล์จากพรีเซทของกลุ่มแล้ว
const styled = (f) => resolveField(f, S.doc, S.presets);
const fontCss = (rf) => `font-family:'${cssFamily(rf.font)}','Sarabun',sans-serif;font-weight:${weightOf(rf.font, rf.bold)}`;

function fieldInner(f0, v) {
  const f = styled(f0);
  const col = f.color || '#000';
  const vb = `viewBox="0 0 ${f.w} ${f.h}" preserveAspectRatio="none"`;
  if (f.type === 'checkbox') {
    if (!truthy(v)) return '';
    const s = Math.min(f.w, f.h), x = (f.w - s) / 2, y = (f.h - s) / 2;
    const sw = Math.max(0.6, s * 0.12);
    let d;
    if (f.checkStyle === 'cross') d = `M${x + s * .22} ${y + s * .22}L${x + s * .78} ${y + s * .78}M${x + s * .78} ${y + s * .22}L${x + s * .22} ${y + s * .78}`;
    else if (f.checkStyle === 'dot') return `<svg class="ft" ${vb}><circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s * .25}" fill="${col}"/></svg>`;
    else d = `M${x + s * .2} ${y + s * .55}L${x + s * .42} ${y + s * .78}L${x + s * .82} ${y + s * .24}`;
    return `<svg class="ft" ${vb}><path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  if (f.type === 'signature') {
    if (v && /^data:image\//.test(v)) {
      const pos = f.align === 'left' ? 'left' : f.align === 'right' ? 'right' : 'center';
      return `<img src="${v}" alt="" style="object-position:${pos} center">`;
    }
    if (S.mode === 'fill') {
      const sz = Math.min(11, f.h * 0.4);
      return `<svg class="ft" ${vb}><text class="ph" x="${f.w / 2}" y="${f.h / 2 + sz * 0.35}" font-size="${sz}" text-anchor="middle">แตะเพื่อเซ็น</text></svg>`;
    }
    return '';
  }
  const t = displayText(f, v);
  if (!t) return '';
  const lay = layoutText(f, t);
  let s = `<svg class="ft" ${vb}>`;
  const fc = fontCss(f);
  for (const ln of lay.lines) s += `<text x="${ln.x}" y="${ln.y}" font-size="${lay.size}" fill="${col}" style="${fc}">${esc(ln.text)}</text>`;
  return s + '</svg>';
}

function setPos(d, f) { d.style.cssText = `--x:${f.x};--y:${f.y};--w:${f.w};--h:${f.h}`; }

function updateFieldEl(f, d = elOf(f)) {
  if (!d) return;
  const v = valOf(f);
  const sel = S.sel.has(f.id);
  d.className = `fld t-${f.type}${sel ? ' sel' : ''}${f.locked ? ' locked' : ''}${isEmptyVal(f, v) ? ' empty' : ''}${f.required ? ' req' : ''}${S.editor?.f.id === f.id ? ' editing' : ''}`;
  setPos(d, f);
  let html = fieldInner(f, v);
  if (S.mode === 'design') {
    html += `<span class="fld-name">${esc(f.name)}${f.locked ? ' 🔒' : ''}</span>`;
    if (sel && S.sel.size === 1 && !f.locked) html += HANDLES;
  }
  d.innerHTML = html;
}

function renderFields(p) {
  p.overlay.querySelectorAll('.fld').forEach((e) => e.remove());
  const frag = document.createDocumentFragment();
  for (const f of fieldsOn(p.num)) {
    const d = document.createElement('div');
    d.dataset.id = f.id;
    updateFieldEl(f, d);
    frag.appendChild(d);
  }
  p.overlay.appendChild(frag);
}
const renderAllFields = () => S.pages.forEach(renderFields);

function renderAll() {
  renderAllFields();
  renderPanel();
  renderToolbar();
}

// ======================================================================
// ประวัติ (ย้อนกลับ/ทำซ้ำ) + บันทึกอัตโนมัติ
// ======================================================================
function pushHistory() {
  S.undo.push(JSON.stringify(S.doc.fields));
  if (S.undo.length > 120) S.undo.shift();
  S.redo = [];
  updateUndoBtns();
}
function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(S.doc.fields));
  S.doc.fields = JSON.parse(from.pop());
  for (const id of [...S.sel]) if (!byId(id)) S.sel.delete(id);
  changed(false);
  updateUndoBtns();
}
const undo = () => restore(S.undo, S.redo);
const redo = () => restore(S.redo, S.undo);
function updateUndoBtns() {
  $('#btnUndo').disabled = !S.undo.length;
  $('#btnRedo').disabled = !S.redo.length;
}

function changed(fullPanel = true) {
  renderAllFields();
  if (fullPanel) renderPanel(); else renderPanel();
  scheduleSave();
}

let saveTimer = null;
function setSaveState(t) { $('#saveState').textContent = t; }
function scheduleSave() {
  setSaveState('กำลังบันทึก…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
async function saveNow() {
  saveTimer = null;
  if (!S.doc) return;
  S.doc.updatedAt = Date.now();
  try { await Store.putDoc(S.doc); setSaveState('บันทึกแล้ว'); } catch (e) { console.error(e); setSaveState('บันทึกไม่สำเร็จ'); }
}
async function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); await saveNow(); }
}

// ======================================================================
// โหมด + เครื่องมือ
// ======================================================================
function setMode(m, silent) {
  closeEditor();
  S.mode = m;
  document.body.classList.toggle('mode-design', m === 'design');
  document.body.classList.toggle('mode-fill', m === 'fill');
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  if (m === 'fill') S.sel.clear();
  if (!silent) renderAll();
  updateFab();
}

function setTool(t) {
  if (S.tool === 'auto' && t !== 'auto' && S.auto) clearAutoPreview();
  const changedTool = S.tool !== t;
  S.tool = t;
  document.body.classList.toggle('brush-pan', S.brush === 'pan');
  for (const c of [...document.body.classList]) if (c.startsWith('tool-')) document.body.classList.remove(c);
  document.body.classList.add('tool-' + t);
  $$('#toolbar .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  if (changedTool && S.doc && (t === 'auto' || S.panelWasAuto)) {
    S.panelWasAuto = t === 'auto';
    renderPanel();
    if (t === 'auto' && isSmall()) document.body.classList.add('sheet-open');
  }
}

function renderToolbar() {
  const tb = $('#toolbar');
  if (tb.childElementCount) return;
  for (const t of TOOLS) {
    if (t === '-') { tb.appendChild(h('<div class="tool-sep"></div>')); continue; }
    const b = h(`<button class="tool" data-tool="${t.id}" title="${t.label} (${t.key.toUpperCase()})">${icon(t.icon)}<span>${t.label}</span></button>`);
    b.onclick = () => setTool(t.id);
    tb.appendChild(b);
  }
  setTool(S.tool);
}

function updateFab() {
  const f = $('#fabPanel span');
  if (!f) return;
  f.textContent = S.mode === 'fill' ? 'กรอกแบบรายการ' : S.sel.size ? 'คุณสมบัติ' : 'รายการช่อง';
}

// ======================================================================
// การโต้ตอบบนหน้า (ออกแบบ)
// ======================================================================
function toPt(e, p) {
  const r = p.overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
}

function track(e, { move, up }) {
  const id = e.pointerId;
  const onMove = (ev) => { if (ev.pointerId === id) move?.(ev); };
  const onUp = (ev) => { if (ev.pointerId === id) { stop(); up?.(ev, false); } };
  const onCancel = (ev) => { if (ev.pointerId === id) { stop(); up?.(ev, true); } };
  function stop() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

function showGuides(p, gx, gy) {
  let v = p.overlay.querySelector('.guide.v'), hz = p.overlay.querySelector('.guide.h');
  if (gx != null) {
    if (!v) { v = h('<div class="guide v"></div>'); p.overlay.appendChild(v); }
    v.style.left = gx * S.zoom + 'px';
  } else v?.remove();
  if (gy != null) {
    if (!hz) { hz = h('<div class="guide h"></div>'); p.overlay.appendChild(hz); }
    hz.style.top = gy * S.zoom + 'px';
  } else hz?.remove();
}
const hideGuides = (p) => p.overlay.querySelectorAll('.guide').forEach((g) => g.remove());

function bindOverlay(p) {
  // ขอบแปรงตามเมาส์ (ขนาดและสีเท่าแปรงจริง)
  p.overlay.addEventListener('pointermove', (e) => updateBrushCursor(p, e));
  p.overlay.addEventListener('pointerleave', () => { if (p.brushCur) p.brushCur.style.display = 'none'; });
  p.overlay.addEventListener('contextmenu', (e) => { if (S.tool === 'auto' && S.mode === 'design') e.preventDefault(); });
  p.overlay.addEventListener('pointerdown', (e) => {
    if (S.mode !== 'design') return;
    // คลิกขวาค้างแล้วลาก = ระบายเป็นสี่เหลี่ยม
    if (S.tool === 'auto' && e.button === 2) { e.preventDefault(); return startRectPaint(e, p); }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (S.tool === 'auto') {
      const cd = e.target.closest('.cand');
      if (cd) { e.preventDefault(); return toggleCand(cd.dataset.id); }
      if (S.brush === 'pan') return;
      e.preventDefault();
      return startPaint(e, p);
    }
    const fEl = e.target.closest('.fld');
    const hd = e.target.closest('.h');
    if (hd && fEl) { e.preventDefault(); return startResize(e, p, byId(fEl.dataset.id), hd.dataset.h); }
    if (fEl) { e.preventDefault(); return startMove(e, p, byId(fEl.dataset.id)); }
    if (S.tool === 'select') {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') { e.preventDefault(); return startMarquee(e, p); }
      track(e, { up: (ev, cancelled) => { if (!cancelled && S.sel.size) { S.sel.clear(); renderAllFields(); renderPanel(); } } });
      return;
    }
    if (e.pointerType === 'mouse') e.preventDefault();
    startCreate(e, p);
  });
  p.overlay.addEventListener('dblclick', (e) => {
    if (S.mode !== 'design') return;
    const fEl = e.target.closest('.fld');
    if (!fEl) return;
    S.designTab = 'props';
    renderPanel();
    if (isSmall()) document.body.classList.add('sheet-open');
    setTimeout(() => { const i = $('#propName'); i?.focus(); i?.select(); }, 50);
  });
  p.overlay.addEventListener('click', (e) => {
    if (S.mode !== 'fill') return;
    const fEl = e.target.closest('.fld');
    if (fEl) editField(byId(fEl.dataset.id));
  });
}

function startMove(e, p, f) {
  const multiKey = e.shiftKey || e.ctrlKey || e.metaKey;
  const wasSel = S.sel.has(f.id);
  if (multiKey) {
    if (wasSel) S.sel.delete(f.id); else S.sel.add(f.id);
    renderAllFields(); renderPanel(); updateFab();
    if (wasSel) return;
  } else if (!wasSel) {
    S.sel = new Set([f.id]);
    renderAllFields(); renderPanel(); updateFab();
  }
  const moving = [...S.sel].map(byId).filter((x) => x && !x.locked && x.page === p.num);
  if (!moving.includes(f) || f.locked) return;
  const start = toPt(e, p);
  const orig = moving.map((x) => ({ f: x, x: x.x, y: x.y }));
  const o0 = orig.find((o) => o.f === f);
  const movingIds = new Set(moving.map((x) => x.id));
  const cand = snapCandidates(p.lines, fieldsOn(p.num).filter((x) => !movingIds.has(x.id)));
  const minX = Math.min(...orig.map((o) => o.x)), minY = Math.min(...orig.map((o) => o.y));
  const maxX = Math.max(...orig.map((o) => o.x + o.f.w)), maxY = Math.max(...orig.map((o) => o.y + o.f.h));
  let moved = false;
  track(e, {
    move(ev) {
      const q = toPt(ev, p);
      let dx = q.x - start.x, dy = q.y - start.y;
      if (!moved && Math.hypot(dx, dy) * S.zoom < 4) return;
      if (!moved) { moved = true; pushHistory(); }
      let g = { gx: null, gy: null };
      if (S.snap && !ev.altKey) {
        g = snapMove({ x: o0.x + dx, y: o0.y + dy, w: f.w, h: f.h }, cand, 6 / S.zoom);
        dx += g.dx; dy += g.dy;
      }
      dx = clamp(dx, -minX, p.w - maxX);
      dy = clamp(dy, -minY, p.h - maxY);
      for (const o of orig) { o.f.x = r1(o.x + dx); o.f.y = r1(o.y + dy); const d = elOf(o.f); if (d) setPos(d, o.f); }
      showGuides(p, g.gx, g.gy);
    },
    up() {
      hideGuides(p);
      if (moved) { renderPanel(); scheduleSave(); }
      else if (wasSel && !multiKey && S.sel.size > 1) { S.sel = new Set([f.id]); renderAllFields(); renderPanel(); }
    },
  });
}

function startResize(e, p, f, dir) {
  const start = toPt(e, p);
  const o = { x: f.x, y: f.y, w: f.w, h: f.h };
  const cand = snapCandidates(p.lines, fieldsOn(p.num).filter((x) => x.id !== f.id));
  const thr = 6 / S.zoom;
  let moved = false;
  const d = elOf(f);
  track(e, {
    move(ev) {
      const q = toPt(ev, p);
      const dx = q.x - start.x, dy = q.y - start.y;
      if (!moved && Math.hypot(dx, dy) * S.zoom < 2) return;
      if (!moved) { moved = true; pushHistory(); }
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h, gx = null, gy = null;
      const sn = S.snap && !ev.altKey;
      if (dir.includes('w')) { x1 = clamp(o.x + dx, 0, x2 - 3); if (sn) { const s = snapValue(x1, cand.xs, thr); x1 = s.v; gx = s.g; } }
      if (dir.includes('e')) { x2 = clamp(o.x + o.w + dx, x1 + 3, p.w); if (sn) { const s = snapValue(x2, cand.xs, thr); x2 = s.v; gx = s.g; } }
      if (dir.includes('n')) { y1 = clamp(o.y + dy, 0, y2 - 3); if (sn) { const s = snapValue(y1, cand.ys, thr); y1 = s.v; gy = s.g; } }
      if (dir.includes('s')) { y2 = clamp(o.y + o.h + dy, y1 + 3, p.h); if (sn) { const s = snapValue(y2, cand.ys, thr); y2 = s.v; gy = s.g; } }
      f.x = r1(x1); f.y = r1(y1); f.w = r1(Math.max(3, x2 - x1)); f.h = r1(Math.max(3, y2 - y1));
      updateFieldEl(f, d);
      showGuides(p, gx, gy);
    },
    up() { hideGuides(p); if (moved) { renderPanel(); scheduleSave(); } },
  });
}

function startMarquee(e, p) {
  const a = toPt(e, p);
  const add = e.shiftKey || e.ctrlKey || e.metaKey;
  const base = add ? new Set(S.sel) : new Set();
  let box = null, moved = false;
  track(e, {
    move(ev) {
      const b = toPt(ev, p);
      if (!moved && Math.hypot(b.x - a.x, b.y - a.y) * S.zoom < 4) return;
      moved = true;
      if (!box) { box = h('<div class="marquee"></div>'); p.overlay.appendChild(box); }
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
      Object.assign(box.style, { left: x * S.zoom + 'px', top: y * S.zoom + 'px', width: w * S.zoom + 'px', height: hh * S.zoom + 'px' });
      S.sel = new Set(base);
      for (const f of fieldsOn(p.num)) if (f.x < x + w && f.x + f.w > x && f.y < y + hh && f.y + f.h > y) S.sel.add(f.id);
      for (const f of fieldsOn(p.num)) { const d = elOf(f); if (d) d.classList.toggle('sel', S.sel.has(f.id)); }
    },
    up() {
      box?.remove();
      if (!moved && !add) S.sel.clear();
      renderAllFields(); renderPanel(); updateFab();
    },
  });
}

function startCreate(e, p) {
  const tool = S.tool;
  const a = toPt(e, p);
  const thr = 6 / S.zoom;
  const cand = snapCandidates(p.lines, fieldsOn(p.num));
  let moved = false, ghost = null, rect = null;
  track(e, {
    move(ev) {
      const b = toPt(ev, p);
      if (!moved && Math.hypot(b.x - a.x, b.y - a.y) * S.zoom < 6) return;
      moved = true;
      const sn = S.snap && !ev.altKey;
      const ax = sn ? snapValue(a.x, cand.xs, thr) : { v: a.x, g: null };
      const ay = sn ? snapValue(a.y, cand.ys, thr) : { v: a.y, g: null };
      const bx = sn ? snapValue(clamp(b.x, 0, p.w), cand.xs, thr) : { v: clamp(b.x, 0, p.w), g: null };
      const by = sn ? snapValue(clamp(b.y, 0, p.h), cand.ys, thr) : { v: clamp(b.y, 0, p.h), g: null };
      rect = { x: Math.min(ax.v, bx.v), y: Math.min(ay.v, by.v), w: Math.abs(bx.v - ax.v), h: Math.abs(by.v - ay.v) };
      if (!ghost) { ghost = h('<div class="ghost"></div>'); p.overlay.appendChild(ghost); }
      Object.assign(ghost.style, { left: rect.x * S.zoom + 'px', top: rect.y * S.zoom + 'px', width: rect.w * S.zoom + 'px', height: rect.h * S.zoom + 'px' });
      showGuides(p, bx.g, by.g);
    },
    async up(ev, cancelled) {
      ghost?.remove(); hideGuides(p);
      if (cancelled) return;
      if (tool === 'table') {
        if (moved && rect.w > 12 && rect.h > 8) openTableDialog(p, rect);
        else toast('ลากกรอบครอบตารางในเอกสาร แล้วระบบจะแบ่งช่องตามเส้นตารางให้');
        return;
      }
      if (moved) {
        if (rect.w < 3 || rect.h < 3) return;
        createField(p, tool, { ...rect, vAlign: tool === 'multiline' ? 'top' : undefined });
      } else {
        await placeSmart(p, tool, a);
      }
    },
  });
}

async function placeSmart(p, type, pt) {
  if (!p.lines) await ensureLines(p);
  let r = smartRect(p.lines, pt, type, p, S.edgeGap);
  if (type === 'checkbox' && !r.smart) {
    try { const b = await findBoxAt(p.page, pt); if (b) r = { ...b, smart: true }; } catch (e) { console.warn(e); }
  }
  createField(p, type, r);
}

function nextName(type) {
  const pre = TYPES[type]?.prefix || 'ช่อง';
  const used = new Set(S.doc.fields.map((f) => f.name));
  let i = 1;
  while (used.has(pre + i)) i++;
  return pre + i;
}

// ช่องวันที่ใหม่ใช้ภาษา/รูปแบบล่าสุดที่เลือก
function newDateProps() {
  const lang = S.lastDateLang === 'en' ? 'en' : 'th';
  const ok = DATE_FORMATS_BY_LANG[lang].some((d) => d.id === S.lastDateFormat);
  return { dateLang: lang, dateFormat: ok ? S.lastDateFormat : DEFAULT_DATE_FORMAT[lang] };
}

function newField(p, type, r) {
  const x = r1(clamp(r.x, 0, p.w - 3)), y = r1(clamp(r.y, 0, p.h - 3));
  return {
    id: uid(), type, page: p.num, x, y,
    w: r1(Math.min(r.w, p.w - x)), h: r1(Math.min(r.h, p.h - y)),
    name: nextName(type), fontSize: 0,
    align: type === 'checkbox' || type === 'signature' ? 'center' : 'left',
    vAlign: r.vAlign || (type === 'multiline' ? 'top' : 'middle'),
    color: '#000000',
    ...(type === 'date' ? newDateProps() : {}),
    ...(type === 'checkbox' ? { checkStyle: r.checkStyle || 'check' } : {}),
    required: false, locked: false,
  };
}

function createField(p, type, r) {
  pushHistory();
  const f = newField(p, type, r);
  S.doc.fields.push(f);
  S.sel = new Set([f.id]);
  changed();
  updateFab();
}

// ---------- ตาราง ----------
async function openTableDialog(p, r) {
  if (!p.lines) await ensureLines(p);
  const g = gridIn(p.lines, r);
  const hasC = g.xs.length >= 2, hasR = g.ys.length >= 2;
  const nC = hasC ? g.xs.length - 1 : 3, nR = hasR ? g.ys.length - 1 : 5;
  const tables = new Set(S.doc.fields.map((f) => f.group).filter(Boolean));
  let ti = tables.size + 1;
  while (tables.has('ตาราง' + ti)) ti++;
  const body = h(`<div style="display:flex;flex-direction:column;gap:12px">
    <div class="tip">${hasC || hasR ? `พบเส้นตารางในเอกสาร: <b>${hasC ? nC + ' คอลัมน์' : '—'}</b> × <b>${hasR ? nR + ' แถว' : '—'}</b> — ช่องจะพอดีกับเส้นตารางเดิม` : 'ไม่พบเส้นตารางในกรอบนี้ — จะแบ่งช่องขนาดเท่ากันตามจำนวนที่กำหนด'}</div>
    <div class="row">
      <label class="f grow">คอลัมน์
        <select class="inp" data-cm>${hasC ? `<option value="lines">ตามเส้นในเอกสาร (${nC})</option>` : ''}<option value="eq">แบ่งเท่ากัน</option></select></label>
      <label class="f" style="width:90px">จำนวน<input class="inp num" type="number" min="1" max="60" value="${nC}" data-cn></label>
    </div>
    <div class="row">
      <label class="f grow">แถว
        <select class="inp" data-rm>${hasR ? `<option value="lines">ตามเส้นในเอกสาร (${nR})</option>` : ''}<option value="eq">แบ่งเท่ากัน</option></select></label>
      <label class="f" style="width:90px">จำนวน<input class="inp num" type="number" min="1" max="200" value="${nR}" data-rn></label>
    </div>
    <label class="f inline"><input type="checkbox" data-skip ${hasR && nR > 1 ? 'checked' : ''} style="accent-color:var(--accent)"> แถวแรกเป็นหัวตาราง (ไม่ต้องวางช่อง)</label>
    <div class="row">
      <label class="f grow">ชนิดช่อง<select class="inp" data-type>
        <option value="text">ข้อความ</option><option value="checkbox">ติ๊กถูก</option><option value="date">วันที่</option><option value="multiline">หลายบรรทัด</option></select></label>
      <label class="f grow">ชื่อกลุ่ม<input class="inp" value="ตาราง${ti}" data-name></label>
    </div>
    <div class="muted" style="font-size:13px" data-count></div>
  </div>`);
  const q = (s) => body.querySelector(s);
  const syncEnable = () => { q('[data-cn]').disabled = q('[data-cm]').value === 'lines'; q('[data-rn]').disabled = q('[data-rm]').value === 'lines'; };
  const eq = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  const cells = () => {
    const cm = q('[data-cm]').value, rm = q('[data-rm]').value;
    const xs = cm === 'lines' ? g.xs : eq(hasC ? g.xs[0] : r.x, hasC ? g.xs.at(-1) : r.x + r.w, clamp(+q('[data-cn]').value || 1, 1, 60));
    const ys = rm === 'lines' ? g.ys : eq(hasR ? g.ys[0] : r.y, hasR ? g.ys.at(-1) : r.y + r.h, clamp(+q('[data-rn]').value || 1, 1, 200));
    const skip = q('[data-skip]').checked ? 1 : 0;
    const type = q('[data-type]').value;
    const out = [];
    for (let ri = skip; ri < ys.length - 1; ri++) for (let ci = 0; ci < xs.length - 1; ci++) {
      let c = { x: xs[ci] + 1.5, y: ys[ri] + 1.5, w: xs[ci + 1] - xs[ci] - 3, h: ys[ri + 1] - ys[ri] - 3, row: ri - skip + 1, col: ci + 1 };
      if (type === 'checkbox') {
        const s = clamp(Math.min(c.w, c.h) - 2, 6, 12);
        c = { ...c, x: c.x + (c.w - s) / 2, y: c.y + (c.h - s) / 2, w: s, h: s };
      }
      if (c.w > 2 && c.h > 2) out.push(c);
    }
    return out;
  };
  const preview = () => {
    p.overlay.querySelectorAll('.ghost.cell').forEach((x) => x.remove());
    const cs = cells();
    q('[data-count]').textContent = `จะสร้าง ${cs.length} ช่อง`;
    for (const c of cs) {
      const gh = h('<div class="ghost cell"></div>');
      Object.assign(gh.style, { left: c.x * S.zoom + 'px', top: c.y * S.zoom + 'px', width: c.w * S.zoom + 'px', height: c.h * S.zoom + 'px' });
      p.overlay.appendChild(gh);
    }
  };
  body.addEventListener('input', () => { syncEnable(); preview(); });
  body.addEventListener('change', () => { syncEnable(); preview(); });
  syncEnable(); preview();
  const ok = await dialog({ title: 'สร้างช่องในตาราง', body, actions: [{ label: 'ยกเลิก', value: null }, { label: 'สร้างช่อง', value: 'ok', primary: true }] });
  const cs = cells();
  const type = q('[data-type]').value;
  const group = q('[data-name]').value.trim() || 'ตาราง' + ti;
  p.overlay.querySelectorAll('.ghost.cell').forEach((x) => x.remove());
  if (ok !== 'ok' || !cs.length) return;
  pushHistory();
  S.sel.clear();
  for (const c of cs) {
    const f = newField(p, type, c);
    f.name = `${group}_r${c.row}_c${c.col}`;
    f.group = group;
    S.doc.fields.push(f);
    S.sel.add(f.id);
  }
  setTool('select');
  changed();
  toast(`สร้าง ${cs.length} ช่องแล้ว — ปรับทั้งกลุ่มได้จากแผงด้านขวา`, { type: 'ok' });
}

// ======================================================================
// สร้างช่องอัตโนมัติ + แปรงระบายโซน
// ======================================================================
const TYPE_LABEL = { text: 'ข้อความ', multiline: 'หลายบรรทัด', checkbox: 'ติ๊กถูก', date: 'วันที่', signature: 'ลายเซ็น' };
const MASK_RES = 2; // พิกเซลแคนวาสต่อ pt (ภาพที่ระบาย)

function ensureMask(p) {
  if (p.mask) return;
  p.mw = Math.ceil(p.w); p.mh = Math.ceil(p.h);
  p.mask = new Uint8Array(p.mw * p.mh);
  const cv = document.createElement('canvas');
  cv.className = 'mask-cv';
  cv.width = Math.ceil(p.w * MASK_RES); cv.height = Math.ceil(p.h * MASK_RES);
  p.el.insertBefore(cv, p.overlay);
  p.maskCv = cv;
}

function startPaint(e, p) {
  ensureMask(p);
  if (S.auto) clearAutoPreview();
  const ctx = p.maskCv.getContext('2d');
  const erase = S.brush === 'erase';
  const code = erase ? 0 : BRUSH_CODE[S.brush] || 1;
  const r = S.brushSize / 2;
  const stamp = (c) => {
    const x0 = Math.max(0, Math.floor(c.x - r)), x1 = Math.min(p.mw - 1, Math.ceil(c.x + r));
    const y0 = Math.max(0, Math.floor(c.y - r)), y1 = Math.min(p.mh - 1, Math.ceil(c.y + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2 <= r * r) p.mask[y * p.mw + x] = code;
    }
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = AUTO_COLORS[S.brush] || '#000';
    ctx.beginPath(); ctx.arc(c.x * MASK_RES, c.y * MASK_RES, r * MASK_RES, 0, Math.PI * 2); ctx.fill();
  };
  let last = toPt(e, p);
  stamp(last);
  track(e, {
    move(ev) {
      const q = toPt(ev, p);
      const dist = Math.hypot(q.x - last.x, q.y - last.y);
      const step = Math.max(1, r / 2);
      for (let t = step; t < dist; t += step) stamp({ x: last.x + ((q.x - last.x) * t) / dist, y: last.y + ((q.y - last.y) * t) / dist });
      stamp(q);
      last = q;
    },
    up() { renderPanel(); },
  });
}

function updateBrushCursor(p, e) {
  const show = S.tool === 'auto' && S.mode === 'design' && S.brush !== 'pan' && e.pointerType !== 'touch' && !e.target.closest('.cand');
  if (!show) { if (p.brushCur) p.brushCur.style.display = 'none'; return; }
  if (!p.brushCur) { p.brushCur = h('<div class="brush-cursor"></div>'); p.overlay.appendChild(p.brushCur); }
  const c = p.brushCur;
  const q = toPt(e, p);
  const d = S.brushSize * S.zoom;
  c.classList.toggle('erase', S.brush === 'erase');
  c.style.cssText = `display:block;left:${q.x * S.zoom}px;top:${q.y * S.zoom}px;width:${d}px;height:${d}px;--c:${AUTO_COLORS[S.brush] || '#64748b'}`;
}

// เติม/ลบ mask เป็นสี่เหลี่ยม (pt)
function paintRect(p, r, erase, code, color) {
  const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(p.mw - 1, Math.ceil(r.x + r.w));
  const y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(p.mh - 1, Math.ceil(r.y + r.h));
  for (let y = y0; y <= y1; y++) p.mask.fill(code, y * p.mw + x0, y * p.mw + x1 + 1);
  const ctx = p.maskCv.getContext('2d');
  const k = MASK_RES;
  if (erase) ctx.clearRect(x0 * k, y0 * k, (x1 - x0 + 1) * k, (y1 - y0 + 1) * k);
  else { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = color; ctx.fillRect(x0 * k, y0 * k, (x1 - x0 + 1) * k, (y1 - y0 + 1) * k); }
}

function startRectPaint(e, p) {
  ensureMask(p);
  if (S.auto) clearAutoPreview();
  const brush = S.brush === 'pan' ? 'auto' : S.brush;
  const erase = brush === 'erase';
  const code = erase ? 0 : BRUSH_CODE[brush] || 1;
  const color = AUTO_COLORS[brush] || '#64748b';
  const a = toPt(e, p);
  const g = h('<div class="paint-rect"></div>');
  g.classList.toggle('erase', erase);
  g.style.setProperty('--c', color);
  p.overlay.appendChild(g);
  let r = null;
  track(e, {
    move(ev) {
      const b = toPt(ev, p);
      const x2 = clamp(b.x, 0, p.w), y2 = clamp(b.y, 0, p.h);
      r = { x: Math.min(a.x, x2), y: Math.min(a.y, y2), w: Math.abs(x2 - a.x), h: Math.abs(y2 - a.y) };
      Object.assign(g.style, { left: r.x * S.zoom + 'px', top: r.y * S.zoom + 'px', width: r.w * S.zoom + 'px', height: r.h * S.zoom + 'px' });
    },
    up(ev, cancelled) {
      g.remove();
      if (cancelled || !r || r.w < 2 || r.h < 2) return;
      paintRect(p, r, erase, code, color);
      renderPanel();
    },
  });
}

const pageHasMask = (p) => !!p.mask && p.mask.some((v) => v);

function clearMasks() {
  for (const p of S.pages) {
    if (!p.mask) continue;
    p.mask.fill(0);
    p.maskCv.getContext('2d').clearRect(0, 0, p.maskCv.width, p.maskCv.height);
  }
}

async function runAuto() {
  const pages = S.autoScope === 'all' ? S.pages : [currentPage()];
  const masked = S.pages.some(pageHasMask);
  const b = busy('กำลังค้นหาช่อง…');
  const cands = [];
  try {
    for (const p of pages) {
      if (masked && !pageHasMask(p)) continue;
      b.set(`กำลังค้นหาช่อง… หน้า ${p.num} / ${S.pages.length}`);
      await ensureLines(p);
      const cs = findCandidates(p, { kinds: S.autoKinds, mask: masked ? p.mask : null, existing: fieldsOn(p.num), gap: S.edgeGap });
      nameCandidates(cs, S.autoNames ? await pageText(p) : [], p.lines);
      for (const c of cs) cands.push({ ...c, page: p.num, id: uid(), skip: false });
    }
  } finally { b.close(); }
  // ชื่อไม่ซ้ำ (ยกเว้นกลุ่มวันที่แยกช่องที่ตั้งใจให้ใช้ค่าร่วมกัน)
  const used = new Set(S.doc.fields.map((f) => f.name));
  const sharedOk = new Set();
  for (const c of readingOrder(cands)) {
    if (c.shared && sharedOk.has(c.name)) continue;
    if (!c.name) {
      const pre = TYPES[c.type].prefix;
      let i = 1; while (used.has(pre + i)) i++;
      c.name = pre + i;
    } else if (used.has(c.name)) {
      let i = 2; while (used.has(`${c.name} ${i}`)) i++;
      c.name = `${c.name} ${i}`;
    }
    used.add(c.name);
    if (c.shared) sharedOk.add(c.name);
  }
  // กลุ่มวันที่ที่ถูกเปลี่ยนชื่อ → ให้ทุกช่องในกลุ่มใช้ชื่อเดียวกัน
  S.auto = { cands, masked };
  renderAutoPreview();
  renderPanel();
  if (!cands.length) toast(masked ? 'ไม่พบช่องในโซนที่ระบาย' : 'ไม่พบช่องว่างสำหรับกรอก — ลองระบายโซนเอง');
}

function renderAutoPreview() {
  for (const p of S.pages) p.overlay.querySelectorAll('.cand').forEach((x) => x.remove());
  if (!S.auto) return;
  for (const c of S.auto.cands) {
    const p = S.pages[c.page - 1];
    const d = h(`<div class="cand ${c.skip ? 'off' : ''} ${c.w < 60 ? 'small' : ''}" data-id="${c.id}" title="${esc(TYPE_LABEL[c.type])}: ${esc(c.name)}"><span>${esc(c.name)}</span></div>`);
    d.style.cssText = `--x:${c.x};--y:${c.y};--w:${c.w};--h:${c.h};--c:${AUTO_COLORS[c.type] || '#64748b'}`;
    p.overlay.appendChild(d);
  }
}

function toggleCand(id) {
  const c = S.auto?.cands.find((x) => x.id === id);
  if (!c) return;
  c.skip = !c.skip;
  renderAutoPreview();
  renderPanel();
}

function clearAutoPreview() {
  S.auto = null;
  renderAutoPreview();
}

function createFromAuto() {
  const list = S.auto?.cands.filter((c) => !c.skip) || [];
  if (!list.length) return;
  pushHistory();
  S.sel.clear();
  for (const c of list) {
    const p = S.pages[c.page - 1];
    const f = newField(p, c.type, c);
    f.name = c.name;
    if (c.dateFormat) f.dateFormat = c.dateFormat;
    if (c.vAlign) f.vAlign = c.vAlign;
    if (c.align) f.align = c.align;
    if (c.checkStyle) f.checkStyle = c.checkStyle;
    S.doc.fields.push(f);
    S.sel.add(f.id);
  }
  S.auto = null;
  renderAutoPreview();
  clearMasks();
  setTool('select');
  changed();
  toast(`สร้าง ${list.length} ช่องแล้ว — ตรวจชื่อได้ที่ “ช่องทั้งหมด”`, { type: 'ok' });
}

function renderAutoPanel(body) {
  const masked = S.pages.some(pageHasMask);
  const sec0 = h(`<div class="sec"><div class="row"><h3 class="grow">สร้างช่องอัตโนมัติ</h3><button class="icon-btn" title="ปิด" data-close>${icon('close')}</button></div>
    <div class="tip">ระบบหา <b>[ ] / ☐</b>, <b>เส้นสำหรับเขียน</b> และ<b>ช่องตารางที่ว่าง</b> แล้วให้ตรวจก่อนสร้างจริง<br>
    <b>ระบาย:</b> คลิกซ้ายลาก = แปรงวงกลม · <b>คลิกขวาค้างแล้วลาก = ระบายเป็นสี่เหลี่ยม</b><br>
    <b>อยากให้แม่นขึ้น:</b> ระบายสีเฉพาะโซนที่ต้องการก่อน — สีบอกชนิดช่อง ระบบจะหาเฉพาะในโซนนั้น</div></div>`);
  sec0.querySelector('[data-close]').onclick = () => setTool('select');
  body.appendChild(sec0);

  const sec1 = h(`<div class="sec"><h3>1. ระบายโซน <span class="badge">ไม่บังคับ</span></h3><div class="brushes"></div>
    <label class="f"><span>ขนาดแปรง <b data-sz>${S.brushSize}</b> pt</span><input type="range" min="4" max="60" step="2" value="${S.brushSize}"></label>
    <div class="row"><button class="btn sm" data-clear ${masked ? '' : 'disabled'}>${icon('trash')}ล้างการระบาย</button></div>
    <div class="muted" style="font-size:12.5px;line-height:1.5">ระบายโซนที่ไม่มีเส้น/กล่องให้จับ → ได้ช่องตามขนาดที่ระบาย (เช่น ช่อง COMMENTS)</div></div>`);
  const bw = sec1.querySelector('.brushes');
  for (const [id, label] of [...BRUSHES, ['erase', 'ยางลบ'], ['pan', 'เลื่อนหน้า']]) {
    const ic = id === 'erase' ? icon('trash') : id === 'pan' ? icon('select') : `<i class="dot" style="--c:${AUTO_COLORS[id]}"></i>`;
    const b = h(`<button class="brush ${S.brush === id ? 'on' : ''}">${ic}<span>${esc(label)}</span></button>`);
    b.onclick = () => { S.brush = id; document.body.classList.toggle('brush-pan', id === 'pan'); renderPanel(); };
    bw.appendChild(b);
  }
  const rg = sec1.querySelector('input[type=range]');
  rg.oninput = () => { S.brushSize = +rg.value; sec1.querySelector('[data-sz]').textContent = rg.value; };
  sec1.querySelector('[data-clear]').onclick = () => { clearMasks(); clearAutoPreview(); renderPanel(); };
  body.appendChild(sec1);

  const sec2 = h('<div class="sec"><h3>2. ค้นหาช่อง</h3><div data-scope></div><div data-kinds style="display:flex;flex-direction:column;gap:8px"></div></div>');
  sec2.querySelector('[data-scope]').appendChild(segRow([['page', 'หน้านี้'], ['all', `ทั้งไฟล์ (${S.pages.length} หน้า)`]], S.autoScope, (v) => { S.autoScope = v; renderPanel(); }));
  const kd = sec2.querySelector('[data-kinds]');
  kd.appendChild(switchRow('ช่องติ๊ก [ ] / ☐', S.autoKinds.checkbox, (v) => { S.autoKinds.checkbox = v; }));
  kd.appendChild(switchRow('เส้นสำหรับเขียน (….. / ____)', S.autoKinds.line, (v) => { S.autoKinds.line = v; }));
  kd.appendChild(switchRow('ช่องตารางที่ว่าง', S.autoKinds.cell, (v) => { S.autoKinds.cell = v; }));
  kd.appendChild(switchRow('ตั้งชื่อจากข้อความรอบช่อง', S.autoNames, (v) => { S.autoNames = v; }));
  kd.appendChild(gapRow());
  const go = h(`<button class="btn ${S.auto ? '' : 'primary'} block">${icon('search')}${masked ? 'ค้นหาเฉพาะโซนที่ระบาย' : 'ค้นหาทั้ง' + (S.autoScope === 'all' ? 'ไฟล์' : 'หน้า')}</button>`);
  go.onclick = runAuto;
  sec2.appendChild(go);
  body.appendChild(sec2);

  if (S.auto) {
    const cs = S.auto.cands;
    const on = cs.filter((c) => !c.skip);
    const types = [...new Set(cs.map((c) => c.type))];
    const sec3 = h(`<div class="sec"><h3>3. ตรวจแล้วสร้าง <span class="badge">${on.length} / ${cs.length}</span></h3>
      <div class="tip">แตะกรอบบนหน้าเพื่อ <b>ข้าม</b> / เอากลับ · ปิดทั้งชนิดได้ด้านล่าง</div><div data-types style="display:flex;flex-direction:column;gap:8px"></div>
      <div class="row"><button class="btn primary grow" data-create ${on.length ? '' : 'disabled'}>${icon('check')}สร้าง ${on.length} ช่อง</button><button class="btn" data-cancel>ยกเลิก</button></div></div>`);
    const tl = sec3.querySelector('[data-types]');
    for (const t of types) {
      const all = cs.filter((c) => c.type === t), n = all.filter((c) => !c.skip).length;
      const r = h(`<label class="f inline" style="justify-content:space-between"><span><i class="dot" style="--c:${AUTO_COLORS[t]}"></i> ${TYPE_LABEL[t]} <span class="muted">${n}/${all.length}</span></span><input type="checkbox" class="switch" ${n ? 'checked' : ''}></label>`);
      r.querySelector('input').onchange = (e) => { all.forEach((c) => { c.skip = !e.target.checked; }); renderAutoPreview(); renderPanel(); };
      tl.appendChild(r);
    }
    sec3.querySelector('[data-create]').onclick = createFromAuto;
    sec3.querySelector('[data-cancel]').onclick = () => { clearAutoPreview(); renderPanel(); };
    body.appendChild(sec3);
  }
}

// ---------- คำสั่งกับช่องที่เลือก ----------
const selFields = () => [...S.sel].map(byId).filter(Boolean);

function deleteSel() {
  if (!S.sel.size) return;
  pushHistory();
  S.doc.fields = S.doc.fields.filter((f) => !S.sel.has(f.id));
  S.sel.clear();
  changed(); updateFab();
}

function duplicateSel(below = true) {
  const list = selFields();
  if (!list.length) return;
  pushHistory();
  const minY = Math.min(...list.map((f) => f.y)), maxY = Math.max(...list.map((f) => f.y + f.h));
  const dy = below ? maxY - minY + 4 : 10;
  S.sel.clear();
  for (const f of list) {
    const p = S.pages[f.page - 1];
    const n = { ...f, id: uid(), y: r1(clamp(f.y + dy, 0, p.h - f.h)), x: below ? f.x : r1(clamp(f.x + 10, 0, p.w - f.w)), locked: false };
    n.name = nextName(f.type);
    S.doc.fields.push(n); S.sel.add(n.id);
  }
  changed();
}

function copySel() {
  const list = selFields();
  if (!list.length) return;
  S.clip = JSON.parse(JSON.stringify(list));
  toast(`คัดลอก ${list.length} ช่อง`);
}

function pasteClip() {
  if (!S.clip?.length) return;
  const target = currentPage();
  pushHistory();
  S.sel.clear();
  const samePage = S.clip.every((f) => f.page === target.num);
  for (const f of S.clip) {
    const n = { ...f, id: uid(), page: target.num, locked: false };
    if (samePage) { n.x = r1(clamp(f.x + 10, 0, target.w - f.w)); n.y = r1(clamp(f.y + 10, 0, target.h - f.h)); }
    n.name = S.doc.fields.some((x) => x.name === f.name) ? nextName(f.type) : f.name;
    S.doc.fields.push(n); S.sel.add(n.id);
  }
  changed();
}

function currentPage() {
  const v = $('#viewer');
  const mid = v.getBoundingClientRect().top + v.clientHeight / 2;
  let best = S.pages[0], bd = Infinity;
  for (const p of S.pages) {
    const r = p.el.getBoundingClientRect();
    const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function alignSel(kind) {
  const list = selFields().filter((f) => !f.locked);
  if (list.length < 2) return;
  pushHistory();
  const L = Math.min(...list.map((f) => f.x)), R = Math.max(...list.map((f) => f.x + f.w));
  const T = Math.min(...list.map((f) => f.y)), B = Math.max(...list.map((f) => f.y + f.h));
  const first = list[0];
  for (const f of list) {
    if (kind === 'aL') f.x = L;
    if (kind === 'aR') f.x = r1(R - f.w);
    if (kind === 'aCH') f.x = r1((L + R) / 2 - f.w / 2);
    if (kind === 'aT') f.y = T;
    if (kind === 'aB') f.y = r1(B - f.h);
    if (kind === 'aCV') f.y = r1((T + B) / 2 - f.h / 2);
    if (kind === 'sameW') f.w = first.w;
    if (kind === 'sameH') f.h = first.h;
  }
  if (kind === 'dH' || kind === 'dV') {
    const hz = kind === 'dH';
    const s = [...list].sort((a, b) => (hz ? a.x - b.x : a.y - b.y));
    const total = hz ? R - L : B - T;
    const sum = s.reduce((t, f) => t + (hz ? f.w : f.h), 0);
    const gap = (total - sum) / (s.length - 1);
    let pos = hz ? L : T;
    for (const f of s) { if (hz) { f.x = r1(pos); pos += f.w + gap; } else { f.y = r1(pos); pos += f.h + gap; } }
  }
  changed();
}

function nudge(dx, dy) {
  const list = selFields().filter((f) => !f.locked);
  if (!list.length) return;
  const now = Date.now();
  if (!S.lastNudge || now - S.lastNudge > 700) pushHistory();
  S.lastNudge = now;
  for (const f of list) {
    const p = S.pages[f.page - 1];
    f.x = r1(clamp(f.x + dx, 0, p.w - f.w));
    f.y = r1(clamp(f.y + dy, 0, p.h - f.h));
    const d = elOf(f); if (d) setPos(d, f);
  }
  scheduleSave();
  clearTimeout(S.nudgeTimer);
  S.nudgeTimer = setTimeout(renderPanel, 250);
}

function readingOrder(list) {
  return [...list].sort((a, b) => a.page - b.page || (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x));
}

async function renameSequential() {
  const list = readingOrder(selFields());
  if (!list.length) return;
  const pre = await promptBox('ตั้งชื่อเรียงลำดับ', 'ชื่อขึ้นต้น (จะได้ ชื่อ1, ชื่อ2, … ตามลำดับการอ่าน)', list[0].group || TYPES[list[0].type].prefix);
  if (!pre) return;
  pushHistory();
  list.forEach((f, i) => { f.name = pre + (i + 1); });
  changed();
}

function scrollToField(f, flash = true) {
  const p = S.pages[f.page - 1];
  const v = $('#viewer');
  const pr = p.el.getBoundingClientRect(), vr = v.getBoundingClientRect();
  const top = v.scrollTop + pr.top - vr.top + f.y * S.zoom - v.clientHeight * 0.3;
  const left = v.scrollLeft + pr.left - vr.left + f.x * S.zoom - v.clientWidth * 0.2;
  v.scrollTo({ top, left: Math.max(0, left), behavior: 'smooth' });
  if (flash) {
    const d = elOf(f);
    if (d) { d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); }
  }
}

// ======================================================================
// โหมดกรอก
// ======================================================================
function setValue(name, v, from) {
  S.doc.values[name] = v;
  for (const f of S.doc.fields) if (f.name === name) updateFieldEl(f);
  if (from !== 'list') syncFillItem(name);
  updateProgress();
  scheduleSave();
}

async function editField(f) {
  if (!f) return;
  S.activeName = f.name;
  markActiveItem();
  if (f.type === 'checkbox') { setValue(f.name, truthy(valOf(f)) ? '' : '1'); return; }
  if (f.type === 'signature') {
    const r = await openSignatureDialog(valOf(f));
    if (r !== null) setValue(f.name, r);
    return;
  }
  openEditor(f);
}

function openEditor(f) {
  closeEditor();
  const p = S.pages[f.page - 1];
  const multi = f.type === 'multiline', isDate = f.type === 'date';
  const ed = document.createElement(multi ? 'textarea' : 'input');
  if (isDate) { ed.type = 'date'; ed.value = isISO(valOf(f)) ? valOf(f) : ''; }
  else { if (!multi) ed.type = 'text'; ed.value = valOf(f); }
  ed.className = 'fill-editor' + (isDate ? ' date' : '');
  ed.setAttribute('enterkeyhint', 'next');
  S.editor = { f, ed, p };
  positionEditor();
  p.overlay.appendChild(ed);
  updateFieldEl(f);
  ed.focus({ preventScroll: true });
  if (!isDate) { try { ed.setSelectionRange(ed.value.length, ed.value.length); } catch (e) { /* noop */ } }
  if (isDate && ed.showPicker) { try { ed.showPicker(); } catch (e) { /* noop */ } }
  ed.addEventListener('input', () => setValue(f.name, ed.value));
  ed.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' && !multi && !e.isComposing) || e.key === 'Tab') {
      e.preventDefault();
      const nx = neighborField(f, e.shiftKey ? -1 : 1);
      closeEditor();
      if (nx) { scrollToField(nx, false); editField(nx); }
    } else if (e.key === 'Escape') closeEditor();
  });
  ed.addEventListener('blur', () => setTimeout(() => { if (S.editor?.ed === ed) closeEditor(); }, 120));
}

function positionEditor() {
  const { f: f0, ed } = S.editor || {};
  if (!ed) return;
  const f = styled(f0);
  const z = S.zoom;
  const lay = layoutText(f, displayText(f, valOf(f)) || 'ก');
  ed.style.fontFamily = `'${cssFamily(f.font)}', 'Sarabun', sans-serif`;
  ed.style.fontWeight = String(weightOf(f.font, f.bold));
  const fs = Math.max(lay.size * z, 13);
  const minH = f.type === 'date' ? 30 : fs * 1.45;
  const hh = Math.max(f.h * z, minH);
  Object.assign(ed.style, {
    left: f.x * z - 2 + 'px', top: f.y * z - (hh - f.h * z) / 2 - 2 + 'px',
    width: Math.max(f.w * z + 4, f.type === 'date' ? 150 : 60) + 'px', height: hh + 4 + 'px',
    fontSize: fs + 'px', textAlign: f.align || 'left', color: f.color || '#000',
  });
}

function closeEditor() {
  if (!S.editor) return;
  const { f, ed } = S.editor;
  S.editor = null;
  ed.remove();
  if (S.doc?.fields.includes(f)) updateFieldEl(f);
}

const FILL_TYPES = new Set(['text', 'multiline', 'date']);
function neighborField(f, dir) {
  const list = readingOrder(S.doc.fields.filter((x) => FILL_TYPES.has(x.type)));
  const seen = new Set();
  const uniq = list.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
  const i = uniq.findIndex((x) => x.name === f.name);
  return uniq[i + dir] || null;
}

function uniqueFields() {
  const seen = new Map();
  for (const f of readingOrder(S.doc.fields)) if (!seen.has(f.name)) seen.set(f.name, f);
  return [...seen.values()];
}

function updateProgress() {
  const el = $('#fillProgress');
  if (!el) return;
  const u = uniqueFields();
  const done = u.filter((f) => !isEmptyVal(f, valOf(f))).length;
  el.querySelector('i').style.width = (u.length ? (done / u.length) * 100 : 0) + '%';
  $('#fillProgressText').textContent = `กรอกแล้ว ${done} / ${u.length}`;
}

function syncFillItem(name) {
  const item = $(`.fill-item[data-name="${CSS.escape(name)}"]`);
  if (!item) return;
  const f = S.doc.fields.find((x) => x.name === name);
  const v = valOf(f);
  const c = item.querySelector('[data-ctl]');
  if (!c || document.activeElement === c) return;
  if (f.type === 'checkbox') c.checked = truthy(v);
  else if (f.type === 'signature') item.querySelector('.sig-prev').innerHTML = v ? `<img src="${v}" alt="">` : '<span class="muted">ยังไม่ได้เซ็น</span>';
  else c.value = f.type === 'date' ? (isISO(v) ? v : '') : v;
  if (f.type === 'date') item.querySelector('[data-dprev]').textContent = v ? formatDate(v, f.dateFormat, f.dateLang) : '';
}

function markActiveItem() {
  $$('.fill-item').forEach((it) => it.classList.toggle('on', it.dataset.name === S.activeName));
}

// ======================================================================
// แผงด้านข้าง
// ======================================================================
function renderPanel() {
  const body = $('#panelBody');
  if (!S.doc) { body.innerHTML = ''; return; }
  body.innerHTML = '';
  if (S.mode === 'design') renderDesignPanel(body); else renderFillPanel(body);
  hydrateIcons(body);
  updateFab();
}

function tabs(items, cur, onPick) {
  const t = h('<div class="tabs"></div>');
  for (const [id, label] of items) {
    const b = h(`<button class="${id === cur ? 'on' : ''}">${esc(label)}</button>`);
    b.onclick = () => onPick(id);
    t.appendChild(b);
  }
  return t;
}

function renderDesignPanel(body) {
  if (S.tool === 'auto') return renderAutoPanel(body);
  body.appendChild(tabs([['props', S.sel.size ? 'คุณสมบัติ' : 'เริ่มต้น'], ['styles', 'สไตล์ & กลุ่ม'], ['list', `ช่อง (${S.doc.fields.length})`]], S.designTab, (t) => { S.designTab = t; renderPanel(); }));
  if (S.designTab === 'list') return renderFieldList(body);
  if (S.designTab === 'styles') return renderStylesPanel(body);
  const list = selFields();
  if (!list.length) return renderTips(body);
  if (list.length === 1) return renderProps(body, list[0]);
  return renderMultiProps(body, list);
}

function renderTips(body) {
  body.appendChild(h(`<div class="sec">
    <button class="btn primary block" data-auto>${icon('wand')}สร้างช่องอัตโนมัติ…</button>
    <div class="tip"><b>วางช่องแบบเร็ว:</b> เลือกเครื่องมือ (ข้อความ, ติ๊กถูก…) แล้ว<b>แตะบนเส้นจุดไข่ปลา / ในช่องตาราง / ในกล่อง ☐</b> — ระบบจะวัดขนาดให้พอดีอัตโนมัติ<br>หรือ<b>ลากเป็นกรอบ</b>เพื่อกำหนดขนาดเอง</div>
    <div class="tip"><b>ตาราง:</b> ใช้เครื่องมือ “ตาราง” ลากครอบตารางในเอกสาร → ได้ช่องตรงทุกเซลล์ในครั้งเดียว</div>
    <div class="tip"><b>ปรับให้ตรง:</b> ลากช่องแล้วจะดูดเข้ากับเส้นและช่องอื่น (กด <span class="kbd">Alt</span> ค้างเพื่อปิดชั่วคราว) · ปุ่มลูกศรขยับทีละ 1 pt (<span class="kbd">Shift</span> = 10)</div>
    <div class="tip"><b>ช่องจะไม่เลื่อน:</b> ตำแหน่งเก็บเป็นหน่วยพอยต์ของ PDF จึงตรงเสมอทุกการซูม/ทุกอุปกรณ์ และบันทึกเป็นแม่แบบให้อัตโนมัติ เปิดไฟล์เดิมครั้งหน้าช่องยังอยู่</div>
  </div>`));
  body.querySelector('[data-auto]').onclick = () => setTool('auto');
  const sec = h('<div class="sec"><h3>ตัวช่วย</h3></div>');
  sec.appendChild(switchRow('ดูดเข้าหาเส้น/ช่องอื่น (snap)', S.snap, (v) => { S.snap = v; }));
  sec.appendChild(switchRow('แสดงเส้นที่ตรวจพบ', S.showLines, (v) => { S.showLines = v; S.pages.forEach(drawLines); }));
  sec.appendChild(switchRow('แสดงชื่อช่องตลอด', document.body.classList.contains('show-names'), (v) => document.body.classList.toggle('show-names', v)));
  sec.appendChild(gapRow());
  body.appendChild(sec);
  body.appendChild(h(`<div class="sec"><h3>คีย์ลัด</h3><div class="tip" style="line-height:1.9">
    <span class="kbd">V</span> เลือก · <span class="kbd">T</span> ข้อความ · <span class="kbd">C</span> ติ๊ก · <span class="kbd">D</span> วันที่ · <span class="kbd">S</span> ลายเซ็น · <span class="kbd">G</span> ตาราง<br>
    <span class="kbd">Ctrl+D</span> ทำซ้ำลงด้านล่าง · <span class="kbd">Ctrl+C/V</span> คัดลอก/วาง · <span class="kbd">Del</span> ลบ<br>
    <span class="kbd">Ctrl+Z</span> ย้อนกลับ · <span class="kbd">Ctrl+A</span> เลือกทั้งหมด · <span class="kbd">Ctrl+ล้อเมาส์</span> ซูม</div></div>`));
}

function switchRow(label, on, cb) {
  const r = h(`<label class="f inline" style="justify-content:space-between"><span>${esc(label)}</span><input type="checkbox" class="switch" ${on ? 'checked' : ''}></label>`);
  r.querySelector('input').onchange = (e) => cb(e.target.checked);
  return r;
}

function segRow(options, cur, cb, cls = '') {
  const s = h(`<div class="seg small ${cls}"></div>`);
  for (const [v, label, ic] of options) {
    const b = h(`<button class="${v === cur ? 'on' : ''}" title="${esc(label)}">${ic ? icon(ic) : esc(label)}</button>`);
    b.onclick = () => cb(v);
    s.appendChild(b);
  }
  return s;
}

function mutate(fn, list = selFields()) {
  pushHistory();
  list.forEach(fn);
  changed();
}

// อัปเดตช่องบนเอกสารทันทีขณะพิมพ์ / กดลูกศรขึ้นลง โดยไม่วาดแผงใหม่ (ช่องที่พิมพ์ยังโฟกัสอยู่)
// บันทึกประวัติ (ย้อนกลับ) ครั้งเดียวต่อการแก้หนึ่งรอบ
function liveInput(input, apply, list) {
  let started = false;
  input.addEventListener('input', () => {
    if (input.value === '' || (input.type === 'number' && Number.isNaN(+input.value))) return;
    if (!started) { pushHistory(); started = true; }
    list.forEach((x) => apply(x, input.value));
    for (const f of list) updateFieldEl(f);
    scheduleSave();
  });
  input.addEventListener('change', () => { started = false; });
}

function renderProps(body, f) {
  const sec = h('<div class="sec"></div>');
  const nm = h(`<label class="f">ชื่อช่อง (ใช้จับคู่กับคอลัมน์ข้อมูล)<input class="inp" id="propName" value="${esc(f.name)}"></label>`);
  nm.querySelector('input').onchange = (e) => {
    const nv = e.target.value.trim();
    if (!nv || nv === f.name) { e.target.value = f.name; return; }
    const old = f.name;
    mutate((x) => { x.name = nv; }, [f]);
    if (!S.doc.fields.some((x) => x.name === old) && S.doc.values[old] !== undefined && S.doc.values[nv] === undefined) {
      S.doc.values[nv] = S.doc.values[old]; delete S.doc.values[old];
    }
    const same = S.doc.fields.filter((x) => x.name === nv).length;
    if (same > 1) toast(`มี ${same} ช่องชื่อ “${nv}” — จะใช้ค่าร่วมกัน`);
  };
  sec.appendChild(nm);

  const typeRow = h('<div class="chips"></div>');
  for (const [t, def] of Object.entries(TYPES)) {
    const b = h(`<button class="btn sm ${t === f.type ? 'primary' : ''}">${icon(def.icon)}${def.label}</button>`);
    b.onclick = () => mutate((x) => {
      x.type = t;
      if (t === 'date' && !x.dateFormat) Object.assign(x, newDateProps());
      if (t === 'checkbox') { x.align = 'center'; x.checkStyle ||= 'check'; }
    }, [f]);
    typeRow.appendChild(b);
  }
  sec.appendChild(h('<label class="f">ชนิดช่อง</label>')).appendChild(typeRow);
  body.appendChild(sec);

  const st = h('<div class="sec"><h3>รูปแบบ</h3></div>');
  renderStyleControls(st, [f]);
  if (f.type === 'date') renderDateControls(st, [f]);
  if (f.type === 'checkbox') {
    st.appendChild(h('<label class="f">เครื่องหมาย</label>'));
    st.lastChild.appendChild(segRow([['check', '✓ ถูก'], ['cross', '✗ กากบาท'], ['dot', '● จุด']], f.checkStyle || 'check', (v) => mutate((x) => { x.checkStyle = v; })));
  }
  if (f.type !== 'checkbox' && f.type !== 'signature') {
    st.appendChild(h('<label class="f">จัดแนวตั้ง</label>')).appendChild(segRow([['top', 'ชิดบน', 'aT'], ['middle', 'กลางแนวตั้ง', 'aCV'], ['bottom', 'ชิดล่าง (บนเส้น)', 'aB']], f.vAlign || 'middle', (v) => mutate((x) => { x.vAlign = v; })));
  }
  body.appendChild(st);

  const pos = h(`<div class="sec"><h3>ตำแหน่งและขนาด <span class="badge">หน้า ${f.page} · หน่วย pt</span></h3><div class="grid4">
    ${[['x', 'X'], ['y', 'Y'], ['w', 'กว้าง'], ['h', 'สูง']].map(([k, l]) => `<label class="f">${l}<input class="inp num" type="number" step="0.5" value="${f[k]}" data-k="${k}"></label>`).join('')}
  </div></div>`);
  pos.querySelectorAll('[data-k]').forEach((i) => liveInput(i, (x, val) => {
    const p = S.pages[x.page - 1];
    const v = +val;
    if (i.dataset.k === 'x') x.x = r1(clamp(v, 0, p.w - x.w));
    if (i.dataset.k === 'y') x.y = r1(clamp(v, 0, p.h - x.h));
    if (i.dataset.k === 'w') x.w = r1(clamp(v, 3, p.w - x.x));
    if (i.dataset.k === 'h') x.h = r1(clamp(v, 3, p.h - x.y));
  }, [f]));
  pos.appendChild(switchRow('ต้องกรอก', !!f.required, (v) => mutate((x) => { x.required = v; }, [f])));
  pos.appendChild(switchRow('ล็อกตำแหน่ง (กันเผลอลาก)', !!f.locked, (v) => mutate((x) => { x.locked = v; }, [f])));
  body.appendChild(pos);

  const act = h(`<div class="sec"><div class="row wrap">
    <button class="btn sm" data-a="fit" title="ขยายช่องให้เต็มกรอบ/กล่อง/ช่องตารางที่อยู่">${icon('sameW')}ขยายเต็มกรอบ</button>
    <button class="btn sm" data-a="dup">${icon('copy')}ทำซ้ำลงด้านล่าง</button>
    <button class="btn sm danger" data-a="del">${icon('trash')}ลบ</button></div>
    <div class="muted" style="font-size:12.5px">ช่องที่ตั้งชื่อเหมือนกันจะใช้ค่าร่วมกัน เช่น ชื่อ-สกุลที่ซ้ำหลายหน้า</div></div>`);
  act.querySelector('[data-a=dup]').onclick = () => duplicateSel(true);
  act.querySelector('[data-a=fit]').onclick = () => fitToFrame(selFields());
  act.querySelector('[data-a=del]').onclick = deleteSel;
  body.appendChild(act);
}

function renderMultiProps(body, list) {
  const sec = h(`<div class="sec"><h3>เลือก ${list.length} ช่อง</h3>
    <label class="f">จัดตำแหน่งช่องให้ตรงกัน</label><div class="icon-row" data-al></div>
    <label class="f">กระจายระยะ / ขนาดเท่ากัน (ยึดช่องแรกที่เลือก)</label><div class="icon-row" data-ds></div></div>`);
  const mk = (box, items) => items.forEach(([k, t]) => {
    const b = h(`<button class="icon-btn" title="${t}">${icon(k)}</button>`);
    b.onclick = () => alignSel(k);
    sec.querySelector(box).appendChild(b);
  });
  mk('[data-al]', [['aL', 'ชิดซ้าย'], ['aCH', 'กึ่งกลางแนวนอน'], ['aR', 'ชิดขวา'], ['aT', 'ชิดบน'], ['aCV', 'กึ่งกลางแนวตั้ง'], ['aB', 'ชิดล่าง']]);
  mk('[data-ds]', [['dH', 'กระจายแนวนอนเท่ากัน'], ['dV', 'กระจายแนวตั้งเท่ากัน'], ['sameW', 'กว้างเท่ากัน'], ['sameH', 'สูงเท่ากัน']]);
  body.appendChild(sec);

  const st = h('<div class="sec"><h3>ตั้งค่าพร้อมกัน</h3></div>');
  renderStyleControls(st, list);
  const dates = list.filter((x) => x.type === 'date');
  if (dates.length) renderDateControls(st, dates);
  // จัดแนวตั้งของข้อความในช่อง (เฉพาะช่องข้อความ/วันที่ ที่เลือกอยู่)
  const vText = list.filter((x) => x.type !== 'checkbox' && x.type !== 'signature');
  if (vText.length) {
    const cur = vText.every((x) => (x.vAlign || 'middle') === (vText[0].vAlign || 'middle')) ? vText[0].vAlign || 'middle' : null;
    st.appendChild(h(`<label class="f">จัดแนวตั้ง (ข้อความในช่อง)${vText.length < list.length ? ` <span class="badge">${vText.length} ช่องข้อความ</span>` : ''}</label>`))
      .appendChild(segRow([['top', 'ชิดบน', 'aT'], ['middle', 'กลางแนวตั้ง', 'aCV'], ['bottom', 'ชิดล่าง (บนเส้น)', 'aB']], cur, (v) => mutate((x) => { x.vAlign = v; }, vText)));
  }
  const ty = h(`<label class="f">เปลี่ยนชนิดทั้งหมด<select class="inp"><option value="">—</option>${Object.entries(TYPES).map(([t, d]) => `<option value="${t}">${d.label}</option>`).join('')}</select></label>`);
  ty.querySelector('select').onchange = (e) => e.target.value && mutate((x) => { x.type = e.target.value; if (x.type === 'date' && !x.dateFormat) Object.assign(x, newDateProps()); });
  st.appendChild(ty);
  st.appendChild(switchRow('ล็อกตำแหน่ง', list.every((f) => f.locked), (v) => mutate((x) => { x.locked = v; })));
  body.appendChild(st);

  const act = h(`<div class="sec"><div class="row wrap">
    <button class="btn sm" data-a="ren">${icon('tag')}ตั้งชื่อเรียงลำดับ</button>
    <button class="btn sm" data-a="fit" title="ขยายช่องให้เต็มกรอบ/กล่อง/ช่องตารางที่อยู่">${icon('sameW')}ขยายเต็มกรอบ</button>
    <button class="btn sm" data-a="dup">${icon('copy')}ทำซ้ำลงด้านล่าง</button>
    <button class="btn sm danger" data-a="del">${icon('trash')}ลบ ${list.length} ช่อง</button></div></div>`);
  act.querySelector('[data-a=ren]').onclick = renameSequential;
  act.querySelector('[data-a=dup]').onclick = () => duplicateSel(true);
  act.querySelector('[data-a=fit]').onclick = () => fitToFrame(selFields());
  act.querySelector('[data-a=del]').onclick = deleteSel;
  body.appendChild(act);
}

// ======================================================================
// พรีเซท (สไตล์) + กลุ่ม
// ======================================================================
const SWATCH = 'กขค ทดสอบ 123 Abc';
const COLOR_CHOICES = [['#000000', 'ดำ'], ['#1d3fb8', 'น้ำเงิน'], ['#c62828', 'แดง'], ['#1b7f3b', 'เขียว']];

async function savePresets() {
  try { await Store.set('presets', S.presets); } catch (e) { console.warn(e); }
  renderAllFields(); renderPanel();
}

function presetSummary(p) {
  const out = [];
  if (isSet(p.font)) out.push(FONTS.find((f) => f.id === p.font)?.label || p.font);
  if (isSet(p.bold)) out.push(p.bold ? 'หนา' : 'ปกติ');
  if (isSet(p.fontSize)) out.push(p.fontSize ? `${p.fontSize} pt` : 'ขนาดอัตโนมัติ');
  if (isSet(p.align)) out.push({ left: 'ชิดซ้าย', center: 'กึ่งกลาง', right: 'ชิดขวา' }[p.align]);
  return out.join(' · ') || 'ไม่กำหนดค่าใด';
}

function swatchStyle(p) {
  const font = isSet(p.font) ? p.font : 'sarabun';
  loadFontFace(font, !!p.bold).catch(() => {});
  return `font-family:'${cssFamily(font)}','Sarabun';font-weight:${weightOf(font, !!p.bold)};color:${isSet(p.color) ? p.color : '#000'}`;
}

function setGroupPreset(name, presetId) {
  S.doc.groups ||= [];
  let g = S.doc.groups.find((x) => x.name === name);
  if (!g) { g = { name, preset: null }; S.doc.groups.push(g); }
  pushHistoryGroups();
  g.preset = presetId || null;
  changed();
}

// กลุ่มอยู่ใน doc (ไม่ใช่ fields) → เก็บสำเนาไว้ใน undo ด้วยการรวมกับ fields
function pushHistoryGroups() { pushHistory(); }

async function newGroupFrom(list) {
  const base = 'กลุ่ม';
  const used = new Set(allGroups(S.doc).map((g) => g.name));
  let i = 1; while (used.has(base + i)) i++;
  const name = await promptBox('สร้างกลุ่มใหม่', 'ชื่อกลุ่ม', base + i, 'สร้าง');
  if (!name) return null;
  S.doc.groups ||= [];
  if (!S.doc.groups.some((g) => g.name === name)) S.doc.groups.push({ name, preset: null });
  if (list?.length) mutate((x) => { x.group = name; }, list);
  else { scheduleSave(); renderPanel(); }
  return name;
}

async function renameGroup(old) {
  const name = await promptBox('เปลี่ยนชื่อกลุ่ม', 'ชื่อกลุ่ม', old, 'บันทึก');
  if (!name || name === old) return;
  pushHistory();
  for (const f of S.doc.fields) if (f.group === old) f.group = name;
  const g = (S.doc.groups || []).find((x) => x.name === old);
  if (g) g.name = name; else (S.doc.groups ||= []).push({ name, preset: null });
  changed();
}

async function deleteGroup(name) {
  const n = S.doc.fields.filter((f) => f.group === name).length;
  if (!(await confirmBox('ลบกลุ่ม?', `ช่อง ${n} ช่องในกลุ่ม “${name}” จะยังอยู่ แต่ไม่ได้ใช้สไตล์ของกลุ่มแล้ว`, 'ลบกลุ่ม', true))) return;
  pushHistory();
  for (const f of S.doc.fields) if (f.group === name) delete f.group;
  S.doc.groups = (S.doc.groups || []).filter((g) => g.name !== name);
  changed();
}

// ---------- ตัวควบคุมสไตล์ของช่อง (ใช้ทั้งเลือกช่องเดียว/หลายช่อง) ----------
function renderStyleControls(st, list) {
  const f0 = list[0];
  const rf = styled(f0);
  const by = rf._by || {};
  const lockNote = (k) => (by[k] ? `<span class="badge" title="กำหนดโดยพรีเซท">ตามพรีเซท “${esc(by[k])}”</span>` : '');
  const textual = list.some((f) => ['text', 'multiline', 'date'].includes(f.type));

  // กลุ่ม
  const groups = allGroups(S.doc);
  const same = list.every((f) => (f.group || '') === (f0.group || ''));
  const gRow = h(`<label class="f">กลุ่ม (กำหนดสไตล์ทั้งกลุ่มด้วยพรีเซท)<select class="inp">
    <option value="">— ไม่อยู่ในกลุ่ม —</option>
    ${!same ? '<option value="__mixed" selected>(หลายกลุ่ม)</option>' : ''}
    ${groups.map((g) => { const p = presetOf(S.presets, g.preset); return `<option value="${esc(g.name)}" ${same && f0.group === g.name ? 'selected' : ''}>${esc(g.name)}${p ? ` · ${esc(p.name)}` : ''}</option>`; }).join('')}
    <option value="__new">+ สร้างกลุ่มใหม่…</option></select></label>`);
  gRow.querySelector('select').onchange = async (e) => {
    const v = e.target.value;
    if (v === '__mixed') return;
    if (v === '__new') { if (!(await newGroupFrom(list))) renderPanel(); return; }
    mutate((x) => { if (v) x.group = v; else delete x.group; }, list);
  };
  st.appendChild(gRow);
  const g = same && groupOf(S.doc, f0.group);
  if (same && f0.group) {
    const pr = h(`<label class="f">พรีเซทของกลุ่ม “${esc(f0.group)}”<select class="inp"><option value="">— ไม่ใช้พรีเซท —</option>
      ${S.presets.map((p) => `<option value="${p.id}" ${g?.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`);
    pr.querySelector('select').onchange = (e) => setGroupPreset(f0.group, e.target.value);
    st.appendChild(pr);
  }

  if (textual) {
    // ฟอนต์
    const fr = h(`<label class="f"><span>ฟอนต์ ${lockNote('font')}</span><select class="inp" ${by.font ? 'disabled' : ''}>
      ${FONTS.map((x) => `<option value="${x.id}" ${rf.font === x.id ? 'selected' : ''}>${esc(x.label)} — ${esc(x.note)}</option>`).join('')}</select></label>`);
    fr.querySelector('select').onchange = (e) => {
      const id = e.target.value;
      loadFontFace(id, !!rf.bold).then(() => mutate((x) => { x.font = id; if (!hasBold(id)) x.bold = false; }, list));
    };
    st.appendChild(fr);
    // ตัวหนา
    const canBold = hasBold(rf.font);
    const br = h(`<label class="f inline" style="justify-content:space-between"><span>ตัวหนา ${lockNote('bold')}${!canBold ? ' <span class="muted">(ฟอนต์นี้ไม่มีตัวหนา)</span>' : ''}</span>
      <input type="checkbox" class="switch" ${rf.bold ? 'checked' : ''} ${by.bold || !canBold ? 'disabled' : ''}></label>`);
    br.querySelector('input').onchange = (e) => { const b = e.target.checked; loadFontFace(rf.font, b).then(() => mutate((x) => { x.bold = b; }, list)); };
    st.appendChild(br);
    // ขนาด
    const auto = !rf.fontSize;
    const fsRow = h(`<div class="f"><span>ขนาดอักษร ${lockNote('fontSize')}</span><div class="row"><label class="f inline grow"><input type="checkbox" class="switch" ${auto ? 'checked' : ''} ${by.fontSize ? 'disabled' : ''} data-a> อัตโนมัติ (พอดีช่อง)</label>
      <input class="inp num" type="number" min="4" max="72" step="0.5" style="width:80px" value="${rf.fontSize || r1(layoutText(rf, displayText(rf, valOf(f0)) || 'ก').size)}" ${auto || by.fontSize ? 'disabled' : ''} data-s></div></div>`);
    fsRow.querySelector('[data-a]').onchange = (e) => mutate((x) => { x.fontSize = e.target.checked ? 0 : +fsRow.querySelector('[data-s]').value || 12; }, list);
    liveInput(fsRow.querySelector('[data-s]'), (x, v) => { x.fontSize = clamp(+v || 12, 4, 72); }, list);
    st.appendChild(fsRow);
  }
  // สี
  const cr = h(`<div class="f"><span>สี ${lockNote('color')}</span><div class="row wrap" data-c></div></div>`);
  const cbox = cr.querySelector('[data-c]');
  const curC = (rf.color || '#000000').toLowerCase();
  for (const [c, n] of COLOR_CHOICES) {
    const b = h(`<button class="swatch ${curC === c ? 'on' : ''}" title="${n}" style="--c:${c}" ${by.color ? 'disabled' : ''}></button>`);
    b.onclick = () => mutate((x) => { x.color = c; }, list);
    cbox.appendChild(b);
  }
  const ci = h(`<input type="color" class="color-in" value="${/^#[0-9a-f]{6}$/i.test(curC) ? curC : '#000000'}" title="เลือกสีเอง" ${by.color ? 'disabled' : ''}>`);
  liveInput(ci, (x, v) => { x.color = v; }, list);
  ci.addEventListener('change', () => renderPanel()); // ปิดตัวเลือกสีแล้ว → อัปเดตปุ่มสีที่เลือก
  cbox.appendChild(ci);
  st.appendChild(cr);
  // จัดแนว (ข้อความ/ลายเซ็น)
  if (list.some((f) => f.type !== 'checkbox')) {
    const al = h(`<div class="f"><span>จัดแนวนอน ${lockNote('align')}</span></div>`);
    const seg = segRow([['left', 'ชิดซ้าย', 'aL'], ['center', 'กึ่งกลาง', 'aCH'], ['right', 'ชิดขวา', 'aR']], rf.align || 'left', (v) => mutate((x) => { x.align = v; }, list));
    if (by.align) seg.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    al.appendChild(seg);
    st.appendChild(al);
  }
  if (Object.keys(by).length) {
    const tip = h(`<div class="muted" style="font-size:12.5px">ค่าที่ขึ้นว่า “ตามพรีเซท” แก้ได้ที่พรีเซท หรือเอาช่องออกจากกลุ่ม <button class="btn sm" style="margin-left:4px">แก้พรีเซท</button></div>`);
    tip.querySelector('button').onclick = () => openPresetDialog(presetOf(S.presets, g?.preset));
    st.appendChild(tip);
  }
}

// ---------- แท็บ สไตล์ & กลุ่ม ----------
function renderStylesPanel(body) {
  const sel = selFields();
  const ps = h(`<div class="sec"><div class="row"><h3 class="grow">พรีเซท</h3><button class="btn sm" data-new>${icon('plus')}สร้างพรีเซท</button></div>
    <div class="muted" style="font-size:12.5px;line-height:1.5">ชุดสไตล์ที่ใช้ซ้ำได้ทุกเอกสาร · ค่าที่ “ไม่กำหนด” ให้แต่ละช่องตั้งเอง</div><div class="presets"></div></div>`);
  ps.querySelector('[data-new]').onclick = () => openPresetDialog(null);
  const wrap = ps.querySelector('.presets');
  for (const p of S.presets) {
    const usedBy = allGroups(S.doc).filter((g) => g.preset === p.id).map((g) => g.name);
    const it = h(`<div class="preset">
      <div class="pv" style="${swatchStyle(p)};${isSet(p.fontSize) && p.fontSize ? `font-size:${Math.min(22, p.fontSize * 1.3)}px` : ''}">${SWATCH}</div>
      <div class="pm"><b>${esc(p.name)}</b><span>${esc(presetSummary(p))}</span>${usedBy.length ? `<span class="badge">ใช้กับ: ${esc(usedBy.join(', '))}</span>` : ''}</div>
      <div class="pa">
        ${sel.length ? `<button class="btn sm" data-copy title="คัดลอกค่าลงช่องที่เลือก (ไม่ผูกกับพรีเซท)">${icon('copy')}ใส่ ${sel.length} ช่อง</button>` : ''}
        <button class="icon-btn" data-edit title="แก้ไข">${icon('pen')}</button>
        <button class="icon-btn" data-del title="ลบ">${icon('trash')}</button></div></div>`);
    it.querySelector('[data-edit]').onclick = () => openPresetDialog(p);
    it.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmBox('ลบพรีเซท?', `“${p.name}”${usedBy.length ? ` ใช้อยู่กับกลุ่ม ${usedBy.join(', ')} — กลุ่มเหล่านั้นจะไม่มีพรีเซท` : ''}`, 'ลบ', true))) return;
      S.presets = S.presets.filter((x) => x.id !== p.id);
      for (const g of S.doc.groups || []) if (g.preset === p.id) g.preset = null;
      scheduleSave(); savePresets();
    };
    it.querySelector('[data-copy]')?.addEventListener('click', () => {
      mutate((x) => { for (const k of STYLE_KEYS) if (isSet(p[k])) x[k] = p[k]; }, sel);
      toast(`ใส่สไตล์ “${p.name}” ให้ ${sel.length} ช่องแล้ว`, { type: 'ok' });
    });
    wrap.appendChild(it);
  }
  body.appendChild(ps);

  const groups = allGroups(S.doc);
  const gs = h(`<div class="sec"><div class="row"><h3 class="grow">กลุ่มในเอกสารนี้</h3>
    <button class="btn sm" data-ng>${icon('plus')}${sel.length ? `กลุ่มจาก ${sel.length} ช่องที่เลือก` : 'กลุ่มใหม่'}</button></div>
    <div class="muted" style="font-size:12.5px;line-height:1.5">จับช่องเป็นกลุ่มแล้วเลือกพรีเซท — แก้พรีเซททีเดียว ช่องทั้งกลุ่มเปลี่ยนตาม</div><div class="groups"></div></div>`);
  gs.querySelector('[data-ng]').onclick = () => newGroupFrom(sel);
  const gw = gs.querySelector('.groups');
  if (!groups.length) gw.appendChild(h('<div class="tip">ยังไม่มีกลุ่ม — เลือกช่อง (ลากครอบ / Shift+คลิก) แล้วกด “กลุ่มจากช่องที่เลือก”</div>'));
  for (const g of groups) {
    const n = S.doc.fields.filter((f) => f.group === g.name).length;
    const it = h(`<div class="group"><div class="row"><b class="grow">${esc(g.name)}</b><span class="badge">${n} ช่อง</span>
      <button class="icon-btn" data-sel title="เลือกช่องในกลุ่ม">${icon('select')}</button>
      <button class="icon-btn" data-ren title="เปลี่ยนชื่อ">${icon('pen')}</button>
      <button class="icon-btn" data-del title="ลบกลุ่ม">${icon('trash')}</button></div>
      <select class="inp"><option value="">— ไม่ใช้พรีเซท —</option>${S.presets.map((p) => `<option value="${p.id}" ${g.preset === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      ${sel.length ? `<button class="btn sm" data-add>${icon('plus')}เพิ่ม ${sel.length} ช่องที่เลือกเข้ากลุ่มนี้</button>` : ''}</div>`);
    it.querySelector('select').onchange = (e) => setGroupPreset(g.name, e.target.value);
    it.querySelector('[data-sel]').onclick = () => {
      S.sel = new Set(S.doc.fields.filter((f) => f.group === g.name).map((f) => f.id));
      renderAllFields(); renderPanel();
      const first = S.doc.fields.find((f) => f.group === g.name);
      if (first) scrollToField(first, false);
    };
    it.querySelector('[data-ren]').onclick = () => renameGroup(g.name);
    it.querySelector('[data-del]').onclick = () => deleteGroup(g.name);
    it.querySelector('[data-add]')?.addEventListener('click', () => mutate((x) => { x.group = g.name; }, sel));
    gw.appendChild(it);
  }
  body.appendChild(gs);
}

// ---------- กล่องแก้พรีเซท ----------
async function openPresetDialog(p) {
  const isNew = !p;
  const d = p ? { ...p } : { id: newPresetId(), name: 'พรีเซทใหม่', font: 'sarabun', bold: false, fontSize: null, color: '#000000', align: null };
  const tri = (v, choices) => choices.map(([val, label]) => `<button data-v="${val}" class="${String(v) === String(val) ? 'on' : ''}">${label}</button>`).join('');
  const body = h(`<div style="display:flex;flex-direction:column;gap:12px">
    <label class="f">ชื่อพรีเซท<input class="inp" data-k="name" value="${esc(d.name)}"></label>
    <label class="f">ฟอนต์<select class="inp" data-k="font"><option value="">— ไม่กำหนด —</option>
      ${FONTS.map((x) => `<option value="${x.id}" ${d.font === x.id ? 'selected' : ''}>${esc(x.label)} — ${esc(x.note)}</option>`).join('')}</select></label>
    <div class="f">ความหนา<div class="seg small" data-k="bold">${tri(isSet(d.bold) ? d.bold : '', [['', 'ไม่กำหนด'], ['false', 'ปกติ'], ['true', 'หนา']])}</div></div>
    <div class="f">ขนาดอักษร<div class="row"><div class="seg small" data-k="sizeMode">${tri(!isSet(d.fontSize) ? '' : d.fontSize ? 'fix' : 'auto', [['', 'ไม่กำหนด'], ['auto', 'อัตโนมัติ'], ['fix', 'กำหนด']])}</div>
      <input class="inp num" type="number" min="4" max="72" step="0.5" style="width:80px" data-k="size" value="${d.fontSize || 12}"> <span class="muted">pt</span></div></div>
    <div class="f">สี<div class="row wrap" data-k="colorRow"><button class="btn sm" data-none>ไม่กำหนด</button>
      ${COLOR_CHOICES.map(([c, n]) => `<button class="swatch" style="--c:${c}" data-c="${c}" title="${n}"></button>`).join('')}<input type="color" class="color-in" value="${isSet(d.color) ? d.color : '#000000'}"></div></div>
    <div class="f">จัดแนวนอน<div class="seg small" data-k="align">${tri(d.align || '', [['', 'ไม่กำหนด'], ['left', 'ซ้าย'], ['center', 'กลาง'], ['right', 'ขวา']])}</div></div>
    <div class="f">ตัวอย่าง<div class="preset-preview" data-prev>นายสมชาย ใจดี · 16 ตุลาคม 2569 · ABC 123</div></div>
  </div>`);
  const q = (s) => body.querySelector(s);
  const refresh = () => {
    q('[data-k=size]').disabled = !(isSet(d.fontSize) && d.fontSize);
    body.querySelectorAll('[data-k=colorRow] [data-c]').forEach((b) => b.classList.toggle('on', isSet(d.color) && b.dataset.c === d.color));
    q('[data-none]').classList.toggle('primary', !isSet(d.color));
    const font = d.font || 'sarabun';
    if (isSet(d.bold) && d.bold && !hasBold(font)) d.bold = false;
    q('[data-prev]').setAttribute('style', `${swatchStyle(d)};font-size:${isSet(d.fontSize) && d.fontSize ? d.fontSize * 1.6 : 20}px;text-align:${d.align || 'left'}`);
  };
  const segBind = (k, fn) => body.querySelectorAll(`[data-k=${k}] button`).forEach((b) => b.onclick = (e) => {
    e.preventDefault();
    body.querySelectorAll(`[data-k=${k}] button`).forEach((x) => x.classList.toggle('on', x === b));
    fn(b.dataset.v); refresh();
  });
  q('[data-k=name]').oninput = (e) => { d.name = e.target.value; };
  q('[data-k=font]').onchange = (e) => { d.font = e.target.value || null; refresh(); };
  segBind('bold', (v) => { d.bold = v === '' ? null : v === 'true'; });
  segBind('sizeMode', (v) => { d.fontSize = v === '' ? null : v === 'auto' ? 0 : +q('[data-k=size]').value || 12; });
  q('[data-k=size]').oninput = (e) => { d.fontSize = clamp(+e.target.value || 12, 4, 72); refresh(); };
  segBind('align', (v) => { d.align = v || null; });
  q('[data-none]').onclick = (e) => { e.preventDefault(); d.color = null; refresh(); };
  body.querySelectorAll('[data-k=colorRow] [data-c]').forEach((b) => b.onclick = (e) => { e.preventDefault(); d.color = b.dataset.c; refresh(); });
  body.querySelector('.color-in').oninput = (e) => { d.color = e.target.value; refresh(); };
  refresh();
  const v = await dialog({
    title: isNew ? 'สร้างพรีเซท' : 'แก้ไขพรีเซท', body,
    actions: [{ label: 'ยกเลิก', value: null }, { label: isNew ? 'สร้าง' : 'บันทึก', value: 'ok', primary: true }],
  });
  if (v !== 'ok') return;
  d.name = (d.name || '').trim() || 'พรีเซท';
  if (isSet(d.font)) await loadFontFace(d.font, !!d.bold).catch(() => {});
  if (isNew) S.presets.push(d); else S.presets = S.presets.map((x) => (x.id === d.id ? d : x));
  await savePresets();
  toast(isNew ? `สร้างพรีเซท “${d.name}” แล้ว` : `บันทึก “${d.name}” แล้ว — ช่องที่ใช้พรีเซทนี้เปลี่ยนตามทันที`, { type: 'ok' });
}

// ภาษาวันที่ (ไทย / EN) + รูปแบบ — ตัวอย่างในรายการคำนวณจากวันนี้จริง
function renderDateControls(st, list) {
  const f0 = list[0];
  const lang = f0.dateLang === 'en' ? 'en' : 'th';
  const mixed = list.some((x) => (x.dateLang === 'en' ? 'en' : 'th') !== lang);
  const box = h(`<div class="f"><div class="row"><span class="grow">รูปแบบวันที่${list.length > 1 ? ` <span class="badge">${list.length} ช่อง</span>` : ''}</span></div></div>`);
  const seg = segRow([['th', 'ไทย'], ['en', 'EN']], mixed ? null : lang, (v) => {
    S.lastDateLang = v;
    mutate((x) => {
      x.dateLang = v;
      // รูปแบบเดิมไม่มีในภาษาใหม่ → ใช้รูปแบบมาตรฐานของภาษานั้น
      if (!DATE_FORMATS_BY_LANG[v].some((d) => d.id === x.dateFormat)) x.dateFormat = DEFAULT_DATE_FORMAT[v];
    }, list);
  });
  box.querySelector('.row').appendChild(seg);
  const today = todayISO();
  const single = new Set(['d', 'mmmm', 'bbbb', 'yyyy']);
  const same = list.every((x) => x.dateFormat === f0.dateFormat);
  const sel = h(`<select class="inp">${!same ? '<option value="" selected>(หลายรูปแบบ)</option>' : ''}${DATE_FORMATS_BY_LANG[lang].map((d) => {
    const ex = single.has(d.id) ? d.label : formatDate(today, d.id, lang) + (/\(.*\)$/.exec(d.label)?.[0] ? ' ' + /\(.*\)$/.exec(d.label)[0] : '');
    return `<option value="${d.id}" ${same && d.id === f0.dateFormat ? 'selected' : ''}>${esc(ex)}</option>`;
  }).join('')}</select>`);
  sel.onchange = (e) => {
    if (!e.target.value) return;
    S.lastDateFormat = e.target.value;
    mutate((x) => { x.dateFormat = e.target.value; x.dateLang = lang; }, list);
  };
  box.appendChild(sel);
  st.appendChild(box);
}

// ระยะห่างจากขอบกรอบ (ใช้ตอนแตะวางช่อง / สร้างอัตโนมัติ / ขยายเต็มกรอบ)
function gapRow() {
  const r = h('<div class="f"><span>ระยะห่างจากขอบกรอบ</span></div>');
  r.appendChild(segRow([[0, 'ชิดขอบ'], [0.5, '0.5 pt'], [1, '1 pt'], [2, '2 pt']], S.edgeGap, (v) => {
    S.edgeGap = v;
    try { localStorage.setItem('pfe-edgeGap', String(v)); } catch (e) { /* ignore */ }
    renderPanel();
  }));
  return r;
}

// ขยายช่องให้เต็มกรอบที่ช่องอยู่ (กล่อง ☐/[ ]/◯ หรือช่องตาราง) ตามระยะห่างที่ตั้งไว้
async function fitToFrame(list) {
  const todo = list.filter((f) => !f.locked);
  if (!todo.length) return;
  for (const p of new Set(todo.map((f) => S.pages[f.page - 1]))) if (!p.lines) await ensureLines(p);
  let n = 0;
  pushHistory();
  for (const f of todo) {
    const p = S.pages[f.page - 1];
    const pt = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const box = findBoxIn(p.lines, pt);
    let r = null;
    if (box) r = boxRect(box, S.edgeGap);
    else { const c = findCell(p.lines, pt); if (c && c.iw > 2 && c.ih > 2 && c.iw < 600 && c.ih < 400) r = innerRect(c, S.edgeGap); }
    if (!r || r.w < 2 || r.h < 2) continue;
    f.x = r1(r.x); f.y = r1(r.y); f.w = r1(r.w); f.h = r1(r.h);
    n++;
  }
  changed();
  toast(n ? `ขยายเต็มกรอบ ${n} ช่อง${n < todo.length ? ` (อีก ${todo.length - n} ช่องไม่ได้อยู่ในกรอบ)` : ''}` : 'ช่องที่เลือกไม่ได้อยู่ในกรอบ/ช่องตาราง', { type: n ? 'ok' : '' });
}

function renderFieldList(body) {
  if (!S.doc.fields.length) {
    body.appendChild(h('<div class="tip">ยังไม่มีช่อง — เลือกเครื่องมือทางซ้ายแล้วแตะบนเอกสาร</div>'));
    return;
  }
  const byPage = new Map();
  for (const f of readingOrder(S.doc.fields)) { if (!byPage.has(f.page)) byPage.set(f.page, []); byPage.get(f.page).push(f); }
  for (const [pg, list] of byPage) {
    const sec = h(`<div class="sec"><h3>หน้า ${pg} <span class="badge">${list.length}</span></h3><div class="list"></div></div>`);
    for (const f of list) {
      const b = h(`<button class="it ${S.sel.has(f.id) ? 'on' : ''}">${icon(TYPES[f.type].icon)}<span>${esc(f.name)}</span><small>${f.locked ? '🔒 ' : ''}${TYPES[f.type].label}</small></button>`);
      b.onclick = (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) S.sel.has(f.id) ? S.sel.delete(f.id) : S.sel.add(f.id);
        else S.sel = new Set([f.id]);
        renderAllFields(); renderPanel(); scrollToField(f, false);
      };
      sec.querySelector('.list').appendChild(b);
    }
    body.appendChild(sec);
  }
}

// ---------- แผงโหมดกรอก ----------
function renderFillPanel(body) {
  body.appendChild(tabs([['fields', 'กรอกแบบรายการ'], ['data', 'ข้อมูลจากตาราง']], S.fillTab, (t) => { S.fillTab = t; renderPanel(); }));
  if (S.fillTab === 'data') return renderDataPanel(body);
  const u = uniqueFields();
  if (!u.length) {
    body.appendChild(h('<div class="tip">ยังไม่มีช่องให้กรอก — สลับไป “ออกแบบช่อง” เพื่อวางช่องก่อน</div>'));
    return;
  }
  body.appendChild(h(`<div class="sec"><div class="row"><span id="fillProgressText" class="grow muted" style="font-size:13px"></span>
    <button class="btn sm" data-today>${icon('date')}วันนี้ทุกช่องวันที่</button></div><div class="progress" id="fillProgress"><i></i></div></div>`));
  body.querySelector('[data-today]').onclick = () => {
    for (const f of uniqueFields()) if (f.type === 'date' && !valOf(f)) setValue(f.name, todayISO());
    renderPanel();
  };
  const list = h('<div class="sec"></div>');
  for (const f of u) list.appendChild(fillItem(f));
  body.appendChild(list);
  const foot = h(`<div class="sec"><button class="btn sm danger">${icon('trash')}ล้างค่าที่กรอกทั้งหมด</button></div>`);
  foot.querySelector('button').onclick = async () => {
    if (!(await confirmBox('ล้างค่าทั้งหมด?', 'ค่าที่กรอกในเอกสารนี้จะถูกลบ (ช่องที่วางไว้ยังอยู่)', 'ล้างค่า', true))) return;
    S.doc.values = {};
    renderAllFields(); renderPanel(); scheduleSave();
  };
  body.appendChild(foot);
  updateProgress();
  markActiveItem();
}

function fillItem(f) {
  const v = valOf(f);
  const it = h(`<div class="fill-item" data-name="${esc(f.name)}"><div class="lbl">${icon(TYPES[f.type].icon)}<span>${esc(f.name)}</span>${f.required ? '<span class="req">*</span>' : ''}</div></div>`);
  let ctl;
  if (f.type === 'checkbox') {
    ctl = h(`<label class="f inline"><input type="checkbox" class="switch" data-ctl ${truthy(v) ? 'checked' : ''}> <span>ติ๊ก</span></label>`);
    ctl.querySelector('input').onchange = (e) => setValue(f.name, e.target.checked ? '1' : '', 'list');
  } else if (f.type === 'signature') {
    ctl = h(`<div class="row"><div class="sig-prev grow">${v ? `<img src="${v}" alt="">` : '<span class="muted">ยังไม่ได้เซ็น</span>'}</div><button class="btn sm" data-ctl>${icon('signature')}เซ็น</button></div>`);
    ctl.querySelector('button').onclick = () => editField(f);
  } else if (f.type === 'date') {
    ctl = h(`<div class="row"><input class="inp" type="date" data-ctl value="${isISO(v) ? v : ''}" style="width:auto"><span class="muted grow" data-dprev style="font-size:13px">${v ? esc(formatDate(v, f.dateFormat, f.dateLang)) : ''}</span></div>`);
    ctl.querySelector('input').oninput = (e) => { setValue(f.name, e.target.value, 'list'); ctl.querySelector('[data-dprev]').textContent = e.target.value ? formatDate(e.target.value, f.dateFormat, f.dateLang) : ''; };
  } else if (f.type === 'multiline') {
    ctl = h(`<textarea class="inp" data-ctl rows="3">${esc(v)}</textarea>`);
    ctl.oninput = (e) => setValue(f.name, e.target.value, 'list');
  } else {
    ctl = h(`<input class="inp" data-ctl value="${esc(v)}">`);
    ctl.oninput = (e) => setValue(f.name, e.target.value, 'list');
    ctl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        const items = $$('.fill-item [data-ctl]');
        const i = items.indexOf(ctl);
        items[i + 1]?.focus();
      }
    };
  }
  const c = ctl.matches('[data-ctl]') ? ctl : ctl.querySelector('[data-ctl]');
  c.addEventListener('focus', () => { S.activeName = f.name; markActiveItem(); if (!isSmall()) scrollToField(f); });
  it.appendChild(ctl);
  return it;
}

// ---------- ข้อมูลจากตาราง (Google Sheets / CSV) ----------
function renderDataPanel(body) {
  const m = S.doc.merge;
  if (!m?.rows?.length) {
    const sec = h(`<div class="sec">
      <div class="tip">กรอกหลายชุดอัตโนมัติจากข้อมูลในตาราง เช่น รายชื่อผู้ป่วย/พนักงาน — <b>แถวแรกต้องเป็นหัวคอลัมน์</b> และตั้งชื่อช่องให้ตรงกับหัวคอลัมน์ (หรือจับคู่เองทีหลัง)</div>
      <button class="btn" data-a="paste">${icon('paste')}วางข้อมูลจาก Google Sheets / Excel</button>
      <button class="btn" data-a="csv">${icon('file')}เปิดไฟล์ CSV</button>
      <button class="btn" data-a="link">${icon('link')}ใช้ลิงก์ Google Sheet (ต้องออนไลน์)</button></div>`);
    sec.querySelector('[data-a=paste]').onclick = pasteDataDialog;
    sec.querySelector('[data-a=csv]').onclick = () => $('#csvInput').click();
    sec.querySelector('[data-a=link]').onclick = sheetLinkDialog;
    body.appendChild(sec);
    return;
  }
  const names = uniqueFields().map((f) => f.name);
  m.map = autoMap(names, m.headers, m.map || {});
  const n = m.rows.length;
  S.recIndex = clamp(S.recIndex || 0, 0, n - 1);
  const labelCol = m.headers[0];
  const info = h(`<div class="sec">
    <div class="row"><b class="grow">${n} แถว · ${m.headers.length} คอลัมน์</b><button class="btn sm" data-a="change">เปลี่ยน</button><button class="icon-btn" data-a="clear" title="ล้างข้อมูล">${icon('trash')}</button></div>
    <div class="muted" style="font-size:12.5px">${esc(m.source || '')}</div>
    <div class="recnav"><button class="icon-btn" data-a="prev">${icon('left')}</button>
      <select class="inp pos">${m.rows.map((r, i) => `<option value="${i}" ${i === S.recIndex ? 'selected' : ''}>${i + 1}. ${esc(String(r[labelCol] ?? '').slice(0, 40))}</option>`).join('')}</select>
      <button class="icon-btn" data-a="next">${icon('right')}</button></div>
    <button class="btn primary" data-a="exportAll">${icon('download')}สร้าง PDF ทุกแถว (${n} ชุด)</button>
  </div>`);
  info.querySelector('[data-a=change]').onclick = (e) => popMenu(e.currentTarget, [
    { icon: 'paste', label: 'วางข้อมูลใหม่', onClick: pasteDataDialog },
    { icon: 'file', label: 'เปิดไฟล์ CSV', onClick: () => $('#csvInput').click() },
    { icon: 'link', label: 'ลิงก์ Google Sheet', onClick: sheetLinkDialog },
  ]);
  info.querySelector('[data-a=clear]').onclick = () => { S.doc.merge = null; scheduleSave(); renderPanel(); };
  info.querySelector('[data-a=prev]').onclick = () => applyRecord(S.recIndex - 1);
  info.querySelector('[data-a=next]').onclick = () => applyRecord(S.recIndex + 1);
  info.querySelector('select').onchange = (e) => applyRecord(+e.target.value);
  info.querySelector('[data-a=exportAll]').onclick = () => openExportDialog('batch');
  body.appendChild(info);

  const mapped = names.filter((nm) => m.map[nm]).length;
  const mp = h(`<div class="sec"><h3>จับคู่ช่อง ↔ คอลัมน์ <span class="badge">${mapped}/${names.length}</span></h3><div class="maptable"></div></div>`);
  const grid = mp.querySelector('.maptable');
  for (const nm of names) {
    grid.appendChild(h(`<div class="nm" title="${esc(nm)}">${esc(nm)}</div>`));
    const sel = h(`<select class="inp"><option value="">— ไม่ใช้ —</option>${m.headers.map((hd) => `<option ${m.map[nm] === hd ? 'selected' : ''}>${esc(hd)}</option>`).join('')}</select>`);
    sel.onchange = () => { m.map[nm] = sel.value; scheduleSave(); applyRecord(S.recIndex); };
    grid.appendChild(sel);
  }
  body.appendChild(mp);
}

function valuesFromRow(row, map, base = {}) {
  const out = { ...base };
  for (const f of uniqueFields()) {
    const col = map[f.name];
    if (!col) continue;
    const raw = row[col] ?? '';
    if (f.type === 'checkbox') out[f.name] = truthy(raw) ? '1' : '';
    else if (f.type === 'date') out[f.name] = parseDateLoose(raw) || raw;
    else if (f.type === 'signature') out[f.name] = /^data:image\//.test(raw) ? raw : '';
    else out[f.name] = raw;
  }
  return out;
}

function applyRecord(i) {
  const m = S.doc.merge;
  if (!m?.rows?.length) return;
  S.recIndex = clamp(i, 0, m.rows.length - 1);
  S.doc.values = valuesFromRow(m.rows[S.recIndex], m.map, S.doc.values);
  renderAllFields(); renderPanel(); scheduleSave();
}

function loadMergeText(text, source) {
  const { headers, rows } = parseDelimited(text);
  if (!headers.length || !rows.length) { toast('ไม่พบข้อมูล — ต้องมีแถวหัวคอลัมน์และข้อมูลอย่างน้อย 1 แถว', { type: 'err' }); return; }
  S.doc.merge = { headers, rows, map: autoMap(uniqueFields().map((f) => f.name), headers, S.doc.merge?.map || {}), source };
  S.fillTab = 'data';
  if (S.mode !== 'fill') setMode('fill');
  applyRecord(0);
  const mapped = Object.values(S.doc.merge.map).filter(Boolean).length;
  toast(`โหลด ${rows.length} แถว · จับคู่อัตโนมัติ ${mapped} ช่อง`, { type: 'ok' });
}

async function pasteDataDialog() {
  const body = h(`<div style="display:flex;flex-direction:column;gap:10px">
    <div class="tip">ใน Google Sheets/Excel ให้<b>เลือกเซลล์ทั้งหมดรวมแถวหัวตาราง</b> → คัดลอก (Ctrl+C) → วางในช่องด้านล่าง (Ctrl+V)</div>
    <textarea class="inp" rows="9" placeholder="วางข้อมูลที่นี่…" style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre"></textarea></div>`);
  const v = await dialog({ title: 'วางข้อมูลจากตาราง', body, wide: true, actions: [{ label: 'ยกเลิก', value: null }, { label: 'ใช้ข้อมูลนี้', value: 'ok', primary: true }] });
  if (v === 'ok') loadMergeText(body.querySelector('textarea').value, 'วางจากคลิปบอร์ด · ' + fmtStamp(Date.now()));
}

async function sheetLinkDialog() {
  const body = h(`<div style="display:flex;flex-direction:column;gap:10px">
    <div class="tip">เปิด Google Sheet → แชร์ → <b>ทุกคนที่มีลิงก์ (ผู้มีสิทธิ์อ่าน)</b> → คัดลอกลิงก์ของแท็บที่ต้องการมาวาง<br>ข้อมูลจะถูกดึงมาเก็บในเครื่อง ใช้งานต่อแบบออฟไลน์ได้</div>
    <input class="inp" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(S.doc.merge?.url || '')}"></div>`);
  const v = await dialog({ title: 'ดึงข้อมูลจาก Google Sheet', body, actions: [{ label: 'ยกเลิก', value: null }, { label: 'ดึงข้อมูล', value: 'ok', primary: true }] });
  if (v !== 'ok') return;
  const url = body.querySelector('input').value.trim();
  const b = busy('กำลังดึงข้อมูลจาก Google Sheet…');
  try {
    const text = await fetchGoogleSheet(url);
    loadMergeText(text, 'Google Sheet · ' + fmtStamp(Date.now()));
    if (S.doc.merge) { S.doc.merge.url = url; scheduleSave(); }
  } catch (e) { toast(e.message, { type: 'err', ms: 7000 }); } finally { b.close(); }
}

// ======================================================================
// ส่งออก
// ======================================================================
const safeName = (s) => String(s || 'เอกสาร').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || 'เอกสาร';

async function openExportDialog(preset) {
  if (!S.doc) return;
  closeEditor();
  const m = S.doc.merge;
  const hasData = !!m?.rows?.length;
  const missing = uniqueFields().filter((f) => f.required && isEmptyVal(f, valOf(f))).map((f) => f.name);
  const body = h(`<div style="display:flex;flex-direction:column;gap:10px">
    <label class="opt"><input type="radio" name="em" value="flat" ${preset !== 'batch' ? 'checked' : ''}><div><b>PDF ที่กรอกแล้ว</b><span>ข้อความ/ลายเซ็นฝังลงในหน้า พร้อมพิมพ์หรือส่งต่อ (ภาษาไทยแสดงถูกต้องทุกโปรแกรม)</span></div></label>
    <label class="opt"><input type="radio" name="em" value="form"><div><b>PDF ฟอร์มกรอกได้</b><span>ได้ช่องฟอร์มจริง ส่งให้คนอื่นกรอกต่อใน Acrobat / Chrome / Edge ได้</span>
      <label class="f inline" style="margin-top:6px"><input type="checkbox" data-incl style="accent-color:var(--accent)"> ใส่ค่าที่กรอกไว้ด้วย</label></div></label>
    ${hasData ? `<label class="opt"><input type="radio" name="em" value="batch" ${preset === 'batch' ? 'checked' : ''}><div><b>ทุกแถวจากข้อมูล (${m.rows.length} ชุด)</b><span>สร้าง PDF ที่กรอกแล้วให้ทุกแถวของตาราง</span>
      <div class="row wrap" style="margin-top:8px"><div class="seg small" data-bm><button class="on" data-v="one">ไฟล์เดียว</button><button data-v="zip">ZIP แยกไฟล์</button></div>
      <label class="f inline">ชื่อไฟล์จาก<select class="inp" style="width:auto;height:32px" data-col><option value="">ลำดับแถว</option>${m.headers.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label></div></div></label>` : ''}
    ${missing.length ? `<div class="tip" style="color:var(--danger)">ยังไม่ได้กรอกช่องที่ต้องกรอก: ${esc(missing.slice(0, 6).join(', '))}${missing.length > 6 ? ' …' : ''}</div>` : ''}
  </div>`);
  let bm = 'one';
  body.querySelectorAll('[data-bm] button').forEach((b) => b.onclick = (e) => {
    e.preventDefault();
    bm = b.dataset.v;
    body.querySelectorAll('[data-bm] button').forEach((x) => x.classList.toggle('on', x === b));
  });
  const get = () => ({
    mode: body.querySelector('input[name=em]:checked').value,
    incl: body.querySelector('[data-incl]').checked,
    col: body.querySelector('[data-col]')?.value || '',
  });
  await dialog({
    title: 'ส่งออก PDF',
    body,
    actions: [
      { label: 'ยกเลิก', value: null },
      { label: 'ดูตัวอย่าง', value: 'preview', handler: async () => { await runExport(get(), bm, true); return false; } },
      { label: 'ดาวน์โหลด', value: 'dl', primary: true, handler: async () => { await runExport(get(), bm, false); } },
    ],
  });
}

async function runExport(opt, bm, preview) {
  const name = safeName(S.doc.name);
  const base = { pdfBytes: S.bytes, pages: S.pages, fields: S.doc.fields.map(styled), removeNames: S.doc.importedNames || [] };
  const b = busy('กำลังสร้าง PDF…');
  try {
    let bytes, fname;
    if (opt.mode === 'batch') {
      const m = S.doc.merge;
      const rows = preview ? m.rows.slice(0, 3) : m.rows;
      const outs = [];
      for (let i = 0; i < rows.length; i++) {
        b.set(`กำลังสร้าง ${i + 1} / ${rows.length}…`);
        const vals = valuesFromRow(rows[i], m.map, {});
        outs.push({ bytes: await buildPdf({ ...base, values: vals, mode: 'flat' }), label: opt.col ? rows[i][opt.col] : String(i + 1).padStart(3, '0') });
        await new Promise((r) => setTimeout(r));
      }
      if (bm === 'zip' && !preview) {
        const files = {};
        const used = new Set();
        for (const o of outs) {
          let fn = safeName(`${name}_${o.label || ''}`);
          let k = 2; while (used.has(fn)) fn = safeName(`${name}_${o.label}_${k++}`);
          used.add(fn);
          files[fn + '.pdf'] = o.bytes;
        }
        b.set('กำลังรวมเป็น ZIP…');
        download(window.fflate.zipSync(files, { level: 0 }), `${name}_${outs.length}ชุด.zip`, 'application/zip');
        toast(`ดาวน์โหลด ZIP ${outs.length} ไฟล์แล้ว`, { type: 'ok' });
        return;
      }
      b.set('กำลังรวมไฟล์…');
      bytes = await concatPdfs(outs.map((o) => o.bytes));
      fname = `${name}_${outs.length}ชุด.pdf`;
    } else if (opt.mode === 'form') {
      bytes = await buildPdf({ ...base, values: S.doc.values, mode: 'form', includeValues: opt.incl });
      fname = `${name}_ฟอร์ม.pdf`;
    } else {
      bytes = await buildPdf({ ...base, values: S.doc.values, mode: 'flat' });
      fname = `${name}_กรอกแล้ว.pdf`;
    }
    if (preview) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const w = window.open(url, '_blank');
      if (!w) toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — กด “ดาวน์โหลด” แทน', { type: 'err' });
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } else {
      download(bytes, fname);
      toast('ดาวน์โหลดแล้ว: ' + fname, { type: 'ok' });
    }
  } catch (e) {
    console.error(e);
    toast('สร้าง PDF ไม่สำเร็จ: ' + (e.message || e), { type: 'err', ms: 7000 });
  } finally { b.close(); }
}

// ======================================================================
// แม่แบบ, นำเข้าช่องเดิม, คัดลอกจากงานอื่น
// ======================================================================
function exportTemplate() {
  const groups = allGroups(S.doc);
  const presets = S.presets.filter((p) => groups.some((g) => g.preset === p.id));
  const data = { app: 'pdf-form-easy', version: 2, name: S.doc.name, pages: S.doc.pages, fields: S.doc.fields, groups, presets };
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), `${safeName(S.doc.name)}.แม่แบบ.json`);
}

async function importTemplate(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.fields)) throw new Error('ไม่ใช่ไฟล์แม่แบบ');
    // พรีเซทในแม่แบบที่เครื่องนี้ยังไม่มี → เพิ่มเข้าคลัง
    const add = (data.presets || []).filter((p) => p?.id && !S.presets.some((x) => x.id === p.id));
    if (add.length) { S.presets.push(...add); savePresets(); }
    await applyFields(data.fields, data.name || file.name, data.groups);
  } catch (e) { toast('เปิดแม่แบบไม่ได้: ' + e.message, { type: 'err' }); }
}

async function applyFields(fields, from, groups = []) {
  let mode = 'replace';
  if (S.doc.fields.length) {
    const v = await dialog({
      title: 'ใช้ช่องจาก “' + from + '”',
      body: `<p style="margin:0">เอกสารนี้มี ${S.doc.fields.length} ช่องอยู่แล้ว</p>`,
      actions: [{ label: 'ยกเลิก', value: null }, { label: 'เพิ่มต่อท้าย', value: 'append' }, { label: 'แทนที่ทั้งหมด', value: 'replace', primary: true }],
    });
    if (!v) return;
    mode = v;
  }
  pushHistory();
  const incoming = fields.filter((f) => f.page >= 1 && f.page <= S.pages.length).map((f) => {
    const p = S.pages[f.page - 1];
    return { ...f, id: uid(), x: clamp(f.x, 0, p.w - 3), y: clamp(f.y, 0, p.h - 3) };
  });
  S.doc.fields = mode === 'append' ? [...S.doc.fields, ...incoming] : incoming;
  S.doc.groups ||= [];
  for (const g of groups || []) if (g?.name && !S.doc.groups.some((x) => x.name === g.name)) S.doc.groups.push({ name: g.name, preset: g.preset || null });
  S.sel.clear();
  setMode('design');
  changed();
  toast(`ใส่ ${incoming.length} ช่องแล้ว`, { type: 'ok' });
}

async function existingWidgets() {
  const out = [];
  for (const p of S.pages) {
    let anns = [];
    try { anns = await p.page.getAnnotations(); } catch (e) { continue; }
    const vp = p.page.getViewport({ scale: 1 });
    for (const a of anns) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.hidden) continue;
      let type = null;
      if (a.fieldType === 'Tx') type = a.multiLine ? 'multiline' : 'text';
      else if (a.fieldType === 'Btn' && (a.checkBox || a.radioButton)) type = 'checkbox';
      else if (a.fieldType === 'Sig') type = 'signature';
      else if (a.fieldType === 'Ch') type = 'text';
      if (!type) continue;
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      out.push({
        type, page: p.num, x: r1(Math.min(x1, x2)), y: r1(Math.min(y1, y2)), w: r1(Math.abs(x2 - x1)), h: r1(Math.abs(y2 - y1)),
        name: a.fieldName, value: type === 'checkbox' ? (a.fieldValue && a.fieldValue !== 'Off' ? '1' : '') : (typeof a.fieldValue === 'string' ? a.fieldValue : ''),
        align: a.textAlignment === 1 ? 'center' : a.textAlignment === 2 ? 'right' : 'left',
      });
    }
  }
  return out;
}

async function importExistingFields() {
  const ws = await existingWidgets();
  if (!ws.length) { toast('ไฟล์นี้ไม่มีช่องฟอร์มเดิม'); return; }
  pushHistory();
  const names = new Set();
  for (const w of ws) {
    const p = S.pages[w.page - 1];
    const f = newField(p, w.type, w);
    f.name = w.name; f.align = w.type === 'checkbox' ? 'center' : w.align;
    S.doc.fields.push(f);
    names.add(w.name);
    if (w.value && S.doc.values[w.name] === undefined) S.doc.values[w.name] = w.value;
  }
  S.doc.importedNames = [...new Set([...(S.doc.importedNames || []), ...names])];
  changed();
  toast(`นำเข้า ${ws.length} ช่องจากไฟล์ — แก้ไข/ย้ายได้ทันที`, { type: 'ok' });
}

async function similarDocs() {
  const all = await Store.listDocs();
  const pg = S.doc.pages?.[0];
  return all.filter((d) => d.id !== S.doc.id && d.fields?.length && d.pages?.[0] && Math.abs(d.pages[0].w - pg.w) < 3 && Math.abs(d.pages[0].h - pg.h) < 3);
}

async function suggestFieldSources() {
  if (!S.doc || S.doc.fields.length) return;
  const ws = await existingWidgets();
  if (ws.length) {
    toast(`ไฟล์นี้มีช่องฟอร์มเดิม ${ws.length} ช่อง`, { action: 'นำเข้ามาแก้', onAction: importExistingFields, ms: 12000 });
    return;
  }
  const sims = await similarDocs();
  const best = sims.find((d) => d.name === S.doc.name) || sims[0];
  if (best) toast(`พบงานเดิมที่ขนาดหน้าเท่ากัน: “${best.name}” (${best.fields.length} ช่อง)`, { action: 'ใช้ช่องเดิม', onAction: () => applyFields(best.fields, best.name, best.groups), ms: 12000 });
}

async function copyFromOtherDialog() {
  const all = (await Store.listDocs()).filter((d) => d.id !== S.doc.id && d.fields?.length);
  if (!all.length) { toast('ยังไม่มีงานอื่นที่มีช่อง'); return; }
  const sims = new Set((await similarDocs()).map((d) => d.id));
  const body = h('<div class="list"></div>');
  const v = await dialog({
    title: 'ใช้ช่องจากงานอื่น',
    body,
    onOpen: ({ close }) => {
      for (const d of all) {
        const b = h(`<button class="it">${icon('file')}<span>${esc(d.name)}</span><small>${d.fields.length} ช่อง${sims.has(d.id) ? ' · ขนาดตรงกัน' : ''}</small></button>`);
        b.onclick = () => close(d.id);
        body.appendChild(b);
      }
    },
    actions: [{ label: 'ยกเลิก', value: null }],
  });
  const d = all.find((x) => x.id === v);
  if (d) applyFields(d.fields, d.name, d.groups);
}

function showHelp() {
  dialog({
    title: 'วิธีใช้',
    wide: true,
    body: `<div class="tip"><b>1. ออกแบบช่อง</b> — เลือกเครื่องมือ แล้วแตะบนเส้นจุดไข่ปลา/ในช่องตาราง/ในกล่อง ☐ ระบบจะวางช่องให้พอดีเอง หรือลากเป็นกรอบ<br>
      ใช้ “ตาราง” ลากครอบตารางเพื่อสร้างช่องทุกเซลล์ · ช่องที่ชื่อเหมือนกันใช้ค่าร่วมกัน</div>
      <div class="tip"><b>2. กรอกข้อมูล</b> — แตะช่องบนหน้าเอกสาร หรือกรอกจาก “กรอกแบบรายการ” (สะดวกบนมือถือ) · Enter/Tab ไปช่องถัดไป</div>
      <div class="tip"><b>3. กรอกหลายชุดจาก Google Sheets</b> — แท็บ “ข้อมูลจากตาราง” → วางข้อมูล/ลิงก์ชีต → จับคู่คอลัมน์ → สร้าง PDF ทุกแถว (ไฟล์เดียวหรือ ZIP)</div>
      <div class="tip"><b>4. ส่งออก</b> — PDF ที่กรอกแล้ว (ฝังข้อความ) หรือ PDF ฟอร์มกรอกได้สำหรับส่งต่อ</div>
      <div class="tip"><b>เก็บข้อมูลที่ไหน?</b> ทุกอย่างอยู่ในเบราว์เซอร์เครื่องนี้ (ไม่อัปโหลด) · สำรอง/ย้ายเครื่องด้วย “บันทึกแม่แบบ (.json)”</div>`,
  });
}

// ======================================================================
// เริ่มต้นแอป
// ======================================================================
function bindUI() {
  hydrateIcons();
  $('#fileInput').onchange = (e) => { openFile(e.target.files[0]); e.target.value = ''; };
  $('#jsonInput').onchange = (e) => { if (e.target.files[0]) importTemplate(e.target.files[0]); e.target.value = ''; };
  $('#csvInput').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let text = await f.text();
    if (text.includes('�')) { try { text = new TextDecoder('windows-874').decode(await f.arrayBuffer()); } catch (er) { /* keep */ } }
    loadMergeText(text, 'ไฟล์ ' + f.name);
  };
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => {
    const f = [...(e.dataTransfer?.files || [])];
    const pdf = f.find((x) => /pdf$/i.test(x.type) || /\.pdf$/i.test(x.name));
    const json = f.find((x) => /\.json$/i.test(x.name));
    const csv = f.find((x) => /\.(csv|tsv)$/i.test(x.name));
    if (pdf) openFile(pdf);
    else if (json && S.doc) importTemplate(json);
    else if (csv && S.doc) { $('#csvInput').files = e.dataTransfer.files; $('#csvInput').dispatchEvent(new Event('change')); }
  });

  $('#btnHome').onclick = showHome;
  $('#docName').onchange = (e) => { if (!S.doc) return; S.doc.name = e.target.value.trim() || S.doc.name; e.target.value = S.doc.name; scheduleSave(); };
  $$('#modeSeg button').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnZoomIn').onclick = () => setZoom(S.zoom * 1.2);
  $('#btnZoomOut').onclick = () => setZoom(S.zoom / 1.2);
  $('#zoomLabel').onclick = fitWidth;
  $('#btnExport').onclick = () => openExportDialog();
  $('#btnMore').onclick = (e) => popMenu(e.currentTarget, [
    { icon: 'file', label: 'เปิดไฟล์ PDF อื่น', onClick: () => $('#fileInput').click() },
    { icon: 'undo', label: 'ย้อนกลับ', onClick: undo },
    { icon: 'redo', label: 'ทำซ้ำ', onClick: redo },
    '-',
    { icon: 'copy', label: 'ใช้ช่องจากงานอื่น…', onClick: copyFromOtherDialog },
    { icon: 'wand', label: 'นำเข้าช่องฟอร์มเดิมในไฟล์ PDF', onClick: importExistingFields },
    { icon: 'save', label: 'บันทึกแม่แบบ (.json)', onClick: exportTemplate },
    { icon: 'upload', label: 'เปิดแม่แบบ (.json)', onClick: () => $('#jsonInput').click() },
    '-',
    { icon: 'eye', label: S.showLines ? 'ซ่อนเส้นที่ตรวจพบ' : 'แสดงเส้นที่ตรวจพบ', onClick: () => { S.showLines = !S.showLines; S.pages.forEach(drawLines); renderPanel(); } },
    { icon: 'info', label: 'วิธีใช้', onClick: showHelp },
  ]);
  $('#fabPanel').onclick = () => document.body.classList.add('sheet-open');
  $('#sheetGrip').onclick = () => document.body.classList.remove('sheet-open');
  $('#viewer').addEventListener('pointerdown', () => { if (isSmall() && !S.editor) document.body.classList.remove('sheet-open'); });

  // ซูมด้วย Ctrl+ล้อเมาส์ / ทัชแพด
  $('#viewer').addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = $('#viewer').getBoundingClientRect();
    setZoom(S.zoom * Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });

  // บีบนิ้วซูม (มือถือ/แท็บเล็ต)
  let pinch = null;
  const v = $('#viewer');
  v.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: S.zoom };
    }
  }, { passive: true });
  v.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const r = v.getBoundingClientRect();
    setZoom(pinch.z * (d / pinch.d), { x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top });
  }, { passive: false });
  v.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; });

  document.addEventListener('keydown', onKey);
  document.addEventListener('paste', (e) => {
    if (!S.doc || S.mode !== 'fill' || S.fillTab !== 'data' || isTyping(e.target)) return;
    const t = e.clipboardData?.getData('text');
    if (t && t.includes('\t')) { e.preventDefault(); loadMergeText(t, 'วางจากคลิปบอร์ด · ' + fmtStamp(Date.now())); }
  });
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('resize', () => { if (S.editor) positionEditor(); });
}

const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function onKey(e) {
  if (!S.doc || document.querySelector('.backdrop')) return;
  if (isTyping(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); flushSave().then(() => toast('บันทึกในเครื่องแล้ว', { type: 'ok' })); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom(S.zoom * 1.2); return; }
  if (mod && k === '-') { e.preventDefault(); setZoom(S.zoom / 1.2); return; }
  if (mod && k === '0') { e.preventDefault(); fitWidth(); return; }
  if (S.mode !== 'design') return;
  if (mod && k === 'c') { copySel(); return; }
  if (mod && k === 'v') { e.preventDefault(); pasteClip(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(true); return; }
  if (mod && k === 'a') { e.preventDefault(); S.sel = new Set(S.doc.fields.map((f) => f.id)); renderAllFields(); renderPanel(); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSel(); return; }
  if (k === 'escape') { if (S.sel.size) { S.sel.clear(); renderAllFields(); renderPanel(); } else setTool('select'); return; }
  const step = e.shiftKey ? 10 : e.altKey ? 0.2 : 1;
  if (k.startsWith('arrow') && S.sel.size) {
    e.preventDefault();
    nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
    return;
  }
  if (!mod && !e.altKey) {
    const t = TOOLS.find((x) => x !== '-' && x.key === k);
    if (t) setTool(t.id);
  }
}

bindUI();
Store.get('presets').then((p) => { if (Array.isArray(p) && p.length) { S.presets = p; if (S.doc) { renderAllFields(); renderPanel(); } } }).catch(() => {});
// ฟอนต์โหลดเสร็จ → วาดช่องใหม่ด้วยฟอนต์จริง
let fontRedraw = null;
onFontLoaded(() => { clearTimeout(fontRedraw); fontRedraw = setTimeout(() => { if (S.doc) { renderAllFields(); if (S.editor) positionEditor(); } }, 30); });
renderRecent();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
}
