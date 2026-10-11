// WebRTC media links, signalled through the game socket.
//   audio  : both ways, created for everybody in earshot
//   camera : one way (owner -> viewers in earshot)
//   screen : one way (owner -> everybody in the same room)
import { S, bus, roomIdOf, voiceRelation } from './state.js';
import { attachVoice, detachVoice, sendStream } from './audio.js';
import { play } from './sfx.js';

const links = new Map();
const failedAt = new Map();
const RETRY_MS = 4000;
const key = (id, channel) => `${id}:${channel}`;

function signal(to, channel, type, lid, data) {
    if (S.socket) S.socket.emit('rtc:signal', { to, channel, type, lid, data });
}

function newLid() { return Math.random().toString(36).slice(2, 10); }

class Link {
    constructor(id, channel, initiator, lid) {
        this.id = id; this.channel = channel; this.initiator = initiator; this.lid = lid;
        this.closed = false; this.haveRemote = false; this.pendingIce = []; this.timer = null;
        this.pc = new RTCPeerConnection({ iceServers: S.config.iceServers || [], bundlePolicy: 'max-bundle', iceTransportPolicy: S.forceRelay ? 'relay' : 'all' });
        this.pc.onicecandidate = e => { if (e.candidate) signal(id, channel, 'candidate', this.lid, e.candidate.toJSON()); };
        this.pc.ontrack = e => this.onTrack(e);
        this.pc.onconnectionstatechange = () => this.onState();
    }

    addLocalTracks() {
        let stream = null;
        if (this.channel === 'audio') stream = sendStream();
        else if (this.channel === 'camera') stream = S.camStream;
        else if (this.channel === 'screen') stream = S.screenStream;
        if (!stream) return;
        stream.getTracks().forEach(t => this.pc.addTrack(t, stream));
        if (this.channel !== 'audio') this.pc.getTransceivers().forEach(tr => { tr.direction = 'sendonly'; });
    }

    async start() {
        this.addLocalTracks();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        signal(this.id, this.channel, 'offer', this.lid, { type: offer.type, sdp: offer.sdp });
    }

    async onOffer(desc) {
        await this.pc.setRemoteDescription(desc);
        this.haveRemote = true;
        if (this.channel === 'audio') this.addLocalTracks();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        signal(this.id, this.channel, 'answer', this.lid, { type: answer.type, sdp: answer.sdp });
        await this.drain();
    }

    async onAnswer(desc) {
        await this.pc.setRemoteDescription(desc);
        this.haveRemote = true;
        await this.drain();
    }

    async onCandidate(c) {
        if (!this.haveRemote) { this.pendingIce.push(c); return; }
        try { await this.pc.addIceCandidate(c); } catch (_) { /* stale candidate */ }
    }

    async drain() {
        const queued = this.pendingIce; this.pendingIce = [];
        for (const c of queued) { try { await this.pc.addIceCandidate(c); } catch (_) {} }
    }

    onTrack(e) {
        const stream = e.streams[0] || new MediaStream([e.track]);
        if (this.channel === 'audio') attachVoice(this.id, stream);
        else if (this.channel === 'camera') bus.emit('rtc:camera', { id: this.id, stream });
        else bus.emit('rtc:screen', { id: this.id, stream });
    }

    onState() {
        const st = this.pc.connectionState;
        clearTimeout(this.timer);
        if (st === 'connected' && this.channel === 'audio') play('join');
        if (st === 'failed') { failedAt.set(key(this.id, this.channel), Date.now()); this.close(); }
        else if (st === 'disconnected') this.timer = setTimeout(() => { if (this.pc.connectionState !== 'connected') this.close(); }, 6000);
        else if (st === 'closed') this.close(false);
    }

    close(notify = true) {
        if (this.closed) return;
        this.closed = true;
        clearTimeout(this.timer);
        try { this.pc.close(); } catch (_) {}
        const k = key(this.id, this.channel);
        if (links.get(k) === this) links.delete(k);
        if (this.channel === 'audio') { detachVoice(this.id); if (notify) play('leave'); }
        else if (this.channel === 'camera') bus.emit('rtc:camera-end', { id: this.id });
        else bus.emit('rtc:screen-end', { id: this.id });
        if (notify) signal(this.id, this.channel, 'close', this.lid, null);
    }
}

