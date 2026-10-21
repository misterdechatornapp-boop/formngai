// ตรวจจับเส้น/กรอบ/จุดไข่ปลาในหน้า PDF (จากภาพที่เรนเดอร์ จึงใช้ได้กับไฟล์สแกนด้วย)
// ผลลัพธ์เป็นพอยต์ (หน่วยเดียวกับตำแหน่งช่อง)
const SC = 2;

function darkMap(ctx, W, H, thr = 165) {
  const img = ctx.getImageData(0, 0, W, H).data;
  const d = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) {
    d[i] = img[j + 3] > 100 && img[j] * 0.3 + img[j + 1] * 0.59 + img[j + 2] * 0.11 < thr ? 1 : 0;
  }
  return d;
}

// เพิ่มเส้นทึบจากภาพแบบไว (เส้นบางมาก ~0.25pt จะออกมาเป็นสีเทาอ่อน) เฉพาะเส้นที่รอบแรกยังไม่เจอ
function addFaint(base, faint, key) {
  const same = (o, l) => !o.dotted && Math.abs(o.y - l.y) < 3 && Math.min(o.b, l.b) - Math.max(o.a, l.a) > 0.5 * Math.min(o.b - o.a, l.b - l.a);
  for (const l of faint) if (!l.dotted && !base.some((o) => same(o, l))) base.push(l);
  return base;
}

export async function analyzePage(page) {
  const vp = page.getViewport({ scale: SC });
  const W = Math.ceil(vp.width), H = Math.ceil(vp.height);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const d = darkMap(ctx, W, H);
  const dl = darkMap(ctx, W, H, 228);
  cv.width = cv.height = 0;
  const v = scanV(d, W, H);
  addFaint(v.long, scanV(dl, W, H).long);
  // ตารางความหนาแน่นหมึก (บล็อกละ 2pt) ใช้ตรวจว่าพื้นที่ "ว่าง" หรือมีข้อความอยู่แล้ว
  const C = 4, gw = Math.ceil(W / C), gh = Math.ceil(H / C);
  const ink = new Uint8Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const r = y * W, g = ((y / C) | 0) * gw;
    for (let x = 0; x < W; x++) if (d[r + x]) { const k = g + ((x / C) | 0); if (ink[k] < 255) ink[k]++; }
  }
  // t = ความหนาเส้น (pt) ไว้หาขอบในของกรอบ ให้ช่องชิดเส้นพอดี
  const hLines = addFaint(scanH(d, W, H), scanH(dl, W, H)).map((l) => ({ y: (l.y + 0.5) / SC, x1: l.a / SC, x2: (l.b + 1) / SC, dotted: l.dotted, t: l.t / SC }));
  const boxes = findBoxes(d, W, H, v.short);
  // ชั้นข้อความของ PDF (ถ้ามี) ช่วยหา "......" และ "(   )" ที่พิมพ์เป็นตัวอักษร แล้วยืนยันตำแหน่งจริงกับภาพ
  let text = [];
  // ชื่อฟอนต์จริง (หลังเรนเดอร์แล้ว) — ใช้แยกฟอนต์สัญลักษณ์ เช่น Wingdings ที่ใช้ตัว "m" แทนวงกลม
  const fontName = (fn) => { try { return page.commonObjs.has(fn) ? page.commonObjs.get(fn)?.name || '' : ''; } catch (e) { return ''; } };
  try { text = textRuns(await page.getTextContent(), page.getViewport({ scale: 1 }), fontName); } catch (e) { /* ไม่มีชั้นข้อความ */ }
  const R = { d, W, H };
  addTextLeaders(text, R, hLines);
  addTextBoxes(text, R, boxes);
  addRings(R, text, boxes);
  return {
    ink: { gw, gh, cell: C / SC, data: ink },
    hLines,
    vLines: v.long.map((l) => ({ x: (l.y + 0.5) / SC, y1: l.a / SC, y2: (l.b + 1) / SC, t: l.t / SC })),
    boxes,
    text,
  };
}

// ---------- ชั้นข้อความ ----------
let mctx = null;
const measureW = (s) => {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = '100px Sarabun, Tahoma, sans-serif';
  return mctx.measureText(s).width;
};

