#!/usr/bin/env node
// Load test without any dependency: simulated players walk, chat and ping a real server.
//
//   node scripts/bench.mjs                         # starts its own server and runs 50,100,200,400 players
//   node scripts/bench.mjs --stages 100,500 --duration 30
//   node scripts/bench.mjs --url http://10.0.0.5:3000   # measure a running server (needs /metrics access)
//   node scripts/bench.mjs --profile ./prof              # also write a V8 CPU profile of the server
//
// The server runs in its own process so its CPU numbers are not mixed with the bots'.
// Bots are spread over worker threads. Each bot behaves like a browser: it sends its position
// 20 times a second while walking, pauses now and then, chats rarely and pings every two seconds.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ bot worker
if (!isMainThread) {
    const { connect } = require(path.join(ROOT, 'src/net/client.js'));
    const W = require(path.join(ROOT, 'shared/world.js'));
    const { url } = workerData;
    const bots = [];
    let rtts = [], joins = [], recvMsgs = 0, recvBytes = 0, sentMsgs = 0, errors = 0;

    function startBot(index) {
        const bot = { x: 0, y: 0, tx: 0, ty: 0, pause: 0, joined: false };
        const t0 = performance.now();
        const c = connect(url, { headers: { Origin: url } });
        bot.c = c;
        c.onAny(() => { recvMsgs++; });
        const origReceive = c.receive.bind(c);
        c.receive = data => { recvBytes += data.length; origReceive(data); };
        c.on('connect_error', () => { errors++; });
        c.on('pong', t => { if (typeof t === 'number') rtts.push(performance.now() - t); });
        c.on('connect', () => {
            c.emit('join', { nickname: `bot${index}`, avatar: W.AVATARS[index % 4] }, res => {
                if (!res || !res.ok) { errors++; return; }
                joins.push(performance.now() - t0);
                const me = res.players.find(p => p.id === res.you);
                bot.x = me.x; bot.y = me.y;
                // a third of the players gather in the same busy area, the rest spread over the map
                bot.home = index % 3 === 0 ? { x: 900, y: 1500, r: 500 } : { x: 1650, y: 1450, r: 1400 };
                pickTarget(bot);
                bot.joined = true;
            });
        });
        bots.push(bot);
    }

    function pickTarget(bot) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * bot.home.r;
        bot.tx = Math.max(10, Math.min(W.C.WIDTH - 50, bot.home.x + Math.cos(a) * d));
        bot.ty = Math.max(10, Math.min(W.C.HEIGHT - 50, bot.home.y + Math.sin(a) * d));
    }

    // 20 Hz movement, like the browser client
    setInterval(() => {
        const now = performance.now();
        for (const bot of bots) {
            if (!bot.joined) continue;
            if (bot.pause > now) continue;
            const dx = bot.tx - bot.x, dy = bot.ty - bot.y, d = Math.hypot(dx, dy);
            if (d < 8) { bot.pause = now + 1000 + Math.random() * 4000; pickTarget(bot); continue; }
            const step = Math.min(d, 300 * 0.05);
            bot.x += dx / d * step; bot.y += dy / d * step;
            bot.c.emit('move', { x: bot.x, y: bot.y, dirX: dx / d, dirY: dy / d });
            sentMsgs++;
        }
    }, 50);

    // pings, chat and heartbeats
    setInterval(() => {
        for (const bot of bots) {
            if (!bot.joined) continue;
            bot.c.sendRaw(JSON.stringify(['ping', performance.now()]));
            sentMsgs++;
            if (Math.random() < 0.02) { bot.c.emit('chat', { text: 'hello from a bot' }); sentMsgs++; }
        }
    }, 2000);

    parentPort.on('message', msg => {
        if (msg.type === 'add') for (let i = 0; i < msg.count; i++) startBot(msg.start + i);
        if (msg.type === 'stats') {
            parentPort.postMessage({ type: 'stats', connected: bots.filter(b => b.joined).length, rtts, joins, recvMsgs, recvBytes, sentMsgs, errors });
            rtts = []; joins = []; recvMsgs = 0; recvBytes = 0; sentMsgs = 0;
        }
        if (msg.type === 'stop') { for (const b of bots) b.c.close(); setTimeout(() => process.exit(0), 200); }
    });
}

