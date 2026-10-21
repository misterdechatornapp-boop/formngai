// สร้างช่องอัตโนมัติ: หา "ที่ว่างสำหรับกรอก" จากผลวิเคราะห์หน้า + ตั้งชื่อจากข้อความรอบช่อง
// ใช้ร่วมกับแปรงระบาย (mask) เพื่อจำกัดโซนและกำหนดชนิดช่องตามสี
import { findCell, innerRect, boxRect } from './detect.js';

export const AUTO_COLORS = { auto: '#64748b', text: '#2563eb', checkbox: '#16a34a', date: '#ea580c', signature: '#9333ea', multiline: '#0891b2', erase: '#e11d48' };
export const BRUSHES = [['auto', 'ให้ระบบเลือก'], ['text', 'ข้อความ'], ['checkbox', 'ติ๊กถูก'], ['date', 'วันที่'], ['signature', 'ลายเซ็น']];
export const BRUSH_CODE = { auto: 1, text: 2, checkbox: 3, date: 4, signature: 5 };
const CODE_TYPE = [null, 'auto', 'text', 'checkbox', 'date', 'signature'];

// สัดส่วนบล็อกที่มีหมึกในกรอบ (นับเฉพาะบล็อกที่อยู่ในกรอบทั้งบล็อก)
export function inkFrac(lines, r) {
  const ink = lines?.ink;
  if (!ink || r.w <= 0 || r.h <= 0) return 0;
  const c = ink.cell;
  const x0 = Math.max(0, Math.ceil(r.x / c)), x1 = Math.min(ink.gw, Math.floor((r.x + r.w) / c));
  const y0 = Math.max(0, Math.ceil(r.y / c)), y1 = Math.min(ink.gh, Math.floor((r.y + r.h) / c));
  let n = 0, k = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (ink.data[y * ink.gw + x] >= 2) k++; }
  return n ? k / n : 0;
}

// ช่องลายเซ็นสูงขึ้นจากเส้นได้ ~36pt แต่ไม่ข้ามเส้นขอบตาราง/เส้นสำหรับเขียนด้านบน
function sigTop(L, c) {
  let top = Math.max(0, c.lineY - 36);
  for (const l of L?.hLines || []) {
    if (l.y < c.lineY - 6 && l.y + 1 > top && Math.min(l.x2, c.x + c.w) - Math.max(l.x1, c.x) > 4) top = l.y + 1;
  }
  return top;
}

