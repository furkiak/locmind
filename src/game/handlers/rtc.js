'use strict';

const { isPlainObject } = require('../../security');

const CHANNELS = new Set(['audio', 'camera', 'screen']);
const TYPES = new Set(['offer', 'answer', 'candidate', 'close']);
const MAX_SDP = 16 * 1024;
const SIGNAL_RANGE = 1000;   // open world links never span more than this (the voice radius is far smaller)

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);

/** Keeps only the fields a browser needs, so the relay cannot be used to push arbitrary data at someone. */
function cleanData(type, data) {
    if (!isPlainObject(data)) return null;
    if (type === 'offer' || type === 'answer') {
        const sdp = str(data.sdp, MAX_SDP);
        return sdp && data.type === type ? { type, sdp } : null;
    }
    const candidate = str(data.candidate, 1024);
    if (candidate === null) return null;
    const out = { candidate };
    if (data.sdpMid !== undefined) out.sdpMid = data.sdpMid === null ? null : str(data.sdpMid, 64);
    if (Number.isInteger(data.sdpMLineIndex) && data.sdpMLineIndex >= 0 && data.sdpMLineIndex < 64) out.sdpMLineIndex = data.sdpMLineIndex;
    if (typeof data.usernameFragment === 'string') out.usernameFragment = str(data.usernameFragment, 256);
    return out;
}

/** WebRTC signalling is relayed over the game socket (no separate signalling server). */
module.exports = function rtc(ctx, client, on) {
    const { world, limiter } = ctx;

    // Two players may set up a call when they share a room, or stand reasonably close in the open world.
    const mayTalk = (a, b) => (a.roomId || b.roomId ? a.roomId === b.roomId : Math.hypot(a.x - b.x, a.y - b.y) < SIGNAL_RANGE);

    on('rtc:signal', { limit: [500, 5000] }, (p, d) => {
        if (!isPlainObject(d) || typeof d.to !== 'string' || !CHANNELS.has(d.channel)) return;
        if (d.to === p.id) return;
        const target = world.players.get(d.to);
        if (!target) return;
        if (typeof d.type !== 'string' || !TYPES.has(d.type)) return;
        const lid = typeof d.lid === 'string' ? d.lid.slice(0, 24) : undefined;
        const sock = ctx.client(d.to);
        if (!sock) return;
        if (d.type === 'close') { sock.emit('rtc:signal', { from: p.id, channel: d.channel, type: 'close', lid, data: null }); return; }
        if (!mayTalk(p, target)) return;
        // per pair budget: a handful of offers and a few dozen candidates per link is all a browser sends
        if (!limiter.allow(p.id, `sig:${d.to}`, 160, 10000)) return;
        const data = cleanData(d.type, d.data);
        if (!data) return;
        sock.emit('rtc:signal', { from: p.id, channel: d.channel, type: d.type, lid, data });
    });
};
