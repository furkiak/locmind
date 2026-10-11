'use strict';

/*
 * Built-in STUN + TURN relay (RFC 5389 / RFC 8656 subset that browsers use):
 *   Binding, Allocate, Refresh, CreatePermission, ChannelBind, Send/Data indications, ChannelData.
 * Transports: UDP and TCP on the same port. Relays are UDP/IPv4.
 * Authentication: time limited "TURN REST API" credentials (HMAC-SHA1 of the username with a secret),
 * so no user database is needed and credentials expire on their own.
 * Abuse protection: per-IP allocation quota, per-allocation bandwidth cap, peer address filtering
 * (no relaying into loopback / private networks unless allowed), request rate limiting.
 */

const dgram = require('dgram');
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');
const S = require('./stun');

const { METHOD, CLASS, ATTR } = S;
const DEFAULT_LIFETIME = 600;
const MAX_LIFETIME = 3600;
const PERMISSION_LIFETIME = 300;
const CHANNEL_LIFETIME = 600;
const NONCE_TTL_MS = 60 * 60 * 1000;
const SOFTWARE = Buffer.from('Locmind TURN');
const USERNAME_RE = /^(\d{1,12}):([A-Za-z0-9_-]{1,64})$/;

function v4ToInt(ip) { return ip.split('.').reduce((a, o) => (a << 8 | Number(o)) >>> 0, 0); }
function inV4(ip, cidr) {
    const [base, bits] = cidr.split('/');
    const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}
const ALWAYS_DENIED_V4 = ['0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4'];
const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '192.0.0.0/24', '198.18.0.0/15'];

function classifyIp(ip) {
    if (net.isIPv4(ip)) {
        if (ALWAYS_DENIED_V4.some(c => inV4(ip, c))) return 'denied';
        if (PRIVATE_V4.some(c => inV4(ip, c))) return 'private';
        return 'public';
    }
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1' || lower.startsWith('ff')) return 'denied';
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return 'denied';
    if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private';
    if (lower.startsWith('::ffff:')) return classifyIp(lower.slice(7));
    return 'public';
}

function detectPublicIp(host) {
    if (net.isIPv4(host) && host !== '0.0.0.0') return host;
    for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
    }
    return '127.0.0.1';
}

const norm = ip => (ip && ip.startsWith('::ffff:') ? ip.slice(7) : ip);

class TurnServer {
    /**
     * @param {object} o
     * @param {number} o.port               STUN/TURN port (UDP + TCP); 0 picks a free one
     * @param {string} [o.host]
     * @param {string} [o.publicIp]         address advertised in XOR-RELAYED-ADDRESS
     * @param {string|Buffer} o.secret      shared secret for the ephemeral credentials
     * @param {number} [o.relayMin]
     * @param {number} [o.relayMax]
     */
    constructor({ port = 3478, host = '0.0.0.0', publicIp = '', secret, realm = 'locmind', relayMin = 49160, relayMax = 49359,
        allowPrivatePeers = false, maxAllocationsPerIp = 10, bandwidthBps = 500000, log = null, tcp = true, tlsOptions = null, tlsPort = 5349 } = {}) {
        if (!secret) throw new Error('TURN secret is required');
        this.port = port;
        this.host = host;
        this.publicIp = publicIp || detectPublicIp(host);
        this.secret = secret;
        this.realm = realm;
        this.realmBuf = Buffer.from(realm);
        this.relayMin = relayMin;
        this.relayMax = Math.max(relayMin, relayMax);
        this.allowPrivatePeers = allowPrivatePeers;
        this.maxAllocationsPerIp = maxAllocationsPerIp;
        this.bandwidthBps = bandwidthBps;
        this.log = log;
        this.enableTcp = tcp;
        this.tlsOptions = tlsOptions;
        this.tlsPort = tlsPort;
        this.allocations = new Map();
        this.pending = new Set();
        this.portsInUse = new Set();
        this.requestCounts = new Map();
        this.stats = { allocationsCreated: 0, bytesRelayed: 0, packetsRelayed: 0, packetsDropped: 0, authFailures: 0 };
    }

