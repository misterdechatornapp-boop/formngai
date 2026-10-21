// วันที่แบบไทย (พ.ศ.)
export const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const MONTHS_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// รูปแบบวันที่ แยกภาษา (ช่องวันที่เก็บ dateLang: 'th' | 'en')
//   โทเคน: d dd · m mm mmm mmmm · bbbb bb (พ.ศ.) · yyyy yy (ค.ศ.) · dddd (ชื่อวัน)
export const DATE_FORMATS_BY_LANG = {
  th: [
    { id: 'd mmmm bbbb', label: '16 ตุลาคม 2569' },
    { id: 'd mmm bbbb', label: '16 ต.ค. 2569' },
    { id: 'd mmm bb', label: '16 ต.ค. 69' },
    { id: 'd/m/bbbb', label: '16/10/2569' },
    { id: 'dd/mm/bbbb', label: '16/10/2569 (2 หลัก)' },
    { id: 'dd/mm/bb', label: '16/10/69' },
    { id: 'dddd d mmm bbbb', label: 'พฤหัสบดี 16 ต.ค. 2569' },
    { id: 'dd/mm/yyyy', label: '16/10/2026 (ค.ศ.)' },
    { id: 'd', label: 'เฉพาะวันที่ (16)' },
    { id: 'mmmm', label: 'เฉพาะเดือน (ตุลาคม)' },
    { id: 'bbbb', label: 'เฉพาะปี พ.ศ. (2569)' },
  ],
  en: [
    { id: 'd mmm yyyy', label: '16 Oct 2026' },
    { id: 'd mmmm yyyy', label: '16 October 2026' },
    { id: 'mmm d, yyyy', label: 'Oct 16, 2026' },
    { id: 'mmmm d, yyyy', label: 'October 16, 2026' },
    { id: 'd mmm yy', label: '16 Oct 26' },
    { id: 'dd/mm/yyyy', label: '16/10/2026 (วัน/เดือน)' },
    { id: 'mm/dd/yyyy', label: '10/16/2026 (เดือน/วัน)' },
    { id: 'yyyy-mm-dd', label: '2026-10-16' },
    { id: 'dddd, d mmmm yyyy', label: 'Thursday, 16 October 2026' },
    { id: 'd', label: 'Day only (16)' },
    { id: 'mmmm', label: 'Month only (October)' },
    { id: 'yyyy', label: 'Year only (2026)' },
  ],
};
export const DATE_FORMATS = DATE_FORMATS_BY_LANG.th; // ใช้กับโค้ดเดิม
export const DEFAULT_DATE_FORMAT = { th: 'd mmmm bbbb', en: 'd mmm yyyy' };

const pad = (n) => String(n).padStart(2, '0');

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }

export function formatDate(iso, fmt = 'd mmmm bbbb', lang = 'th') {
  if (!isISO(iso)) return iso || '';
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const en = lang === 'en';
  return fmt.replace(/dddd|dd|d|mmmm|mmm|mm|m|bbbb|bb|yyyy|yy/g, (t) => ({
    dddd: en ? DAYS_EN[dow] : DAYS[dow], dd: pad(d), d: String(d),
    mmmm: en ? MONTHS_EN[m - 1] : MONTHS[m - 1], mmm: en ? MONTHS_EN[m - 1].slice(0, 3) : MONTHS_S[m - 1],
    mm: pad(m), m: String(m), bbbb: String(y + 543), bb: pad((y + 543) % 100), yyyy: String(y), yy: pad(y % 100),
  }[t]));
}

// แปลงค่าวันที่หลายรูปแบบ (เช่นจาก Google Sheets) เป็น yyyy-mm-dd; ไม่รู้จัก → null
export function parseDateLoose(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    let y = +m[3];
    if (y < 100) y += y > 50 ? 2400 : 2500; // 69 → 2569
    return mk(y, +m[2], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/))) {
    const name = m[2].replace(/\.$/, '');
    let mi = MONTHS.indexOf(name);
    if (mi < 0) mi = MONTHS_S.findIndex((x) => x.replace(/\.$/, '') === name);
    if (mi >= 0) return mk(+m[3], mi + 1, +m[1]);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { // เลขวันที่ของสเปรดชีต
    const d = new Date(Math.round((+s - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

function mk(y, m, d) {
  if (y > 2400) y -= 543;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function fmtStamp(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS_S[d.getMonth()]} ${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