// รายการข้อความเป็นพอยต์ พร้อมตำแหน่ง x ของทุกตัวอักษร (ประมาณจากความกว้างจริงของรายการ)
export function textRuns(tc, vp1, fontName = () => '') {
  const items = [];
  const SYM = /wingding|webding|symbol|dingbat|zapf|marlett/i;
  for (const it of tc.items) {
    if (!it.str || !it.transform || Math.abs(it.transform[1]) > 0.01) continue; // ข้ามข้อความแนวเฉียง/ตั้ง
    const [x, y] = vp1.convertToViewportPoint(it.transform[4], it.transform[5]);
    const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    const chars = Array.from(it.str);
    const width = it.width || size * chars.length * 0.5;
    const total = measureW(it.str) || 1;
    const k = width / total;
    const xs = [];
    let acc = '';
    for (const ch of chars) { xs.push(x + measureW(acc) * k); acc += ch; }
    xs.push(x + width);
    const sym = SYM.test(fontName(it.fontName));
    items.push({ chars, xs, base: y, size, sym: chars.map(() => sym) });
  }
  // รวมรายการที่อยู่บรรทัดเดียวกันและติดกัน (บางไฟล์แยกทีละคำ/ทีละตัว)
  items.sort((a, b) => a.base - b.base || a.xs[0] - b.xs[0]);
  const out = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    const gap = prev ? it.xs[0] - prev.xs[prev.xs.length - 1] : Infinity;
    if (prev && Math.abs(prev.base - it.base) < prev.size * 0.2 && gap > -prev.size * 0.3 && gap < prev.size * 0.6) {
      const end = prev.xs.pop(); // xs ยาวกว่า chars 1 ตัว (ตำแหน่งท้าย)
      if (gap > prev.size * 0.15) { prev.chars.push(' '); prev.sym.push(false); prev.xs.push(end); }
      prev.chars.push(...it.chars); prev.sym.push(...it.sym);
      prev.xs.push(...it.xs);
    } else out.push({ ...it, chars: [...it.chars], xs: [...it.xs], sym: [...it.sym] });
  }
  for (const r of out) {
    r.str = r.chars.join('');
    r.x1 = r.xs[0]; r.x2 = r.xs[r.xs.length - 1];
    r.y1 = r.base - r.size * 0.8; r.y2 = r.base + r.size * 0.25;
  }
  return out;
}

const LEADER_RE = /(?:[.…_·‥]\s?){3,}/g;

function colInk(R, xp, ya, yb) {
  if (xp < 0 || xp >= R.W) return false;
  for (let y = Math.max(0, ya); y <= Math.min(R.H - 1, yb); y++) if (R.d[y * R.W + xp]) return true;
  return false;
}

// "........" / "______" ที่เป็นตัวอักษร → เส้นสำหรับเขียน (แทนเส้นจุดจากภาพที่ซ้อนกัน เพราะแม่นกว่า)
function addTextLeaders(text, R, hLines) {
  // เส้นจุดจากภาพที่จริง ๆ คือฐานของตัวอักษร (ไม่ใช่จุดไข่ปลา) → ทิ้ง
  const LEAD_CH = /[.…_·‥\s]/;
  for (let i = hLines.length - 1; i >= 0; i--) {
    const l = hLines[i];
    if (!l.dotted) continue;
    let cover = 0;
    for (const it of text) {
      if (l.y < it.base - it.size * 0.9 || l.y > it.base + it.size * 0.3) continue; // อยู่ในความสูงของบรรทัดข้อความ
      for (let k = 0; k < it.chars.length; k++) {
        if (LEAD_CH.test(it.chars[k])) continue;
        cover += Math.max(0, Math.min(l.x2, it.xs[k + 1]) - Math.max(l.x1, it.xs[k]));
      }
    }
    if (cover > 0.3 * (l.x2 - l.x1)) hLines.splice(i, 1);
  }
  for (const it of text) {
    for (const m of it.str.matchAll(LEADER_RE)) {
      const seg = m[0].replace(/\s+$/, '');
      let x1 = it.xs[m.index], x2 = it.xs[m.index + seg.length];
      const ya = Math.round((it.base - it.size * 0.3) * SC), yb = Math.round((it.base + it.size * 0.08) * SC);
      const a = Math.round(x1 * SC), b = Math.round(x2 * SC);
      for (let xp = a - 3; xp <= a + 10; xp++) if (colInk(R, xp, ya, yb)) { x1 = xp / SC; break; }
      for (let xp = b + 2; xp >= b - 10; xp--) if (colInk(R, xp, ya, yb)) { x2 = (xp + 1) / SC; break; }
      if (x2 - x1 < 6) continue;
      const y = it.base + 0.3;
      for (let i = hLines.length - 1; i >= 0; i--) {
        const l = hLines[i];
        if (l.dotted && Math.abs(l.y - y) < 3.5 && Math.min(l.x2, x2) - Math.max(l.x1, x1) > 0) hLines.splice(i, 1);
      }
      hLines.push({ y, x1, x2, dotted: true, text: true });
    }
  }
}

