'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect } = require('../src/net/client');
const { createApp } = require('../src/app');
const W = require('../shared/world');

const made = [];
/** A throw-away directory, removed when the test process exits. */
function tmpDir(prefix = 'locmind-test-') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(dir);
    return dir;
}
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* ignore */ } } });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ports that fetch() refuses to connect to (the Fetch standard's "bad ports"). On machines whose dynamic port range starts
// low (Windows with Docker or Hyper-V uses 1024+), listen(0) can hand one of them out and the HTTP tests then fail.
const BAD_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103,
    104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
    531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060,
    5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

async function listenOnUsablePort(server) {
    for (;;) {
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        if (!BAD_PORTS.has(server.address().port)) return;
        await new Promise(r => server.close(r));
    }
}

async function bootApp(extra = {}) {
    const fakeFetch = async url => ({ ok: true, json: async () => ({ title: `Title of ${String(url).slice(-11)}` }) });
    const dir = tmpDir();
    const ctx = createApp({
        fetchImpl: fakeFetch, LOG_LEVEL: 'silent', MAX_CONNECTIONS_PER_IP: 1000, TURN: false,
        // the optional YouTube integration is exercised with a fake fetch; it is off by default in production
        YOUTUBE: true, INVIDIOUS_INSTANCES: ['https://invidious.example'],
        DATA_DIR: path.join(dir, 'data'), MEDIA_DIR: path.join(dir, 'media'), ...extra
    });
    await ctx.ready;
    await listenOnUsablePort(ctx.server);
    ctx.url = `${ctx.secure ? 'https' : 'http'}://127.0.0.1:${ctx.server.address().port}`;
    ctx.dir = dir;
    return ctx;
}

function client(ctx, opts = {}) {
    const s = connect(ctx.url, opts);
    s.events = [];
    s.onAny((name, ...args) => s.events.push([name, ...args]));
    s.waitFor = (name, pred = () => true, timeout = 2000) => new Promise((resolve, reject) => {
        const hit = s.events.find(e => e[0] === name && pred(...e.slice(1)));
        if (hit) return resolve(hit.slice(1));
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${name}`)), timeout);
        const handler = (...args) => { if (pred(...args)) { clearTimeout(timer); s.off(name, handler); resolve(args); } };
        s.on(name, handler);
    });
    s.call = (event, payload) => new Promise(resolve => s.emit(event, payload, resolve));
    return new Promise((resolve, reject) => { s.on('connect', () => resolve(s)); s.on('connect_error', reject); });
}

async function join(ctx, nickname, extra = {}) {
    const s = await client(ctx);
    s.me = await s.call('join', { nickname, avatar: 'usr1.png', ...extra });
    return s;
}

/** Walks the server-side player to a point in small legal steps (like a real client). */
async function walkTo(ctx, sock, tx, ty) {
    const p = ctx.world.players.get(sock.id);
    while (Math.hypot(tx - p.x, ty - p.y) > 1) {
        const d = Math.hypot(tx - p.x, ty - p.y), step = Math.min(10, d);
        const nx = p.x + (tx - p.x) / d * step, ny = p.y + (ty - p.y) / d * step;
        const before = { x: p.x, y: p.y };
        sock.emit('move', { x: nx, y: ny, dirX: 1, dirY: 0 });
        await sleep(25);
        if (p.x === before.x && p.y === before.y) throw new Error(`blocked at ${p.x},${p.y} -> ${tx},${ty}`);
    }
}

/** Puts a player straight into a slot (test shortcut, bypasses movement validation). */
function teleport(ctx, sock, x, y) {
    const p = ctx.world.players.get(sock.id);
    p.x = x; p.y = y;
}

const slotCenter = slot => ({ x: slot.x + slot.w / 2 - W.C.PLAYER_SIZE / 2, y: slot.y + slot.h / 2 - W.C.PLAYER_SIZE / 2 });

/** Walks a player into the middle of a plot via its left side (plots without walls). */
async function enterPlot(ctx, sock, slot) {
    teleport(ctx, sock, slot.x - 80, slot.y + 100);
    const c = slotCenter(slot);
    await walkTo(ctx, sock, c.x, c.y);
}

module.exports = { tmpDir, sleep, bootApp, client, join, walkTo, teleport, slotCenter, enterPlot };
