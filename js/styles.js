// พรีเซท (สไตล์) + กลุ่มช่อง
//   พรีเซท: { id, name, font, bold, fontSize, color, align }  — ค่า null = "ไม่กำหนด" (ให้แต่ละช่องตั้งเอง)
//           fontSize 0 = ขนาดอัตโนมัติ
//   กลุ่ม (ต่อเอกสาร): doc.groups = [{ name, preset }]  — ช่องอยู่กลุ่มไหนดูจาก field.group
//   ลำดับการใช้ค่า: ค่าที่พรีเซทของกลุ่มกำหนด  >  ค่าของช่องเอง  >  ค่าเริ่มต้น
export const STYLE_KEYS = ['font', 'bold', 'fontSize', 'color', 'align'];

export const DEFAULT_PRESETS = [
  { id: 'p-normal', name: 'ปกติ', font: 'sarabun', bold: false, fontSize: null, color: '#000000', align: null },
  { id: 'p-bold', name: 'ตัวหนา', font: null, bold: true, fontSize: null, color: null, align: null },
  { id: 'p-hand-blue', name: 'ลายมือ น้ำเงิน', font: 'charmonman', bold: false, fontSize: null, color: '#1d3fb8', align: null },
  { id: 'p-small', name: 'ตัวเล็ก 10 pt', font: null, bold: null, fontSize: 10, color: null, align: null },
  { id: 'p-center', name: 'กึ่งกลาง ตัวหนา', font: null, bold: true, fontSize: null, color: null, align: 'center' },
];

export const isSet = (v) => v !== null && v !== undefined && v !== '';

export function groupOf(doc, name) {
  if (!name) return null;
  return (doc.groups || []).find((g) => g.name === name) || null;
}

export function presetOf(presets, id) {
  return presets.find((p) => p.id === id) || null;
}

// ช่องที่รวมสไตล์แล้ว (ไม่แก้ object เดิม) · ._by = ค่าไหนมาจากพรีเซท
export function resolveField(f, doc, presets) {
  const out = { ...f, font: f.font || 'sarabun', bold: !!f.bold };
  const g = groupOf(doc, f.group);
  const p = g && presetOf(presets, g.preset);
  out._by = {};
  if (p) {
    for (const k of STYLE_KEYS) {
      if (isSet(p[k])) { out[k] = p[k]; out._by[k] = p.name; }
    }
  }
  return out;
}

// รายชื่อกลุ่มทั้งหมด: ที่บันทึกไว้ + ที่มีช่องอ้างถึง (เช่น "ตาราง1" จากเครื่องมือตาราง)
export function allGroups(doc) {
  const list = [...(doc.groups || [])];
  for (const f of doc.fields) if (f.group && !list.some((g) => g.name === f.group)) list.push({ name: f.group, preset: null });
  return list;
}

export function newPresetId() { return 'p-' + Math.random().toString(36).slice(2, 9); }