// วงกลมเลือก ◯ (วาดเป็นเส้น หรือเป็นสัญลักษณ์ของฟอนต์) — ชิ้นหมึกเดี่ยวที่เป็น "วงแหวนกลวง" กลม ปิดรอบ
// ตัดตัวอักษรที่หน้าตาเป็นวง (O, o, 0, อ) ออกด้วยชั้นข้อความ ถ้ามี (ยกเว้นตัวจากฟอนต์สัญลักษณ์)
function addRings(R, text, boxes) {
  const { d, W, H } = R;
  const lab = new Int32Array(W * H);
  const stack = [];
  const LETTER = /[\p{L}\p{N}]/u;
  const overlaps = (b) => boxes.some((o) => Math.min(o.x2, b.x2) - Math.max(o.x1, b.x1) > 0 && Math.min(o.y2, b.y2) - Math.max(o.y1, b.y1) > 0);
  const isLetterAt = (xp, yp) => {
    for (const it of text) {
      if (yp < it.base - it.size * 0.9 || yp > it.base + it.size * 0.3) continue;
      for (let k = 0; k < it.chars.length; k++) {
        if (xp >= it.xs[k] && xp <= it.xs[k + 1]) return !it.sym[k] && LETTER.test(it.chars[k]);
      }
    }
    return false;
  };
  let id = 0;
  for (let i = 0; i < d.length; i++) {
    if (!d[i] || lab[i]) continue;
    id++;
    let x1 = W, y1 = H, x2 = -1, y2 = -1, n = 0;
    stack.length = 0; stack.push(i); lab[i] = id;
    while (stack.length) {
      const k = stack.pop();
      const x = k % W, y = (k / W) | 0;
      n++;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (x > 0 && d[k - 1] && !lab[k - 1]) { lab[k - 1] = id; stack.push(k - 1); }
      if (x < W - 1 && d[k + 1] && !lab[k + 1]) { lab[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && d[k - W] && !lab[k - W]) { lab[k - W] = id; stack.push(k - W); }
      if (y < H - 1 && d[k + W] && !lab[k + W]) { lab[k + W] = id; stack.push(k + W); }
    }
    const w = x2 - x1 + 1, hh = y2 - y1 + 1;
    if (w < 10 || hh < 10 || w > 60 || hh > 60) continue;
    if (w / hh < 0.8 || w / hh > 1.25) continue;
    const fill = n / (w * hh);
    if (fill < 0.1 || fill > 0.6) continue;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, Rr = (w + hh) / 4;
    // ข้างในกลวง
    let hollow = true;
    const ri = Math.max(1, Math.floor(Rr * 0.4));
    for (let yy = -ri; yy <= ri && hollow; yy++) for (let xx = -ri; xx <= ri; xx++) {
      if (xx * xx + yy * yy > ri * ri) continue;
      if (d[Math.round(cy + yy) * W + Math.round(cx + xx)]) { hollow = false; break; }
    }
    if (!hollow) continue;
    // หมึกอยู่บนวงแหวน (ระยะจากศูนย์กลางใกล้เคียงรัศมี) และปิดรอบทุกทิศ
    let on = 0;
    for (let yy = y1; yy <= y2; yy++) for (let xx = x1; xx <= x2; xx++) {
      if (lab[yy * W + xx] !== id) continue;
      const r = Math.hypot(xx - cx, yy - cy);
      if (r >= Rr * 0.5 && r <= Rr * 1.2) on++;
    }
    if (on / n < 0.92) continue;
    let closed = true;
    for (let a = 0; a < 12 && closed; a++) {
      const ang = (a / 12) * Math.PI * 2;
      let hit = false;
      for (let r = Rr * 0.4; r <= Rr * 1.25; r += 0.5) {
        const xx = Math.round(cx + Math.cos(ang) * r), yy = Math.round(cy + Math.sin(ang) * r);
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && lab[yy * W + xx] === id) { hit = true; break; }
      }
      closed = hit;
    }
    if (!closed) continue;
    if (isLetterAt(cx / SC, cy / SC)) continue;
    const b = { x1: x1 / SC, x2: (x2 + 1) / SC, y1: y1 / SC, y2: (y2 + 1) / SC, kind: 'circle' };
    if (!overlaps(b)) boxes.push(b);
  }
}

