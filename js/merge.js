// ข้อมูลจากตาราง (Google Sheets / CSV) → ค่าในช่อง

// แยก CSV/TSV (รองรับเครื่องหมายคำพูดและขึ้นบรรทัดใหม่ในเซลล์)
export function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length && firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!clean.length) return { headers: [], rows: [] };
  const headers = clean[0].map((h, i) => h.trim() || `คอลัมน์ ${i + 1}`);
  const body = clean.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
  return { headers, rows: body };
}

const norm = (s) => String(s).toLowerCase().replace(/[\s_\-.:()]/g, '');

// จับคู่ชื่อช่องกับหัวคอลัมน์อัตโนมัติ
export function autoMap(names, headers, prev = {}) {
  const map = {};
  for (const n of names) {
    if (prev[n] && headers.includes(prev[n])) { map[n] = prev[n]; continue; }
    const nn = norm(n);
    let hit = headers.find((h) => norm(h) === nn);
    if (!hit && nn.length >= 2) hit = headers.find((h) => norm(h).includes(nn) || nn.includes(norm(h)) && norm(h).length >= 2);
    map[n] = hit || '';
  }
  return map;
}

export function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return !!s && !['0', 'false', 'no', 'n', 'ไม่', 'ไม่ใช่', '-', 'off'].includes(s);
}

// ลิงก์ Google Sheet ที่แชร์แบบ "ทุกคนที่มีลิงก์ดูได้" → CSV (ต้องออนไลน์)
export async function fetchGoogleSheet(url) {
  const id = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/)?.[1];
  if (!id) throw new Error('ไม่พบรหัสชีตในลิงก์');
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] || '0';
  const tries = [
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`,
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`,
  ];
  let lastErr;
  for (const u of tries) {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      if (/^\s*<!doctype html|<html/i.test(t)) throw new Error('ชีตยังไม่ได้แชร์แบบสาธารณะ');
      return t;
    } catch (e) { lastErr = e; }
  }
  throw new Error('โหลดชีตไม่ได้ — ตรวจว่าแชร์เป็น "ทุกคนที่มีลิงก์" แล้ว (' + (lastErr?.message || '') + ')');
}
