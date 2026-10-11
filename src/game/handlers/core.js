'use strict';

const { isPlainObject } = require('../../security');

/** join / heartbeat / move / status / profile */
module.exports = function core(ctx, client, on) {
    const { world, cfg, limiter, settings, bans, W } = ctx;

    client.on('join', (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : ctx.noop;
        try {
            let p = world.players.get(client.id);
            if (!p) {
                const data = isPlainObject(payload) ? payload : {};
                if (bans.isBanned(client.ip)) return reply({ ok: false, error: 'banned' });
                if (world.players.size >= cfg.MAX_PLAYERS) return reply({ ok: false, error: 'full' });
                if (!limiter.allow(client.id, 'join', 3, 10000)) return reply({ ok: false, error: 'rate-limit' });
                const pw = settings.serverPassword();
                if (pw) {
                    if (!limiter.allow(client.ip, 'server-password', 10, 60000)) return reply({ ok: false, error: 'rate-limit' });
                    if (!ctx.safeEqual(typeof data.serverPassword === 'string' ? data.serverPassword : '', pw)) return reply({ ok: false, error: 'server-password' });
                }
                p = world.addPlayer(client.id, data, ctx.takeResume(data.resume), { ip: client.ip });
                if (p.roomId) ctx.enterRoom(p, p.roomId);
                client.broadcast.emit('player:join', world.publicPlayer(p));
            }
            reply({
                ok: true,
                you: p.id,
                token: p.token,
                iceServers: ctx.iceServersFor(client, p),
                unlocked: world.unlockedSlots(p),
                slots: world.slots,
                rooms: world.publicRooms(),
                players: world.publicPlayers(),
                ball: world.football.snapshot(),
                score: world.football.score,
                chat: world.publicChat,
                emojis: { images: ctx.emojiFiles, unicode: W.REACTIONS },
                server: {
                    name: cfg.SERVER_NAME,
                    motd: settings.get().motd,
                    youtube: cfg.YOUTUBE,
                    library: !!ctx.library,
                    uploads: !!ctx.library && settings.uploadsAllowed(),
                    uploadMaxBytes: cfg.UPLOAD_MAX_BYTES
                }
            });
        } catch (err) {
            ctx.log.error('join failed', err);
            reply({ ok: false, error: 'server-error' });
        }
    });

    on('heartbeat', p => { p.lastActive = world.now(); });

    on('move', { limit: [45, 1000] }, (p, d) => {
        if (!isPlainObject(d)) return;
        const res = world.tryMove(p, Number(d.x), Number(d.y), Number(d.dirX), Number(d.dirY));
        if (!res.ok) {
            client.emit('player:snap', ctx.posOf(p));   // authoritative correction for the sender only
            return;
        }
        ctx.dirty.add(p.id);
        if (res.membership) ctx.applyMembership(p, res.membership);
        if (res.destroyed.length) ctx.announceDestroyed(res.destroyed);
        if (p.roomId === W.STADIUM.id && (res.dx || res.dy) && world.football.nudge(p, res.dx, res.dy)) ctx.broadcastBall(false);
    });

    // Everyone sees who is muted / on camera / sharing a screen.
    on('status', { limit: [12, 2000] }, (p, d) => {
        if (!isPlainObject(d)) return;
        p.muted = !!d.muted; p.cam = !!d.cam; p.screen = !!d.screen;
        p.lastActive = world.now();
        client.broadcast.emit('player:status', { id: p.id, muted: p.muted, cam: p.cam, screen: p.screen });
    });

    on('profile:set', { limit: [8, 10000] }, (p, d, reply) => {
        if (!isPlainObject(d)) return reply({ ok: false, error: 'invalid' });
        if (world.setProfile(p, d)) {
            ctx.hub.emit('player:profile', { id: p.id, status: p.status, statusText: p.statusText, avatar: p.avatar });
        }
        reply({ ok: true, status: p.status, statusText: p.statusText, avatar: p.avatar });
    });
};