// "(   )" / "[   ]" / "☐" ที่เป็นตัวอักษร → กล่องติ๊ก (หาขอบจริงจากภาพ)
const PAREN_RE = /[([（［][\s  -​]+[)\]）］]/g;
const BOXCH_RE = /[☐□❏▢◻⬜]/g;
function addTextBoxes(text, R, boxes) {
  const overlaps = (b) => boxes.some((o) => Math.min(o.x2, b.x2) - Math.max(o.x1, b.x1) > 0 && Math.min(o.y2, b.y2) - Math.max(o.y1, b.y1) > 0);
  for (const it of text) {
    const ya = Math.round((it.base - it.size * 0.8) * SC), yb = Math.round((it.base + it.size * 0.25) * SC);
    for (const m of it.str.matchAll(PAREN_RE)) {
      const i = m.index, j = m.index + m[0].length - 1;
      const inL = it.xs[i + 1], inR = it.xs[j];
      const cx = Math.round(((inL + inR) / 2) * SC);
      const lim = Math.round(it.size * 1.6 * SC);
      let L = null, Rr = null;
      for (let xp = cx; xp > cx - lim; xp--) if (colInk(R, xp, ya, yb)) { L = xp; break; }
      for (let xp = cx; xp < cx + lim; xp++) if (colInk(R, xp, ya, yb)) { Rr = xp; break; }
      let x1 = L != null ? (L + 1) / SC : inL, x2 = Rr != null ? Rr / SC : inR;
      if (x2 - x1 < 2 || x2 - x1 > it.size * 4) continue;
      // ความสูงจริงของวงเล็บ
      let top = null, bot = null;
      if (L != null) {
        for (let y = ya; y <= yb; y++) if (colInk(R, L, y, y) || colInk(R, L - 1, y, y)) { if (top == null) top = y; bot = y; }
      }
      const y1 = top != null ? top / SC : it.base - it.size * 0.75, y2 = bot != null ? (bot + 1) / SC : it.base + it.size * 0.2;
      const b = { x1, x2, y1, y2, kind: 'paren' };
      if (!overlaps(b)) boxes.push(b);
    }
    for (const m of it.str.matchAll(BOXCH_RE)) {
      const b = { x1: it.xs[m.index] + it.size * 0.1, x2: it.xs[m.index + 1] - it.size * 0.1, y1: it.base - it.size * 0.72, y2: it.base + 0.5, kind: 'box' };
      if (b.x2 - b.x1 > 2 && !overlaps(b)) boxes.push(b);
    }
  }
}

// แนวนอน: พิกเซลเข้ม "บาง" (เหนือ/ใต้ 3px สว่าง) ต่อกันเป็นเส้น ยอมให้มีช่องว่าง (จุดไข่ปลา)
function scanH(d, W, H) {
  const GAP = 10, O = 3, raw = [];
  for (let y = 8; y < H - 8; y++) {
    const r = y * W, up = (y - O) * W, dn = (y + O) * W;
    let x = 0;
    while (x < W) {
      if (!(d[r + x] && !d[up + x] && !d[dn + x])) { x++; continue; }
      const a = x; let last = x, cnt = 0;
      while (x < W && x - last <= GAP) {
        if (d[r + x] && !d[up + x] && !d[dn + x]) { last = x; cnt++; }
        x++;
      }
      pushRun(raw, d, W, y, a, last, cnt, true);
      x = last + 1;
    }
  }
  return mergeRuns(raw);
}

function scanV(d, W, H) {
  // GAP 4: ให้เส้นตั้งต่อเนื่องผ่านจุดตัดกับเส้นนอน (ตรงนั้นไม่ "บาง") แต่ไม่ต่อข้ามบรรทัด
  const GAP = 4, raw = [], short = [];
  for (let x = 8; x < W - 8; x++) {
    let y = 0;
    while (y < H) {
      const i = y * W + x;
      if (!(d[i] && !d[i - 3] && !d[i + 3])) { y++; continue; }
      const a = y; let last = y, cnt = 0;
      while (y < H && y - last <= GAP) {
        const j = y * W + x;
        if (d[j] && !d[j - 3] && !d[j + 3]) { last = y; cnt++; }
        y++;
      }
      const len = last - a + 1;
      if (cnt / len >= 0.85) {
        if (len >= 24) raw.push({ y: x, a, b: last, dotted: false });
        if (len >= 8 && len <= 90) short.push({ y: x, a, b: last, dotted: false });
      }
      y = last + 1;
    }
  }
  return { long: mergeRuns(raw), short: mergeRuns(short) };
}

