// จัดวางข้อความในช่อง — ใช้ร่วมกันทั้งพรีวิวบนจอและตอนสร้าง PDF เพื่อให้ตรงกันทุกพิกเซล
// วัดขนาดด้วย fontkit (ตัวเดียวกับที่ฝังใน PDF) และตัดคำไทยด้วย Intl.Segmenter
import { loadFont as loadFontFile, fontNow, DEFAULT_FONT } from './fonts.js';

// โหลดฟอนต์มาตรฐาน (Sarabun ปกติ + หนา) ตอนเริ่มแอป
export async function loadFont() {
  const e = await loadFontFile(DEFAULT_FONT, false);
  loadFontFile(DEFAULT_FONT, true).catch(() => {});
  return e.fk;
}

export const LINE = 1.3;
const caches = new Map(); // font key → Map(text → width em)

// fontkit ของช่องนี้ (f.font / f.bold) — ยังไม่โหลดจะได้ Sarabun ชั่วคราว
export const fkOf = (f) => fontNow(f?.font || DEFAULT_FONT, !!f?.bold);

// ความกว้างเป็นหน่วย em
export function measure(text, fe = fontNow(DEFAULT_FONT, false)) {
  if (!text) return 0;
  let cache = caches.get(fe.key);
  if (!cache) { cache = new Map(); caches.set(fe.key, cache); }
  let w = cache.get(text);
  if (w !== undefined) return w;
  const run = fe.fk.layout(text);
  w = 0;
  for (const p of run.positions) w += p.xAdvance;
  w /= fe.fk.unitsPerEm;
  if (cache.size > 5000) cache.clear();
  cache.set(text, w);
  return w;
}

const wordSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const graphSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
const words = (s) => (wordSeg ? Array.from(wordSeg.segment(s), (x) => x.segment) : s.split(/(\s+)/).filter(Boolean));
const graphemes = (s) => (graphSeg ? Array.from(graphSeg.segment(s), (x) => x.segment) : Array.from(s));

export function wrap(text, size, maxW, fe) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const tok of words(para)) {
      const cand = line + tok;
      if (!line || measure(cand, fe) * size <= maxW) { line = cand; }
      else { out.push(line.trimEnd()); line = tok.trimStart(); }
      // คำเดียวยาวเกินช่อง → ตัดตามตัวอักษร (ไม่แยกสระ/วรรณยุกต์ออกจากพยัญชนะ)
      while (measure(line, fe) * size > maxW && graphemes(line).length > 1) {
        const g = graphemes(line);
        let k = g.length - 1;
        while (k > 1 && measure(g.slice(0, k).join(''), fe) * size > maxW) k--;
        out.push(g.slice(0, k).join(''));
        line = g.slice(k).join('');
      }
    }
    out.push(line);
  }
  return out;
}

// คืน { size, fe, lines:[{text,x,y}] } — x,y (baseline) เป็นพอยต์ สัมพัทธ์กับมุมซ้ายบนของช่อง
// f คือช่องที่ "รวมสไตล์แล้ว" (font, bold, fontSize, align จากพรีเซท/กลุ่ม)
export function layoutText(f, text) {
  text = String(text ?? '');
  const fe = fkOf(f);
  const pad = Math.min(2, f.w * 0.06);
  const innerW = Math.max(1, f.w - pad * 2);
  const multi = f.type === 'multiline';
  let size = +f.fontSize || 0;
  let lines;
  if (!multi) {
    lines = [text.replace(/\r?\n/g, ' ')];
    if (!size) {
      size = Math.min(14, f.h * 0.7);
      const w = measure(lines[0], fe);
      if (w * size > innerW) size = Math.max(4, innerW / w);
    }
  } else if (!size) {
    size = Math.min(13, Math.max(5, f.h * 0.62));
    for (;;) {
      lines = wrap(text, size, innerW, fe);
      if (lines.length * size * LINE <= f.h + 0.5 || size <= 5) break;
      size -= 0.5;
    }
  } else {
    lines = wrap(text, size, innerW, fe);
  }
  const lh = size * LINE;
  const block = lines.length * lh;
  const va = f.vAlign || 'middle';
  const top = va === 'top' ? 0 : va === 'bottom' ? f.h - block : (f.h - block) / 2;
  // ระยะ baseline จากกลางบรรทัด ตามสัดส่วนของฟอนต์ (Sarabun ≈ 0.32 em)
  const mid = (((fe.fk.ascent + fe.fk.descent) / fe.fk.unitsPerEm) * 0.38) || 0.32;
  return {
    size,
    fe,
    lines: lines.map((t, i) => {
      const w = measure(t, fe) * size;
      const x = f.align === 'center' ? (f.w - w) / 2 : f.align === 'right' ? f.w - pad - w : pad;
      return { text: t, x, y: top + i * lh + lh / 2 + size * mid, w };
    }),
  };
}
