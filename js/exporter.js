// สร้าง PDF: ฝังค่า (flatten) หรือสร้างช่องฟอร์มกรอกได้จริง (AcroForm)
// ภาษาไทย: จัดรูปด้วย fontkit แล้ววางทีละ glyph พร้อม offset ของสระ/วรรณยุกต์ (pdf-lib ปกติทิ้งค่านี้ → ไทยเพี้ยน)
import { layoutText } from './textlayout.js';
import { loadFont } from './fonts.js';
import { formatDate } from './thai.js';
import { truthy } from './merge.js';

const L = () => window.PDFLib;

const inv = ([a, b, c, d, e, f]) => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

function hexColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function displayText(f, v) {
  if (f.type === 'date') return formatDate(v, f.dateFormat, f.dateLang);
  return v ?? '';
}

function glyphOps(fontKey, text, x, y, size, fk) {
  const P = L();
  const run = fk.layout(text);
  const s = size / fk.unitsPerEm;
  const ops = [P.setFontAndSize(fontKey, size)];
  let cx = x;
  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i], p = run.positions[i];
    ops.push(
      P.setTextMatrix(1, 0, 0, -1, cx + p.xOffset * s, y - p.yOffset * s),
      P.showText(P.PDFHexString.of(g.id.toString(16).padStart(4, '0'))),
    );
    cx += p.xAdvance * s;
  }
  return ops;
}

function checkOps(f) {
  const P = L();
  const side = Math.min(f.w, f.h);
  const x = f.x + (f.w - side) / 2, y = f.y + (f.h - side) / 2;
  const [r, g, b] = hexColor(f.color);
  const ops = [P.setStrokingRgbColor(r, g, b), P.setFillingRgbColor(r, g, b), P.setLineWidth(Math.max(0.6, side * 0.12)),
    P.setLineCap(P.LineCapStyle.Round), P.setLineJoin(P.LineJoinStyle.Round)];
  const st = f.checkStyle || 'check';
  if (st === 'cross') {
    ops.push(P.moveTo(x + side * 0.22, y + side * 0.22), P.lineTo(x + side * 0.78, y + side * 0.78),
      P.moveTo(x + side * 0.78, y + side * 0.22), P.lineTo(x + side * 0.22, y + side * 0.78), P.stroke());
  } else if (st === 'dot') {
    const cx = x + side / 2, cy = y + side / 2, rr = side * 0.25, k = rr * 0.5523;
    ops.push(P.moveTo(cx + rr, cy),
      P.appendBezierCurve(cx + rr, cy + k, cx + k, cy + rr, cx, cy + rr),
      P.appendBezierCurve(cx - k, cy + rr, cx - rr, cy + k, cx - rr, cy),
      P.appendBezierCurve(cx - rr, cy - k, cx - k, cy - rr, cx, cy - rr),
      P.appendBezierCurve(cx + k, cy - rr, cx + rr, cy - k, cx + rr, cy), P.fill());
  } else {
    ops.push(P.moveTo(x + side * 0.2, y + side * 0.55), P.lineTo(x + side * 0.42, y + side * 0.78),
      P.lineTo(x + side * 0.82, y + side * 0.24), P.stroke());
  }
  return ops;
}