// กล่องเล็ก: เส้นตั้งสั้นสองเส้นสูงเท่ากัน ข้างในว่าง และเป็น "กรอบสี่เหลี่ยม" หรือ "วงเล็บ [ ]"
function findBoxes(d, W, H, strokes) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
  const has = (x, ya, yb) => { for (let y = ya; y <= yb; y++) if (at(x, y)) return true; return false; };
  // จำแนกรูปทรงของแต่ละขาก่อน: "[" มีเท้าชี้ขวาบน-ล่างเท่านั้น, "]" ชี้ซ้ายเท่านั้น
  // (ตัวอักษรอย่าง K, I, N มีเชิงทั้งสองข้าง → ไม่ใช่วงเล็บ)
  const st = [...strokes].sort((p, q) => p.y - q.y).map((s) => {
    const x = Math.round(s.y), ym = Math.round((s.a + s.b) / 2);
    let xl = x, xr = x;
    while (xl > 0 && at(xl - 1, ym)) xl--;
    while (xr < W - 1 && at(xr + 1, ym)) xr++;
    // ความสูงจริงของขา (รวมเท้า) วัดจากภาพโดยตรง
    const colDark = (y) => { for (let xx = xl; xx <= xr; xx++) if (at(xx, y)) return true; return false; };
    let a = ym, b = ym;
    while (a > 0 && ym - a < 120 && colDark(a - 1)) a--;
    while (b < H - 1 && b - ym < 120 && colDark(b + 1)) b++;
    // เท้าด้านที่เปิดต้องยาว ≥2px, ด้านตรงข้ามต้องไม่มีเชิงเลย (ตัว I มีเชิงสั้น ๆ ทั้งสองข้าง)
    const foot = (x) => has(x, a, a + 3) && has(x, b - 3, b);
    const any = (x) => has(x, a, a + 3) || has(x, b - 3, b);
    const rMid = has(xr + 2, ym - 1, ym + 1), lMid = has(xl - 2, ym - 1, ym + 1);
    return { ...s, a, b, xl, xr, open: foot(xr + 2) && !any(xl - 1) && !rMid && !lMid, close: foot(xl - 2) && !any(xr + 1) && !rMid && !lMid };
  });
  const used = new Set();
  const out = [];
  for (let i = 0; i < st.length; i++) {
    const L = st[i];
    if (used.has(L)) continue;
    for (let j = i + 1; j < st.length; j++) {
      const R = st[j];
      const dx = R.y - L.y;
      if (dx < 8) continue;
      if (dx > 160) break;
      if (used.has(R)) continue;
      const bracketPair = L.open && R.close;
      const hL = L.b - L.a, hR = R.b - R.a;
      const tol = bracketPair ? 5 : 4;
      if (Math.abs(L.a - R.a) > tol || Math.abs(L.b - R.b) > tol || Math.abs(hL - hR) > 0.3 * Math.max(hL, hR)) continue;
      const lx = L.xr, rx = R.xl;
      const y1 = Math.min(L.a, R.a), y2 = Math.max(L.b, R.b);
      // ข้างในต้องว่าง (เว้นเท้าวงเล็บ)
      const pad = 2;
      let dark = 0, tot = 0;
      for (const yy of [Math.round((2 * y1 + y2) / 3), Math.round((y1 + y2) / 2), Math.round((y1 + 2 * y2) / 3)]) {
        for (let x = lx + pad; x <= rx - pad; x++) { tot++; dark += at(x, yy); }
      }
      if (tot < 6 || dark / tot > 0.04) continue;
      // วงเล็บ: กลางขอบบน/ล่างโล่ง (ไม่ใช่ตัวอักษรมีหลังคาอย่าง n หรือกรอบปิด)
      const cx = Math.round((lx + rx) / 2);
      const openTB = !has(cx, y1 - 3, y1 + 2) && !has(cx, y2 - 2, y2 + 3);
      let square = false;
      if (!(bracketPair && openTB)) {
        // กรอบสี่เหลี่ยม: ขอบบน/ล่างต้องเป็นเส้นตรงแถวเดียว (ตัวอักษรโค้งอย่าง O จะไม่ผ่าน)
        const edge = (ya, yb) => {
          let best = 0;
          for (let y = ya; y <= yb; y++) { let c = 0; for (let x = L.xl; x <= R.xr; x++) c += at(x, y); best = Math.max(best, c / (R.xr - L.xl + 1)); }
          return best;
        };
        // ช่องติ๊กจริงเกือบเป็นสี่เหลี่ยมจัตุรัส (กันช่องว่างแคบระหว่างตัวอักษรมีเชิง เช่น "I N")
        const ratio = (R.xr - L.xl) / (y2 - y1 || 1);
        square = ratio >= 0.6 && ratio <= 1.8 && edge(y1 - 3, y1 + 1) > 0.9 && edge(y2 - 1, y2 + 3) > 0.9;
        if (!square) continue;
      }
      let iy1 = (y1 - 1) / SC, iy2 = (y2 + 2) / SC;
      if (square) {
        // ขอบในบน/ล่างจริงของกรอบ (วัดที่กึ่งกลางกล่อง)
        const cxp = Math.round((L.xr + R.xl) / 2), ym = Math.round((y1 + y2) / 2);
        let yt = ym; while (yt > y1 - 6 && !at(cxp, yt)) yt--;
        let yb = ym; while (yb < y2 + 6 && !at(cxp, yb)) yb++;
        if (at(cxp, yt)) iy1 = (yt + 1) / SC;
        if (at(cxp, yb)) iy2 = yb / SC;
        // ช่องว่างข้างในตัวอักษรหนา (เช่นใน "H", "M") ไม่ใช่กล่องติ๊ก — กล่องจริงข้างในกว้าง ≥ 4.5 pt
        if ((R.xl - L.xr - 1) / SC < 4.5 || iy2 - iy1 < 4.5) continue;
      }
      used.add(L); used.add(R);
      out.push({ x1: (L.xr + 1) / SC, x2: R.xl / SC, y1: iy1, y2: iy2, kind: square ? 'box' : 'bracket' });
      break;
    }
  }
  return out;
}

