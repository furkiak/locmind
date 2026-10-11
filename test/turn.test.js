'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const net = require('net');
const crypto = require('crypto');
const S = require('../src/turn/stun');
const { TurnServer, classifyIp } = require('../src/turn/server');

const { METHOD, CLASS, ATTR } = S;
const base = 40000 + Math.floor(Math.random() * 20000);

async function startTurn(extra = {}) {
    const t = new TurnServer({ port: 0, host: '127.0.0.1', publicIp: '127.0.0.1', secret: 'test-secret', relayMin: base, relayMax: base + 50, ...extra });
    await t.start();
    return t;
}

/** A tiny TURN client speaking UDP or TCP. */
class Client {
    static async udp(port) {
        const c = new Client();
        c.sock = dgram.createSocket('udp4');
        await new Promise(r => c.sock.bind(0, '127.0.0.1', r));
        c.sock.on('message', b => c.onData(b));
        c.write = b => c.sock.send(b, port, '127.0.0.1');
        c.local = c.sock.address();
        return c;
    }

    static async tcp(port) {
        const c = new Client();
        c.sock = net.connect(port, '127.0.0.1');
        await new Promise(r => c.sock.once('connect', r));
        let buf = Buffer.alloc(0);
        c.sock.on('data', chunk => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 4) {
                let need;
                if ((buf[0] & 0xC0) === 0x40) { const l = buf.readUInt16BE(2); need = 4 + l + ((4 - l % 4) % 4); } else need = 20 + buf.readUInt16BE(2);
                if (buf.length < need) break;
                c.onData(buf.subarray(0, need));
                buf = buf.subarray(need);
            }
        });
        c.write = b => c.sock.write(b);
        c.local = { address: c.sock.localAddress, port: c.sock.localPort };
        return c;
    }

    constructor() { this.waiting = new Map(); this.inbox = []; this.listeners = []; }

    onData(b) {
        if (S.isChannelData(b)) { this.inbox.push({ channel: b.readUInt16BE(0), data: b.subarray(4, 4 + b.readUInt16BE(2)) }); this.listeners.forEach(f => f()); return; }
        const m = S.decode(b);
        if (!m) return;
        const key = m.tid.toString('hex');
        if (this.waiting.has(key)) { this.waiting.get(key)(m); this.waiting.delete(key); return; }
        this.inbox.push(m);
        this.listeners.forEach(f => f());
    }

    request(method, attrs = [], key = null) {
        const tid = crypto.randomBytes(12);
        const list = typeof attrs === 'function' ? attrs(tid) : attrs;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('no response')), 2000);
            this.waiting.set(tid.toString('hex'), m => { clearTimeout(timer); resolve(m); });
            this.write(S.encode({ method, cls: CLASS.REQUEST, tid, attrs: list }, { key }));
        });
    }

    /** Full long-term auth dance; returns { key, attrs(extra) } helpers. */
    async allocate(username, password, extra = []) {
        const first = await this.request(METHOD.ALLOCATE, [[ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0])]]);
        assert.equal(first.cls, CLASS.ERROR);
        const realm = S.attr(first, ATTR.REALM).toString(), nonce = S.attr(first, ATTR.NONCE);
        this.auth = { username, realm, nonce, key: S.longTermKey(username, realm, password) };
        const res = await this.request(METHOD.ALLOCATE, [[ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0])], ...extra, ...this.authAttrs()], this.auth.key);
        return res;
    }

    authAttrs() { return [[ATTR.USERNAME, Buffer.from(this.auth.username)], [ATTR.REALM, Buffer.from(this.auth.realm)], [ATTR.NONCE, this.auth.nonce]]; }

    next(pred = () => true, ms = 2000) {
        return new Promise((resolve, reject) => {
            const check = () => {
                const i = this.inbox.findIndex(pred);
                if (i >= 0) { const [m] = this.inbox.splice(i, 1); this.listeners = this.listeners.filter(f => f !== check); clearTimeout(timer); resolve(m); }
            };
            const timer = setTimeout(() => { this.listeners = this.listeners.filter(f => f !== check); reject(new Error('timeout')); }, ms);
            this.listeners.push(check);
            check();
        });
    }

    close() { if (this.sock.close) try { this.sock.close(); } catch (_) {} if (this.sock.destroy) this.sock.destroy(); }
}

const errCode = m => { const v = S.attr(m, ATTR.ERROR_CODE); return v ? v[2] * 100 + v[3] : 0; };

