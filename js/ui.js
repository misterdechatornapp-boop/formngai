// กล่องโต้ตอบ, เมนู, toast — ไม่ใช้ alert/confirm/prompt ของเบราว์เซอร์
import { icon, hydrateIcons } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const el = t.content.firstElementChild;
  hydrateIcons(el);
  return el;
}

export function toast(msg, opts = {}) {
  const box = document.getElementById('toasts');
  const el = h(`<div class="toast ${opts.type || ''}"><span>${esc(msg)}</span></div>`);
  let timer;
  const close = () => { clearTimeout(timer); el.remove(); };
  if (opts.action) {
    const b = h(`<button>${esc(opts.action)}</button>`);
    b.onclick = () => { close(); opts.onAction?.(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  timer = setTimeout(close, opts.ms || (opts.action ? 8000 : 3200));
  return close;
}

// dialog({title, body: HTMLElement|string, actions:[{label, value, primary, danger}], wide})
// → Promise<value> (null เมื่อปิด)
export function dialog({ title, body, actions = [{ label: 'ปิด', value: null }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const bd = h(`<div class="backdrop"><div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <header><h2>${esc(title)}</h2><button class="icon-btn" data-x>${icon('close')}</button></header>
      <div class="body"></div><footer></footer></div></div>`);
    const bodyEl = bd.querySelector('.body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    hydrateIcons(bodyEl);
    const foot = bd.querySelector('footer');
    let done = false;
    const close = (v) => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey, true);
      bd.remove(); resolve(v);
    };
    const ctx = { el: bd, body: bodyEl, close, buttons: {} };
    for (const a of actions) {
      const b = h(`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`);
      b.onclick = async () => {
        if (a.handler) {
          const r = await a.handler(ctx);
          if (r === false) return;
          close(r === undefined ? a.value : r);
        } else close(a.value);
      };
      ctx.buttons[a.value ?? a.label] = b;
      foot.appendChild(b);
    }
    if (!actions.length) foot.remove();
    bd.querySelector('[data-x]').onclick = () => close(null);
    bd.addEventListener('pointerdown', (e) => { if (e.target === bd) bd.dataset.down = '1'; });
    bd.addEventListener('click', (e) => { if (e.target === bd && bd.dataset.down) close(null); delete bd.dataset.down; });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
        const p = actions.find((a) => a.primary);
        if (p) { e.preventDefault(); e.stopPropagation(); ctx.buttons[p.value ?? p.label].click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(bd);
    onOpen?.(ctx);
    const first = bodyEl.querySelector('input:not([type=radio]):not([type=checkbox]), textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmBox(title, message, okLabel = 'ตกลง', danger = false) {
  const v = await dialog({
    title, body: `<p style="margin:0;line-height:1.6">${esc(message)}</p>`,
    actions: [{ label: 'ยกเลิก', value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
  return v === true;
}

export async function promptBox(title, label, value = '', okLabel = 'ตกลง') {
  const body = h(`<label class="f">${esc(label)}<input class="inp" value="${esc(value)}"></label>`);
  const v = await dialog({
    title, body,
    actions: [{ label: 'ยกเลิก', value: null }, { label: okLabel, value: 'ok', primary: true }],
  });
  return v === 'ok' ? body.querySelector('input').value.trim() : null;
}

// เมนูลอยใต้ปุ่ม: items [{icon,label,onClick}|'-']
export function popMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const m = h('<div class="menu" role="menu"></div>');
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    const b = h(`<button role="menuitem">${icon(it.icon)}<span>${esc(it.label)}</span></button>`);
    b.onclick = () => { m.remove(); it.onClick(); };
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + 'px';
  m.style.top = Math.min(r.bottom + 6, innerHeight - mh - 8) + 'px';
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true));
  return m;
}

export function busy(msg) {
  const el = h(`<div class="busy"><div><span class="spinner" style="color:var(--accent)"></span><span class="msg">${esc(msg)}</span></div></div>`);
  document.body.appendChild(el);
  return {
    set: (t) => { el.querySelector('.msg').textContent = t; },
    close: () => el.remove(),
  };
}

export function download(bytes, filename, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
