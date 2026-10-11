'use strict';

const { cleanText, isPlainObject } = require('../../security');

const TYPING_RADIUS = 700;

/** chat / direct messages / waves / reactions / typing */
module.exports = function social(ctx, client, on) {
    const { world, hub, limiter, settings, W } = ctx;

    const mutedNow = p => {
        if (p.chatMutedUntil > world.now()) { client.emit('moderation', { type: 'chat-muted', until: p.chatMutedUntil }); return true; }
        return false;
    };

    on('chat', { limit: [4, 3000] }, (p, d) => {
        const text = settings.filter(cleanText(isPlainObject(d) ? d.text : d, 160));
        if (!text || mutedNow(p)) return;
        p.lastActive = world.now();
        const room = ctx.roomOf(p);
        const msg = { id: p.id, name: p.nickname, text, roomId: p.roomId, t: Date.now() };
        world.pushChat(room, msg);
        if (room) ctx.toRoom(room, 'chat', msg); else hub.emit('chat', msg);
    });

    on('dm', { limit: [8, 5000] }, (p, d, reply) => {
        if (!isPlainObject(d) || typeof d.to !== 'string') return reply({ ok: false, error: 'invalid' });
        const target = world.players.get(d.to);
        if (!target || target === p) return reply({ ok: false, error: 'not-found' });
        const text = settings.filter(cleanText(d.text, 300));
        if (!text) return reply({ ok: false, error: 'invalid' });
        if (mutedNow(p)) return reply({ ok: false, error: 'muted' });
        const msg = { from: p.id, fromName: p.nickname, to: target.id, toName: target.nickname, text, t: Date.now() };
        const sock = ctx.client(target.id);
        if (sock) sock.emit('dm', msg);
        client.emit('dm', msg);
        reply({ ok: true });
    });

    on('wave', { limit: [6, 10000] }, (p, d, reply) => {
        const to = isPlainObject(d) ? d.to : null;
        const target = typeof to === 'string' ? world.players.get(to) : null;
        if (!target || target === p) return reply({ ok: false, error: 'not-found' });
        if (!limiter.allow(p.id, `wave:${target.id}`, 1, 5000)) return reply({ ok: false, error: 'rate-limit' });
        const sock = ctx.client(target.id);
        if (sock) sock.emit('waved', { from: p.id, name: p.nickname });
        reply({ ok: true });
    });

    on('emoji', { limit: [3, 1000] }, (p, d) => {
        const emoji = isPlainObject(d) ? d.emoji : d;
        if (typeof emoji !== 'string') return;
        if (!ctx.emojiFiles.includes(emoji) && !W.REACTIONS.includes(emoji)) return;
        p.lastActive = world.now();
        hub.emit('emoji', { id: p.id, emoji });
    });

    on('typing', { limit: [12, 5000] }, (p, d) => {
        const payload = { id: p.id, on: !!(isPlainObject(d) && d.on) };
        const room = ctx.roomOf(p);
        if (room) { client.to(ctx.rkey(room.id)).emit('typing', payload); return; }
        for (const o of ctx.near(p, TYPING_RADIUS)) {
            if (o === p) continue;
            const sock = ctx.client(o.id);
            if (sock) sock.emit('typing', payload);
        }
    });
};