// ------------------------------------------------------------------ main
else {
    const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
        if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
        return acc;
    }, []));
    const stages = (args.stages || '50,100,200,400').split(',').map(Number).filter(n => n > 0);
    const duration = Number(args.duration || 20) * 1000;
    const workers = Number(args.workers || Math.max(1, Math.min(4, os.cpus().length - 1)));
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

    let url = args.url, child = null, tmp = null;
    if (!url) {
        const port = await freePort();
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'locmind-bench-'));
        const nodeArgs = args.profile ? ['--cpu-prof', `--cpu-prof-dir=${path.resolve(args.profile === 'true' ? 'bench-profile' : args.profile)}`] : [];
        child = spawn(process.execPath, [...nodeArgs, path.join(ROOT, 'server.js')], {
            env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TURN: 'false', LOG_LEVEL: 'warn', DATA_DIR: path.join(tmp, 'data'), MEDIA_DIR: path.join(tmp, 'media'),
                MAX_CONNECTIONS_PER_IP: '100000', MAX_PLAYERS: '100000', AFK_LIMIT_MINUTES: '600', METRICS: 'true', ADMIN_TOKEN: 'bench-admin-token' },
            stdio: ['ignore', 'inherit', 'inherit']
        });
        url = `http://127.0.0.1:${port}`;
        for (let i = 0; i < 50; i++) { try { if ((await fetch(url + '/healthz')).ok) break; } catch (_) { /* booting */ } await sleep(100); }
    }

    async function serverMetrics() {
        const res = await fetch(url + '/metrics', { headers: { Authorization: `Bearer ${args.token || 'bench-admin-token'}` } });
        if (!res.ok) throw new Error(`/metrics answered ${res.status}; run the bench on the server machine or pass --token`);
        const out = {};
        for (const line of (await res.text()).split('\n')) {
            const m = /^(\w+)(?:\{[^}]*\})? ([\d.eE+-]+)$/.exec(line);
            if (m) out[m[1]] = Number(m[2]);
        }
        return out;
    }

    const pool = Array.from({ length: workers }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { url } }));
    const collect = () => Promise.all(pool.map(w => new Promise(res => { w.once('message', res); w.postMessage({ type: 'stats' }); })));
    const pct = (arr, p) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };

    const rows = [];
    let total = 0;
    console.log(`Locmind load test · server ${url} · ${os.cpus().length} × ${os.cpus()[0].model.trim()} · Node ${process.version} · ${workers} bot workers\n`);
    for (const n of stages) {
        const add = n - total;
        for (let i = 0; i < add; i++) pool[i % workers].postMessage({ type: 'add', count: 1, start: total + i });
        total = n;
        // let everybody join and settle
        for (let i = 0; i < 60; i++) {
            await sleep(500);
            const st = await collect();
            if (st.reduce((s, x) => s + x.connected, 0) >= n) break;
        }
        await sleep(3000);
        await collect();                                    // discard warm-up numbers
        const m0 = await serverMetrics(), t0 = Date.now(), cpu0 = process.cpuUsage();
        let loopMax = 0, rssMax = 0;
        const stats = [];
        while (Date.now() - t0 < duration) {
            await sleep(Math.min(5000, duration));
            const m = await serverMetrics();
            loopMax = Math.max(loopMax, m.locmind_eventloop_lag_p99_seconds * 1000);
            rssMax = Math.max(rssMax, m.process_resident_memory_bytes);
            stats.push(...await collect());
        }
        const m1 = await serverMetrics(), secs = (Date.now() - t0) / 1000, cpu1 = process.cpuUsage(cpu0);
        const rtts = stats.flatMap(s => s.rtts), joins = stats.flatMap(s => s.joins);
        const row = {
            players: m1.locmind_players,
            cpu: (m1.process_cpu_seconds_total - m0.process_cpu_seconds_total) / secs * 100,
            rssMB: rssMax / 1048576,
            loopP99: loopMax,
            inMsgs: (m1.locmind_ws_messages_in_total - m0.locmind_ws_messages_in_total) / secs,
            outMsgs: (m1.locmind_ws_messages_out_total - m0.locmind_ws_messages_out_total) / secs,
            outKBs: (m1.locmind_ws_bytes_out_total - m0.locmind_ws_bytes_out_total) / secs / 1024,
            perClientKBs: (m1.locmind_ws_bytes_out_total - m0.locmind_ws_bytes_out_total) / secs / 1024 / Math.max(1, m1.locmind_players),
            rttP50: pct(rtts, 50), rttP99: pct(rtts, 99),
            errors: stats.reduce((s, x) => s + x.errors, 0),
            botCpu: (cpu1.user + cpu1.system) / 1e6 / secs * 100          // all bot threads together
        };
        rows.push(row);
        console.log(`  ${String(n).padStart(5)} players: cpu ${row.cpu.toFixed(1)}% · rss ${row.rssMB.toFixed(0)} MB · loop p99 ${row.loopP99.toFixed(1)} ms · in ${row.inMsgs.toFixed(0)} msg/s · out ${row.outKBs.toFixed(0)} KB/s (${row.perClientKBs.toFixed(1)} KB/s each) · rtt p50 ${row.rttP50.toFixed(1)} / p99 ${row.rttP99.toFixed(1)} ms · bots ${row.botCpu.toFixed(0)}% cpu`);
    }

    console.log('\n| Players | Server CPU (% of one core) | Memory (RSS) | Event loop p99 | Messages in / s | Traffic out | Per player | Ping p50 / p99 | Bot CPU |');
    console.log('|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of rows) {
        console.log(`| ${r.players} | ${r.cpu.toFixed(1)} % | ${r.rssMB.toFixed(0)} MB | ${r.loopP99.toFixed(1)} ms | ${Math.round(r.inMsgs).toLocaleString('en')} | ${(r.outKBs / 1024).toFixed(2)} MB/s | ${r.perClientKBs.toFixed(1)} KB/s | ${r.rttP50.toFixed(1)} / ${r.rttP99.toFixed(1)} ms | ${r.botCpu.toFixed(0)} % |`);
    }
    if (args.json) fs.writeFileSync(args.json, JSON.stringify({ stages: rows, cpus: os.cpus().length, node: process.version }, null, 2));

    for (const w of pool) w.postMessage({ type: 'stop' });
    await sleep(500);
    if (child) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(0);
}
