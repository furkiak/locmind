// Socket.io protocol <-> client state.
import { S, bus, makePlayer, redraw, me } from './state.js';
import { handleSignal, closeAllLinks, closeLinksFor } from './rtc.js';
import { refreshZone, applySnap } from './movement.js';

export function send(event, payload, ack) {
    if (S.socket) S.socket.emit(event, payload, ack);
}

function applyWorld(res) {
    S.myId = res.you;
    S.slots = res.slots;
    S.slotsById = Object.fromEntries(res.slots.map(s => [s.id, s]));
    S.rooms = {};
    res.rooms.forEach(r => { S.rooms[r.id] = r; });
    S.players = {};
    res.players.forEach(p => { S.players[p.id] = makePlayer(p); });
    S.ball = { ...res.ball, rx: res.ball.x, ry: res.ball.y };
    S.score = res.score;
    S.emojis = res.emojis;
    S.unlocked = new Set(res.unlocked || []);
    S.resume = res.token;
    S.currentRoomId = null;
    S.currentSlotId = null;
    refreshZone();
    bus.emit('world');
    redraw();
}

export function joinWorld(nickname, avatar) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000);
        S.socket.emit('join', { nickname, avatar, resume: S.resume }, res => {
            clearTimeout(timer);
            if (res && res.ok) applyWorld(res);
            resolve(res || { ok: false, error: 'server-error' });
        });
    });
}

export function initNet() {
    const socket = window.io({ transports: ['websocket', 'polling'] });
    S.socket = socket;
    let dropped = false;

    socket.on('connect', async () => {
        S.connected = true;
        bus.emit('conn', 'up');
        if (S.active && dropped) {
            dropped = false;
            const res = await joinWorld(S.settings.nick, S.settings.avatar);
            if (res.ok) bus.emit('rejoined');
            else bus.emit('kicked', { reason: res.error || 'server-error' });
        }
    });

    socket.on('disconnect', () => {
        S.connected = false;
        if (S.active) { dropped = true; closeAllLinks(); bus.emit('conn', 'down'); }
    });

    socket.on('kicked', d => { S.active = false; closeAllLinks(); bus.emit('kicked', d || {}); });

    socket.on('player:join', p => { S.players[p.id] = makePlayer(p); bus.emit('players'); redraw(); });
    socket.on('player:leave', id => {
        closeLinksFor(id);
        delete S.players[id];
        delete S.userVolumes[id];
        bus.emit('player-left', id);
        bus.emit('players');
        redraw();
    });

    socket.on('players:move', rows => {
        for (const [id, x, y, dx, dy] of rows) {
            if (id === S.myId) continue;
            const p = S.players[id];
            if (!p) continue;
            p.x = x; p.y = y; p.dirX = dx; p.dirY = dy;
        }
        redraw();
    });

    socket.on('player:snap', d => {
        if (d.id === S.myId) { applySnap(d.x, d.y); return; }
        const p = S.players[d.id];
        if (p) { p.x = d.x; p.y = d.y; p.rx = d.x; p.ry = d.y; redraw(); }
    });

    socket.on('player:status', d => {
        const p = S.players[d.id];
        if (!p) return;
        p.muted = !!d.muted; p.cam = !!d.cam; p.screen = !!d.screen;
        bus.emit('player-status', p);
        redraw();
    });

    socket.on('room:created', room => {
        S.rooms[room.id] = room;
        refreshZone();
        bus.emit('rooms');
        redraw();
    });
    socket.on('room:destroyed', id => {
        delete S.rooms[id];
        S.unlocked.delete(id);
        refreshZone();
        bus.emit('rooms');
        redraw();
    });

    socket.on('room:sync', snap => bus.emit('room:sync', snap));
    socket.on('wb:draw', d => bus.emit('wb:draw', d));
    socket.on('wb:clear', d => bus.emit('wb:clear', d));
    socket.on('note:update', d => bus.emit('note:update', d));
    socket.on('music:update', d => bus.emit('music:update', d));

    socket.on('chat', m => bus.emit('chat', m));
    socket.on('emoji', d => bus.emit('emoji', d));
    socket.on('player:kick', id => bus.emit('player-kick', id));

    socket.on('ball', b => {
        if (!S.ball) S.ball = { ...b, rx: b.x, ry: b.y };
        Object.assign(S.ball, b);
        redraw();
    });
    socket.on('score', sc => { S.score = sc; bus.emit('score'); });
    socket.on('goal', g => { S.score = g.score; bus.emit('goal', g); bus.emit('score'); });

    socket.on('rtc:signal', handleSignal);

    window.addEventListener('beforeunload', () => { try { socket.disconnect(); } catch (_) {} });
    return socket;
}

export { me };