function pushRun(raw, d, W, y, a, b, cnt, horiz) {
  const len = b - a + 1;
  const dens = cnt / len;
  if (dens >= 0.85 && len >= 24) { raw.push({ y, a, b, dotted: false }); return; }
  if (dens < 0.15 || len < 24) return;
  // จุดไข่ปลา: แถบเหนือและใต้ต้องโล่ง — ตัดเส้นออกตรงที่มีตัวอักษร (ป้ายกำกับที่อยู่บนฐานเดียวกัน)
  // จึงได้ "ชื่อกิจกรรม......" เป็นเส้นเฉพาะส่วนจุด และ "ร้อยละ....2) ผลที่ได้รับ...." แยกเป็นสองเส้น
  const row = y * W, r1 = (y - 6) * W, r2 = (y - 9) * W, r3 = (y + 6) * W;
  let sa = -1, se = -1, cntS = 0, dirtyRun = 0;
  const flush = () => {
    if (sa >= 0 && se - sa + 1 >= 24 && cntS / (se - sa + 1) >= 0.15) raw.push({ y, a: sa, b: se, dotted: true });
    sa = -1; cntS = 0;
  };
  for (let x = a; x <= b; x++) {
    if (d[r1 + x] || d[r2 + x] || d[r3 + x]) {
      if (++dirtyRun > 2) flush();
      continue;
    }
    dirtyRun = 0;
    if (d[row + x]) { if (sa < 0) sa = x; se = x; cntS++; }
  }
  flush();
}

// รวมแถวติดกัน (เส้นหนาหลายพิกเซล) เป็นเส้นเดียว
function mergeRuns(raw) {
  raw.sort((p, q) => p.y - q.y || p.a - q.a);
  const out = [];
  const open = [];
  for (const r of raw) {
    let hit = null;
    for (const o of open) {
      if (r.y - o.yLast <= 2 && Math.min(o.b, r.b) - Math.max(o.a, r.a) > 0.5 * Math.min(o.b - o.a, r.b - r.a)) { hit = o; break; }
    }
    if (hit) {
      hit.a = Math.min(hit.a, r.a); hit.b = Math.max(hit.b, r.b);
      hit.ySum += r.y; hit.n++; hit.yLast = r.y; hit.dotted = hit.dotted && r.dotted;
    } else {
      const o = { a: r.a, b: r.b, ySum: r.y, n: 1, yLast: r.y, dotted: r.dotted };
      open.push(o); out.push(o);
    }
    for (let i = open.length - 1; i >= 0; i--) if (r.y - open[i].yLast > 2) open.splice(i, 1);
  }
  return out.filter((o) => o.n <= 8).map((o) => ({ y: o.ySum / o.n, a: o.a, b: o.b, dotted: o.dotted, t: o.n }));
}

// ---------- การวางอัจฉริยะ ----------
const covers = (a, b, v, tol = 2) => v >= a - tol && v <= b + tol;

export function findCell(lines, pt) {
  if (!lines) return null;
  let top = null, bot = null, left = null, right = null;
  for (const l of lines.hLines) {
    if (l.dotted || !covers(l.x1, l.x2, pt.x)) continue;
    if (l.y <= pt.y && (!top || l.y > top.y)) top = l;
    if (l.y > pt.y && (!bot || l.y < bot.y)) bot = l;
  }
  for (const l of lines.vLines) {
    if (!covers(l.y1, l.y2, pt.y)) continue;
    if (l.x <= pt.x && (!left || l.x > left.x)) left = l;
    if (l.x > pt.x && (!right || l.x < right.x)) right = l;
  }
  if (!top || !bot || !left || !right) return null;
  // ขอบใน = กึ่งกลางเส้น ± ครึ่งความหนา
  const ht = (l) => (l.t || 0.5) / 2;
  const ix1 = left.x + ht(left), ix2 = right.x - ht(right), iy1 = top.y + ht(top), iy2 = bot.y - ht(bot);
  return { x1: left.x, x2: right.x, y1: top.y, y2: bot.y, w: right.x - left.x, h: bot.y - top.y, ix1, ix2, iy1, iy2, iw: ix2 - ix1, ih: iy2 - iy1 };
}

