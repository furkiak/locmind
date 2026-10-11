import { S, bus, me, redraw } from './state.js';
import { input } from './movement.js';
import { clamp, isTyping } from './dom.js';

const MIN_ZOOM = .35, MAX_ZOOM = 2.2;

export function setZoom(z) {
    S.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    redraw();
}

export function screenToWorld(sx, sy) {
    return { x: (sx - window.innerWidth / 2) / S.zoom + S.cam.x, y: (sy - window.innerHeight / 2) / S.zoom + S.cam.y };
}

const KEY_ACTIONS = {
    Enter: 'chat', KeyF: 'mic', KeyC: 'camera', KeyQ: 'emoji', KeyE: 'interact', KeyG: 'board',
    KeyH: 'notes', KeyM: 'music', KeyT: 'chatlog', KeyR: 'rooms', Space: 'kick', Escape: 'escape',
    Equal: 'zoom-in', NumpadAdd: 'zoom-in', Minus: 'zoom-out', NumpadSubtract: 'zoom-out'
};
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function initInput(canvas) {
    window.addEventListener('keydown', e => {
        if (!S.active) return;
        if (e.key === 'Escape') { bus.emit('action', 'escape'); return; }
        if (S.modalOpen || e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTyping()) return;
        if (MOVE_KEYS.has(e.code)) { input.keys.add(e.code); input.target = null; e.preventDefault(); return; }
        const action = KEY_ACTIONS[e.code];
        if (!action) return;
        if (e.repeat && action !== 'kick') return;
        e.preventDefault();
        bus.emit('action', action);
    });
    window.addEventListener('keyup', e => { input.keys.delete(e.code); });
    window.addEventListener('blur', () => { input.keys.clear(); input.joy.x = input.joy.y = 0; });

    // ---- pointer: click / drag to walk, pinch to zoom --------------------
    const pointers = new Map();
    let pinchStart = null, dragging = false;

    const setTarget = e => {
        const p = me();
        if (!p) return;
        const w = screenToWorld(e.clientX, e.clientY);
        input.target = { x: w.x - 20, y: w.y - 20 };
        S.fx.push({ type: 'ripple', x: w.x, y: w.y, born: performance.now() });
        redraw();
    };

    canvas.addEventListener('pointerdown', e => {
        if (!S.active || S.modalOpen) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        bus.emit('canvas-press');
        if (pointers.size === 2) {
            const [a, b] = Array.from(pointers.values());
            pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: S.zoom };
            dragging = false;
            input.target = null;
        } else {
            dragging = true;
            setTarget(e);
        }
        if (document.activeElement && document.activeElement !== canvas && isTyping()) document.activeElement.blur();
    });
    canvas.addEventListener('pointermove', e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && pinchStart) {
            const [a, b] = Array.from(pointers.values());
            setZoom(pinchStart.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.d);
        } else if (dragging && e.pointerType !== 'mouse') {
            const w = screenToWorld(e.clientX, e.clientY);
            input.target = { x: w.x - 20, y: w.y - 20 };
        } else if (dragging && e.buttons & 1) {
            const w = screenToWorld(e.clientX, e.clientY);
            input.target = { x: w.x - 20, y: w.y - 20 };
        }
    });
    const release = e => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        if (pointers.size === 0) dragging = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('wheel', e => {
        if (!S.active) return;
        e.preventDefault();
        setZoom(S.zoom * Math.exp(-e.deltaY * .0015));
    }, { passive: false });

    // ---- virtual joystick (touch devices) --------------------------------
    const joy = document.getElementById('joystick'), knob = document.getElementById('joy-knob');
    let joyId = null;
    const joyMove = e => {
        const r = joy.getBoundingClientRect(), R = r.width / 2;
        let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
        const d = Math.hypot(dx, dy), max = R - 10;
        if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const dead = .18;
        const nx = dx / max, ny = dy / max, mag = Math.hypot(nx, ny);
        if (mag < dead) { input.joy.x = 0; input.joy.y = 0; } else { input.joy.x = nx; input.joy.y = ny; }
    };
    joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(joyId); input.target = null; joyMove(e); });
    joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
    const joyEnd = e => {
        if (e.pointerId !== joyId) return;
        joyId = null; input.joy.x = 0; input.joy.y = 0; knob.style.transform = '';
    };
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);

    document.getElementById('zoom-in').addEventListener('click', () => setZoom(S.zoom * 1.25));
    document.getElementById('zoom-out').addEventListener('click', () => setZoom(S.zoom / 1.25));
    bus.on('action', a => { if (a === 'zoom-in') setZoom(S.zoom * 1.2); else if (a === 'zoom-out') setZoom(S.zoom / 1.2); });
}
