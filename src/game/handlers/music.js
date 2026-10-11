'use strict';

const { cleanText, isPlainObject } = require('../../security');
const { parseVideoId } = require('../../youtube');

/** shared jukebox: YouTube links (when enabled) and the self-hosted library */
module.exports = function music(ctx, client, on) {
    const { world, cfg } = ctx;
    const musicRoom = p => { const r = ctx.roomOf(p); return r && !r.builtin ? r : null; };

    on('music:add', { limit: [4, 5000] }, async (p, d, reply) => {
        const room = musicRoom(p);
        if (!room || !isPlainObject(d)) return reply({ ok: false, error: 'invalid' });
        let item;
        if (typeof d.trackId === 'string') {
            const track = ctx.library && ctx.library.get(d.trackId);
            if (!track) return reply({ ok: false, error: 'not-found' });
            item = { source: 'library', trackId: track.id, title: track.artist ? `${track.artist} — ${track.title}` : track.title, addedBy: p.nickname };
        } else {
            if (!cfg.YOUTUBE) return reply({ ok: false, error: 'youtube-disabled' });
            const videoId = parseVideoId(d.videoId || d.input);
            if (!videoId) return reply({ ok: false, error: 'invalid-link' });
            const title = cleanText((await ctx.youtube.title(videoId)) || '', 80) || `YouTube · ${videoId}`;
            item = { source: 'youtube', videoId, title, addedBy: p.nickname };
        }
        // The player may have moved on while the title was being fetched.
        if (world.rooms.get(room.id) !== room || p.roomId !== room.id) return reply({ ok: false, error: 'invalid' });
        if (!room.music.add(item)) return reply({ ok: false, error: 'queue-full' });
        ctx.musicChanged(room);
        reply({ ok: true });
    });

    on('music:skip', { limit: [3, 3000] }, (p, d) => {
        const room = musicRoom(p);
        if (!room || !isPlainObject(d)) return;
        if (room.music.current && room.music.current.id === d.songId && room.music.skip()) ctx.musicChanged(room);
    });

    on('music:ended', { limit: [6, 3000] }, (p, d) => {
        const room = musicRoom(p);
        if (!room || !isPlainObject(d)) return;
        if (room.music.ended(d.songId)) ctx.musicChanged(room);
    });

    on('music:remove', { limit: [6, 3000] }, (p, d) => {
        const room = musicRoom(p);
        if (!room || !isPlainObject(d)) return;
        if (room.music.remove(d.itemId)) ctx.musicChanged(room);
    });
};
