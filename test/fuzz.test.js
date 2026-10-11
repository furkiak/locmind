'use strict';
// Hostile input: every realtime event gets malformed, oversized and prototype-polluting payloads,
// and the HTTP side gets traversal tricks and broken encodings. The server must answer gracefully,
// never throw inside a handler, never pollute prototypes and keep serving honest players.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { bootApp, client, join, sleep, tmpDir } = require('./helpers');

const EVENTS = ['join', 'heartbeat', 'move', 'status', 'profile:set', 'chat', 'dm', 'wave', 'emoji', 'typing',
    'room:create', 'room:password', 'room:settings', 'room:kick', 'hand', 'poll:create', 'poll:vote', 'poll:close',
    'timer:start', 'timer:stop', 'wb:draw', 'wb:clear', 'note:set', 'music:add', 'music:skip', 'music:ended',
    'music:remove', 'kick', 'score:reset', 'rtc:signal', 'ping', 'unknown:event'];

function deepArray(depth) { let v = []; for (let i = 0; i < depth; i++) v = [v]; return v; }

const PAYLOADS = [
    null, true, false, 0, -1, 1e308, -1e308, '', 'x'.repeat(20000), '\u0000‮​', [], [null], {},
    deepArray(2000),
    JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}'),
    { to: '__proto__', target: 'constructor', slotId: '__proto__', pollId: 'toString', songId: 'hasOwnProperty', itemId: 'valueOf' },
    { x: 'Infinity', y: -Infinity, dirX: NaN, dirY: '1e9' },
    { x: 1e15, y: -1e15, dirX: 1, dirY: 0 },
    { text: { toString: 'boom' }, nickname: ['a'], avatar: '../../etc/passwd', status: 'admin', statusText: 7 },
    { question: 'q'.repeat(5000), options: new Array(5000).fill('o'), seconds: 1e12, label: {} },
    { options: [{}, [], null, 'ok', 'fine'] },
    { slotId: 'slot_1', name: '<img src=x onerror=alert(1)>', password: { length: 1 }, color: '__proto__', topic: ['x'] },
    { points: deepArray(500), color: '#fff', size: 1e9 },
    { batch: new Array(3000).fill([1, 2, 3, 4]) },
    { text: 'x'.repeat(60000) },
    { videoId: '"><script>', input: 'javascript:alert(1)', trackId: '../../../../etc/passwd' },
    { channel: 'audio', type: 'offer', data: { sdp: 'x'.repeat(30000) }, to: 'nobody', lid: {} },
    { option: -1 }, { option: 1.5 }, { option: '0' }, { up: 'yes', target: 1 }
];

test('fuzz: hostile realtime payloads never break a handler', async t => {
    const errors = [];
    const logger = { debug() {}, info() {}, warn() {}, error: (msg, err) => errors.push(`${msg}: ${err && (err.err || err.message || err)}`) };
    const ctx = await bootApp({ logger });
    t.after(() => ctx.close());

    let s = await join(ctx, 'Fuzzer');
    let sent = 0;
    for (const event of EVENTS) {
        for (const payload of PAYLOADS) {
            if (!s.connected) s = await join(ctx, 'Fuzzer');   // flood / protocol guards may close us: that is fine
            const withAck = sent % 2 === 0;
            s.emit(event, payload, withAck ? () => {} : undefined);
            if (++sent % 40 === 0) await sleep(110);              // stay below the flood guard
        }
    }
    // raw garbage frames, too
    for (const raw of ['', 'null', '{}', '[1,2,3]', '["__proto__",{}]', '[' .repeat(5000), '["chat"', 'x'.repeat(1000)]) s.sendRaw(raw);
    await sleep(400);

    assert.deepEqual(errors, [], 'no handler threw');
    assert.equal({}.polluted, undefined, 'Object.prototype is untouched');
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);

    // the server is still healthy for an honest player
    const honest = await join(ctx, 'Honest');
    t.after(() => honest.close());
    assert.ok(honest.me.ok);
    honest.emit('chat', { text: 'still here' });
    await honest.waitFor('chat', m => m.text === 'still here');
    const res = await fetch(ctx.url + '/healthz');
    assert.equal(res.status, 200);
});

function rawGet(ctx, rawPath, headers = {}) {
    const { port } = new URL(ctx.url);
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET', headers }, res => {
            let body = ''; res.on('data', d => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

test('fuzz: path traversal and broken encodings never leave the public folder', async t => {
    const ctx = await bootApp();
    t.after(() => ctx.close());
    const probes = [
        '/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/js/..%2f..%2fserver.js', '/%2e%2e%5cserver.js',
        '/shared/../../server.js', '/shared/..%2f..%2fsrc/app.js', '/%00', '/js/main.js%00.png', '/%E0%A4%A', '/\u0000',
        '/media/music/..%2f..%2fdata%2fsecrets.json', '/media/music/%2e%2e', '/api/../data/secrets.json', '//etc/passwd', '/admin/../../server.js'
    ];
    for (const p of probes) {
        const r = await rawGet(ctx, p).catch(() => ({ status: 400, body: '' }));
        assert.ok(r.status === 400 || r.status === 404 || r.status === 301 || (r.status === 200 && !/require\(|"dependencies"|turnSecret|adminToken/.test(r.body)), `${p} -> ${r.status}`);
        assert.ok(!/turnSecret|adminToken/.test(r.body), `${p} leaked secrets`);
    }
    // absurd headers and methods
    const big = await rawGet(ctx, '/healthz', { 'X-Junk': 'y'.repeat(16000) }).catch(() => ({ status: 431 }));
    assert.ok([200, 431, 400].includes(big.status));
    const res = await fetch(ctx.url + '/healthz', { method: 'DELETE' });
    assert.ok([404, 405].includes(res.status));
});

test('fuzz: uploads are checked by content, quota and size even without a content length', async t => {
    const media = tmpDir();
    const ctx = await bootApp({ MEDIA_DIR: media, UPLOAD_QUOTA_BYTES: 4096, UPLOAD_MAX_BYTES: 64 * 1024 });
    const s = await join(ctx, 'Uploader');
    t.after(async () => { s.close(); await ctx.close(); });
    const token = s.me.token;
    const post = (body, headers = {}) => fetch(ctx.url + '/api/music/upload', { method: 'POST', body, headers: { 'X-Locmind-Token': token, ...headers }, duplex: 'half' });
    // not audio
    assert.equal((await post(Buffer.from('<?php echo 1; ?>'), { 'X-Title': 'x' })).status, 415);
    // streamed body (no content length) bigger than the quota
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000)]))); c.close(); } });
    const r = await post(stream, { 'X-Title': 'big' });
    assert.ok([413, 507].includes(r.status), `streamed upload -> ${r.status}`);
    assert.ok(ctx.library.uploadedBytes() <= 4096);
    // no token, no upload
    assert.equal((await fetch(ctx.url + '/api/music/upload', { method: 'POST', body: 'ID3' })).status, 401);
    assert.ok(path.isAbsolute(media));
});