// เส้น (ทึบหรือจุดไข่ปลา) ที่อยู่ใต้จุดคลิก ภายในระยะ
export function findLineUnder(lines, pt, maxBelow = 22, maxAbove = 5) {
  if (!lines) return null;
  let best = null;
  for (const l of lines.hLines) {
    if (!covers(l.x1, l.x2, pt.x, 3)) continue;
    const dy = l.y - pt.y;
    if (dy < -maxAbove || dy > maxBelow) continue;
    if (!best || Math.abs(dy) < Math.abs(best.y - pt.y)) best = l;
  }
  return best;
}

const DEF = {
  text: { w: 140, h: 18 }, multiline: { w: 240, h: 54 }, date: { w: 110, h: 18 },
  checkbox: { w: 12, h: 12 }, signature: { w: 120, h: 40 },
};
export const defaultSize = (type) => DEF[type] || DEF.text;

// คลิกครั้งเดียว → เดาขนาด/ตำแหน่งช่องจากเส้นในเอกสาร
export function findBoxIn(lines, pt, tol = 2.5) {
  let best = null;
  for (const b of lines?.boxes || []) {
    if (pt.x < b.x1 - tol || pt.x > b.x2 + tol || pt.y < b.y1 - tol || pt.y > b.y2 + tol) continue;
    if (!best || (b.x2 - b.x1) * (b.y2 - b.y1) < (best.x2 - best.x1) * (best.y2 - best.y1)) best = b;
  }
  return best;
}

// gap = ระยะห่างจากขอบในของกรอบ (pt) · 0 = ชิดเส้นพอดี
export const innerRect = (c, gap = 0) => ({ x: c.ix1 + gap, y: c.iy1 + gap, w: c.iw - 2 * gap, h: c.ih - 2 * gap });
export function boxRect(box, gap = 0) {
  if (box.kind === 'circle') {
    const k = Math.min(box.x2 - box.x1, box.y2 - box.y1) * 0.2;
    return { x: box.x1 + k, y: box.y1 + k, w: box.x2 - box.x1 - 2 * k, h: box.y2 - box.y1 - 2 * k, checkStyle: 'dot' };
  }
  return { x: box.x1 + gap, y: box.y1 + gap, w: box.x2 - box.x1 - 2 * gap, h: box.y2 - box.y1 - 2 * gap };
}

export function smartRect(lines, pt, type, page, gap = 0) {
  const def = defaultSize(type);
  const box = findBoxIn(lines, pt);
  if (box) return { ...boxRect(box, gap), smart: true };
  const fallback = { x: pt.x - 2, y: pt.y - def.h / 2, w: def.w, h: def.h, smart: false };
  if (type === 'checkbox') {
    const c = findCell(lines, pt);
    if (c && c.w <= 34 && c.h <= 34) return { ...innerRect(c, gap), smart: true };
    return { x: pt.x - 6, y: pt.y - 6, w: 12, h: 12, smart: false };
  }
  const cell = findCell(lines, pt);
  const ln = findLineUnder(lines, pt);
  if (ln && (!cell || ln.y <= cell.y2 + 1)) {
    let x1 = ln.x1, x2 = ln.x2;
    if (cell) { x1 = Math.max(x1, cell.ix1 + gap); x2 = Math.min(x2, cell.ix2 - gap); }
    let h = type === 'signature' ? 36 : type === 'multiline' ? def.h : 17;
    let top = ln.y - h + 1;
    // ไม่ให้ทับเส้นบรรทัดก่อนหน้า
    for (const l of lines.hLines) {
      if (l !== ln && l.y < ln.y - 4 && l.y > top && Math.min(l.x2, x2) - Math.max(l.x1, x1) > 4) top = l.y + 1;
    }
    if (ln.y + 1 - top < 8) top = ln.y - 9;
    return { x: x1, y: top, w: Math.max(8, x2 - x1), h: ln.y + 1 - top, vAlign: 'bottom', smart: true };
  }
  if (cell && cell.w <= 520 && cell.h <= 180 && cell.w >= 8 && cell.h >= 8) {
    return { ...innerRect(cell, gap), smart: true };
  }
  if (page) { fallback.x = Math.min(Math.max(0, fallback.x), page.w - def.w); fallback.y = Math.max(0, fallback.y); }
  return fallback;
}