    // ------------------------------------------------------------ lifecycle

    async start() {
        this.udp = dgram.createSocket('udp4');
        this.udp.on('message', (buf, r) => this.handle(buf, { proto: 'udp', address: norm(r.address), port: r.port, send: b => this.udp.send(b, r.port, r.address) }));
        this.udp.on('error', err => this.log && this.log.warn('turn udp error', { err: err.message }));
        await new Promise((resolve, reject) => { this.udp.once('error', reject); this.udp.bind(this.port, this.host, () => { this.udp.off('error', reject); resolve(); }); });
        this.port = this.udp.address().port;
        if (this.enableTcp) {
            this.tcp = net.createServer(sock => this.onTcp(sock));
            this.tcp.on('error', err => this.log && this.log.warn('turn tcp error', { err: err.message }));
            await new Promise((resolve, reject) => { this.tcp.once('error', reject); this.tcp.listen(this.port, this.host, () => { this.tcp.off('error', reject); resolve(); }); });
        }
        if (this.tlsOptions) {
            // TURN over TLS ("turns:") gets through firewalls that only allow TLS traffic.
            this.tls = tls.createServer(this.tlsOptions, sock => this.onTcp(sock));
            this.tls.on('error', err => this.log && this.log.warn('turn tls error', { err: err.message }));
            this.tls.on('tlsClientError', () => {});
            await new Promise((resolve, reject) => { this.tls.once('error', reject); this.tls.listen(this.tlsPort, this.host, () => { this.tls.off('error', reject); resolve(); }); });
            this.tlsPort = this.tls.address().port;
        }
        this.sweeper = setInterval(() => this.sweep(), 5000);
        this.sweeper.unref();
        return this;
    }

    async close() {
        clearInterval(this.sweeper);
        for (const a of this.allocations.values()) this.destroy(a);
        if (this.udp) this.udp.close();
        if (this.tcp) await new Promise(r => this.tcp.close(() => r()));
        if (this.tls) await new Promise(r => this.tls.close(() => r()));
    }

    // ---------------------------------------------------------- credentials

