// คลังฟอนต์ (ไฟล์อยู่ใน fonts/ ใช้ออฟไลน์ได้ · ทุกตัวเป็น SIL Open Font License)
// แต่ละฟอนต์โหลดครั้งเดียว: ได้ทั้ง fontkit (วัด/จัดรูปข้อความ, ฝังใน PDF) และ FontFace (พรีวิวบนจอ)
export const FONTS = [
  { id: 'sarabun', label: 'Sarabun', note: 'ทางการ', files: { 400: 'Sarabun-Regular.ttf', 700: 'Sarabun-Bold.ttf' } },
  { id: 'kanit', label: 'Kanit', note: 'หัวกลม ทันสมัย', files: { 400: 'Kanit-Regular.ttf', 700: 'Kanit-Bold.ttf' } },
  { id: 'prompt', label: 'Prompt', note: 'ไม่มีหัว อ่านง่าย', files: { 400: 'Prompt-Regular.ttf', 700: 'Prompt-Bold.ttf' } },
  { id: 'chakrapetch', label: 'Chakra Petch', note: 'เหลี่ยม', files: { 400: 'ChakraPetch-Regular.ttf', 700: 'ChakraPetch-Bold.ttf' } },
  { id: 'taviraj', label: 'Taviraj', note: 'มีเชิง', files: { 400: 'Taviraj-Regular.ttf', 700: 'Taviraj-Bold.ttf' } },
  { id: 'charmonman', label: 'Charmonman', note: 'ลายมือ', files: { 400: 'Charmonman-Regular.ttf', 700: 'Charmonman-Bold.ttf' } },
  { id: 'sriracha', label: 'Sriracha', note: 'ลายมือ', files: { 400: 'Sriracha-Regular.ttf' } },
  { id: 'itim', label: 'Itim', note: 'ลายมือ', files: { 400: 'Itim-Regular.ttf' } },
];

export const DEFAULT_FONT = 'sarabun';
export const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
export const hasBold = (id) => !!fontById(id).files[700];
export const weightOf = (id, bold) => (bold && hasBold(id) ? 700 : 400);
export const fontKey = (id, bold) => `${fontById(id).id}-${weightOf(id, bold)}`;
export const cssFamily = (id) => `pf-${fontById(id).id}`;

const loaded = new Map();   // key → { fk, bytes }
const pending = new Map();  // key → Promise
const listeners = new Set();
export const onFontLoaded = (fn) => listeners.add(fn);

export function fontEntry(key) { return loaded.get(key) || null; }

export function loadFont(id, bold = false) {
  const key = fontKey(id, bold);
  if (loaded.has(key)) return Promise.resolve(loaded.get(key));
  if (pending.has(key)) return pending.get(key);
  const f = fontById(id), w = weightOf(id, bold);
  const p = (async () => {
    const r = await fetch(new URL(`../fonts/${f.files[w]}`, import.meta.url));
    if (!r.ok) throw new Error('โหลดฟอนต์ไม่ได้: ' + f.label);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const fk = window.fontkit.create(bytes);
    try {
      const face = new FontFace(cssFamily(id), bytes, { weight: String(w) });
      await face.load();
      document.fonts.add(face);
    } catch (e) { console.warn('FontFace', e); }
    const entry = { fk, bytes, key };
    loaded.set(key, entry);
    pending.delete(key);
    listeners.forEach((fn) => fn(key));
    return entry;
  })();
  pending.set(key, p);
  return p;
}

// คืนฟอนต์ที่พร้อมใช้ทันที; ถ้ายังไม่โหลด สั่งโหลดแล้วใช้ Sarabun ไปก่อน (เมื่อโหลดเสร็จจะแจ้ง listeners ให้วาดใหม่)
export function fontNow(id, bold) {
  const e = loaded.get(fontKey(id, bold));
  if (e) return e;
  loadFont(id, bold).catch((err) => console.warn(err));
  return loaded.get(fontKey(DEFAULT_FONT, bold)) || loaded.get(fontKey(DEFAULT_FONT, false));
}