function dataUrlBytes(url) {
  const b64 = url.split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function embedImage(doc, cache, url) {
  if (cache.has(url)) return cache.get(url);
  const bytes = dataUrlBytes(url);
  const img = /^data:image\/jpe?g/i.test(url) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  cache.set(url, img);
  return img;
}

// ห่อเนื้อหาเดิมของหน้าด้วย q/Q เผื่อไฟล์ต้นฉบับทิ้งสถานะกราฟิกค้างไว้
function wrapOriginal(doc, page) {
  const P = L();
  page.node.normalize();
  page.getContentStream();
  const s = doc.context.register(doc.context.contentStream([P.pushGraphicsState()]));
  const e = doc.context.register(doc.context.contentStream([P.popGraphicsState()]));
  page.node.wrapContentStreams(s, e);
}

/**
 * opts: { pdfBytes, pages:[{transform}], fields, values, mode: 'flat'|'form', includeValues, removeNames:[] }
 */
export async function buildPdf({ pdfBytes, pages, fields, values, mode = 'flat', includeValues = true, removeNames = [] }) {
  const P = L();
  const doc = await P.PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  doc.registerFontkit(window.fontkit);
  // ฝังเฉพาะฟอนต์ที่ใช้จริง (แยกตัวปกติ/ตัวหนา) — subset:false เพื่อให้ glyph id ตรงกับที่ fontkit จัดรูปไว้
  const pdfFonts = new Map();
  const fontFor = async (f) => {
    const fe = await loadFont(f.font || 'sarabun', !!f.bold);
    if (!pdfFonts.has(fe.key)) pdfFonts.set(fe.key, { font: await doc.embedFont(fe.bytes, { subset: false }), fe });
    return pdfFonts.get(fe.key);
  };
  for (const f of fields) if (f.type !== 'checkbox' && f.type !== 'signature') await fontFor(f);
  const imgCache = new Map();
  const pdfPages = doc.getPages();
  const wrapped = new Set();
  const val = (f) => (includeValues ? values[f.name] ?? '' : '');

  // ช่องเดิมของไฟล์ที่นำเข้ามาแก้แล้ว → ลบของเก่าออก
  if (removeNames.length) {
    try {
      const form = doc.getForm();
      for (const n of removeNames) { const fld = form.getFieldMaybe(n); if (fld) form.removeField(fld); }
    } catch (e) { console.warn('remove fields', e); }
  }

  const byPage = new Map();
  for (const f of fields) {
    if (!byPage.has(f.page)) byPage.set(f.page, []);
    byPage.get(f.page).push(f);
  }

  const form = mode === 'form' ? doc.getForm() : null;
  const usedNames = new Map();

  for (const [pnum, list] of byPage) {
    const page = pdfPages[pnum - 1];
    if (!page) continue;
    const T = pages[pnum - 1].transform; // PDF → จอ (สเกล 1)
    const Ti = inv(T);                  // จอ → PDF
    const ops = [];
    const keys = new Map();
    const resKey = (pf) => { if (!keys.has(pf.fe.key)) keys.set(pf.fe.key, page.node.newFontDictionary(pf.font.name, pf.font.ref)); return keys.get(pf.fe.key); };

    for (const f of list) {
      const v = val(f);
      const asWidget = form && f.type !== 'signature';
      if (asWidget) {
        await addWidget(form, page, f, v, Ti, f.type === 'checkbox' ? null : (await fontFor(f)).font, usedNames);
        continue;
      }
      if (f.type === 'checkbox') {
        if (truthy(v)) ops.push(...checkOps(f));
      } else if (f.type === 'signature') {
        if (v && /^data:image\//.test(v)) {
          const img = await embedImage(doc, imgCache, v);
          const k = Math.min(f.w / img.width, f.h / img.height);
          const w = img.width * k, h = img.height * k;
          const x = f.align === 'left' ? f.x : f.align === 'right' ? f.x + f.w - w : f.x + (f.w - w) / 2;
          const y = f.y + (f.h - h) / 2;
          const key = page.node.newXObject('Image', img.ref);
          ops.push(P.pushGraphicsState(), P.concatTransformationMatrix(w, 0, 0, -h, x, y + h), P.drawObject(key), P.popGraphicsState());
        }
      } else {
        const text = displayText(f, v);
        if (!String(text).trim()) continue;
        const pf = await fontFor(f);
        const lay = layoutText(f, text);
        const [r, g, b] = hexColor(f.color);
        const key = resKey(pf);
        ops.push(P.setFillingRgbColor(r, g, b), P.beginText());
        for (const ln of lay.lines) if (ln.text) ops.push(...glyphOps(key, ln.text, f.x + ln.x, f.y + ln.y, lay.size, pf.fe.fk));
        ops.push(P.endText());
      }
    }
    if (ops.length) {
      if (!wrapped.has(pnum)) { wrapOriginal(doc, page); wrapped.add(pnum); }
      page.pushOperators(P.pushGraphicsState(), P.concatTransformationMatrix(...Ti), ...ops, P.popGraphicsState());
    }
  }

  if (form) {
    try {
      form.acroForm.dict.set(P.PDFName.of('NeedAppearances'), P.PDFBool.True);
    } catch (e) { /* ignore */ }
  }
  return doc.save({ updateFieldAppearances: false });
}

function pdfRect(f, Ti) {
  const pts = [apply(Ti, f.x, f.y), apply(Ti, f.x + f.w, f.y), apply(Ti, f.x, f.y + f.h), apply(Ti, f.x + f.w, f.y + f.h)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

async function addWidget(form, page, f, v, Ti, font, usedNames) {
  const P = L();
  const rect = pdfRect(f, Ti);
  const key = f.type === 'checkbox' ? 'cb' : 'tx';
  // ชื่อซ้ำ + ชนิดเดียวกัน → วิดเจ็ตหลายตัวของช่องเดียว (ค่าเชื่อมกัน)
  let name = f.name || f.id;
  const prev = usedNames.get(name);
  let field = null;
  if (prev && prev.key === key && prev.fmt === (f.dateFormat || '')) field = prev.field;
  else if (prev || form.getFieldMaybe(name)) {
    let i = 2;
    while (usedNames.has(`${name}_${i}`) || form.getFieldMaybe(`${name}_${i}`)) i++;
    name = `${name}_${i}`;
  }
  const opts = { ...rect, borderWidth: 0, backgroundColor: undefined, borderColor: undefined, textColor: P.rgb(...hexColor(f.color)) };
  if (f.type === 'checkbox') {
    if (!field) {
      field = form.createCheckBox(name);
      usedNames.set(f.name || f.id, { key, field, fmt: '' });
    }
    field.addToPage(page, { ...opts, textColor: P.rgb(...hexColor(f.color)) });
    if (truthy(v)) field.check();
    return;
  }
  if (!field) {
    field = form.createTextField(name);
    if (f.type === 'multiline') field.enableMultiline();
    usedNames.set(f.name || f.id, { key, field, fmt: f.dateFormat || '' });
    const text = displayText(f, v);
    if (text) field.setText(text);
  }
  field.addToPage(page, { ...opts, font });
  field.setAlignment(f.align === 'center' ? P.TextAlignment.Center : f.align === 'right' ? P.TextAlignment.Right : P.TextAlignment.Left);
  const size = +f.fontSize || (f.type === 'multiline' ? 0 : Math.min(12, f.h * 0.62));
  field.setFontSize(size);
  if (f.required) field.enableRequired();
  field.updateAppearances(font);
}

// รวม PDF หลายไฟล์เป็นไฟล์เดียว
export async function concatPdfs(list) {
  const P = L();
  const out = await P.PDFDocument.create();
  for (const bytes of list) {
    const src = await P.PDFDocument.load(bytes);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return out.save();
}
