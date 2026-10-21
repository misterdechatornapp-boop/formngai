// ที่เก็บข้อมูลในเครื่อง (IndexedDB)
// ออกแบบเป็นชั้นแยก เพื่ออนาคตสลับ/ซิงก์กับ Google Drive หรือฐานข้อมูลออนไลน์ได้โดยไม่ต้องแก้ส่วนอื่น
//   docs:  { id, name, pageCount, pages:[{w,h}], fields:[], values:{}, merge, thumb, createdAt, updatedAt }
//   files: { id, bytes }   (ไฟล์ PDF ต้นฉบับ)
//   kv:    { key, value }  (ลายเซ็นที่บันทึกไว้ ฯลฯ)
const DB_NAME = 'pdf-form-easy';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('docs', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' });
      d.createObjectStore('kv', { keyPath: 'key' });
    };
    r.onsuccess = () => {
      const d = r.result;
      // มีการลบ/อัปเกรดฐานข้อมูลจากที่อื่น (แท็บอื่น, เวอร์ชันใหม่) → ปล่อยการเชื่อมต่อ ไม่ให้ค้าง แล้วเปิดใหม่ครั้งถัดไป
      d.onversionchange = () => { d.close(); dbp = null; };
      d.onclose = () => { dbp = null; };
      resolve(d);
    };
    r.onerror = () => { dbp = null; reject(r.error); };
    r.onblocked = () => console.warn('IndexedDB ถูกแท็บอื่นของแอปนี้ใช้อยู่ — ปิดแท็บอื่นแล้วลองใหม่');
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const req = fn(s);
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const Store = {
  getDoc: (id) => tx('docs', 'readonly', (s) => s.get(id)),
  putDoc: (doc) => tx('docs', 'readwrite', (s) => s.put(doc)),
  listDocs: async () => {
    const all = (await tx('docs', 'readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  deleteDoc: async (id) => {
    await tx('docs', 'readwrite', (s) => s.delete(id));
    await tx('files', 'readwrite', (s) => s.delete(id));
  },
  getFile: async (id) => (await tx('files', 'readonly', (s) => s.get(id)))?.bytes || null,
  putFile: (id, bytes) => tx('files', 'readwrite', (s) => s.put({ id, bytes })),
  get: async (key, def = null) => (await tx('kv', 'readonly', (s) => s.get(key)))?.value ?? def,
  set: (key, value) => tx('kv', 'readwrite', (s) => s.put({ key, value })),
};