test('STUN codec: integrity, fingerprint, XOR addresses (IPv4 and IPv6)', () => {
    const tid = crypto.randomBytes(12);
    const key = S.longTermKey('user', 'realm', 'pass');
    const buf = S.encode({ method: METHOD.CHANNEL_BIND, cls: CLASS.REQUEST, tid, attrs: [
        [ATTR.CHANNEL_NUMBER, Buffer.from([0x40, 0x01, 0, 0])],
        [ATTR.XOR_PEER_ADDRESS, S.encodeXorAddress('203.0.113.9', 5000, tid)],
        [ATTR.XOR_MAPPED_ADDRESS, S.encodeXorAddress('2001:db8:1::ab9:c0a8:102', 12345, tid)],
        [ATTR.SOFTWARE, Buffer.from('odd-length')]
    ] }, { key });
    const m = S.decode(buf);
    assert.equal(m.method, METHOD.CHANNEL_BIND);
    assert.equal(m.cls, CLASS.REQUEST);
    assert.ok(S.checkIntegrity(m, key));
    assert.ok(!S.checkIntegrity(m, S.longTermKey('user', 'realm', 'wrong')));
    assert.ok(S.checkFingerprint(m));
    assert.deepEqual(S.decodeXorAddress(S.attr(m, ATTR.XOR_PEER_ADDRESS), tid), { family: 4, address: '203.0.113.9', port: 5000 });
    assert.equal(S.decodeXorAddress(S.attr(m, ATTR.XOR_MAPPED_ADDRESS), tid).address, '2001:db8:1::ab9:c0a8:102');
    const tampered = Buffer.from(buf); tampered[30] ^= 1;
    const t2 = S.decode(tampered);
    assert.ok(!t2 || !S.checkFingerprint(t2) || !S.checkIntegrity(t2, key));
    assert.equal(S.crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('codec never throws on garbage', () => {
    for (let i = 0; i < 5000; i++) {
        const b = crypto.randomBytes(Math.floor(Math.random() * 120));
        if (Math.random() < .5 && b.length >= 20) { b[0] &= 0x3f; b.writeUInt32BE(S.MAGIC, 4); b.writeUInt16BE(Math.floor(Math.random() * 30) * 4, 2); }
        const m = S.decode(b);
        if (m) { S.checkFingerprint(m); S.checkIntegrity(m, Buffer.alloc(16)); m.attrs.forEach(([, v]) => S.decodeXorAddress(v, m.tid)); }
    }
});

test('peer address classification', () => {
    assert.equal(classifyIp('127.0.0.1'), 'denied');
    assert.equal(classifyIp('169.254.1.1'), 'denied');
    assert.equal(classifyIp('224.0.0.1'), 'denied');
    assert.equal(classifyIp('10.1.2.3'), 'private');
    assert.equal(classifyIp('172.20.0.5'), 'private');
    assert.equal(classifyIp('192.168.1.10'), 'private');
    assert.equal(classifyIp('100.64.0.1'), 'private');
    assert.equal(classifyIp('8.8.8.8'), 'public');
    assert.equal(classifyIp('::1'), 'denied');
    assert.equal(classifyIp('fe80::1'), 'denied');
    assert.equal(classifyIp('fd00::1'), 'private');
    assert.equal(classifyIp('2001:4860:4860::8888'), 'public');
});

test('TURN over UDP: binding, auth, allocate, permissions, send/data, channels, refresh', async t => {
    const turn = await startTurn();
    const c = await Client.udp(turn.port);
    const peer = dgram.createSocket('udp4');
    await new Promise(r => peer.bind(0, '127.0.0.1', r));
    t.after(async () => { c.close(); peer.close(); await turn.close(); });

    const bind = await c.request(METHOD.BINDING);
    assert.equal(bind.cls, CLASS.SUCCESS);
    assert.deepEqual(S.decodeXorAddress(S.attr(bind, ATTR.XOR_MAPPED_ADDRESS), bind.tid), { family: 4, address: '127.0.0.1', port: c.local.port });

    const { username, credential } = turn.credentials('player1');
    const bad = await c.allocate(username, 'not-the-password');
    assert.equal(errCode(bad), 401);
    assert.equal(turn.allocations.size, 0);

    const ok = await c.allocate(username, credential);
    assert.equal(ok.cls, CLASS.SUCCESS, `error ${errCode(ok)}`);
    assert.ok(S.checkIntegrity(ok, c.auth.key), 'success responses are signed');
    const relayed = S.decodeXorAddress(S.attr(ok, ATTR.XOR_RELAYED_ADDRESS), ok.tid);
    assert.equal(relayed.address, '127.0.0.1');
    assert.ok(relayed.port >= base && relayed.port <= base + 50);
    assert.equal(S.attr(ok, ATTR.LIFETIME).readUInt32BE(0), 600);

    // a second allocation on the same 5-tuple is a mismatch
    const again = await c.request(METHOD.ALLOCATE, [[ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0])], ...c.authAttrs()], c.auth.key);
    assert.equal(errCode(again), 437);

    // permissions: private networks are refused, our own relay IP is allowed
    const denied = await c.request(METHOD.CREATE_PERMISSION, tid => [[ATTR.XOR_PEER_ADDRESS, S.encodeXorAddress('10.0.0.7', 9, tid)], ...c.authAttrs()], c.auth.key);
    assert.equal(errCode(denied), 403);
    const perm = await c.request(METHOD.CREATE_PERMISSION, tid => [[ATTR.XOR_PEER_ADDRESS, S.encodeXorAddress('127.0.0.1', peer.address().port, tid)], ...c.authAttrs()], c.auth.key);
    assert.equal(perm.cls, CLASS.SUCCESS);

    // client -> peer via Send indication
    const got = new Promise(r => peer.once('message', (b, rinfo) => r({ b, rinfo })));
    const tid = crypto.randomBytes(12);
    c.write(S.encode({ method: METHOD.SEND, cls: CLASS.INDICATION, tid, attrs: [[ATTR.XOR_PEER_ADDRESS, S.encodeXorAddress('127.0.0.1', peer.address().port, tid)], [ATTR.DATA, Buffer.from('hello peer')]] }));
    const arrived = await got;
    assert.equal(arrived.b.toString(), 'hello peer');
    assert.equal(arrived.rinfo.port, relayed.port, 'peer sees the relayed address');

    // peer -> client arrives as a Data indication
    peer.send(Buffer.from('hello client'), relayed.port, '127.0.0.1');
    const ind = await c.next(m => m.method === METHOD.DATA);
    assert.equal(S.attr(ind, ATTR.DATA).toString(), 'hello client');

    // channel binding: both directions use the compact ChannelData framing
    const cb = await c.request(METHOD.CHANNEL_BIND, tid => [[ATTR.CHANNEL_NUMBER, Buffer.from([0x40, 0x00, 0, 0])], [ATTR.XOR_PEER_ADDRESS, S.encodeXorAddress('127.0.0.1', peer.address().port, tid)], ...c.authAttrs()], c.auth.key);
    assert.equal(cb.cls, CLASS.SUCCESS);
    const got2 = new Promise(r => peer.once('message', b => r(b)));
    const cd = Buffer.alloc(4 + 5); cd.writeUInt16BE(0x4000, 0); cd.writeUInt16BE(5, 2); Buffer.from('chan!').copy(cd, 4);
    c.write(cd);
    assert.equal((await got2).toString(), 'chan!');
    peer.send(Buffer.from('back'), relayed.port, '127.0.0.1');
    const back = await c.next(m => m.channel === 0x4000);
    assert.equal(back.data.toString(), 'back');

    // binding a different channel to the same peer is rejected
    const clash = await c.request(METHOD.CHANNEL_BIND, tid => [[ATTR.CHANNEL_NUMBER, Buffer.from([0x40, 0x01, 0, 0])], [ATTR.XOR_PEER_ADDRESS, S.encodeXorAddress('127.0.0.1', peer.address().port, tid)], ...c.authAttrs()], c.auth.key);
    assert.equal(errCode(clash), 400);

    // traffic from a peer without permission is dropped
    const stranger = dgram.createSocket('udp4');
    await new Promise(r => stranger.bind(0, '127.0.0.2', r));
    const before = turn.stats.packetsDropped;
    stranger.send(Buffer.from('spam'), relayed.port, '127.0.0.1');
    await new Promise(r => setTimeout(r, 100));
    stranger.close();
    assert.equal(turn.stats.packetsDropped, before + 1);

    // refresh with lifetime 0 deletes the allocation
    const gone = await c.request(METHOD.REFRESH, [[ATTR.LIFETIME, S.u32(0)], ...c.authAttrs()], c.auth.key);
    assert.equal(gone.cls, CLASS.SUCCESS);
    assert.equal(turn.allocations.size, 0);
    assert.equal(turn.portsInUse.size, 0);
});

test('TURN over TCP and per-IP quota', async t => {
    const turn = await startTurn({ maxAllocationsPerIp: 2 });
    const clients = [];
    t.after(async () => { clients.forEach(c => c.close()); await turn.close(); });
    const { username, credential } = turn.credentials('p');

    const tcp = await Client.tcp(turn.port); clients.push(tcp);
    const ok = await tcp.allocate(username, credential);
    assert.equal(ok.cls, CLASS.SUCCESS, `error ${errCode(ok)}`);

    const u1 = await Client.udp(turn.port); clients.push(u1);
    assert.equal((await u1.allocate(username, credential)).cls, CLASS.SUCCESS);
    const u2 = await Client.udp(turn.port); clients.push(u2);
    assert.equal(errCode(await u2.allocate(username, credential)), 486, 'quota reached');

    tcp.close();
    await new Promise(r => setTimeout(r, 100));
    assert.equal(turn.allocations.size, 1, 'closing the TCP connection frees its allocation');
});

test('expired credentials are refused and garbage packets are ignored', async t => {
    const turn = await startTurn();
    const c = await Client.udp(turn.port);
    t.after(async () => { c.close(); await turn.close(); });
    const username = `${Math.floor(Date.now() / 1000) - 10}:old`;
    const res = await c.allocate(username, turn.passwordFor(username));
    assert.equal(errCode(res), 401);
    for (let i = 0; i < 300; i++) c.write(crypto.randomBytes(1 + Math.floor(Math.random() * 200)));
    await new Promise(r => setTimeout(r, 300)); // let the burst drain (UDP may drop on a full buffer)
    const bind = await c.request(METHOD.BINDING);
    assert.equal(bind.cls, CLASS.SUCCESS, 'still alive after garbage');
});