const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// ---------- หาตำแหน่งที่น่าจะเป็นช่องกรอก ----------
export function findCandidates(p, { kinds = { checkbox: true, line: true, cell: true }, mask = null, existing = [], gap = 0 } = {}) {
  const L = p.lines;
  if (!L) return [];
  let out = [];

  if (kinds.checkbox) {
    for (const b of L.boxes || []) {
      // วงกลมเลือก ◯ → ช่องติ๊กแบบ "จุด" อยู่ในวง · กล่อง/วงเล็บ → ชิดขอบในตามระยะ gap
      out.push({ src: 'box', boxKind: b.kind, type: 'checkbox', ...boxRect(b, gap) });
    }
  }

  if (kinds.line) {
    const touchesV = (l) => L.vLines.some((v) => v.x >= l.x1 - 3 && v.x <= l.x2 + 3 && l.y >= v.y1 - 3 && l.y <= v.y2 + 3);
    for (const l of L.hLines) {
      const len = l.x2 - l.x1;
      if (len < 18) continue;
      if (!l.dotted) {
        if (len > p.w * 0.8 || touchesV(l)) continue; // เส้นคั่นหน้า / เส้นตาราง
        // เส้นทึบต้องมีป้ายกำกับทางซ้าย (เช่น "Model: ____") ไม่ใช่เส้นใต้หัวข้อลอย ๆ
        if (inkFrac(L, { x: l.x1 - 50, y: l.y - 14, w: 48, h: 12 }) < 0.04) continue;
      }
      let top = l.y - 17;
      for (const o of L.hLines) {
        if (o !== l && o.y < l.y - 4 && o.y > top && Math.min(o.x2, l.x2) - Math.max(o.x1, l.x1) > 4) top = o.y + 1;
      }
      // ถ้ามีข้อความ (เช่น หัวข้อบรรทัดก่อน) ล้ำลงมาในกรอบ → ลดความสูงลงจนว่าง
      // ยังมีหมึกแม้เหลือ 9pt = มีข้อความอยู่บนเส้นแล้ว (เส้นใต้ข้อความ หรือกรอกแล้ว) → ข้าม
      const empty = (t) => inkFrac(L, { x: l.x1 + 2, y: t + 1, w: len - 4, h: l.y - t - 2.5 }) <= 0.05;
      while (top < l.y - 9 && !empty(top)) top += 1;
      const r = { x: l.x1 + 1, y: top, w: len - 2, h: l.y + 1 - top };
      if (r.h < 7 || !empty(top)) continue;
      out.push({ src: 'line', type: 'text', vAlign: 'bottom', ...r, lineY: l.y });
    }
  }

  if (kinds.cell) {
    const seen = new Set();
    for (let y = 3; y < p.h; y += 5) {
      for (let x = 3; x < p.w; x += 5) {
        const c = findCell(L, { x, y });
        if (!c) continue;
        const key = `${Math.round(c.x1)},${Math.round(c.y1)},${Math.round(c.x2)},${Math.round(c.y2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (c.w < 12 || c.h < 9 || c.w > 560 || c.h > 400) continue;
        if (!bordersOK(L, c)) continue;
        if (inkFrac(L, { x: c.x1 + 2, y: c.y1 + 2, w: c.w - 4, h: c.h - 4 }) > 0.02) continue;
        const sq = c.w <= 26 && c.h <= 26 && c.w / c.h > 0.6 && c.w / c.h < 1.7;
        const ir = innerRect(c, gap);
        if (sq) out.push({ src: 'cell', type: 'checkbox', ...ir });
        else if (c.h > 70 && c.w >= 80) out.push({ src: 'cell', type: 'multiline', vAlign: 'top', ...ir });
        else if (c.h <= 70) out.push({ src: 'cell', type: 'text', ...ir });
      }
    }
  }

  // ---------- กล่องเล็กเรียงติดกันเป็นแถว (เลขบัตร 13 หลัก, วันเดือนปี) = ช่องกรอกทีละตัวอักษร ไม่ใช่ช่องติ๊ก ----------
  const squareish = (c) => c.type === 'checkbox' && (c.src === 'cell' || c.boxKind === 'box');
  for (const c of out) {
    if (!squareish(c)) continue;
    // มีกล่องขนาดเท่ากันในแถวเดียวกันอยู่ใกล้ ๆ (ติดกัน หรือคั่นด้วย "-") → กล่องทีละหลัก
    const nb = out.some((o) => o !== c && squareish(o) && Math.abs(o.y - c.y) < 2.5 && Math.abs(o.h - c.h) < 3 && Math.abs(o.w - c.w) < 3 &&
      Math.min(Math.abs(o.x - (c.x + c.w)), Math.abs(c.x - (o.x + o.w))) < 22);
    if (nb) c.digit = true;
  }
  for (const c of out) if (c.digit) Object.assign(c, { type: 'text', align: 'center', vAlign: 'middle' });

  // ---------- จำกัดด้วยโซนที่ระบาย + ชนิดตามสี ----------
  if (mask) {
    const mw = Math.ceil(p.w);
    const codeAt = (x, y) => mask[Math.floor(y) * mw + Math.floor(x)] || 0;
    const kept = [];
    for (const c of out) {
      const code = codeAt(c.x + c.w / 2, c.y + c.h / 2);
      if (!code) continue;
      const want = CODE_TYPE[code];
      if (want === 'auto') { kept.push(c); continue; }
      if (want === 'checkbox') {
        if (c.type === 'checkbox') kept.push(c);
        else if (c.digit) kept.push({ ...c, type: 'checkbox', align: 'center', forced: true }); // ระบายเขียวบนกล่องเล็ก = อยากได้ช่องติ๊ก
        continue;
      }
      if (c.type === 'checkbox') {
        // ระบายสีข้อความบนกล่องสี่เหลี่ยมเล็ก → ช่องกรอก 1 ตัวอักษร (วงเล็บ/วงกลมยังเป็นช่องติ๊ก)
        if (c.src === 'cell' || c.boxKind === 'box') kept.push({ ...c, type: want, align: 'center', vAlign: 'middle', digit: true, forced: true });
        continue;
      }
      const n = { ...c, type: want, forced: true };
      if (want === 'signature' && c.src === 'line') { const top = sigTop(L, c); n.h = c.lineY + 1 - top; n.y = top; }
      if (want === 'signature' || want === 'date') delete n.vAlign;
      kept.push(n);
    }
    out = kept;
    // โซนที่ระบายแต่ไม่พบโครงสร้าง → สร้างช่องตามขนาดที่ระบาย
    for (const comp of maskComponents(mask, mw, Math.ceil(p.h))) {
      if (out.some((c) => overlap(c, comp) > 0)) continue;
      const t = CODE_TYPE[comp.code];
      const type = t === 'auto' ? (comp.w <= 26 && comp.h <= 26 ? 'checkbox' : comp.h > 40 ? 'multiline' : 'text') : t;
      out.push({ src: 'paint', type, x: comp.x, y: comp.y, w: comp.w, h: comp.h, forced: t !== 'auto', vAlign: type === 'multiline' ? 'top' : undefined });
    }
  }

  // ---------- ตัดซ้ำ: กล่อง > เส้น > ช่องตาราง > ระบาย; ไม่ทับช่องที่มีอยู่แล้ว ----------
  const prio = { box: 0, line: 1, cell: 2, paint: 3 };
  out.sort((a, b) => prio[a.src] - prio[b.src]);
  const acc = [];
  for (const c of out) {
    if (c.w < 3 || c.h < 3) continue;
    if (existing.some((f) => overlap(f, c) > 0.3 * Math.min(area(f), area(c)))) continue;
    if (acc.some((a) => overlap(a, c) > 0.4 * Math.min(area(a), area(c)))) continue;
    acc.push(c);
  }
  return acc.map((c) => ({ ...c, x: r1(c.x), y: r1(c.y), w: r1(c.w), h: r1(c.h) }));
}
const r1 = (v) => Math.round(v * 10) / 10;

// ช่องตารางจริงต้องมีเส้นขอบยาวเกือบเต็มทั้ง 4 ด้าน (กันขาตัวอักษรที่ถูกนับเป็นเส้นตั้งสร้าง "ช่องหลอก")
function bordersOK(L, c) {
  const cov = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)) / Math.max(1, b2 - b1);
  const h = (y) => L.hLines.some((l) => !l.dotted && Math.abs(l.y - y) < 1.6 && cov(l.x1, l.x2, c.x1, c.x2) > 0.8);
  const v = (x) => L.vLines.some((l) => Math.abs(l.x - x) < 1.6 && cov(l.y1, l.y2, c.y1, c.y2) > 0.8);
  return h(c.y1) && h(c.y2) && v(c.x1) && v(c.x2);
}

function maskComponents(mask, mw, mh) {
  const seen = new Uint8Array(mask.length);
  const out = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const code = mask[i];
    let x1 = mw, y1 = mh, x2 = 0, y2 = 0, n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop();
      const x = k % mw, y = (k / mw) | 0;
      n++;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      for (const nb of [k - 1, k + 1, k - mw, k + mw]) {
        if (nb < 0 || nb >= mask.length || seen[nb] || mask[nb] !== code) continue;
        if ((nb === k - 1 && x === 0) || (nb === k + 1 && x === mw - 1)) continue;
        seen[nb] = 1; stack.push(nb);
      }
    }
    if (n > 30 && x2 - x1 >= 4 && y2 - y1 >= 4) out.push({ code, x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 });
  }
  return out;
}

// ---------- ข้อความในหน้า (สำหรับตั้งชื่อ) ----------
export async function pageText(p) {
  if (p.lines?.text) return p.lines.text; // จาก analyzePage (ตำแหน่งตัวอักษรแม่นกว่า)
  if (p.text) return p.text;
  try {
    const tc = await p.page.getTextContent();
    const vp = p.page.getViewport({ scale: 1 });
    p.text = tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const hgt = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      return { str: it.str, x1: x, x2: x + (it.width || hgt * it.str.length * 0.5), y1: y - hgt * 0.8, y2: y + hgt * 0.25 };
    });
  } catch (e) { p.text = []; }
  return p.text;
}

// ตัวอักษร (ประมาณตำแหน่ง) ที่อยู่ในแนวบรรทัด yMid ระหว่าง xa..xb
function charsOnLine(items, yMid, xa, xb) {
  const out = [];
  for (const it of items) {
    if (yMid < it.y1 - 1 || yMid > it.y2 + 1) continue;
    const chars = it.chars || Array.from(it.str);
    const n = chars.length;
    chars.forEach((ch, i) => {
      const cx = it.xs ? (it.xs[i] + it.xs[i + 1]) / 2 : it.x1 + ((i + 0.5) / n) * (it.x2 - it.x1);
      if (cx >= xa && cx <= xb) out.push({ cx, ch });
    });
  }
  return out.sort((a, b) => a.cx - b.cx);
}

// แบ่งตัวอักษรเป็นกลุ่มตามช่องว่างที่กว้าง และตัดที่จุดไข่ปลา ("วันที่.....เดือน" → ["วันที่", "เดือน"])
function groups(chars, gap = 14) {
  const gs = [];
  let cur = null, last = -1e9;
  for (const c of chars) {
    if (!cur || c.cx - last > gap) { cur = []; gs.push(cur); }
    cur.push(c.ch); last = c.cx;
  }
  return gs.flatMap((g) => g.join('').split(/(?:[.…_·‥]\s?){3,}/)).map(clean).filter(Boolean);
}

// ฟอนต์ไทยรุ่นเก่าเก็บวรรณยุกต์ที่เลื่อนตำแหน่งไว้ในโซน PUA → แปลงกลับเป็นอักษรไทยปกติ
const PUA = { 0xF700: 'ฐ', 0xF701: 'ิ', 0xF702: 'ี', 0xF703: 'ึ', 0xF704: 'ื', 0xF70F: 'ญ', 0xF710: 'ั', 0xF711: 'ํ', 0xF712: '็', 0xF718: 'ุ', 0xF719: 'ู', 0xF71A: 'ฺ' };
for (const base of [0xF705, 0xF70A, 0xF713]) for (let i = 0; i < 5; i++) PUA[base + i] = String.fromCharCode(0x0E48 + i);

function clean(s) {
  return s.replace(/[-]/g, (ch) => PUA[ch.charCodeAt(0)] || '')
    .replace(/[ʰ-˿-�]/g, '')
    .replace(/ํา|ำา/g, 'ำ')
    .replace(/[.…_]{2,}/g, ' ').replace(/[[\]☐☑☒□■]/g, ' ').replace(/\s+/g, ' ')
    .replace(/^[\s:：\-–(（.)）\]]+|[\s:：\-–(（.)）]+$/g, '')
    .replace(/^\(?\d+(?:\.\d+)*[).]?\s*(?=[^\d\s.)])/, '') // ตัดเลขข้อนำหน้า เช่น "2.1 ", "3)", "(1)" (ถ้าเหลือแต่เลขก็คงไว้)
    .trim().slice(0, 64)
    .replace(/^(.*\([^)]*)$/, '$1)'); // วงเล็บเปิดค้าง (ถูกตัดท้าย) → ปิดให้
}

const SIG_RE = /(ลงช|ลายมือ|ลายเซ็น|signature|signed|sign\b)/i;
const DATE_RE = /(^date|date$|\bdate\b|วันท|ว\/ด\/ป|วัน\s*\/?\s*เดือน|d\.?o\.?b)/i;

// ขอบซ้าย/ขวาของช่องตารางที่ตำแหน่งนี้อยู่ (เส้นตั้งที่ใกล้ที่สุด) — ป้ายกำกับไม่ข้ามเส้นตาราง
function cellBounds(lines, x1, x2, yMid) {
  let lb = 0, rb = Infinity;
  for (const v of lines?.vLines || []) {
    if (yMid < v.y1 - 1 || yMid > v.y2 + 1) continue;
    if (v.x <= x1 + 1 && v.x > lb) lb = v.x;
    if (v.x >= x2 - 1 && v.x < rb) rb = v.x;
  }
  return [lb, rb];
}

// กลุ่มคำพร้อมตำแหน่ง (ไว้เลือกเฉพาะคำที่อยู่เหนือช่อง ไม่ตัดกลางคำ)
function groupsPos(chars, gap = 14) {
  const gs = [];
  let cur = null, last = -1e9;
  for (const c of chars) {
    if (!cur || c.cx - last > gap) { cur = { s: '', x1: c.cx, x2: c.cx }; gs.push(cur); }
    cur.s += c.ch; cur.x2 = c.cx; last = c.cx;
  }
  return gs.flatMap((g) => g.s.split(/(?:[.…_·‥]\s?){3,}/).map((s) => ({ ...g, s: clean(s) }))).filter((g) => g.s);
}

// หัวคอลัมน์/หัวข้อ: ข้อความบรรทัดที่ใกล้ที่สุดเหนือช่อง ภายในช่องตารางเดียวกัน (ไม่ข้ามเส้นนอนของตาราง)
function headerAbove(items, c, lb, rb, lines) {
  const xa = Math.max(lb, c.x - 10), xb = Math.min(rb, c.x + c.w + 10);
  const refY = c.lineY ?? c.y + c.h / 2;
  let ceil = refY - 160;
  // เส้นขอบตาราง/ส่วน (ยาวเลยช่องออกไป) เป็นเพดาน — ไม่ใช่เส้นสำหรับเขียนของแถวก่อน และไม่ใช่ขอบบนของช่องตารางเอง
  if (c.src !== 'cell') {
    for (const l of lines?.hLines || []) {
      if (!l.dotted && l.y < c.y + 1 && l.y > ceil && l.x2 - l.x1 > c.w + 30 && Math.min(l.x2, xb) - Math.max(l.x1, xa) > 4) ceil = l.y;
    }
  }
  const above = items.filter((it) => it.base < refY - 4 && it.base > ceil && Math.min(it.x2, xb) - Math.max(it.x1, xa) > 2);
  const nearest = above.reduce((m, it) => (!m || it.base > m.base ? it : m), null);
  if (!nearest) return '';
  return groupsPos(charsOnLine(items, nearest.base - nearest.size * 0.3, lb, rb))
    .filter((g) => g.x2 > xa && g.x1 < xb).map((g) => g.s).join(' ');
}

// "2.3" → หาหัวข้อแม่ "2.วัตถุประสงค์โครงการ" ด้านบน
function parentHeading(items, c, lab) {
  const m = /^(\d+)\.\d+/.exec(lab);
  if (!m) return '';
  const refY = c.lineY ?? c.y;
  const re = new RegExp('^\\s*' + m[1] + '\\s*[.)]\\s*(?!\\d)');
  const hits = items.filter((it) => it.base < refY - 2 && it.base > refY - 220 && re.test(it.str));
  const h = hits.reduce((a, it) => (!a || it.base > a.base ? it : a), null);
  return h ? groups(h.chars.map((ch, i) => ({ ch, cx: (h.xs[i] + h.xs[i + 1]) / 2 })))[0] || '' : '';
}

// หัวคอลัมน์ของช่องตาราง: ไล่ขึ้นทีละช่องในคอลัมน์เดียวกัน (ไม่ออกนอกตาราง) จนเจอช่องที่มีข้อความ
function headerInColumn(items, lines, c) {
  const cx = c.x + c.w / 2;
  const own = findCell(lines, { x: cx, y: c.y + c.h / 2 });
  if (!own) return '';
  let top = own.y1;
  for (let k = 0; k < 40; k++) {
    const up = findCell(lines, { x: cx, y: top - 2.5 });
    if (!up || Math.abs(up.x1 - own.x1) > 3 || Math.abs(up.x2 - own.x2) > 3 || up.y2 > top + 3) return '';
    const chars = [];
    for (const it of items) {
      if (it.base < up.y1 || it.base > up.y2 + 2) continue;
      it.chars.forEach((ch, i) => { const x = it.xs ? (it.xs[i] + it.xs[i + 1]) / 2 : it.x1; if (x > up.x1 && x < up.x2) chars.push({ ch, cx: x }); });
    }
    const g = groups(chars.sort((a, b) => a.cx - b.cx));
    if (g.length) return g.join(' ');
    top = up.y1;
  }
  return '';
}

const onlyNum = (s) => /^[\d.()\s]*$/.test(s || '');
const NOT_LABEL = /[\s[\]()（）]/;

export function nameCandidates(cands, items, lines) {
  const boxes = cands.filter((o) => o.type === 'checkbox');
  for (const c of cands) {
    const yMid = c.src === 'line' ? c.lineY - 5 : c.y + c.h / 2;
    const [lb, rb] = cellBounds(lines, c.x, c.x + c.w, yMid);
    const leftChars = charsOnLine(items, yMid, lb, c.x + 1);
    const left = groups(leftChars);
    const gapLeft = leftChars.length ? c.x - leftChars[leftChars.length - 1].cx : Infinity;
    const rightChars = charsOnLine(items, yMid, c.x + c.w, Math.min(rb, c.x + c.w + 260));
    const firstR = rightChars.find((ch) => !NOT_LABEL.test(ch.ch));
    const right = groups(rightChars, 10);
    let name = '';
    c.direct = false;
    if (c.type === 'checkbox') {
      // ป้ายติดขวากล่อง (☐ ใช้ในหอผู้ป่วย / ( ) การฝึกอบรม) มาก่อน; ไม่มีจึงใช้ป้ายซ้าย (OK [ ])
      const optR = firstR && firstR.cx - (c.x + c.w) < 12 ? right[0] || '' : '';
      // หัวแถว = ข้อความก่อน "กล่องแรก" ของบรรทัดนั้น
      const first = boxes.filter((o) => Math.abs(o.y + o.h / 2 - yMid) < 3 && o.x >= lb && o.x <= c.x).sort((a, b) => a.x - b.x)[0] || c;
      const pre = groups(charsOnLine(items, yMid, lb, first.x + 1));
      let opt, row;
      if (optR) { opt = optR; row = pre.length ? pre[pre.length - 1] : ''; }
      else { opt = left.length ? left[left.length - 1] : ''; row = first === c ? (left.length > 1 ? left[0] : '') : pre[0] || ''; }
      // กล่องอยู่ในช่องตาราง (เช่นคอลัมน์ Test Result) → หัวแถวอยู่ในคอลัมน์ซ้ายสุดของแถว
      // (เฉพาะเมื่อช่องที่กล่องอยู่เป็น "แถวตาราง" เตี้ย ๆ ไม่ใช่ส่วนใหญ่ของฟอร์มที่มีหลายบรรทัด)
      if (!row && lb > 0) {
        const own = findCell(lines, { x: c.x + c.w / 2, y: yMid });
        if (own && own.h < Math.max(c.h, 8) * 3.5) row = groups(charsOnLine(items, yMid, 0, lb))[0] || '';
      }
      if (row === opt) row = '';
      name = row && opt && opt.length <= 40 ? `${row} - ${opt}` : opt || row;
    } else if (c.digit) {
      // กล่องทีละหลัก: ป้ายคือข้อความล่าสุดทางซ้ายบนบรรทัดเดียวกัน (ข้ามขอบกล่อง/ขีด "-") → "เลขประจำตัวประชาชน 1…13"
      const g = groups(charsOnLine(items, yMid, 0, c.x + 1)).filter((s) => !onlyNum(s));
      name = g.length ? g[g.length - 1] : '';
    } else if (c.src === 'cell') {
      // ช่องตาราง: มีหัวคอลัมน์ในตาราง → "หัวแถว - หัวคอลัมน์" · ไม่มี → ตารางแบบ "ป้าย | ค่า" ใช้ป้ายช่องซ้าย
      const header = headerInColumn(items, lines, c);
      const fullLeft = groups(charsOnLine(items, yMid, 0, c.x + 1));
      if (header) {
        const row = fullLeft[0] || '';
        name = row && row !== header ? `${row} - ${header}` : header;
      } else {
        name = fullLeft.length ? fullLeft[fullLeft.length - 1] : headerAbove(items, c, lb, rb, lines);
      }
    } else if (c.src === 'line' && gapLeft > 25) {
      // เส้นที่ไม่มีป้ายติด: หัวคอลัมน์/หัวข้อด้านบน + หัวแถว
      const header = headerAbove(items, c, lb, rb, lines);
      const row = left[0] || '';
      name = row && header && row !== header ? `${row} - ${header}` : header || row;
    } else {
      // ป้ายซ้าย; ถ้าเหลือแต่เลขข้อ (เช่น "3.1") → ใช้ป้ายขวา ("หัวหน้า") หรือหัวข้อด้านบน
      let lab = left.length ? left[left.length - 1] : '';
      const own = !!lab && !onlyNum(lab);
      // "( .......... )" ใต้ลายเซ็น = ชื่อตัวบรรจง → ปล่อยว่างให้กฎด้านล่างตั้งชื่อ
      const SKIP = /[.…_·‥\s]/;
      const lastL = [...leftChars].reverse().find((ch) => !SKIP.test(ch.ch));
      const firstRR = rightChars.find((ch) => !SKIP.test(ch.ch));
      const inParens = lastL && /[(（]/.test(lastL.ch) && firstRR && /[)）]/.test(firstRR.ch);
      if (inParens) lab = '';
      else if (onlyNum(lab)) {
        const r = firstR && firstR.cx - (c.x + c.w) < 20 && !onlyNum(right[0]) ? right[0] || '' : '';
        const parent = r ? '' : parentHeading(items, c, lab);
        const extra = r || (parent ? '' : headerAbove(items, c, lb, rb, lines));
        if (parent) { lab = `${parent} ${lab}`; }
        lab = extra ? (lab ? `${lab} ${extra}` : extra) : lab;
      }
      name = lab;
      c.direct = own; // เดาชนิด (ลายเซ็น/วันที่) จากป้ายของช่องเองเท่านั้น ไม่ใช่จากหัวข้อด้านบน
    }
    c.label = name;
    c.name = name;
    if (!c.forced && c.direct && c.type !== 'checkbox' && name) {
      if (SIG_RE.test(name)) c.type = 'signature';
      else if (DATE_RE.test(name)) c.type = 'date';
    }
    if (c.type === 'signature' && c.src === 'line' && c.h < 30) { const top = sigTop(lines, c); c.h = r1(c.lineY + 1 - top); c.y = r1(top); delete c.vAlign; }
  }
  // วันที่แบบไทยแยกช่อง: "วันที่ ..... เดือน ..... พ.ศ. ....." → ชื่อเดียวกัน ค่าเดียวกัน คนละรูปแบบ
  const ls = cands.filter((c) => c.src === 'line').sort((a, b) => a.lineY - b.lineY || a.x - b.x);
  let g = 0;
  for (let i = 0; i < ls.length - 1; i++) {
    const a = ls[i], b = ls[i + 1], c = ls[i + 2];
    // ไม่ทับชนิดที่ผู้ใช้ระบายสีกำหนดไว้ (เช่น ระบายสีข้อความ → ต้องได้ช่องข้อความ)
    const free = (x) => !x?.forced || x.type === 'date';
    if (/วันท\S*$/.test(a.label || '') && b && free(a) && free(b) && Math.abs(b.lineY - a.lineY) < 3 && /^เดือน$/.test(b.label || '')) {
      g++;
      const nm = g > 1 ? `วันที่ ${g}` : 'วันที่';
      Object.assign(a, { type: 'date', dateFormat: 'd', name: nm, shared: true });
      Object.assign(b, { type: 'date', dateFormat: 'mmmm', name: nm, shared: true });
      if (c && free(c) && Math.abs(c.lineY - a.lineY) < 3 && /^(พ\.?ศ\.?|ปี)$/.test(c.label || '')) Object.assign(c, { type: 'date', dateFormat: 'bbbb', name: nm, shared: true });
    }
  }
  // บรรทัด ( ........ ) ใต้ช่องลายเซ็น → ชื่อตัวบรรจงของผู้ลงนาม
  for (const c of cands) {
    if (c.name || c.type === 'checkbox') continue;
    const sig = cands.find((o) => o.type === 'signature' && o.y < c.y && c.y - (o.y + o.h) < 40 && Math.min(o.x + o.w, c.x + c.w) - Math.max(o.x, c.x) > 20);
    if (sig) c.name = sig.name + ' (ชื่อ)';
  }
  // "( ) อื่นๆ ........" → เส้นหลังตัวเลือกเดียวกันคือช่อง "ระบุ"
  for (const c of cands) {
    if (c.src !== 'line' || !c.name) continue;
    const box = cands.find((o) => o.type === 'checkbox' && o.name === c.name && Math.abs(o.y + o.h / 2 - (c.lineY - 4)) < 6 && o.x < c.x);
    if (box) c.name = `${c.name} (ระบุ)`;
  }
  // ชื่อซ้ำ (เช่น แถวในตาราง) → ใส่ลำดับ 1, 2, 3 ตามตำแหน่ง
  const byName = new Map();
  for (const c of cands) if (c.name && !c.shared) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c); }
  for (const [nm, list] of byName) if (list.length > 1) list.sort((p, q) => (Math.abs(p.y - q.y) > 4 ? p.y - q.y : p.x - q.x)).forEach((c, k) => { c.name = nm + ' ' + (k + 1); });
  return cands;
}
