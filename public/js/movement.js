// Local player movement: time based (same speed at any refresh rate), client side
// collision using the shared world module, throttled position updates.
import { S, W, C, bus, me, redraw, canEnter, slotOfPlayer } from './state.js';
import { clamp, isTyping } from './dom.js';
import { play } from './sfx.js';
import { findPath } from './path.js';

export const input = { keys: new Set(), joy: { x: 0, y: 0 }, target: null, path: null, dest: null };

/** Walks to a world position (top-left coordinates), around walls when needed. */
export function walkTo(x, y, { keepFollow = false } = {}) {
    const p = me();
    if (!p) return false;
    if (!keepFollow) S.follow = null;
    const path = findPath(p.x, p.y, x, y);
    if (!path) return false;
    input.path = path;
    input.target = path.shift();
    input.dest = { x, y, replans: 0 };
    stuckSince = 0;
    redraw();
    return true;
}

export function stopWalking() { input.target = null; input.path = null; input.dest = null; S.follow = null; }

let stuckSince = 0;
/** Called when walking makes no progress: plan again from here (people may be in the way), then give up. */
function unstick(now) {
    if (!stuckSince) { stuckSince = now; return; }
    if (now - stuckSince < 450) return;
    stuckSince = 0;
    const d = input.dest;
    if (d && d.replans < 3) {
        const replans = d.replans + 1;
        if (walkTo(d.x, d.y, { keepFollow: true })) { input.dest.replans = replans; return; }
    }
    input.target = null; input.path = null; input.dest = null;
}

// following another player: re-plan twice a second while they move
setInterval(() => {
    if (!S.follow || !S.active) return;
    const self = me(), o = S.players[S.follow];
    if (!o) { S.follow = null; bus.emit('follow', null); return; }
    const d = Math.hypot(o.x - self.x, o.y - self.y);
    if (d > 90) {
        const a = Math.atan2(self.y - o.y, self.x - o.x);
        walkTo(o.x + Math.cos(a) * 60, o.y + Math.sin(a) * 60, { keepFollow: true });
    }
}, 500);

const PS = C.PLAYER_SIZE;
const SEND_EVERY_MS = 50;
let lastSend = 0;
let lastSent = null;   // last position the server heard about
let dirty = false;

function sendPosition(p, x, y, now) {
    S.socket.emit('move', { x, y, dirX: p.dirX, dirY: p.dirY });
    lastSent = { x, y };
    lastSend = now;
}
let gateAsked = 0;

function blocked(x, y, prevY) {
    const rect = { x, y, w: PS, h: PS };
    for (const id in S.rooms) {
        const room = S.rooms[id];
        if (room.builtin) continue;
        const slot = S.slotsById[id];
        if (!slot) continue;
        if (W.wallsBlock(slot, rect)) return true;
        if (!canEnter(room) && W.gateBlocks(slot, rect, prevY, y)) {
            const now = performance.now();
            if (now - gateAsked > 800 && !S.modalOpen) { gateAsked = now; bus.emit('gate', room.id); }
            return true;
        }
    }
    return false;
}

export function refreshZone() {
    const p = me();
    if (!p) return;
    const slot = slotOfPlayer(p);
    const room = slot ? S.rooms[slot.id] : null;
    const roomId = room && canEnter(room) ? slot.id : null;
    const plotId = slot && !room && slot.type === 'conference' ? slot.id : null;
    if (roomId !== S.currentRoomId || plotId !== S.currentSlotId) {
        const prev = S.currentRoomId;
        S.currentRoomId = roomId;
        S.currentSlotId = plotId;
        bus.emit('zone', { roomId, prev, plotId });
        redraw();
    }
}

export function applySnap(x, y) {
    const p = me();
    if (!p) return;
    p.x = x; p.y = y; p.rx = x; p.ry = y;
    lastSent = { x, y };
    const dest = input.dest;
    input.target = null; input.path = null; input.dest = null;
    refreshZone();
    // the server disagreed with a step: plan the rest of the walk again from where it put us
    if (dest && dest.replans < 3) { const n = dest.replans + 1; if (walkTo(dest.x, dest.y, { keepFollow: true })) input.dest.replans = n; }
    redraw();
}

