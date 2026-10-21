// สูตรคำนวณแบบ Excel ในช่อง: เริ่มด้วย "=" · อ้างถึงช่องด้วย [ชื่อช่อง]
//   ตัวดำเนินการ: + - * / ^ % ( )   ฟังก์ชัน: SUM AVERAGE MIN MAX COUNT ROUND ABS
//   เช่น  =SUM([ค่าที่พัก 1], [ค่าเดินทาง 1]) * 1.07   ·   =ROUND([รวม] / 3, 2)
// คำนวณเฉพาะในแอป แล้วเก็บผลเป็นค่าของช่อง (จึงฝังลง PDF ได้ทุกโหมด)

const FUNCS = {
  SUM: (xs) => nums(xs).reduce((a, b) => a + b, 0),
  AVERAGE: (xs) => { const n = nums(xs); if (!n.length) throw new FErr('#DIV/0!'); return n.reduce((a, b) => a + b, 0) / n.length; },
  MIN: (xs) => { const n = nums(xs); return n.length ? Math.min(...n) : 0; },
  MAX: (xs) => { const n = nums(xs); return n.length ? Math.max(...n) : 0; },
  COUNT: (xs) => nums(xs).length,
  ROUND: (xs) => { const [x, d = 0] = xs.map(req); const k = 10 ** Math.trunc(d); return Math.round((x + Math.sign(x) * Number.EPSILON) * k) / k; },
  ABS: (xs) => Math.abs(req(xs[0])),
};
export const FUNC_NAMES = Object.keys(FUNCS);

class FErr extends Error {}

// ค่าในช่อง → ตัวเลข (รับ "1,500", "1500 บาท", "฿1,500.50", เลขไทย ๑๒๓) · ว่าง → null · ไม่ใช่ตัวเลข → NaN
export function toNumber(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)))
    .replace(/[,\s]/g, '').replace(/^฿/, '').replace(/(บาท|บ\.|฿)$/, '');
  if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1); // (1,000) = -1000 แบบบัญชี
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
}
// ฟังก์ชันรวม: ข้ามช่องว่างและข้อความ (เหมือน Excel)
const nums = (xs) => xs.flat().filter((x) => typeof x === 'number' && Number.isFinite(x));
// การคำนวณตรง ๆ: ว่าง = 0 · ข้อความ = #VALUE!
function req(x) {
  if (x === null) return 0;
  if (typeof x !== 'number' || Number.isNaN(x)) throw new FErr('#VALUE!');
  return x;
}