// หากล่องเล็ก (เช่น ☐) รอบจุดคลิก ด้วยการเรนเดอร์ภาพเฉพาะบริเวณ
export async function findBoxAt(page, pt) {
  const S = 6, R = 22, N = R * 2 * S;
  const vp = page.getViewport({ scale: S, offsetX: -(pt.x - R) * S, offsetY: -(pt.y - R) * S });
  const cv = document.createElement('canvas');
  cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, N, N);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const d = darkMap(ctx, N, N);
  const c = R * S;
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : d[y * N + x]);
  // จุดคลิกอาจอยู่บนเส้น → ขยับหาจุดว่างใกล้ที่สุด
  let cx = c, cy = c;
  if (at(cx, cy)) {
    outer: for (let r = 1; r < 3 * S; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (!at(c + dx, c + dy)) { cx = c + dx; cy = c + dy; break outer; }
  }
  const ray = (dx, dy) => { let x = cx, y = cy; for (let i = 0; i < N; i++) { x += dx; y += dy; if (at(x, y)) return i + 1; if (x < 0 || y < 0 || x >= N || y >= N) return null; } return null; };
  const l = ray(-1, 0), r = ray(1, 0), u = ray(0, -1), dn = ray(0, 1);
  cv.width = cv.height = 0;
  if (!l || !r || !u || !dn) return null;
  const w = (l + r) / S, hh = (u + dn) / S;
  if (w < 4 || hh < 4 || w > 36 || hh > 36 || Math.max(w, hh) / Math.min(w, hh) > 2.2) return null;
  const x0 = pt.x + (cx - c - l) / S, y0 = pt.y + (cy - c - u) / S;
  return { x: x0 + 0.6, y: y0 + 0.6, w: w - 1.2, h: hh - 1.2 };
}

// เส้นตารางภายในกรอบที่ลาก
export function gridIn(lines, r) {
  const tol = 3;
  const ov = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const dedupe = (arr) => arr.sort((a, b) => a - b).filter((v, i, s) => i === 0 || v - s[i - 1] > 3);
  if (!lines) return { xs: [], ys: [] };
  const xs = lines.vLines.filter((l) => l.x >= r.x - tol && l.x <= r.x + r.w + tol && ov(l.y1, l.y2, r.y, r.y + r.h) >= 0.5 * r.h).map((l) => l.x);
  const ys = lines.hLines.filter((l) => !l.dotted && l.y >= r.y - tol && l.y <= r.y + r.h + tol && ov(l.x1, l.x2, r.x, r.x + r.w) >= 0.5 * r.w).map((l) => l.y);
  return { xs: dedupe(xs), ys: dedupe(ys) };
}

// ---------- จุดยึด (snap) ----------
export function snapCandidates(lines, fields) {
  const xs = [], ys = [], cxs = [], cys = [];
  if (lines) {
    for (const b of lines.boxes || []) { xs.push(b.x1, b.x2); ys.push(b.y1, b.y2); cxs.push((b.x1 + b.x2) / 2); cys.push((b.y1 + b.y2) / 2); }
    for (const l of lines.vLines) { xs.push(l.x); ys.push(l.y1, l.y2); }
    for (const l of lines.hLines) { ys.push(l.y); if (!l.dotted) xs.push(l.x1, l.x2); }
  }
  for (const f of fields) { xs.push(f.x, f.x + f.w); ys.push(f.y, f.y + f.h); cxs.push(f.x + f.w / 2); cys.push(f.y + f.h / 2); }
  return { xs, ys, cxs, cys };
}

function nearest(vals, targets, thr) {
  let best = null;
  for (const t of targets) for (const v of vals) {
    const d = v - t;
    if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: v };
  }
  return best;
}

const closer = (a, b) => (!a ? b : !b ? a : Math.abs(b.d) < Math.abs(a.d) ? b : a);

// ย้ายทั้งกรอบ: ลองยึดขอบซ้าย/ขวา/บน/ล่าง และกึ่งกลาง (เช่น ช่องติ๊กให้อยู่กลางวงเล็บ)
export function snapMove(r, cand, thr) {
  const sx = closer(nearest(cand.xs, [r.x, r.x + r.w], thr), nearest(cand.cxs || [], [r.x + r.w / 2], thr));
  const sy = closer(nearest(cand.ys, [r.y, r.y + r.h], thr), nearest(cand.cys || [], [r.y + r.h / 2], thr));
  return { dx: sx ? sx.d : 0, dy: sy ? sy.d : 0, gx: sx?.at ?? null, gy: sy?.at ?? null };
}

export function snapValue(v, vals, thr) {
  const s = nearest(vals, [v], thr);
  return s ? { v: s.at, g: s.at } : { v, g: null };
}