function startLink(id, channel) {
    if (typeof RTCPeerConnection === 'undefined') return;
    const link = new Link(id, channel, true, newLid());
    links.set(key(id, channel), link);
    link.start().catch(err => { console.warn('[rtc] offer failed', err); link.close(); });
}

export async function handleSignal({ from, channel, type, lid, data }) {
    if (!S.players[from] || !S.config || typeof RTCPeerConnection === 'undefined') return;
    const k = key(from, channel);
    try {
        if (type === 'offer') {
            const old = links.get(k);
            if (old) old.close(false);
            const link = new Link(from, channel, false, lid);
            links.set(k, link);
            await link.onOffer(data);
            return;
        }
        const link = links.get(k);
        if (!link || link.lid !== lid) return;
        if (type === 'answer') await link.onAnswer(data);
        else if (type === 'candidate') await link.onCandidate(data);
        else if (type === 'close') link.close(false);
    } catch (err) {
        console.warn('[rtc] signal failed', type, err);
        const link = links.get(k);
        if (link) link.close();
    }
}

export function wantsVoice(me, p, linked) {
    return voiceRelation(me, p, linked).link;
}

function canRetry(k) {
    const t = failedAt.get(k);
    return !t || Date.now() - t > RETRY_MS;
}

/** Opens / closes links according to who is currently in earshot. Cheap, runs ~6x per second. */
export function updateLinks(me) {
    if (!S.config || !sendStream()) return;
    for (const id in S.players) {
        if (id === S.myId) continue;
        const p = S.players[id];

        const aKey = key(id, 'audio');
        const audio = links.get(aKey);
        const inRange = wantsVoice(me, p, !!audio);
        if (inRange) { if (!audio && S.myId > id && canRetry(aKey)) startLink(id, 'audio'); }
        else if (audio) audio.close();

        const cKey = key(id, 'camera');
        const cam = links.get(cKey);
        if (S.camStream && inRange) { if (!cam && canRetry(cKey)) startLink(id, 'camera'); }
        else if (cam && (cam.initiator || !inRange)) cam.close();

        const sKey = key(id, 'screen');
        const scr = links.get(sKey);
        const sameRoom = !!S.currentRoomId && roomIdOf(p) === S.currentRoomId;
        if (S.screenStream && sameRoom) { if (!scr && canRetry(sKey)) startLink(id, 'screen'); }
        else if (scr && (scr.initiator || !sameRoom)) scr.close();
    }
}

export function closeLinksFor(id, notify = false) {
    for (const ch of ['audio', 'camera', 'screen']) {
        const l = links.get(key(id, ch));
        if (l) l.close(notify);
    }
}

export function closeChannel(channel, initiatorOnly = true) {
    for (const l of Array.from(links.values())) {
        if (l.channel === channel && (!initiatorOnly || l.initiator)) l.close();
    }
}

export function closeAllLinks() {
    for (const l of Array.from(links.values())) l.close(false);
    failedAt.clear();
}

/** Connection details for diagnostics: which candidate types each link really uses. */
export async function linkStats() {
    const out = [];
    for (const l of links.values()) {
        const row = { id: l.id, channel: l.channel, state: l.pc.connectionState, local: null, remote: null, rtt: null };
        try {
            const stats = await l.pc.getStats();
            let pair = null;
            stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
            if (!pair) stats.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
            if (pair) {
                const lc = stats.get(pair.localCandidateId), rc = stats.get(pair.remoteCandidateId);
                row.local = lc && lc.candidateType; row.remote = rc && rc.candidateType;
                row.rtt = pair.currentRoundTripTime ? Math.round(pair.currentRoundTripTime * 1000) : null;
                row.protocol = lc && (lc.relayProtocol || lc.protocol);
            }
        } catch (_) { /* closed meanwhile */ }
        out.push(row);
    }
    return out;
}

export const linkedIds = () => {
    const ids = new Set();
    for (const l of links.values()) if (l.channel === 'audio') ids.add(l.id);
    return ids;
};
