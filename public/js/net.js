// Socket.io protocol <-> client state.
import { S, bus, makePlayer, redraw, me, slotOfPlayer } from './state.js';
import { handleSignal, closeAllLinks, closeLinksFor } from './rtc.js';
import { refreshZone, applySnap } from './movement.js';
import { Transport } from './transport.js';

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
    S.server = res.server || null;
    if (S.config) S.config.iceServers = res.iceServers || [];
    S.currentRoomId = null;
    S.currentSlotId = null;
    S.room = { hands: [], poll: null, timer: null };
    refreshZone();
    bus.emit('world');
    if (Array.isArray(res.chat)) bus.emit('chat:history', res.chat);
    redraw();
}

export function joinWorld(nickname, avatar) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 8000);
        const p = me();
        const profile = p ? { status: p.status, statusText: p.statusText } : { status: S.settings.status || 'available', statusText: S.settings.statusText || '' };
        S.socket.emit('join', { nickname, avatar, resume: S.resume, serverPassword: S.serverPassword || undefined, ...profile }, res => {
            clearTimeout(timer);
            if (res && res.ok) applyWorld(res);
            resolve(res || { ok: false, error: 'server-error' });
        });
    });
}

export function initNet() {
    const socket = new Transport('/ws');
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

    socket.on('disconnect', code => {
        S.connected = false;
        if (!S.active) return;
        // 4002: the same player connected again from another tab or device
        if (code === 4002) { S.active = false; closeAllLinks(); bus.emit('kicked', { reason: 'replaced' }); return; }
        if (code >= 4000 && code < 5000) return;   // a 'kicked' event explains it
        dropped = true; closeAllLinks(); bus.emit('conn', 'down');
    });

    socket.on('kicked', d => { S.active = false; socket.disconnect(); closeAllLinks(); bus.emit('kicked', d || {}); });
    socket.on('rtt', ms => { S.rtt = ms; bus.emit('rtt', ms); });

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

    socket.on('player:profile', d => {
        const p = S.players[d.id];
        if (!p) return;
        const avatarChanged = p.avatar !== d.avatar;
        p.status = d.status; p.statusText = d.statusText; p.avatar = d.avatar;
        bus.emit('player-profile', p);
        if (avatarChanged) bus.emit('players');
        redraw();
    });

    socket.on('room:updated', room => {
        const before = S.rooms[room.id];
        S.rooms[room.id] = room;
        // a room that just got a password stays open for the people already inside
        const self = me();
        if (room.hasPassword && (!before || !before.hasPassword) && self && slotOfPlayer(self) && slotOfPlayer(self).id === room.id) S.unlocked.add(room.id);
        refreshZone();
        bus.emit('rooms');
        bus.emit('room-updated', room);
        redraw();
    });

    socket.on('room:created', room => {
        S.rooms[room.id] = room;
        refreshZone();
        bus.emit('rooms');
        redraw();
    });
    socket.on('room:relock', id => { S.unlocked.delete(id); refreshZone(); redraw(); });
    socket.on('room:destroyed', id => {
        delete S.rooms[id];
        S.unlocked.delete(id);
        refreshZone();
        bus.emit('rooms');
        redraw();
    });

    socket.on('room:sync', snap => {
        S.room = { hands: snap.hands || [], poll: snap.poll || null, timer: snap.timer ? { ...snap.timer, at: performance.now() } : null };
        bus.emit('room:sync', snap);
        bus.emit('room-tools');
        redraw();
    });
    const forMyRoom = d => d && d.roomId === S.currentRoomId;
    socket.on('hands:update', d => { if (forMyRoom(d)) { S.room.hands = d.hands || []; bus.emit('room-tools', 'hands'); redraw(); } });
    socket.on('poll:update', d => { if (forMyRoom(d)) { const prev = S.room.poll; S.room.poll = d.poll; bus.emit('room-tools', 'poll'); if (d.poll && (!prev || prev.id !== d.poll.id)) bus.emit('poll-new', d.poll); } });
    socket.on('timer:update', d => { if (forMyRoom(d)) { S.room.timer = d.timer ? { ...d.timer, at: performance.now() } : null; bus.emit('room-tools', 'timer'); } });
    socket.on('typing', d => bus.emit('typing', d));
    socket.on('dm', m => bus.emit('dm', m));
    socket.on('waved', d => bus.emit('waved', d));
    socket.on('announce', d => bus.emit('announce', d));
    socket.on('moderation', d => bus.emit('moderation', d));
    socket.on('library:update', d => bus.emit('library:update', d));
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
