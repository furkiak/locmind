// Browser end-to-end test: two real Chromium pages talk to a real server.
//   npm run test:e2e
// Needs a Chromium binary. Set CHROMIUM_PATH, or install one with `npx playwright install chromium`.
// Exits 0 (skipped) when no browser is available.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../../src/app');
const W = require('../../shared/world');

let chromium;
try { ({ chromium } = await import('playwright-core')); } catch (_) { /* optional dev dependency */ }

const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
let exe = candidates.find(p => fs.existsSync(p));
if (!exe && chromium) { try { const p = chromium.executablePath(); if (fs.existsSync(p)) exe = p; } catch (_) {} }
if (!chromium || !exe) {
    console.log('e2e: no Chromium found (set CHROMIUM_PATH) - skipped');
    process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const os = require('os');
const relayBase = 53000 + Math.floor(Math.random() * 5000);
const tmp = fs.mkdtempSync(os.tmpdir() + '/locmind-e2e-');
fs.mkdirSync(tmp + '/media/music', { recursive: true });
// a two second 440 Hz tone so the self-hosted library has something real to play
function toneWav(seconds = 2, rate = 8000) {
    const n = seconds * rate, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), 44 + i * 2);
    return buf;
}
fs.writeFileSync(tmp + '/media/music/Test Tone.wav', toneWav());
const ctx = createApp({ LOG_LEVEL: 'silent', MAX_CONNECTIONS_PER_IP: 1000, DATA_DIR: tmp + '/data', MEDIA_DIR: tmp + '/media', ADMIN_TOKEN: 'e2e-admin-token', YOUTUBE: true, TURN: true, TURN_PORT: 0, TURN_PUBLIC_IP: '127.0.0.1', TURN_RELAY_MIN: relayBase, TURN_RELAY_MAX: relayBase + 40 });
await ctx.ready;
await new Promise(r => ctx.server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${ctx.server.address().port}/`;
const browser = await chromium.launch({
    executablePath: exe,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
});

const problems = [];
async function player(nick, { avatar = 'usr1.png', scheme = 'dark', width = 1280, height = 800, query = '' } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: 'en-US', permissions: ['microphone', 'camera'] });
    const page = await context.newPage();
    page.on('pageerror', e => problems.push(`[${nick}] pageerror: ${e.message}`));
    page.on('console', m => {
        const text = m.text();
        if (m.type() === 'error' && !/youtube|ytimg|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(text)) problems.push(`[${nick}] console.error: ${text}`);
    });
    await page.goto(URL + query);
    await page.fill('#nick', nick);
    await page.click(`#avatars [data-avatar="${avatar}"]`);
    await page.check('#tos', { force: true });
    await page.click('#join-btn');
    await page.waitForFunction(() => window.__locmind && window.__locmind.S.active && window.__locmind.S.myId, null, { timeout: 10000 });
    return page;
}
const walkTo = async (page, x, y) => {
    await page.evaluate(([x, y]) => { window.__locmind.input.target = { x: x - 20, y: y - 20 }; }, [x, y]);
    await page.waitForFunction(([x, y]) => { const { S } = window.__locmind; const p = S.players[S.myId]; return Math.hypot(p.x + 20 - x, p.y + 20 - y) < 14; }, [x, y], { timeout: 30000 });
};
const my = (page, fn) => page.evaluate(fn);

let step = 0;
async function check(name, fn) {
    step++;
    const t0 = Date.now();
    try { await fn(); console.log(`  ok ${step} - ${name} (${Date.now() - t0} ms)`); }
    catch (err) { console.error(`  FAIL ${step} - ${name}\n${err.stack || err}`); process.exitCode = 1; throw err; }
}

