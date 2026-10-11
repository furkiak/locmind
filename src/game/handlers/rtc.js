'use strict';

const { isPlainObject } = require('../../security');

const CHANNELS = new Set(['audio', 'camera', 'screen']);
const TYPES = new Set(['offer', 'answer', 'candidate', 'close']);

/** WebRTC signalling is relayed over the game socket (no separate signalling server). */
module.exports = function rtc(ctx, client, on) {
    const { world } = ctx;
    on('rtc:signal', { limit: [500, 5000] }, (p, d) => {
        if (!isPlainObject(d) || typeof d.to !== 'string' || !CHANNELS.has(d.channel)) return;
        if (d.to === p.id || !world.players.has(d.to)) return;
        if (typeof d.type !== 'string' || !TYPES.has(d.type)) return;
        if (d.type !== 'close' && !isPlainObject(d.data)) return;
        const lid = typeof d.lid === 'string' ? d.lid.slice(0, 24) : undefined;
        const sock = ctx.client(d.to);
        if (sock) sock.emit('rtc:signal', { from: p.id, channel: d.channel, type: d.type, lid, data: d.type === 'close' ? null : d.data });
    });
};