// ---------- แปลงสูตร ----------
function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') {
      const j = src.indexOf(']', i + 1);
      if (j < 0) throw new FErr('ขาด ] ปิดชื่อช่อง');
      t.push({ k: 'ref', v: src.slice(i + 1, j).trim() });
      i = j + 1; continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (num) { t.push({ k: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_]+/.exec(src.slice(i));
    if (id) { t.push({ k: 'id', v: id[0].toUpperCase(), raw: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),%'.includes(c)) { t.push({ k: c }); i++; continue; }
    if (c === '，') { t.push({ k: ',' }); i++; continue; }
    throw new FErr(`ไม่รู้จักตัวอักษร “${c}”`);
  }
  return t;
}

export function parseFormula(src) {
  const body = String(src || '').replace(/^\s*=/, '');
  if (!body.trim()) return { error: 'สูตรว่าง' };
  try {
    const t = tokenize(body);
    let p = 0;
    const peek = () => t[p], eat = (k) => { if (t[p]?.k !== k) throw new FErr(k === ')' ? 'ขาดวงเล็บปิด )' : `ต้องมี “${k}”`); return t[p++]; };
    const refs = new Set();
    const expr = () => {
      let n = term();
      while (peek()?.k === '+' || peek()?.k === '-') { const op = t[p++].k; n = { op, a: n, b: term() }; }
      return n;
    };
    const term = () => {
      let n = power();
      while (peek()?.k === '*' || peek()?.k === '/') { const op = t[p++].k; n = { op, a: n, b: power() }; }
      return n;
    };
    const power = () => {
      const n = unary();
      return peek()?.k === '^' ? (p++, { op: '^', a: n, b: power() }) : n;
    };
    const unary = () => {
      if (peek()?.k === '-') { p++; return { op: 'neg', a: unary() }; }
      if (peek()?.k === '+') { p++; return unary(); }
      let n = primary();
      while (peek()?.k === '%') { p++; n = { op: '%', a: n }; }
      return n;
    };
    const primary = () => {
      const k = t[p];
      if (!k) throw new FErr('สูตรไม่จบ');
      if (k.k === 'num') { p++; return { num: k.v }; }
      if (k.k === 'ref') { p++; if (!k.v) throw new FErr('ชื่อช่องว่าง []'); refs.add(k.v); return { ref: k.v }; }
      if (k.k === '(') { p++; const n = expr(); eat(')'); return n; }
      if (k.k === 'id') {
        p++;
        if (!FUNCS[k.v]) throw new FErr(peek()?.k === '(' ? `ไม่รู้จักฟังก์ชัน ${k.v} (มี ${FUNC_NAMES.join(', ')})` : `ชื่อช่องต้องอยู่ใน [ ] เช่น [${k.raw}]`);
        eat('(');
        const args = [];
        if (peek()?.k !== ')') { args.push(expr()); while (peek()?.k === ',') { p++; args.push(expr()); } }
        eat(')');
        return { fn: k.v, args };
      }
      throw new FErr(`ไม่คาดว่าจะเจอ “${k.k}”`);
    };
    const ast = expr();
    if (p < t.length) throw new FErr(`มีส่วนเกินที่ “${t[p].k === 'ref' ? '[' + t[p].v + ']' : t[p].v ?? t[p].k}”`);
    return { ast, refs };
  } catch (e) {
    return { error: e.message };
  }
}

function evalNode(n, get) {
  if ('num' in n) return n.num;
  if ('ref' in n) return get(n.ref);
  if (n.fn) {
    // อาร์กิวเมนต์ที่เป็นช่องตรง ๆ ส่งค่าดิบ (ให้ SUM ข้ามช่องว่าง/ข้อความได้) ที่เหลือคำนวณก่อน
    return FUNCS[n.fn](n.args.map((a) => ('ref' in a ? get(a.ref) : evalNode(a, get))));
  }
  if (n.op === 'neg') return -req(evalNode(n.a, get));
  if (n.op === '%') return req(evalNode(n.a, get)) / 100;
  const a = req(evalNode(n.a, get)), b = req(evalNode(n.b, get));
  switch (n.op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': if (b === 0) throw new FErr('#DIV/0!'); return a / b;
    case '^': return a ** b;
  }
  throw new FErr('#ERROR!');
}

// ---------- รูปแบบตัวเลข ----------
export const NUM_FORMATS = [
  ['auto', 'อัตโนมัติ (1,234 / 1,234.5)'],
  ['#,##0.00', '1,234.50'],
  ['#,##0', '1,235'],
  ['0.00', '1234.50'],
  ['0', '1235'],
];
export function formatNumber(x, fmt = 'auto') {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '';
  const opt = {
    auto: { minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: true },
    '#,##0.00': { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true },
    '#,##0': { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: true },
    '0.00': { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false },
    '0': { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: false },
  }[fmt] || {};
  return new Intl.NumberFormat('en-US', opt).format(x);
}

// ---------- คำนวณทุกสูตรในเอกสาร ----------
// คืน { values: ค่าใหม่ทั้งหมด, errors: Map(ชื่อช่อง → ข้อความผิดพลาด) } — สูตรอ้างกันเป็นวง → #CIRC!
export function computeAll(fields, values) {
  const out = { ...values };
  const errors = new Map();
  const defs = new Map();
  for (const f of fields) if (f.formula && !defs.has(f.name)) defs.set(f.name, f);
  if (!defs.size) return { values: out, errors };
  const raw = new Map(), state = new Map();
  const get = (name) => {
    if (defs.has(name)) {
      const v = calc(name);
      if (errors.has(name)) throw new FErr(errors.get(name)); // ส่งต่อข้อผิดพลาดของสูตรที่อ้างถึง
      return v;
    }
    return toNumber(out[name]);
  };
  const calc = (name) => {
    if (state.get(name) === 'done') return raw.get(name);
    if (state.get(name) === 'busy') throw new FErr('#CIRC!');
    state.set(name, 'busy');
    const f = defs.get(name);
    let v;
    try {
      const parsed = parseFormula(f.formula);
      if (parsed.error) throw new FErr('#ERROR!');
      for (const r of parsed.refs) if (!defs.has(r) && !fields.some((x) => x.name === r)) throw new FErr(`#REF! [${r}]`);
      v = evalNode(parsed.ast, get);
      if (typeof v !== 'number' || !Number.isFinite(v)) v = v === null ? 0 : NaN;
      if (Number.isNaN(v)) throw new FErr('#VALUE!');
      out[name] = formatNumber(v, f.numFormat || 'auto');
    } catch (e) {
      errors.set(name, e.message);
      out[name] = e.message.startsWith('#') ? e.message.split(' ')[0] : '#ERROR!';
      v = NaN;
    }
    raw.set(name, v);
    state.set(name, 'done');
    return v;
  };
  for (const name of defs.keys()) calc(name);
  return { values: out, errors };
}
