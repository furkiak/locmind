'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const crypto = require('crypto');
const { encodeFrame, OP, acceptKey, Receiver } = require('../src/net/frames');
const { bootApp, client, join, sleep } = require('./helpers');

/** Raw TCP WebSocket session so tests can send anything, including broken frames. */
function raw(ctx, { headers = {}, path = '/ws' } = {}) {
    return new Promise((resolve, reject) => {
        const port = new URL(ctx.url).port;
        const sock = net.connect(port, '127.0.0.1');
        const key = crypto.randomBytes(16).toString('base64');
        let buf = Buffer.alloc(0), upgraded = false;
        const frames = [];
        const rx = new Receiver({ expectMasked: false, maxPayload: 1 << 20, onFrame: (op, data) => frames.push({ op, data }) });
        sock.on('connect', () => {
            const h = { Host: `127.0.0.1:${port}`, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', ...headers };
            sock.write(`GET ${path} HTTP/1.1\r\n` + Object.entries(h).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}\r\n`).join('') + '\r\n');
        });
        sock.on('data', chunk => {
            if (upgraded) { try { rx.push(chunk); } catch (_) { /* server sent something odd */ } return; }
            buf = Buffer.concat([buf, chunk]);
            const end = buf.indexOf('\r\n\r\n');
            if (end < 0) return;
            const head = buf.subarray(0, end).toString();
            const status = Number(head.split(' ')[1]);
            if (status !== 101) { resolve({ status, head, sock }); return; }
            assert.ok(head.includes(acceptKey(key)));
            upgraded = true;
            const rest = buf.subarray(end + 4);
            if (rest.length) rx.push(rest);
            resolve({ status, sock, frames, send: b => sock.write(b), closed: new Promise(r => sock.on('close', r)) });
        });
        sock.on('error', reject);
    });
}

const closeCode = frames => { const f = frames.find(x => x.op === OP.CLOSE); return f && f.data.length >= 2 ? f.data.readUInt16BE(0) : null; };

test('handshake validation', async t => {
    const ctx = await bootApp({ MAX_CONNECTIONS_PER_IP: 2 });
    t.after(() => ctx.close());
    assert.equal((await raw(ctx, { path: '/nope' })).status, 404);
    assert.equal((await raw(ctx, { headers: { 'Sec-WebSocket-Version': '8' } })).status, 426);
    assert.equal((await raw(ctx, { headers: { 'Sec-WebSocket-Key': 'short' } })).status, 400);
    assert.equal((await raw(ctx, { headers: { Origin: 'https://evil.example' } })).status, 403, 'cross-site WebSocket hijacking is refused');
    const same = await raw(ctx, { headers: { Origin: ctx.url } });
    assert.equal(same.status, 101, 'same origin is fine');
    const second = await raw(ctx);
    assert.equal(second.status, 101);
    assert.equal((await raw(ctx)).status, 429, 'per-IP connection cap');
    same.sock.destroy(); second.sock.destroy();
});

test('protocol errors close the connection with the right code', async t => {
    const ctx = await bootApp();
    t.after(() => ctx.close());

    const a = await raw(ctx);
    a.send(encodeFrame(OP.TEXT, Buffer.from('["ping",1]'), false));    // clients must mask
    await a.closed;
    assert.equal(closeCode(a.frames), 1002);

    const b = await raw(ctx);
    b.send(encodeFrame(OP.TEXT, Buffer.alloc(70 * 1024, 0x61), true));
    await b.closed;
    assert.equal(closeCode(b.frames), 1009);

    const c = await raw(ctx);
    c.send(encodeFrame(OP.TEXT, Buffer.from([0xff, 0xfe, 0xfd]), true));
    await c.closed;
    assert.equal(closeCode(c.frames), 1007);

    const d = await raw(ctx);
    d.send(Buffer.from([0x8f, 0x80, 1, 2, 3, 4]));                     // unknown opcode
    await d.closed;
    assert.equal(closeCode(d.frames), 1002);
});

test('fragmentation, ping/pong and clean close', async t => {
    const ctx = await bootApp();
    t.after(() => ctx.close());
    const s = await raw(ctx);
    await sleep(50);
    // ["ping",42] split into three fragments with a control frame in between
    const msg = Buffer.from('["ping",42]');
    const f1 = encodeFrame(OP.TEXT, msg.subarray(0, 3), true); f1[0] &= 0x7f;
    const f2 = encodeFrame(OP.CONT, msg.subarray(3, 7), true); f2[0] &= 0x7f;
    const f3 = encodeFrame(OP.CONT, msg.subarray(7), true);
    s.send(Buffer.concat([f1, encodeFrame(OP.PING, Buffer.from('hi'), true), f2, f3]));
    await sleep(100);
    assert.ok(s.frames.some(f => f.op === OP.PONG && f.data.toString() === 'hi'), 'control frames may interleave');
    assert.ok(s.frames.some(f => f.op === OP.TEXT && f.data === '["pong",42]'), 'fragments are reassembled');
    // byte-by-byte delivery
    const one = encodeFrame(OP.TEXT, Buffer.from('["ping",7]'), true);
    for (const byte of one) { s.send(Buffer.from([byte])); }
    await sleep(100);
    assert.ok(s.frames.some(f => f.op === OP.TEXT && f.data === '["pong",7]'));
    s.send(encodeFrame(OP.CLOSE, Buffer.from([0x03, 0xe8]), true));
    await s.closed;
    assert.equal(closeCode(s.frames), 1000);
});

test('garbage never takes the server down', async t => {
    const ctx = await bootApp();
    t.after(() => ctx.close());
    const victim = await join(ctx, 'Victim');
    t.after(() => victim.close());
    for (let i = 0; i < 40; i++) {
        const s = await raw(ctx);
        for (let k = 0; k < 20; k++) s.send(crypto.randomBytes(1 + Math.floor(Math.random() * 300)));
        if (Math.random() < .5) s.send(encodeFrame(OP.TEXT, crypto.randomBytes(50), true));
        s.sock.destroy();
    }
    // valid frames carrying hostile JSON
    const evil = await client(ctx);
    for (const text of ['[]', '{}', 'null', '["__proto__",{}]', '["join",{"nickname":{"toString":1}}]', '["a".repeat(100)]', '[1,2,3]', '"x"']) evil.sendRaw(text);
    await sleep(100);
    const res = await victim.call('profile:set', {});
    assert.equal(res.ok, true, 'existing players are still served');
    const after = await join(ctx, 'After');
    assert.equal(after.me.ok, true, 'server still serves new players');
    after.close(); evil.close();
});

test('slow consumers are dropped instead of exhausting memory', async t => {
    const ctx = await bootApp();
    t.after(() => ctx.close());
    const s = await raw(ctx);
    await sleep(50);
    s.sock.pause();                                   // never read again
    const id = Array.from(ctx.hub.clients.keys()).pop();
    const big = 'x'.repeat(60000);
    for (let i = 0; i < 200 && ctx.hub.clients.has(id); i++) { ctx.hub.to(id).emit('spam', big); await sleep(1); }
    assert.ok(!ctx.hub.clients.has(id), 'client with a huge backlog was terminated');
    s.sock.destroy();
});

test('interoperates with an independent WebSocket implementation', { skip: typeof WebSocket === 'undefined' && 'no global WebSocket in this Node version' }, async t => {
    const ctx = await bootApp();
    t.after(() => ctx.close());
    const ws = new WebSocket(ctx.url.replace('http', 'ws') + '/ws');
    const msgs = [];
    ws.onmessage = e => msgs.push(JSON.parse(e.data));
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.send(JSON.stringify(['join', { nickname: 'Undici' }, 1]));
    await sleep(200);
    const hello = msgs.find(m => m[0] === 'hello');
    const ack = msgs.find(m => m[0] === 'ack' && m[1] === 1);
    assert.ok(hello && ack && ack[2].ok, JSON.stringify(msgs).slice(0, 200));
    const big = 'é'.repeat(20000);                     // multi-byte, > 64 KiB frame header path
    ws.send(JSON.stringify(['ping', 5, null, big]).slice(0, 60000));
    ws.close(1000);
    await new Promise(r => { ws.onclose = r; });
});
