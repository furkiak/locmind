'use strict';

const W = require('../shared/world');
const { C, STADIUM } = W;
const { cleanText, cleanMultiline, isPlainObject, RateLimiter } = require('./security');
const { parseVideoId } = require('./youtube');

const noop = () => {};
const rkey = id => `room:${id}`;
const round = (v, d = 1) => { const m = 10 ** d; return Math.round(v * m) / m; };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const RTC_CHANNELS = new Set(['audio', 'camera', 'screen']);
const RTC_TYPES = new Set(['offer', 'answer', 'candidate', 'close']);

/**
 * Wires the whole realtime protocol onto a socket.io server.
 * Returns { stop() } so tests and graceful shutdown can clear the timers.
 */
function createGame(io, { world, youtube, config, emojiFiles = [], limiter = new RateLimiter() }) {
    const dirty = new Set();

    const posOf = p => ({ id: p.id, x: round(p.x), y: round(p.y), dirX: round(p.dirX, 2), dirY: round(p.dirY, 2) });
    const roomOf = p => (p.roomId ? world.rooms.get(p.roomId) : null);

    function broadcastBall(reliable = true) {
        const payload = world.football.snapshot();
        (reliable ? io : io.volatile).emit('ball', payload);
    }

    function enterRoom(player, roomId) {
        const sock = io.sockets.sockets.get(player.id);
        if (!sock) return;
        sock.join(rkey(roomId));
        const room = world.rooms.get(roomId);
        if (room) sock.emit('room:sync', world.roomSnapshot(room));
    }

    function leaveRoom(player, roomId) {
        const sock = io.sockets.sockets.get(player.id);
        if (sock) sock.leave(rkey(roomId));
    }

    function applyMembership(player, change) {
        if (!change) return;
        if (change.from) leaveRoom(player, change.from);
        if (change.to) enterRoom(player, change.to);
    }

    function announceDestroyed(ids) {
        for (const id of ids) io.emit('room:destroyed', id);
    }

    world.on('football:reset', () => { broadcastBall(); io.emit('score', world.football.score); });

    // Batched movement: one message per tick per client instead of one per move per player.
    const moveTimer = setInterval(() => {
        if (!dirty.size) return;
        const batch = [];
        for (const id of dirty) {
            const p = world.players.get(id);
            if (p) batch.push([id, round(p.x), round(p.y), round(p.dirX, 2), round(p.dirY, 2)]);
        }
        dirty.clear();
        if (batch.length) io.emit('players:move', batch);
    }, 50);

    const ballTimer = setInterval(() => {
        const { moved, goal } = world.football.tick();
        if (goal) {
            io.emit('goal', goal);
            broadcastBall();
        } else if (moved) {
            broadcastBall(world.football.moving ? false : true);
        }
    }, 30);

    // Server side backstop for the client's AFK logic.
    const afkTimer = setInterval(() => {
        const limit = config.AFK_LIMIT_MS + config.AFK_GRACE_MS;
        const t = world.now();
        for (const p of Array.from(world.players.values())) {
            if (t - p.lastActive > limit) {
                const sock = io.sockets.sockets.get(p.id);
                if (sock) { sock.emit('kicked', { reason: 'afk' }); sock.disconnect(true); }
            }
        }
        limiter.sweep();
    }, 30000);

    for (const timer of [moveTimer, ballTimer, afkTimer]) timer.unref();

    io.on('connection', socket => {
        // Flood guard: a well behaved client never gets near this.
        let windowStart = Date.now(), count = 0;
        socket.use((_packet, next) => {
            const t = Date.now();
            if (t - windowStart >= 1000) { windowStart = t; count = 0; }
            if (++count > 400) { socket.disconnect(true); return; }
            next();
        });

        /** Registers a handler with join check, rate limit, ack safety and error isolation. */
        function on(event, opts, handler) {
            if (typeof opts === 'function') { handler = opts; opts = {}; }
            socket.on(event, async (payload, ack) => {
                const reply = typeof ack === 'function' ? ack : noop;
                try {
                    const player = world.players.get(socket.id);
                    if (!player) return reply({ ok: false, error: 'not-joined' });
                    if (opts.limit && !limiter.allow(socket.id, event, opts.limit[0], opts.limit[1])) {
                        return reply({ ok: false, error: 'rate-limit' });
                    }
                    await handler(player, payload, reply);
                } catch (err) {
                    console.error(`[socket ${event}]`, err);
                    reply({ ok: false, error: 'server-error' });
                }
            });
        }

        socket.on('join', (payload, ack) => {
            const reply = typeof ack === 'function' ? ack : noop;
            try {
                let p = world.players.get(socket.id);
                if (!p) {
                    if (world.players.size >= config.MAX_PLAYERS) return reply({ ok: false, error: 'full' });
                    if (!limiter.allow(socket.id, 'join', 3, 10000)) return reply({ ok: false, error: 'rate-limit' });
                    p = world.addPlayer(socket.id, isPlainObject(payload) ? payload : {});
                    socket.broadcast.emit('player:join', world.publicPlayer(p));
                }
                reply({
                    ok: true,
                    you: p.id,
                    slots: world.slots,
                    rooms: world.publicRooms(),
                    players: world.publicPlayers(),
                    ball: world.football.snapshot(),
                    score: world.football.score,
                    emojis: { images: emojiFiles, unicode: W.REACTIONS }
                });
            } catch (err) {
                console.error('[socket join]', err);
                reply({ ok: false, error: 'server-error' });
            }
        });

        on('heartbeat', p => { p.lastActive = world.now(); });

        on('move', { limit: [45, 1000] }, (p, d) => {
            if (!isPlainObject(d)) return;
            const res = world.tryMove(p, Number(d.x), Number(d.y), Number(d.dirX), Number(d.dirY));
            if (!res.ok) {
                // Authoritative correction, only meaningful for the sender.
                socket.emit('player:snap', posOf(p));
                return;
            }
            dirty.add(p.id);
            if (res.membership) applyMembership(p, res.membership);
            if (res.destroyed.length) announceDestroyed(res.destroyed);
            if (p.roomId === STADIUM.id && (res.dx || res.dy) && world.football.nudge(p, res.dx, res.dy)) broadcastBall(false);
        });

        on('chat', { limit: [4, 3000] }, (p, d) => {
            const text = cleanText(isPlainObject(d) ? d.text : d, 80);
            if (!text) return;
            p.lastActive = world.now();
            const msg = { id: p.id, name: p.nickname, text, roomId: p.roomId, t: Date.now() };
            (p.roomId ? io.to(rkey(p.roomId)) : io).emit('chat', msg);
        });

        on('emoji', { limit: [3, 1000] }, (p, d) => {
            const emoji = isPlainObject(d) ? d.emoji : d;
            if (typeof emoji !== 'string') return;
            if (!emojiFiles.includes(emoji) && !W.REACTIONS.includes(emoji)) return;
            p.lastActive = world.now();
            io.emit('emoji', { id: p.id, emoji });
        });

        // --------------------------------------------------------------- football
        on('kick', { limit: [5, 1000] }, p => {
            if (p.roomId !== STADIUM.id) return;
            p.lastActive = world.now();
            io.emit('player:kick', p.id);
            if (world.football.kick(p)) broadcastBall(false);
        });

        on('score:reset', { limit: [1, 5000] }, p => {
            if (p.roomId !== STADIUM.id) return;
            world.football.reset(true);
            broadcastBall();
            io.emit('score', world.football.score);
        });

        // ------------------------------------------------------------------ rooms
        on('room:create', { limit: [3, 3000] }, (p, d, reply) => {
            if (!isPlainObject(d)) return reply({ ok: false, error: 'invalid' });
            const res = world.createRoom(p, d);
            if (!res.ok) return reply(res);
            io.emit('room:created', world.publicRoom(res.room));
            for (const m of res.moved) io.emit('player:snap', posOf(m));
            for (const m of res.membership) enterRoom(m.player, m.to);
            reply({ ok: true, slotId: res.room.id });
        });

        on('room:password', { limit: [4, 10000] }, (p, d, reply) => {
            if (!isPlainObject(d) || typeof d.slotId !== 'string') return reply({ ok: false, error: 'invalid' });
            reply({ ok: world.checkPassword(p, d.slotId, d.password), slotId: d.slotId, error: 'wrong-password' });
        });

        // ------------------------------------------------------------- whiteboard
        on('wb:draw', { limit: [60, 1000] }, (p, d) => {
            const room = roomOf(p);
            if (!room || room.builtin || !isPlainObject(d) || !Array.isArray(d.s) || !d.s.length || d.s.length > 64) return;
            if (typeof d.c !== 'string' || !COLOR_RE.test(d.c)) return;
            const w = Number(d.w);
            if (!Number.isFinite(w)) return;
            const segs = [];
            for (const seg of d.s) {
                if (!Array.isArray(seg) || seg.length !== 4) return;
                const v = seg.map(Number);
                if (!v.every(Number.isFinite)) return;
                segs.push(v.map(n => round(W.clamp(n, 0, 1), 4)));
            }
            const batch = { c: d.c.toLowerCase(), w: W.clamp(round(w, 1), 0.5, 48), s: segs };
            world.addStroke(room, batch);
            socket.to(rkey(room.id)).emit('wb:draw', { roomId: room.id, ...batch });
        });

        on('wb:clear', { limit: [2, 2000] }, p => {
            const room = roomOf(p);
            if (!room || room.builtin) return;
            room.whiteboard = [];
            socket.to(rkey(room.id)).emit('wb:clear', { roomId: room.id });
        });

        // ------------------------------------------------------------------ notes
        on('note:set', { limit: [15, 1000] }, (p, d) => {
            const room = roomOf(p);
            if (!room || room.builtin || !isPlainObject(d)) return;
            room.note = { text: cleanMultiline(d.text, 5000), rev: room.note.rev + 1 };
            io.to(rkey(room.id)).emit('note:update', { roomId: room.id, text: room.note.text, rev: room.note.rev, by: p.id });
        });

        // ------------------------------------------------------------------ music
        const pushMusic = room => io.to(rkey(room.id)).emit('music:update', { roomId: room.id, ...room.music.snapshot() });

        on('music:add', { limit: [4, 5000] }, async (p, d, reply) => {
            const room = roomOf(p);
            if (!room || room.builtin || !isPlainObject(d)) return reply({ ok: false, error: 'invalid' });
            const videoId = parseVideoId(d.videoId || d.input);
            if (!videoId) return reply({ ok: false, error: 'invalid-link' });
            const title = cleanText((await youtube.title(videoId)) || '', 80) || `YouTube · ${videoId}`;
            // The player may have moved on while the title was being fetched.
            if (world.rooms.get(room.id) !== room || p.roomId !== room.id) return reply({ ok: false, error: 'invalid' });
            const item = room.music.add({ videoId, title, addedBy: p.nickname });
            if (!item) return reply({ ok: false, error: 'queue-full' });
            pushMusic(room);
            reply({ ok: true });
        });

        on('music:skip', { limit: [3, 3000] }, (p, d) => {
            const room = roomOf(p);
            if (!room || room.builtin || !isPlainObject(d)) return;
            if (room.music.current && room.music.current.id === d.songId && room.music.skip()) pushMusic(room);
        });

        on('music:ended', { limit: [6, 3000] }, (p, d) => {
            const room = roomOf(p);
            if (!room || room.builtin || !isPlainObject(d)) return;
            if (room.music.ended(d.songId)) pushMusic(room);
        });

        on('music:remove', { limit: [6, 3000] }, (p, d) => {
            const room = roomOf(p);
            if (!room || room.builtin || !isPlainObject(d)) return;
            if (room.music.remove(d.itemId)) pushMusic(room);
        });

        // -------------------------------------------------------------- p2p media
        // WebRTC signalling is relayed over the existing socket (no extra signalling server).
        on('rtc:signal', { limit: [500, 5000] }, (p, d) => {
            if (!isPlainObject(d) || typeof d.to !== 'string' || !RTC_CHANNELS.has(d.channel)) return;
            if (d.to === p.id || !world.players.has(d.to)) return;
            if (typeof d.type !== 'string' || !RTC_TYPES.has(d.type)) return;
            if (d.type !== 'close' && !isPlainObject(d.data)) return;
            io.to(d.to).emit('rtc:signal', { from: p.id, channel: d.channel, type: d.type, data: d.type === 'close' ? null : d.data });
        });

        on('camera:stop', { limit: [5, 2000] }, p => { socket.broadcast.emit('camera:stopped', p.id); });
        on('screen:stop', { limit: [5, 2000] }, p => { socket.broadcast.emit('screen:stopped', p.id); });

        socket.on('disconnect', () => {
            limiter.forget(socket.id);
            const { player, destroyed } = world.removePlayer(socket.id);
            dirty.delete(socket.id);
            if (!player) return;
            io.emit('player:leave', socket.id);
            announceDestroyed(destroyed);
        });
    });

    return {
        stop() { for (const t of [moveTimer, ballTimer, afkTimer]) clearInterval(t); }
    };
}

module.exports = { createGame };
