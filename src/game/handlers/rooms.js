'use strict';

const { isPlainObject } = require('../../security');

/** building / unlocking / owner controls / raise hand / polls / timers */
module.exports = function rooms(ctx, client, on) {
    const { world, hub } = ctx;

    on('room:create', { limit: [3, 3000] }, (p, d, reply) => {
        if (!isPlainObject(d)) return reply({ ok: false, error: 'invalid' });
        const res = world.createRoom(p, d);
        if (!res.ok) return reply(res);
        hub.emit('room:created', world.publicRoom(res.room));
        ctx.snap(res.moved);
        for (const m of res.membership) ctx.applyMembership(m.player, m);
        reply({ ok: true, slotId: res.room.id });
    });

    on('room:password', { limit: [4, 10000] }, (p, d, reply) => {
        if (!isPlainObject(d) || typeof d.slotId !== 'string') return reply({ ok: false, error: 'invalid' });
        reply({ ok: world.checkPassword(p, d.slotId, d.password), slotId: d.slotId, error: 'wrong-password' });
    });

    on('room:settings', { limit: [6, 10000] }, (p, d, reply) => {
        if (!isPlainObject(d) || typeof d.slotId !== 'string') return reply({ ok: false, error: 'invalid' });
        const res = world.updateRoom(p, d.slotId, d);
        if (!res.ok) return reply(res);
        ctx.roomChanged(res.room);
        for (const id of res.lockedOut) { const sock = ctx.client(id); if (sock) sock.emit('room:relock', res.room.id); }
        reply({ ok: true });
    });

    on('room:kick', { limit: [6, 10000] }, (p, d, reply) => {
        if (!isPlainObject(d) || typeof d.slotId !== 'string' || typeof d.target !== 'string') return reply({ ok: false, error: 'invalid' });
        const res = world.kickFromRoom(p, d.slotId, d.target);
        if (!res.ok) return reply(res);
        ctx.snap([res.target]);
        ctx.applyMembership(res.target, res.change);
        const sock = ctx.client(res.target.id);
        if (sock) sock.emit('moderation', { type: 'room-kick', roomName: world.rooms.get(d.slotId).name });
        reply({ ok: true });
    });

    // ---------------------------------------------------------- raise hand
    on('hand', { limit: [6, 5000] }, (p, d) => {
        const room = ctx.roomOf(p);
        if (!room || !isPlainObject(d)) return;
        const target = typeof d.target === 'string' && d.target !== p.id ? d.target : p.id;
        let changed;
        if (target !== p.id) {
            if (room.owner !== p.id || d.up) return;           // only the owner may lower other hands
            changed = world.lowerHand(room, target);
        } else {
            changed = d.up ? world.raiseHand(room, p) : world.lowerHand(room, p.id);
        }
        if (changed) ctx.handsChanged(room);
    });

    // --------------------------------------------------------------- polls
    on('poll:create', { limit: [3, 10000] }, (p, d, reply) => {
        const room = ctx.roomOf(p);
        if (!room || room.type === 'stadium' || !isPlainObject(d)) return reply({ ok: false, error: 'invalid' });
        const res = world.createPoll(room, p, d.question, d.options);
        if (!res.ok) return reply(res);
        ctx.pollChanged(room);
        reply({ ok: true });
    });

    on('poll:vote', { limit: [10, 5000] }, (p, d) => {
        const room = ctx.roomOf(p);
        if (!room || !isPlainObject(d)) return;
        if (world.vote(room, p, d.pollId, d.option)) ctx.pollChanged(room);
    });

    on('poll:close', { limit: [3, 5000] }, (p, d) => {
        const room = ctx.roomOf(p);
        if (!room || !isPlainObject(d)) return;
        if (world.closePoll(room, p, d.pollId)) ctx.pollChanged(room);
    });

    // -------------------------------------------------------------- timers
    on('timer:start', { limit: [4, 10000] }, (p, d, reply) => {
        const room = ctx.roomOf(p);
        if (!room || room.type === 'stadium' || !isPlainObject(d)) return reply({ ok: false, error: 'invalid' });
        if (!world.startTimer(room, p, d.seconds, d.label)) return reply({ ok: false, error: 'invalid' });
        ctx.timerChanged(room);
        reply({ ok: true });
    });

    on('timer:stop', { limit: [4, 10000] }, p => {
        const room = ctx.roomOf(p);
        if (!room || !room.timer) return;
        room.timer = null;
        ctx.timerChanged(room);
    });
};
