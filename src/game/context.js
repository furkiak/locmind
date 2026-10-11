'use strict';

/*
 * Shared state and helpers for the realtime handlers. Every handler module receives this
 * object, so they never need to know about each other.
 */

const crypto = require('crypto');
const W = require('../../shared/world');
const { textFrame } = require('../net/frames');

const rkey = id => `room:${id}`;
const round = (v, d = 1) => { const m = 10 ** d; return Math.round(v * m) / m; };
const noop = () => {};
const safeEqual = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());

const RESUME_TTL_MS = 90 * 1000;

function makeContext(hub, deps) {
    const { world } = deps;
    const ctx = { hub, ...deps, rkey, round, noop, safeEqual };
    ctx.dirty = new Set();
    ctx.resumes = new Map();

    ctx.posOf = p => ({ id: p.id, x: round(p.x), y: round(p.y), dirX: round(p.dirX, 2), dirY: round(p.dirY, 2) });
    ctx.roomOf = p => (p.roomId ? world.rooms.get(p.roomId) : null);
    ctx.client = id => hub.clients.get(id);
    ctx.toRoom = (room, event, payload) => hub.to(rkey(room.id)).emit(event, payload);

    // The ball moves 33 times a second. Only people around the stadium need every update;
    // everybody else gets two a second (the final resting position is always sent reliably).
    const BALL_NEAR = 900, BALL_FAR_EVERY = 15;
    const ST = W.STADIUM;
    const nearStadium = p => p.x > ST.x - BALL_NEAR && p.x < ST.x + ST.w + BALL_NEAR && p.y > ST.y - BALL_NEAR && p.y < ST.y + ST.h + BALL_NEAR;
    let ballTicks = 0;
    ctx.broadcastBall = (reliable = true) => {
        const payload = world.football.snapshot();
        if (reliable) { hub.emit('ball', payload); return; }
        const far = ++ballTicks % BALL_FAR_EVERY === 0;
        const frame = textFrame(JSON.stringify(['ball', payload]));
        for (const p of world.players.values()) {
            if (!far && !nearStadium(p)) continue;
            const sock = hub.clients.get(p.id);
            if (sock) hub.sendFrame(sock, frame, true);
        }
    };

    ctx.enterRoom = (player, roomId) => {
        const sock = ctx.client(player.id);
        if (!sock) return;
        sock.join(rkey(roomId));
        const room = world.rooms.get(roomId);
        if (room) sock.emit('room:sync', world.roomSnapshot(room));
    };

    ctx.leaveRoom = (player, roomId) => {
        const sock = ctx.client(player.id);
        if (sock) sock.leave(rkey(roomId));
        const room = world.rooms.get(roomId);
        if (room) ctx.handsChanged(room);
    };

    ctx.applyMembership = (player, change) => {
        if (!change) return;
        if (change.from) ctx.leaveRoom(player, change.from);
        if (change.to) ctx.enterRoom(player, change.to);
    };

    ctx.announceDestroyed = ids => { for (const id of ids) hub.emit('room:destroyed', id); };
    ctx.snap = players => { for (const m of players) hub.emit('player:snap', ctx.posOf(m)); };

    ctx.persist = room => {
        if (room && room.permanent && ctx.store) ctx.store.schedule('rooms', () => world.permanentRooms());
    };

    ctx.roomChanged = room => {
        hub.emit('room:updated', world.publicRoom(room));
        ctx.persist(room);
    };

    ctx.handsChanged = room => ctx.toRoom(room, 'hands:update', { roomId: room.id, hands: room.hands });
    ctx.pollChanged = room => ctx.toRoom(room, 'poll:update', { roomId: room.id, poll: world.publicPoll(room) });
    ctx.timerChanged = room => ctx.toRoom(room, 'timer:update', { roomId: room.id, timer: world.publicTimer(room) });
    ctx.musicChanged = room => ctx.toRoom(room, 'music:update', { roomId: room.id, ...room.music.snapshot() });

    /** Sends a player away for good (the client does not reconnect after a 4xxx close code). */
    ctx.kick = (id, reason, message = '') => {
        const sock = ctx.client(id);
        if (!sock) return false;
        sock.emit('kicked', { reason, message });
        sock.disconnect(4001, reason);
        return true;
    };

    /** Removes a player and tells everybody; remembers their state so a reconnect can pick it up. */
    ctx.dropPlayer = id => {
        ctx.limiter.forget(id);
        const { player, destroyed, room } = world.removePlayer(id, { grace: true });
        ctx.dirty.delete(id);
        if (!player) return null;
        ctx.resumes.set(player.token, {
            token: player.token, x: player.x, y: player.y, unlocked: new Set(player.unlocked),
            chatMutedUntil: player.chatMutedUntil, expires: world.now() + RESUME_TTL_MS
        });
        hub.emit('player:leave', id);
        if (room) ctx.handsChanged(room);
        ctx.announceDestroyed(destroyed);
        return player;
    };

    ctx.takeResume = token => {
        if (typeof token !== 'string' || token.length > 64) return null;
        // The old connection may still look alive for a while after a network drop: take it over.
        for (const p of Array.from(world.players.values())) {
            if (p.token === token) {
                const sock = ctx.client(p.id);
                ctx.dropPlayer(p.id);
                if (sock) sock.disconnect(4002, 'replaced');
                break;
            }
        }
        const saved = ctx.resumes.get(token);
        if (!saved) return null;
        ctx.resumes.delete(token);
        return saved.expires >= world.now() ? saved : null;
    };

    /** Players near a point (for "nearby" scoped events outside of rooms). */
    ctx.near = (p, radius) => {
        const out = [];
        for (const o of world.players.values()) {
            if (o.roomId === p.roomId && Math.hypot(o.x - p.x, o.y - p.y) <= radius) out.push(o);
        }
        return out;
    };

    ctx.W = W;
    return ctx;
}

module.exports = { makeContext, rkey, round, noop, safeEqual };
