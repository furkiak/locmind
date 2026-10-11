// Local player movement: time based (same speed at any refresh rate), client side
// collision using the shared world module, throttled position updates.
import { S, W, C, bus, me, redraw, canEnter, slotOfPlayer } from './state.js';
import { clamp, isTyping } from './dom.js';
import { play } from './sfx.js';
import { findPath } from './path.js';

export const input = { keys: new Set(), joy: { x: 0, y: 0 }, target: null, path: null };

/** Walks to a world position (top-left coordinates), around walls when needed. */
export function walkTo(x, y, { keepFollow = false } = {}) {
    const p = me();
    if (!p) return false;
    if (!keepFollow) S.follow = null;
    const path = findPath(p.x, p.y, x, y);
    if (!path) return false;
    input.path = path;
    input.target = path.shift();
    redraw();
    return true;
}

export function stopWalking() { input.target = null; input.path = null; S.follow = null; }

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
let dirty = false;
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
    input.target = null;
    refreshZone();
    redraw();
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
        input.target = null; input.path = null; S.follow = null;
        if (len > 1) { ax /= len; ay /= len; }
        speedScale = Math.min(1, len);
    } else if (input.target && !locked) {
        const dx = input.target.x - p.x, dy = input.target.y - p.y, d = Math.hypot(dx, dy);
        if (d < 3) input.target = input.path && input.path.length ? input.path.shift() : null;
        else { ax = dx / d; ay = dy / d; speedScale = Math.min(1, d / (C.SPEED * dt)); }
    }

    const moving = ax !== 0 || ay !== 0;
    let mx = ax * C.SPEED * speedScale * dt, my = ay * C.SPEED * speedScale * dt;

    // Soft push away from overlapping players (purely cosmetic, server only sees the result).
    for (const id in S.players) {
        if (id === S.myId) continue;
        const o = S.players[id];
        const ox = p.x - o.rx, oy = p.y - o.ry, d = Math.hypot(ox, oy);
        if (d > 0 && d < PS) { mx += ox / d * 120 * dt; my += oy / d * 120 * dt; }
    }

    if (mx !== 0 || my !== 0) {
        const nx = clamp(p.x + mx, 0, C.WIDTH - PS), ny = clamp(p.y + my, 0, C.HEIGHT - PS);
        const prevY = p.y;
        const okX = !blocked(nx, p.y, prevY);
        const okY = !blocked(okX ? nx : p.x, ny, prevY);
        if ((mx !== 0 && !okX) || (my !== 0 && !okY)) { input.target = null; input.path = null; }
        if (okX) p.x = nx;
        if (okY) p.y = ny;
        p.rx = p.x; p.ry = p.y;
        if (okX || okY) { dirty = true; refreshZone(); redraw(); }
    }
    if (moving) {
        const l = Math.hypot(ax, ay);
        p.dirX = ax / l; p.dirY = ay / l;
        dirty = true; redraw();
    }

    const now = performance.now();
    if (dirty && now - lastSend >= SEND_EVERY_MS && S.socket && S.socket.connected) {
        S.socket.emit('move', { x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
        lastSend = now;
        dirty = false;
    }
}