/** The server checks the straight line between two reported positions (every 8 px), so must we. */
function segmentBlocked(ax, ay, bx, by) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
    let prevY = ay;
    for (let i = 1; i <= steps; i++) {
        const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps;
        const rect = { x, y, w: PS, h: PS };
        for (const id in S.rooms) {
            const room = S.rooms[id];
            if (room.builtin) continue;
            const slot = S.slotsById[id];
            if (!slot) continue;
            if (W.wallsBlock(slot, rect) || (!canEnter(room) && W.gateBlocks(slot, rect, prevY, y))) return true;
        }
        prevY = y;
    }
    return false;
}

export function kick() {
    if (S.currentRoomId !== C.STADIUM_ID || !S.socket) return;
    S.socket.emit('kick');
    const p = me();
    if (p) p.kickAnim = performance.now();
    play('kick');
    redraw();
}

export function step(dt) {
    const p = me();
    if (!p) return;
    dt = Math.min(dt, .1);   // a 30 px step at most: still thinner than a player plus a wall, so nothing is skipped

    let ax = 0, ay = 0;
    const locked = S.modalOpen || isTyping();
    if (!locked) {
        const k = input.keys;
        if (k.has('KeyW') || k.has('ArrowUp')) ay -= 1;
        if (k.has('KeyS') || k.has('ArrowDown')) ay += 1;
        if (k.has('KeyA') || k.has('ArrowLeft')) ax -= 1;
        if (k.has('KeyD') || k.has('ArrowRight')) ax += 1;
        ax += input.joy.x; ay += input.joy.y;
    }

    let speedScale = 1;
    const len = Math.hypot(ax, ay);
    if (len > 0) {
        if (input.target || S.follow) bus.emit('follow', null);
        input.target = null; input.path = null; input.dest = null; S.follow = null;
        if (len > 1) { ax /= len; ay /= len; }
        speedScale = Math.min(1, len);
    } else if (input.target && !locked) {
        const dx = input.target.x - p.x, dy = input.target.y - p.y, d = Math.hypot(dx, dy);
        if (d < 3) {
            input.target = input.path && input.path.length ? input.path.shift() : null;
            if (!input.target) input.dest = null;
        }
        else { ax = dx / d; ay = dy / d; speedScale = Math.min(1, d / (C.SPEED * dt)); }
    }

    const moving = ax !== 0 || ay !== 0;
    const wx = ax * C.SPEED * speedScale * dt, wy = ay * C.SPEED * speedScale * dt;

    // Soft push away from overlapping players (purely cosmetic, server only sees the result).
    let px = 0, py = 0;
    for (const id in S.players) {
        if (id === S.myId) continue;
        const o = S.players[id];
        const ox = p.x - o.rx, oy = p.y - o.ry, d = Math.hypot(ox, oy);
        if (d > 0 && d < PS) { px += ox / d * 120 * dt; py += oy / d * 120 * dt; }
    }

    if (wx || wy || px || py) {
        const prevY = p.y, x0 = p.x, y0 = p.y;
        // try the walk plus the push, then the walk alone, one axis at a time: walls make you slide, not stop
        const tryAxis = (dx, dy) => {
            const nx = clamp(p.x + dx, 0, C.WIDTH - PS), ny = clamp(p.y + dy, 0, C.HEIGHT - PS);
            if ((dx || dy) && !blocked(nx, ny, prevY)) { p.x = nx; p.y = ny; return true; }
            return false;
        };
        if (!tryAxis(wx + px, 0)) tryAxis(wx, 0);
        if (!tryAxis(0, wy + py)) tryAxis(0, wy);
        const moved = p.x !== x0 || p.y !== y0;
        p.rx = p.x; p.ry = p.y;
        if (moved) {
            // sliding round a corner: report the corner first so the server sees a legal polyline
            if (lastSent && S.socket && S.socket.connected && (lastSent.x !== x0 || lastSent.y !== y0) && segmentBlocked(lastSent.x, lastSent.y, p.x, p.y)) {
                sendPosition(p, x0, y0, performance.now());
            }
            dirty = true; refreshZone(); redraw();
        }
        if (input.target && moving) {
            if (Math.hypot(p.x - x0, p.y - y0) < Math.hypot(wx, wy) * .25) unstick(performance.now());
            else stuckSince = 0;
        }
    }
    if (moving) {
        const l = Math.hypot(ax, ay);
        p.dirX = ax / l; p.dirY = ay / l;
        dirty = true; redraw();
    }

    const now = performance.now();
    if (dirty && now - lastSend >= SEND_EVERY_MS && S.socket && S.socket.connected) {
        sendPosition(p, p.x, p.y, now);
        dirty = false;
    }
}