    /** Time limited credentials for one user (the classic TURN REST API scheme). */
    credentials(userId, ttlSeconds = 8 * 3600) {
        const id = String(userId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'user';
        const username = `${Math.floor(Date.now() / 1000) + ttlSeconds}:${id}`;
        return { username, credential: this.passwordFor(username) };
    }

    passwordFor(username) { return crypto.createHmac('sha1', this.secret).update(username).digest('base64'); }

    nonce() {
        const ts = Date.now().toString(36);
        return `${ts}-${crypto.createHmac('sha1', this.secret).update('nonce:' + ts).digest('hex').slice(0, 16)}`;
    }

    nonceValid(n) {
        const m = /^([0-9a-z]+)-([0-9a-f]{16})$/.exec(n);
        if (!m) return false;
        const expected = crypto.createHmac('sha1', this.secret).update('nonce:' + m[1]).digest('hex').slice(0, 16);
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]))) return false;
        return Date.now() - parseInt(m[1], 36) < NONCE_TTL_MS;
    }

    // -------------------------------------------------------------- helpers

    keyOf(T) { return `${T.proto}:${T.address}:${T.port}`; }

    reply(T, msg, attrs = [], key = null) {
        T.send(S.encode({ method: msg.method, cls: CLASS.SUCCESS, tid: msg.tid, attrs: [...attrs, [ATTR.SOFTWARE, SOFTWARE]] }, { key }));
    }

    error(T, msg, code, reason, attrs = [], key = null) {
        T.send(S.encode({ method: msg.method, cls: CLASS.ERROR, tid: msg.tid, attrs: [[ATTR.ERROR_CODE, S.errorCodeValue(code, reason)], ...attrs, [ATTR.SOFTWARE, SOFTWARE]] }, { key }));
    }

    challenge(T, msg, code, reason) {
        this.error(T, msg, code, reason, [[ATTR.REALM, this.realmBuf], [ATTR.NONCE, Buffer.from(this.nonce())]]);
    }

    peerAllowed(ip) {
        if (ip === this.publicIp) return true;                 // relay to relay (both peers behind TURN)
        const kind = classifyIp(ip);
        if (kind === 'denied') return false;
        if (kind === 'private' && !this.allowPrivatePeers) return false;
        return true;
    }

    rateOk(address) {
        const now = Date.now();
        let r = this.requestCounts.get(address);
        if (!r || now - r.start > 1000) { r = { start: now, n: 0 }; this.requestCounts.set(address, r); }
        return ++r.n <= 200;
    }

    spend(bucket, bytes) {
        const now = Date.now();
        bucket.tokens = Math.min(this.bandwidthBps * 2, bucket.tokens + (now - bucket.at) * this.bandwidthBps / 1000);
        bucket.at = now;
        if (bucket.tokens < bytes) return false;
        bucket.tokens -= bytes;
        return true;
    }

    // ------------------------------------------------------------- dispatch

    handle(buf, T) {
        if (S.isChannelData(buf)) { this.onChannelData(buf, T); return; }
        const msg = S.decode(buf);
        if (!msg || !S.checkFingerprint(msg)) return;
        if (msg.cls === CLASS.INDICATION) { if (msg.method === METHOD.SEND) this.onSend(msg, T); return; }
        if (msg.cls !== CLASS.REQUEST) return;
        if (!this.rateOk(T.address)) return;
        try {
            switch (msg.method) {
                case METHOD.BINDING: this.reply(T, msg, [[ATTR.XOR_MAPPED_ADDRESS, S.encodeXorAddress(T.address, T.port, msg.tid)]]); break;
                case METHOD.ALLOCATE: this.onAllocate(msg, T); break;
                case METHOD.REFRESH: this.onRefresh(msg, T); break;
                case METHOD.CREATE_PERMISSION: this.onCreatePermission(msg, T); break;
                case METHOD.CHANNEL_BIND: this.onChannelBind(msg, T); break;
                default: this.error(T, msg, 400, 'Bad Request');
            }
        } catch (err) {
            if (this.log) this.log.warn('turn request failed', { err: err.message });
        }
    }

    /** Long-term credential check. Sends the challenge/error itself and returns null on failure. */
    authenticate(msg, T) {
        const username = S.attr(msg, ATTR.USERNAME), realm = S.attr(msg, ATTR.REALM), nonce = S.attr(msg, ATTR.NONCE);
        if (msg.integrityAt < 0 || !username || !realm || !nonce) { this.challenge(T, msg, 401, 'Unauthorized'); return null; }
        if (!this.nonceValid(nonce.toString())) { this.challenge(T, msg, 438, 'Stale Nonce'); return null; }
        const user = username.toString();
        const m = USERNAME_RE.exec(user);
        const fail = () => { this.stats.authFailures++; this.challenge(T, msg, 401, 'Unauthorized'); return null; };
        if (!m || Number(m[1]) * 1000 < Date.now() || realm.toString() !== this.realm) return fail();
        const key = S.longTermKey(user, this.realm, this.passwordFor(user));
        if (!S.checkIntegrity(msg, key)) return fail();
        return { key, username: user };
    }

    // ------------------------------------------------------------ requests

    onAllocate(msg, T) {
        const auth = this.authenticate(msg, T);
        if (!auth) return;
        const k = this.keyOf(T);
        const existing = this.allocations.get(k);
        if (existing) {
            if (existing.tid.equals(msg.tid)) this.allocateOk(existing, msg, T, auth.key);
            else this.error(T, msg, 437, 'Allocation Mismatch', [], auth.key);
            return;
        }
        if (this.pending.has(k)) return;                        // retransmission while the relay port is being opened
        const rt = S.attr(msg, ATTR.REQUESTED_TRANSPORT);
        if (!rt || rt[0] !== 17) return this.error(T, msg, 442, 'Unsupported Transport Protocol', [], auth.key);
        const fam = S.attr(msg, ATTR.REQUESTED_ADDRESS_FAMILY);
        if (fam && fam[0] !== 0x01) return this.error(T, msg, 440, 'Address Family not Supported', [], auth.key);
        if (S.attr(msg, ATTR.RESERVATION_TOKEN)) return this.error(T, msg, 508, 'Insufficient Capacity', [], auth.key);
        let perIp = 0;
        for (const a of this.allocations.values()) if (a.client.address === T.address) perIp++;
        if (perIp >= this.maxAllocationsPerIp) return this.error(T, msg, 486, 'Allocation Quota Reached', [], auth.key);

        this.pending.add(k);
        this.openRelay().then(relay => {
            this.pending.delete(k);
            if (!relay) return this.error(T, msg, 508, 'Insufficient Capacity', [], auth.key);
            if (T.closed) { relay.socket.close(); this.portsInUse.delete(relay.port); return; }
            const lt = S.attr(msg, ATTR.LIFETIME);
            const lifetime = Math.min(MAX_LIFETIME, Math.max(DEFAULT_LIFETIME, lt ? lt.readUInt32BE(0) : DEFAULT_LIFETIME));
            const a = {
                key: k, client: T, tid: Buffer.from(msg.tid), username: auth.username, relay: relay.socket, relayPort: relay.port,
                expires: Date.now() + lifetime * 1000, lifetime,
                permissions: new Map(), channels: new Map(), peerChannels: new Map(),
                up: { tokens: this.bandwidthBps, at: Date.now() }, down: { tokens: this.bandwidthBps, at: Date.now() },
                createdAt: Date.now(), bytes: 0
            };
            relay.socket.on('message', (data, r) => this.fromPeer(a, data, norm(r.address), r.port));
            this.allocations.set(k, a);
            this.stats.allocationsCreated++;
            this.allocateOk(a, msg, T, auth.key);
        });
    }

    allocateOk(a, msg, T, key) {
        this.reply(T, msg, [
            [ATTR.XOR_RELAYED_ADDRESS, S.encodeXorAddress(this.publicIp, a.relayPort, msg.tid)],
            [ATTR.LIFETIME, S.u32(a.lifetime)],
            [ATTR.XOR_MAPPED_ADDRESS, S.encodeXorAddress(T.address, T.port, msg.tid)]
        ], key);
    }

    openRelay() {
        const span = this.relayMax - this.relayMin + 1;
        if (this.portsInUse.size >= span) return Promise.resolve(null);
        return new Promise(resolve => {
            let tries = 0;
            const attempt = () => {
                if (tries++ > 30) return resolve(null);
                const port = this.relayMin + Math.floor(Math.random() * span);
                if (this.portsInUse.has(port)) return attempt();
                const sock = dgram.createSocket('udp4');
                sock.once('error', () => { sock.close(); attempt(); });
                sock.bind(port, this.host, () => {
                    sock.removeAllListeners('error');
                    sock.on('error', () => {});
                    this.portsInUse.add(port);
                    resolve({ socket: sock, port });
                });
            };
            attempt();
        });
    }

    allocationFor(msg, T, key) {
        const a = this.allocations.get(this.keyOf(T));
        if (!a) { this.error(T, msg, 437, 'Allocation Mismatch', [], key); return null; }
        return a;
    }

    onRefresh(msg, T) {
        const auth = this.authenticate(msg, T);
        if (!auth) return;
        const a = this.allocationFor(msg, T, auth.key);
        if (!a) return;
        if (a.username !== auth.username) return this.error(T, msg, 441, 'Wrong Credentials', [], auth.key);
        const lt = S.attr(msg, ATTR.LIFETIME);
        const req = lt ? lt.readUInt32BE(0) : DEFAULT_LIFETIME;
        if (req === 0) {
            this.destroy(a);
            return this.reply(T, msg, [[ATTR.LIFETIME, S.u32(0)]], auth.key);
        }
        a.lifetime = Math.min(MAX_LIFETIME, Math.max(DEFAULT_LIFETIME, req));
        a.expires = Date.now() + a.lifetime * 1000;
        this.reply(T, msg, [[ATTR.LIFETIME, S.u32(a.lifetime)]], auth.key);
    }

    onCreatePermission(msg, T) {
        const auth = this.authenticate(msg, T);
        if (!auth) return;
        const a = this.allocationFor(msg, T, auth.key);
        if (!a) return;
        if (a.username !== auth.username) return this.error(T, msg, 441, 'Wrong Credentials', [], auth.key);
        const peers = S.attrs(msg, ATTR.XOR_PEER_ADDRESS).map(v => S.decodeXorAddress(v, msg.tid));
        if (!peers.length || peers.some(p => !p)) return this.error(T, msg, 400, 'Bad Request', [], auth.key);
        if (peers.some(p => p.family !== 4)) return this.error(T, msg, 443, 'Peer Address Family Mismatch', [], auth.key);
        if (peers.some(p => !this.peerAllowed(p.address))) return this.error(T, msg, 403, 'Forbidden', [], auth.key);
        const until = Date.now() + PERMISSION_LIFETIME * 1000;
        for (const p of peers) a.permissions.set(p.address, until);
        this.reply(T, msg, [], auth.key);
    }

    onChannelBind(msg, T) {
        const auth = this.authenticate(msg, T);
        if (!auth) return;
        const a = this.allocationFor(msg, T, auth.key);
        if (!a) return;
        if (a.username !== auth.username) return this.error(T, msg, 441, 'Wrong Credentials', [], auth.key);
        const cn = S.attr(msg, ATTR.CHANNEL_NUMBER);
        const peer = S.decodeXorAddress(S.attr(msg, ATTR.XOR_PEER_ADDRESS), msg.tid);
        if (!cn || cn.length < 2 || !peer) return this.error(T, msg, 400, 'Bad Request', [], auth.key);
        const number = cn.readUInt16BE(0);
        if (number < 0x4000 || number > 0x7FFF) return this.error(T, msg, 400, 'Bad Request', [], auth.key);
        if (peer.family !== 4) return this.error(T, msg, 443, 'Peer Address Family Mismatch', [], auth.key);
        if (!this.peerAllowed(peer.address)) return this.error(T, msg, 403, 'Forbidden', [], auth.key);
        const peerKey = `${peer.address}:${peer.port}`;
        const bound = a.channels.get(number), byPeer = a.peerChannels.get(peerKey);
        if ((bound && bound.peerKey !== peerKey) || (byPeer && byPeer.number !== number)) return this.error(T, msg, 400, 'Bad Request', [], auth.key);
        const now = Date.now();
        const entry = { number, address: peer.address, port: peer.port, peerKey, expires: now + CHANNEL_LIFETIME * 1000 };
        a.channels.set(number, entry);
        a.peerChannels.set(peerKey, entry);
        a.permissions.set(peer.address, Math.max(a.permissions.get(peer.address) || 0, now + PERMISSION_LIFETIME * 1000));
        this.reply(T, msg, [], auth.key);
    }

    // ------------------------------------------------------------ data path

    onSend(msg, T) {
        const a = this.allocations.get(this.keyOf(T));
        if (!a) return;
        const peer = S.decodeXorAddress(S.attr(msg, ATTR.XOR_PEER_ADDRESS), msg.tid);
        const data = S.attr(msg, ATTR.DATA);
        if (!peer || !data) return;
        this.toPeer(a, data, peer.address, peer.port);
    }

    onChannelData(buf, T) {
        const a = this.allocations.get(this.keyOf(T));
        if (!a) return;
        const number = buf.readUInt16BE(0), len = buf.readUInt16BE(2);
        if (4 + len > buf.length) return;
        const ch = a.channels.get(number);
        if (!ch || ch.expires < Date.now()) return;
        this.toPeer(a, buf.subarray(4, 4 + len), ch.address, ch.port);
    }

    toPeer(a, data, address, port) {
        const perm = a.permissions.get(address);
        if (!perm || perm < Date.now() || !this.spend(a.up, data.length)) { this.stats.packetsDropped++; return; }
        a.relay.send(data, port, address);
        a.bytes += data.length;
        this.stats.bytesRelayed += data.length;
        this.stats.packetsRelayed++;
    }

    fromPeer(a, data, address, port) {
        const now = Date.now();
        const perm = a.permissions.get(address);
        if (!perm || perm < now || !this.spend(a.down, data.length)) { this.stats.packetsDropped++; return; }
        const ch = a.peerChannels.get(`${address}:${port}`);
        let out;
        if (ch && ch.expires >= now) {
            const pad = a.client.proto === 'tcp' ? (4 - (data.length % 4)) % 4 : 0;
            out = Buffer.alloc(4 + data.length + pad);
            out.writeUInt16BE(ch.number, 0);
            out.writeUInt16BE(data.length, 2);
            data.copy(out, 4);
        } else {
            const tid = crypto.randomBytes(12);
            out = S.encode({ method: METHOD.DATA, cls: CLASS.INDICATION, tid, attrs: [[ATTR.XOR_PEER_ADDRESS, S.encodeXorAddress(address, port, tid)], [ATTR.DATA, data]] }, { fingerprint: false });
        }
        a.client.send(out);
        a.bytes += data.length;
        this.stats.bytesRelayed += data.length;
        this.stats.packetsRelayed++;
    }

    // ------------------------------------------------------------------ TCP

    onTcp(sock) {
        sock.setNoDelay(true);
        const T = { proto: 'tcp', address: norm(sock.remoteAddress), port: sock.remotePort, closed: false, send: b => { if (!sock.destroyed) sock.write(b); } };
        let buf = Buffer.alloc(0);
        const idle = setTimeout(() => { if (!this.allocations.has(this.keyOf(T))) sock.destroy(); }, 30000);
        sock.on('data', chunk => {
            buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
            if (buf.length > 256 * 1024) { sock.destroy(); return; }
            while (buf.length >= 4) {
                let need;
                if ((buf[0] & 0xC0) === 0x40) { const len = buf.readUInt16BE(2); need = 4 + len + ((4 - (len % 4)) % 4); }
                else if ((buf[0] & 0xC0) === 0) { if (buf.length < 20) break; need = 20 + buf.readUInt16BE(2); }
                else { sock.destroy(); return; }
                if (buf.length < need) break;
                const frame = buf.subarray(0, need);
                buf = buf.subarray(need);
                this.handle(frame, T);
            }
        });
        sock.on('error', () => {});
        sock.on('close', () => {
            clearTimeout(idle);
            T.closed = true;
            const a = this.allocations.get(this.keyOf(T));
            if (a) this.destroy(a);
        });
    }

    // ---------------------------------------------------------- housekeeping

    destroy(a) {
        if (this.allocations.get(a.key) === a) this.allocations.delete(a.key);
        try { a.relay.close(); } catch (_) { /* already closed */ }
        this.portsInUse.delete(a.relayPort);
    }

    sweep() {
        const now = Date.now();
        for (const a of Array.from(this.allocations.values())) {
            if (a.expires < now) { this.destroy(a); continue; }
            for (const [ip, until] of a.permissions) if (until < now) a.permissions.delete(ip);
            for (const [n, ch] of a.channels) if (ch.expires < now) { a.channels.delete(n); a.peerChannels.delete(ch.peerKey); }
        }
        for (const [ip, r] of this.requestCounts) if (now - r.start > 5000) this.requestCounts.delete(ip);
    }

    snapshot() {
        return {
            port: this.port, tlsPort: this.tls ? this.tlsPort : null, publicIp: this.publicIp, allocations: this.allocations.size,
            relayPorts: `${this.relayMin}-${this.relayMax}`, ...this.stats
        };
    }
}

module.exports = { TurnServer, classifyIp, detectPublicIp };
