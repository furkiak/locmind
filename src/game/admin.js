'use strict';

/* Moderation operations used by the admin HTTP API. */

const { cleanText } = require('../security');

function createAdminApi(ctx) {
    const { world, hub } = ctx;

    const playerRow = p => {
        const room = p.roomId ? world.rooms.get(p.roomId) : null;
        const sock = ctx.client(p.id);
        return {
            id: p.id, nickname: p.nickname, avatar: p.avatar, status: p.status, ip: p.ip,
            room: room ? room.name : null, roomId: p.roomId, joinedAt: p.joinedAt, lastActive: p.lastActive,
            muted: p.muted, cam: p.cam, screen: p.screen, chatMutedUntil: p.chatMutedUntil > world.now() ? p.chatMutedUntil : 0,
            userAgent: sock ? sock.userAgent : '', backlog: sock ? sock.conn.bufferedAmount : 0
        };
    };

    return {
        players: () => Array.from(world.players.values()).map(playerRow),

        rooms: () => Array.from(world.rooms.values()).map(r => ({
            ...world.publicRoom(r),
            whiteboardStrokes: r.whiteboard.length, noteLength: r.note.text.length, queue: r.music.queue.length,
            playing: r.music.current ? r.music.current.title : null, expiresAt: r.expiresAt
        })),

        kick(id, message = '') {
            return ctx.kick(id, 'admin', cleanText(message, 160));
        },

        ban(id, { minutes = 0, reason = '' } = {}) {
            const p = world.players.get(id);
            if (!p) return null;
            const ban = ctx.bans.add({ ip: p.ip, name: p.nickname, minutes, reason });
            // everybody on that address goes
            for (const o of Array.from(world.players.values())) if (o.ip === p.ip) ctx.kick(o.id, 'banned', cleanText(reason, 160));
            return ban;
        },

        mute(id, minutes) {
            const p = world.players.get(id);
            if (!p) return false;
            p.chatMutedUntil = minutes > 0 ? world.now() + minutes * 60000 : 0;
            const sock = ctx.client(id);
            if (sock) sock.emit('moderation', { type: p.chatMutedUntil ? 'chat-muted' : 'chat-unmuted', until: p.chatMutedUntil });
            return true;
        },

        announce(text) {
            const t = cleanText(text, 280);
            if (!t) return false;
            hub.emit('announce', { text: t, t: Date.now() });
            return true;
        },

        closeRoom(slotId) {
            const res = world.closeRoom(slotId);
            if (!res.ok) return res;
            ctx.snap(res.moved);
            for (const m of res.membership) ctx.applyMembership(m.player, m);
            hub.emit('room:destroyed', slotId);
            if (ctx.store) ctx.store.write('rooms', world.permanentRooms());
            return { ok: true };
        },

        createPermanentRoom(data) {
            const res = world.createPermanentRoom(data || {});
            if (!res.ok) return res;
            if (res.replaced) hub.emit('room:destroyed', res.room.id);
            hub.emit('room:created', world.publicRoom(res.room));
            ctx.snap(res.moved);
            for (const m of res.membership) ctx.applyMembership(m.player, m);
            if (ctx.store) ctx.store.write('rooms', world.permanentRooms());
            return { ok: true, room: world.publicRoom(res.room) };
        },

        removeTrack(id) {
            return ctx.library ? ctx.library.remove(id) : false;
        }
    };
}

module.exports = { createAdminApi };