let a, b;
try {
    console.log('e2e: ' + exe);
    await check('login screen renders and two players can join', async () => {
        a = await player('Ada', { avatar: 'usr2.png' });
        b = await player('Bob', { avatar: 'usr3.png' });
        assert.equal(await my(a, () => document.getElementById('login').hidden), true);
        assert.equal(await my(a, () => Object.keys(window.__locmind.S.players).length), 2);
    });

    const slot = W.buildSlots()[0];
    await check('proximity voice: audio link, remote voice node and speaking indicator', async () => {
        await Promise.all([walkTo(a, 230, 230), walkTo(b, 180, 280)]);
        await a.waitForFunction(() => window.__locmind.linkedIds().size === 1, null, { timeout: 15000 });
        await b.waitForFunction(() => window.__locmind.linkedIds().size === 1, null, { timeout: 15000 });
        await a.waitForFunction(() => Object.keys(window.__locmind.S.players).some(id => window.__locmind.hasVoice(id)), null, { timeout: 10000 });
    });

    await check('building a locked room ejects bystanders and enters the owner', async () => {
        await a.keyboard.press('KeyE');
        await a.waitForSelector('#modal-create:not([hidden])');
        await a.fill('#room-name', 'Design Lab');
        await a.fill('#room-pass', 'secret');
        await a.click('#room-colors [data-color="purple"]');
        await a.click('#room-create-btn');
        await a.waitForFunction(id => window.__locmind.S.currentRoomId === id, slot.id);
        await b.waitForFunction(id => window.__locmind.S.rooms[id] && window.__locmind.S.rooms[id].hasPassword, slot.id);
        assert.equal(await my(b, () => window.__locmind.S.currentRoomId), null, 'Bob was pushed out');
    });

    await check('password gate: wrong password rejected, right password lets Bob in', async () => {
        const door = { x: W.doorStart(slot) + W.C.DOOR_SIZE / 2, y: slot.y + slot.h };
        await walkTo(b, door.x, door.y + 50);
        await b.evaluate(([x, y]) => { window.__locmind.input.target = { x: x - 20, y: y - 20 }; }, [door.x, slot.y + slot.h - 60]);
        await b.waitForSelector('#modal-password:not([hidden])', { timeout: 8000 });
        await b.fill('#enter-pass', 'nope');
        await b.click('#enter-pass-btn');
        await b.waitForSelector('#pass-error:not([hidden])');
        await b.fill('#enter-pass', 'secret');
        await b.click('#enter-pass-btn');
        await b.waitForFunction(() => document.getElementById('modal-password').hidden);
        await b.evaluate(([x, y]) => { window.__locmind.input.target = { x: x - 20, y: y - 20 }; }, [door.x, slot.y + slot.h - 80]);
        await b.waitForFunction(id => window.__locmind.S.currentRoomId === id, slot.id, { timeout: 10000 });
    });

    await check('chat bubble + log + reactions reach the other player (HTML stays text)', async () => {
        await a.keyboard.press('Enter');
        await a.keyboard.type('Hello <b>team</b> & co');
        await a.keyboard.press('Enter');
        await b.waitForFunction(() => window.__locmind.S.players && Object.values(window.__locmind.S.players).some(p => p.bubble && p.bubble.text === 'Hello <b>team</b> & co'));
        assert.equal(await my(b, () => document.querySelector('#chat-list li') && document.querySelector('#chat-list li').innerHTML.includes('<b>team</b>')), false, 'chat is rendered as text, never HTML');
        await a.keyboard.press('KeyQ');
        await a.click('#emoji-picker .grid button:nth-child(1)');
        await b.waitForFunction(() => Object.values(window.__locmind.S.players).some(p => p.emoji));
    });

    await check('shared whiteboard, notes and caret-safe sync', async () => {
        await a.keyboard.press('KeyG');
        const box = await a.locator('#wb-canvas').boundingBox();
        await a.mouse.move(box.x + 40, box.y + 40);
        await a.mouse.down();
        await a.mouse.move(box.x + 200, box.y + 140, { steps: 10 });
        await a.mouse.up();
        await b.keyboard.press('KeyG');
        await b.waitForFunction(() => { const c = document.getElementById('wb-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120) return true; return false; }, null, { timeout: 8000 });
        await a.keyboard.press('KeyH');
        await a.fill('#notes-text', 'Agenda\n1. Ship it');
        await b.keyboard.press('KeyH');
        await b.waitForFunction(() => document.getElementById('notes-text').value === 'Agenda\n1. Ship it', null, { timeout: 8000 });
        // Bob types in the middle while Ada edits the end: Bob's caret must not jump
        await b.focus('#notes-text');
        await b.evaluate(() => { const t = document.getElementById('notes-text'); t.setSelectionRange(3, 3); });
        await a.fill('#notes-text', 'Agenda\n1. Ship it now');
        await b.waitForFunction(() => document.getElementById('notes-text').value.endsWith('now'));
        assert.equal(await my(b, () => document.getElementById('notes-text').selectionStart), 3, 'caret stays where it was');
        await b.evaluate(() => document.getElementById('notes-text').blur());
    });

    await check('camera video and mute badge are visible to the other player', async () => {
        const idA = await my(a, () => window.__locmind.S.myId);
        await a.evaluate(() => window.__locmind.bus.emit('action', 'camera'));
        await b.waitForFunction(id => { const v = window.__locmind.S.videos[id]; return v && v.videoWidth > 0; }, idA, { timeout: 15000 });
        await a.evaluate(() => window.__locmind.bus.emit('action', 'mic'));
        await b.waitForFunction(id => window.__locmind.S.players[id].muted === true, idA);
        await a.evaluate(() => window.__locmind.bus.emit('action', 'camera'));
        await b.waitForFunction(id => !window.__locmind.S.videos[id], idA);
    });

    await check('screen sharing shows a window for the viewer', async () => {
        await a.evaluate(() => {
            navigator.mediaDevices.getDisplayMedia = async () => {
                const c = document.createElement('canvas'); c.width = 640; c.height = 360;
                const g = c.getContext('2d');
                setInterval(() => { g.fillStyle = '#0a84ff'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.fillText(String(Date.now()), 20, 40); }, 80);
                return c.captureStream(15);
            };
        });
        await a.evaluate(() => window.__locmind.bus.emit('action', 'share'));
        await b.waitForSelector('.screen-win video', { timeout: 15000 });
        await b.waitForFunction(() => document.querySelector('.screen-win video').videoWidth > 0, null, { timeout: 10000 });
        await a.evaluate(() => window.__locmind.bus.emit('action', 'share'));
        await b.waitForFunction(() => !document.querySelector('.screen-win'), null, { timeout: 8000 });
    });

    await check('network drop: the player resumes in the same room, still owner and unlocked', async () => {
        const before = await my(a, () => window.__locmind.S.myId);
        await a.evaluate(() => window.__locmind.S.socket.drop());
        await a.waitForFunction(old => window.__locmind.S.connected && window.__locmind.S.myId !== old && window.__locmind.S.currentRoomId, before, { timeout: 15000 });
        assert.equal(await my(a, () => { const S = window.__locmind.S; return S.rooms[S.currentRoomId].owner === S.myId; }), true);
        await a.waitForFunction(() => window.__locmind.linkedIds().size === 1, null, { timeout: 15000 });
    });

    await check('music: the self-hosted library plays for everybody, YouTube stays available', async () => {
        await a.evaluate(() => window.__locmind.bus.emit('action', 'music'));
        await a.waitForSelector('#library-list li .t');
        assert.match(await a.textContent('#library-list li .t'), /Test Tone/);
        await a.click('#library-list li');
        await b.waitForFunction(() => document.getElementById('music-title').textContent.includes('Test Tone'), null, { timeout: 8000 });
        await b.waitForFunction(() => document.getElementById('music-audio').src.includes('/media/music/'), null, { timeout: 8000 });
        await a.click('#music-tabs [data-tab="youtube"]');
        await a.fill('#music-input', 'https://youtu.be/dQw4w9WgXcQ');
        await a.keyboard.press('Enter');
        await b.waitForFunction(() => document.querySelectorAll('#music-queue li:not(.empty)').length >= 1 || document.getElementById('music-title').textContent.includes('dQw4w9WgXcQ'), null, { timeout: 8000 });
        await a.evaluate(() => window.__locmind.bus.emit('action', 'music'));
    });

    await check('profile: status and an emoji avatar show up for the other player', async () => {
        const idA = await my(a, () => window.__locmind.S.myId);
        await a.click('#statusbar');
        await a.waitForSelector('#profile-pop:not([hidden])');
        await a.click('#profile-pop .pp-status button:nth-child(2)');
        await b.waitForFunction(id => window.__locmind.S.players[id].status === 'busy', idA);
        await a.click('#profile-pop .avatar-custom');
        await a.click('#profile-pop .maker-faces button:nth-child(6)');
        await b.waitForFunction(id => window.__locmind.S.players[id].avatar.startsWith('e:🦊'), idA, { timeout: 6000 });
        await a.keyboard.press('Escape');
    });

    await check('player card: direct message and wave', async () => {
        const idB = await my(b, () => window.__locmind.S.myId);
        await a.evaluate(id => window.__locmind.bus.emit('player-click', id), idB);
        await a.waitForSelector('#player-card:not([hidden])');
        await a.click('#player-card .card-act:nth-child(2)');
        await b.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some(t => /waved|el salladı/.test(t.textContent)));
        await a.click('#player-card .card-act:nth-child(1)');
        await a.waitForSelector('#win-dm:not([hidden])');
        await a.fill('#dm-input', 'psst <i>hi</i>');
        await a.press('#dm-input', 'Enter');
        await b.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some(t => t.textContent.includes('psst <i>hi</i>')));
        await b.evaluate(() => window.__locmind.bus.emit('action', 'dm'));
        await b.waitForFunction(() => document.querySelector('#dm-list li') && document.querySelector('#dm-list li').textContent.includes('psst <i>hi</i>'));
        await a.evaluate(() => window.__locmind.bus.emit('action', 'dm'));
        await b.evaluate(() => window.__locmind.bus.emit('action', 'dm'));
    });

    await check('room tools: raise hand, poll, timer and owner settings', async () => {
        await b.keyboard.press('KeyY');
        await a.waitForFunction(() => window.__locmind.S.room.hands.length === 1);
        await a.keyboard.press('KeyO');
        await a.waitForSelector('#win-room:not([hidden]) .rt-form');
        const forms = a.locator('#room-body .rt-form');
        await forms.nth(0).locator('input').first().fill('Ship on Friday?');
        await forms.nth(0).locator('button[type=submit]').click();
        await b.waitForFunction(() => window.__locmind.S.room.poll && window.__locmind.S.room.poll.question === 'Ship on Friday?');
        await b.keyboard.press('KeyO');
        await b.waitForSelector('#room-body .rt-opt');
        await b.click('#room-body .rt-opt');
        await a.waitForFunction(() => window.__locmind.S.room.poll.total === 1);
        await a.click('#room-body .rt-sec:nth-of-type(3) .rt-row .btn');   // 1 minute preset
        await b.waitForSelector('#timer-chip:not([hidden])');
        const topic = a.locator('#room-body input[maxlength="80"]');
        await topic.fill('Release planning');
        await a.locator('#room-body .rt-sec:last-child button[type=submit]').click();
        await b.waitForFunction(id => window.__locmind.S.rooms[id].topic === 'Release planning', slot.id);
        await a.keyboard.press('Escape');
        await a.evaluate(() => window.__locmind.bus.emit('action', 'roomtools'));
        await b.evaluate(() => window.__locmind.bus.emit('action', 'roomtools'));
    });

    await check('admin panel: dashboard, announcement and kicking a player', async () => {
        const z = await player('Zed', { avatar: 'usr4.png' });
        const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'en-US' });
        const admin = await context.newPage();
        admin.on('pageerror', e => problems.push(`[admin] pageerror: ${e.message}`));
        await admin.goto(URL + 'admin');
        await admin.fill('#tokenInput', 'e2e-admin-token');
        await admin.click('#loginForm button[type=submit]');
        await admin.waitForSelector('#app:not([hidden])');
        await admin.waitForFunction(() => document.getElementById('heroPlayers').textContent === '3');
        await admin.fill('#announceInput', 'Pizza in the lobby');
        await admin.click('#announceForm button');
        await a.waitForSelector('#announce:not([hidden])');
        assert.match(await a.textContent('#announce'), /Pizza in the lobby/);
        await admin.click('.nav button[data-view=players]');
        await admin.waitForSelector('#playersTable tbody tr');
        const row = admin.locator('#playersTable tbody tr', { hasText: 'Zed' });
        await row.locator('button', { hasText: 'Kick' }).click();
        await admin.fill('#sheetBody input', 'Take a break');
        await admin.click('#sheetOk');
        await z.waitForSelector('#kicked:not([hidden])');
        assert.match(await z.textContent('#kicked-text'), /Take a break/);
        await context.close();
        await z.context().close();
    });

    await check('path finding walks around walls into a room', async () => {
        await b.evaluate(() => window.__locmind.walkTo(1500, 2700));
        await b.waitForFunction(() => { const { S } = window.__locmind; const p = S.players[S.myId]; return Math.hypot(p.x - 1500, p.y - 2700) < 8; }, null, { timeout: 30000 });
        await b.evaluate(id => { const s = window.__locmind.S.slotsById[id]; window.__locmind.walkTo(s.x + s.w / 2 - 20, s.y + s.h / 2 - 20); }, slot.id);
        await b.waitForFunction(id => window.__locmind.S.currentRoomId === id, slot.id, { timeout: 30000 });
    });

    await check('built-in TURN: two forced-relay players talk through the relay', async () => {
        const r1 = await player('Relay1', { query: '?relay=1' });
        const r2 = await player('Relay2', { query: '?relay=1' });
        // down the free corridor on the left, then across empty plots (no walls on the way)
        await Promise.all([walkTo(r1, 60, 1020), walkTo(r2, 60, 1080)]);
        await Promise.all([walkTo(r1, 2000, 1020), walkTo(r2, 2060, 1080)]);
        await r1.waitForFunction(() => window.__locmind.linkedIds().size >= 1, null, { timeout: 20000 });
        const stats = await r1.waitForFunction(async () => {
            const rows = await window.__locmind.linkStats();
            const a = rows.find(r => r.channel === 'audio' && r.state === 'connected');
            return a && a.local ? a : null;
        }, null, { timeout: 20000, polling: 500 });
        const row = await stats.jsonValue();
        assert.equal(row.local, 'relay', JSON.stringify(row));
        assert.ok(ctx.turn.stats.packetsRelayed > 0, 'audio packets went through our relay');
        await r1.context().close(); await r2.context().close();
    });

    await check('mobile layout: joystick visible, dock fits, no horizontal overflow', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'tr-TR' });
        const m = await context.newPage();
        await m.goto(URL);
        await m.fill('#nick', 'Zeynep');
        await m.check('#tos', { force: true });
        await m.tap('#join-btn');
        await m.waitForFunction(() => window.__locmind && window.__locmind.S.active, null, { timeout: 10000 });
        assert.equal(await my(m, () => getComputedStyle(document.getElementById('joystick')).display), 'block');
        assert.equal(await my(m, () => document.documentElement.scrollWidth <= window.innerWidth), true);
        assert.match(await my(m, () => document.getElementById('zone-text').textContent), /Herkese açık/);
        await context.close();
    });
} catch (_) {
    process.exitCode = 1;
}

if (problems.length) { console.error('Browser problems:\n' + problems.join('\n')); process.exitCode = 1; }
await browser.close();
await ctx.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(process.exitCode ? 'e2e: FAILED' : 'e2e: all passed');
process.exit(process.exitCode || 0);
