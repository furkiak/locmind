'use strict';

/*
 * Realtime game: wires the handler modules onto the hub and runs the world clock
 * (movement broadcast with interest management, ball physics, housekeeping).
 */

const { RateLimiter } = require('../security');
const { textFrame } = require('../net/frames');
const { makeContext } = require('./context');
const { createAdminApi } = require('./admin');

const HANDLERS = ['core', 'social', 'rooms', 'tools', 'music', 'football', 'rtc'].map(n => require(`./handlers/${n}`));

const TICK_MS = 50;              // movement broadcast rate for nearby players (20 Hz)
const FAR_EVERY = 10;            // everybody else gets a full update every 10 ticks (2 Hz)
const CELL = 700;                // interest management grid cell (px); a client sees its 3x3 cell block at full rate

const safe = (log, fn) => () => { try { fn(); } catch (err) { log.error('timer failed', err); } };

function createGame(hub, deps) {
    const ctx = makeContext(hub, { limiter: new RateLimiter(), iceServersFor: () => [], ...deps });
    const { world, cfg, limiter, log, round } = ctx;

    world.on('football:reset', () => { ctx.broadcastBall(); hub.emit('score', world.football.score); });

    // ------------------------------------------------- movement (interest managed)
    const farDirty = new Set();
    let tick = 0;
    const cellOf = p => `${Math.floor((p.x + 20) / CELL)}:${Math.floor((p.y + 20) / CELL)}`;
    const row = p => [p.id, round(p.x), round(p.y), round(p.dirX, 2), round(p.dirY, 2)];

    const moveTimer = setInterval(safe(log, () => {
        tick++;
        for (const id of ctx.dirty) farDirty.add(id);
        if (tick % FAR_EVERY === 0) {
            // full refresh for everybody (keeps far away players and the minimap up to date)
            ctx.dirty.clear();
            if (!farDirty.size) return;
            const rows = [];
            for (const id of farDirty) { const p = world.players.get(id); if (p) rows.push(row(p)); }
            farDirty.clear();
            if (rows.length) hub.emit('players:move', rows);
            return;
        }
        if (!ctx.dirty.size) return;
        // bucket movers by grid cell
        const movers = new Map();
        for (const id of ctx.dirty) {
            const p = world.players.get(id);
            if (!p) continue;
            const c = cellOf(p);
            if (!movers.has(c)) movers.set(c, []);
            movers.get(c).push(row(p));
        }
        ctx.dirty.clear();
        // bucket recipients by cell, encode one frame per cell neighbourhood
        const recipients = new Map();
        for (const p of world.players.values()) {
            const c = cellOf(p);
            if (!recipients.has(c)) recipients.set(c, []);
            recipients.get(c).push(p.id);
        }
        for (const [c, ids] of recipients) {
            const [cx, cy] = c.split(':').map(Number);
            const rows = [];
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const m = movers.get(`${cx + dx}:${cy + dy}`);
                if (m) rows.push(...m);
            }
            if (!rows.length) continue;
            const frame = textFrame(JSON.stringify(['players:move', rows]));
            for (const id of ids) { const sock = hub.clients.get(id); if (sock) hub.sendFrame(sock, frame, true); }
        }
    }), TICK_MS);

    const ballTimer = setInterval(safe(log, () => {
        const { moved, goal } = world.football.tick();
        if (goal) { hub.emit('goal', goal); ctx.broadcastBall(); }
        else if (moved) ctx.broadcastBall(!world.football.moving);
    }), 30);

    // Server side backstop for the client's AFK logic + housekeeping.
    const slowTimer = setInterval(safe(log, () => {
        const limit = cfg.AFK_LIMIT_MS + cfg.AFK_GRACE_MS;
        const t = world.now();
        for (const p of Array.from(world.players.values())) if (t - p.lastActive > limit) ctx.kick(p.id, 'afk');
        limiter.sweep();
        for (const [token, saved] of ctx.resumes) if (saved.expires < t) ctx.resumes.delete(token);
        if (ctx.bans) ctx.bans.sweep();
    }), 30000);

    const roomTimer = setInterval(safe(log, () => ctx.announceDestroyed(world.sweepRooms())), 5000);
    for (const timer of [moveTimer, ballTimer, slowTimer, roomTimer]) timer.unref();

    // ------------------------------------------------------------- connections
    hub.on('connection', client => {
        /** Registers a handler with join check, rate limit, ack safety and error isolation. */
        const on = (event, opts, handler) => {
            if (typeof opts === 'function') { handler = opts; opts = {}; }
            client.on(event, async (payload, ack) => {
                const reply = typeof ack === 'function' ? ack : ctx.noop;
                try {
                    const player = world.players.get(client.id);
                    if (!player) return reply({ ok: false, error: 'not-joined' });
                    if (opts.limit && !limiter.allow(client.id, event, opts.limit[0], opts.limit[1])) return reply({ ok: false, error: 'rate-limit' });
                    await handler(player, payload, reply);
                } catch (err) {
                    log.error(`realtime ${event} failed`, err);
                    reply({ ok: false, error: 'server-error' });
                }
            });
        };
        for (const register of HANDLERS) register(ctx, client, on);
        client.on('disconnect', () => { ctx.dropPlayer(client.id); });
    });

    return {
        ctx,
        admin: createAdminApi(ctx),
        stop() { for (const t of [moveTimer, ballTimer, slowTimer, roomTimer]) clearInterval(t); }
    };
}

module.exports = { createGame };
