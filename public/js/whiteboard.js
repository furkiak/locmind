import { S, bus } from './state.js';
import { t } from './i18n.js';
import { byId, clamp } from './dom.js';
import { send } from './net.js';
import { toast, isWindowOpen, hideWindow } from './ui.js';

const COLORS = ['#111827', '#ff453a', '#ff9f0a', '#30d158', '#0a84ff', '#bf5af2', '#ff375f', '#8e8e93'];
const BOARD_W = 640;           // brush sizes are relative to this logical board width
const MAX_LOCAL = 700;

export function initWhiteboard() {
    const canvas = byId('wb-canvas'), ctx = canvas.getContext('2d'), stage = canvas.parentElement;
    let color = COLORS[0], size = +byId('wb-size').value, eraser = false;
    let strokes = [], boardRoom = null, dpr = 1;
    let drawing = false, last = null, batch = null, flushTimer = null;

    // ---- palette
    const sw = byId('wb-colors');
    COLORS.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'swatch-btn'; b.style.background = c;
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(i === 0)); b.setAttribute('aria-label', c);
        b.addEventListener('click', () => {
            color = c; eraser = false;
            sw.querySelectorAll('.swatch-btn').forEach(x => x.setAttribute('aria-checked', String(x === b)));
            byId('wb-eraser').classList.remove('is-active');
        });
        sw.appendChild(b);
    });
    byId('wb-size').addEventListener('input', e => { size = +e.target.value; });
    byId('wb-eraser').addEventListener('click', () => {
        eraser = !eraser;
        byId('wb-eraser').classList.toggle('is-active', eraser);
        sw.querySelectorAll('.swatch-btn').forEach(x => x.setAttribute('aria-checked', 'false'));
        if (!eraser) sw.firstChild.setAttribute('aria-checked', 'true'), color = COLORS[0];
    });

    // ---- drawing primitives (coordinates are normalised 0..1)
    function paint(b) {
        const w = canvas.width, hgt = canvas.height, lw = Math.max(1, b.w * (w / dpr / BOARD_W) * dpr);
        ctx.strokeStyle = b.c; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of b.s) { ctx.moveTo(x0 * w, y0 * hgt); ctx.lineTo(x1 * w + .01, y1 * hgt); }
        ctx.stroke();
    }
    function redrawAll() {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        strokes.forEach(paint);
    }
    function resize() {
        const r = stage.getBoundingClientRect();
        if (r.width < 2) return;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
        redrawAll();
    }
    new ResizeObserver(resize).observe(stage);
    bus.on('win', ({ id }) => { if (id === 'win-board') requestAnimationFrame(resize); });

    const pos = e => {
        const r = canvas.getBoundingClientRect();
        return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
    };

    function flush() {
        clearTimeout(flushTimer); flushTimer = null;
        if (!batch || !batch.s.length) return;
        send('wb:draw', batch);
        strokes.push(batch);
        if (strokes.length > MAX_LOCAL) strokes.shift();
        batch = null;
    }
    function addSegment(seg) {
        const c = eraser ? '#ffffff' : color, w = eraser ? size * 4 : size;
        if (!batch || batch.c !== c || batch.w !== w || batch.s.length >= 48) { flush(); batch = { c, w, s: [] }; }
        batch.s.push(seg);
        paint({ c, w, s: [seg] });
        if (!flushTimer) flushTimer = setTimeout(flush, 45);
    }

    canvas.addEventListener('pointerdown', e => {
        if (!S.currentRoomId) return;
        drawing = true; canvas.setPointerCapture(e.pointerId);
        last = pos(e);
        addSegment([last[0], last[1], last[0], last[1]]);
    });
    canvas.addEventListener('pointermove', e => {
        if (!drawing) return;
        const p = pos(e);
        addSegment([last[0], last[1], p[0], p[1]]);
        last = p;
    });
    const up = () => { drawing = false; flush(); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

    // ---- clear (two taps) / download
    let armed = null;
    const clearBtn = byId('wb-clear');
    clearBtn.addEventListener('click', () => {
        if (!armed) {
            armed = setTimeout(() => { armed = null; clearBtn.style.color = ''; clearBtn.title = t('clear_all'); }, 2600);
            clearBtn.style.color = 'var(--red)'; clearBtn.title = t('clear_confirm');
            toast(t('clear_confirm'), { type: 'warn', icon: 'trash', ttl: 2400 });
            return;
        }
        clearTimeout(armed); armed = null; clearBtn.style.color = ''; clearBtn.title = t('clear_all');
        strokes = []; redrawAll();
        send('wb:clear', {});
    });
    byId('wb-download').addEventListener('click', () => {
        canvas.toBlob(blob => {
            if (!blob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = 'locmind-whiteboard.png';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }, 'image/png');
    });

    // ---- network
    bus.on('room:sync', snap => {
        if (!snap.whiteboard) return;
        boardRoom = snap.roomId;
        strokes = snap.whiteboard.slice(-MAX_LOCAL);
        redrawAll();
    });
    bus.on('wb:draw', d => {
        if (d.roomId !== boardRoom) return;
        const b = { c: d.c, w: d.w, s: d.s };
        strokes.push(b); if (strokes.length > MAX_LOCAL) strokes.shift();
        paint(b);
    });
    bus.on('wb:clear', d => { if (d.roomId === boardRoom) { strokes = []; redrawAll(); } });
    bus.on('zone', ({ roomId }) => {
        if (roomId !== boardRoom) { boardRoom = roomId; strokes = []; redrawAll(); }
        if (!roomId && isWindowOpen('win-board')) hideWindow('win-board');
    });
    redrawAll();
}
