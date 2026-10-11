'use strict';

const { cleanMultiline, isPlainObject } = require('../../security');

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** shared whiteboard and notepad */
module.exports = function tools(ctx, client, on) {
    const { world, W, round } = ctx;
    const toolRoom = p => { const r = ctx.roomOf(p); return r && !r.builtin ? r : null; };

    on('wb:draw', { limit: [60, 1000] }, (p, d) => {
        const room = toolRoom(p);
        if (!room || !isPlainObject(d) || !Array.isArray(d.s) || !d.s.length || d.s.length > 64) return;
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
        client.to(ctx.rkey(room.id)).emit('wb:draw', { roomId: room.id, ...batch });
        ctx.persist(room);
    });

    on('wb:clear', { limit: [2, 2000] }, p => {
        const room = toolRoom(p);
        if (!room) return;
        room.whiteboard = [];
        client.to(ctx.rkey(room.id)).emit('wb:clear', { roomId: room.id });
        ctx.persist(room);
    });

    on('note:set', { limit: [15, 1000] }, (p, d) => {
        const room = toolRoom(p);
        if (!room || !isPlainObject(d)) return;
        room.note = { text: cleanMultiline(d.text, 5000), rev: room.note.rev + 1 };
        ctx.toRoom(room, 'note:update', { roomId: room.id, text: room.note.text, rev: room.note.rev, by: p.id });
        ctx.persist(room);
    });
};
