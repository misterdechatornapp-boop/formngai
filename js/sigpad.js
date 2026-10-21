// กล่องเซ็นชื่อ / เลือกรูปภาพ — คืนค่า dataURL (PNG/JPEG) หรือ null
import { dialog, h, toast } from './ui.js';
import { icon } from './icons.js';
import { Store } from './store.js';

function trimCanvas(cv) {
  const ctx = cv.getContext('2d');
  const { width: W, height: H } = cv;
  const d = ctx.getImageData(0, 0, W, H).data;
  let x1 = W, y1 = H, x2 = -1, y2 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 10) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  }
  if (x2 < 0) return null;
  const pad = 6;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(W - 1, x2 + pad); y2 = Math.min(H - 1, y2 + pad);
  const out = document.createElement('canvas');
  out.width = x2 - x1 + 1; out.height = y2 - y1 + 1;
  out.getContext('2d').drawImage(cv, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function fileToDataUrl(file, maxSide = 1400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(file.type === 'image/png' ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดรูปไม่ได้')); };
    img.src = url;
  });
}

export async function openSignatureDialog(current = '') {
  const saved = await Store.get('signatures', []);
  const body = h(`<div style="display:flex;flex-direction:column;gap:12px">
    <div class="row"><b class="grow">วาดลายเซ็น</b>
      <div class="seg small" data-color>
        <button class="on" data-c="#111111">ดำ</button><button data-c="#1d3fb8">น้ำเงิน</button>
      </div></div>
    <canvas class="sigpad"></canvas>
    <div class="row wrap">
      <button class="btn sm" data-clear>${icon('trash')}ล้าง</button>
      <label class="btn sm">${icon('image')}ใช้รูปภาพ/ตราประทับ<input type="file" accept="image/*" hidden data-file></label>
      <label class="f inline" style="margin-left:auto"><input type="checkbox" data-remember checked style="accent-color:var(--accent)"> จำลายเซ็นนี้ไว้</label>
    </div>
    <div data-savedwrap ${saved.length ? '' : 'hidden'}><div class="muted" style="font-size:13px;margin-bottom:6px">ลายเซ็นที่บันทึกไว้ (แตะเพื่อใช้)</div><div class="saved-sigs"></div></div>
  </div>`);
  const cv = body.querySelector('canvas');
  let color = '#111111', drawn = false, strokes = 0;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let picked = null;

  const setup = () => {
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  };
  const ctx = cv.getContext('2d');
  let last = null, lastMid = null;
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect();
    last = [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
    lastMid = last;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(last[0], last[1], 1.3 * dpr, 0, Math.PI * 2); ctx.fill();
    drawn = true; strokes++;
  });
  cv.addEventListener('pointermove', (e) => {
    if (!last) return;
    const r = cv.getBoundingClientRect();
    const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const pe of (pts.length ? pts : [e])) {
      const p = [(pe.clientX - r.left) * dpr, (pe.clientY - r.top) * dpr];
      const mid = [(last[0] + p[0]) / 2, (last[1] + p[1]) / 2];
      const speed = Math.hypot(p[0] - last[0], p[1] - last[1]) / dpr;
      ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.4, 3.2 - speed * 0.08) * dpr;
      ctx.beginPath(); ctx.moveTo(lastMid[0], lastMid[1]); ctx.quadraticCurveTo(last[0], last[1], mid[0], mid[1]); ctx.stroke();
      last = p; lastMid = mid;
    }
  });
  const end = () => { last = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);

  body.querySelector('[data-clear]').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; picked = null; };
  body.querySelectorAll('[data-color] button').forEach((b) => b.onclick = () => {
    body.querySelectorAll('[data-color] button').forEach((x) => x.classList.toggle('on', x === b));
    color = b.dataset.c;
  });

  const renderSaved = (list, close) => {
    const box = body.querySelector('.saved-sigs');
    box.innerHTML = '';
    body.querySelector('[data-savedwrap]').hidden = !list.length;
    list.forEach((url, i) => {
      const b = h(`<button title="ใช้ลายเซ็นนี้"><img src="${url}" alt=""><span class="x" title="ลบ">${icon('close')}</span></button>`);
      b.onclick = async (e) => {
        if (e.target.closest('.x')) {
          e.stopPropagation();
          list.splice(i, 1); await Store.set('signatures', list); renderSaved(list, close); return;
        }
        close(url);
      };
      box.appendChild(b);
    });
  };

  return dialog({
    title: 'ลายเซ็น / รูปภาพ',
    body,
    onOpen: (ctx2) => {
      requestAnimationFrame(setup);
      renderSaved(saved, ctx2.close);
      body.querySelector('[data-file]').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { picked = await fileToDataUrl(file); ctx2.close(picked); } catch (err) { toast(err.message, { type: 'err' }); }
      };
    },
    actions: [
      ...(current ? [{ label: 'ลบลายเซ็นออก', value: '', danger: true }] : []),
      { label: 'ยกเลิก', value: null },
      {
        label: 'ใช้ลายเซ็นนี้', primary: true, value: 'ok',
        handler: async () => {
          if (!drawn) { toast('ยังไม่ได้วางลายเซ็น'); return false; }
          const url = trimCanvas(cv);
          if (!url) { toast('ยังไม่ได้วางลายเซ็น'); return false; }
          if (body.querySelector('[data-remember]').checked) {
            const list = [url, ...saved.filter((s) => s !== url)].slice(0, 6);
            await Store.set('signatures', list);
          }
          return url;
        },
      },
    ],
  });
}
