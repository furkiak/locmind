import { S, C, bus, me, redraw } from './state.js';
import { input, walkTo } from './movement.js';
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
    KeyY: 'hand', KeyO: 'roomtools', KeyP: 'profile', KeyL: 'gallery', KeyN: 'dm',
    Equal: 'zoom-in', NumpadAdd: 'zoom-in', Minus: 'zoom-out', NumpadSubtract: 'zoom-out'
};
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function initInput(canvas) {
    // Escape inside any text field hands the keyboard back to the world
    window.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || !S.active || !isTyping() || e.target.id === 'chat-input' || S.modalOpen) return;
        e.target.blur();
        canvas.focus({ preventScroll: true });
    }, true);
    window.addEventListener('keydown', e => {
        if (!S.active) return;
        if (e.key === 'Escape') { bus.emit('action', 'escape'); return; }
        if (S.modalOpen || e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTyping()) return;
        if (MOVE_KEYS.has(e.code)) { input.keys.add(e.code); input.target = null; input.path = null; e.preventDefault(); return; }
        if (e.code === 'KeyV') { if (!e.repeat) bus.emit('ptt', true); e.preventDefault(); return; }
        const action = KEY_ACTIONS[e.code];
        if (!action) return;
        if (e.repeat && action !== 'kick') return;
        e.preventDefault();
        bus.emit('action', action);
    });
    window.addEventListener('keyup', e => { input.keys.delete(e.code); if (e.code === 'KeyV') bus.emit('ptt', false); });
    window.addEventListener('blur', () => { input.keys.clear(); input.joy.x = input.joy.y = 0; bus.emit('ptt', false); });

    // ---- pointer: click / drag to walk, pinch to zoom --------------------
    const pointers = new Map();
    let pinchStart = null, dragging = false;

    const playerAt = (x, y) => {
        let best = null, bestD = C.PLAYER_SIZE / 2 + 6;
        for (const id in S.players) {
            const p = S.players[id];
            const d = Math.hypot(p.rx + C.PLAYER_SIZE / 2 - x, p.ry + C.PLAYER_SIZE / 2 - y);
            if (d < bestD) { best = p; bestD = d; }
        }
        return best;
    };
    const setTarget = e => {
        const p = me();
        if (!p) return;
        const w = screenToWorld(e.clientX, e.clientY);
        const hit = playerAt(w.x, w.y);
        if (hit) { dragging = false; bus.emit(hit.id === S.myId ? 'profile-open' : 'player-click', hit.id); return; }
        if (!walkTo(w.x - 20, w.y - 20)) input.target = { x: w.x - 20, y: w.y - 20 };
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
        } else if (dragging && (e.pointerType !== 'mouse' || e.buttons & 1)) {
            const w = screenToWorld(e.clientX, e.clientY);
            input.target = { x: w.x - 20, y: w.y - 20 };
            input.path = null;
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

    // minimap: click to walk there
    const mini = document.getElementById('minimap');
    mini.addEventListener('click', e => {
        if (!S.active) return;
        const r = mini.getBoundingClientRect();
        const sc = Math.min(r.width / C.WIDTH, r.height / C.HEIGHT), ox = (r.width - C.WIDTH * sc) / 2, oy = (r.height - C.HEIGHT * sc) / 2;
        const x = (e.clientX - r.left - ox) / sc, y = (e.clientY - r.top - oy) / sc;
        if (x < 0 || y < 0 || x > C.WIDTH || y > C.HEIGHT) return;
        if (walkTo(x - 20, y - 20)) { S.fx.push({ type: 'ripple', x, y, born: performance.now() }); redraw(); }
    });

    document.getElementById('zoom-in').addEventListener('click', () => setZoom(S.zoom * 1.25));
    document.getElementById('zoom-out').addEventListener('click', () => setZoom(S.zoom / 1.25));
    bus.on('action', a => { if (a === 'zoom-in') setZoom(S.zoom * 1.2); else if (a === 'zoom-out') setZoom(S.zoom / 1.2); });
}
