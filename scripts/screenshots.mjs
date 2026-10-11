// Regenerates the README screenshots in docs/ with a real browser.
//   npm run screenshots            (set CHROMIUM_PATH if Chromium is not found automatically)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/app');
const W = require('../shared/world');
const { chromium } = await import('playwright-core');

const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].filter(Boolean);
let exe = candidates.find(p => fs.existsSync(p));
if (!exe) { try { const p = chromium.executablePath(); if (fs.existsSync(p)) exe = p; } catch (_) { /* none */ } }
if (!exe) { console.error('Set CHROMIUM_PATH to a Chromium/Chrome binary.'); process.exit(1); }

const OUT = new URL('../docs/', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- server
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'locmind-shots-'));
fs.mkdirSync(path.join(tmp, 'media', 'music'), { recursive: true });
function toneWav(seconds = 90, rate = 8000, freq = 330) {
    const n = seconds * rate, buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 1500), 44 + i * 2);
    return buf;
}
['Lo-fi Morning', 'Deep Focus', 'Sunset Drive', 'Night Shift'].forEach((t, i) => fs.writeFileSync(path.join(tmp, 'media', 'music', `${t}.wav`), toneWav(90, 8000, 220 + i * 60)));

const app = createApp({ LOG_LEVEL: 'silent', MAX_CONNECTIONS_PER_IP: 1000, TURN: false, DATA_DIR: path.join(tmp, 'data'), MEDIA_DIR: path.join(tmp, 'media'), ADMIN_TOKEN: 'screenshot-admin-token', SERVER_NAME: 'Locmind Lab' });
app.settings.set({ motd: 'Welcome to the lab! Town hall every Friday at 16:00 in the Auditorium.' });
app.game.admin.createPermanentRoom({ slotId: 'slot_8', name: 'Library', color: 'teal', topic: 'Quiet zone · deep work' });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${app.server.address().port}/`;
const sampler = setInterval(() => app.metrics.sample(), 1500);

// One browser per player: background windows of a shared browser get throttled.
const browsers = [];
async function open({ scheme = 'dark', width = 1440, height = 900, mobile = false, lang = 'en-US', scale = 1 } = {}) {
    const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
    browsers.push(browser);
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: lang, deviceScaleFactor: mobile ? 2 : scale, isMobile: mobile, hasTouch: mobile, permissions: ['microphone', 'camera'] });
    await ctx.addInitScript(t => { try { localStorage.setItem('locmind.settings', JSON.stringify({ theme: t })); } catch (_) {} }, scheme);
    return ctx.newPage();
}
async function login(page, nick, avatar) {
    await page.goto(BASE);
    await page.fill('#nick', nick);
    if (avatar.startsWith('e:')) {
        const [, face, color] = avatar.split(':');
        await page.click('#avatars .avatar-custom');
        await page.click(`#avatars .maker-faces button:nth-child(${W.AVATAR_EMOJIS.indexOf(face) + 1})`);
        await page.click(`#avatars .maker-colors [aria-label="${color}"]`);
    } else await page.click(`#avatars [data-avatar="${avatar}"]`);
    await page.check('#tos', { force: true });
}
async function player(nick, avatar, opts) {
    const page = await open(opts);
    await login(page, nick, avatar);
    await page.click('#join-btn');
    await page.waitForFunction(() => window.__locmind && window.__locmind.S.active, null, { timeout: 15000 });
    return page;
}
async function go(page, x, y) {
    const ok = await page.evaluate(([x, y]) => window.__locmind.walkTo(x - 20, y - 20), [x, y]);
    try {
        await page.waitForFunction(([x, y]) => { const { S } = window.__locmind; const p = S.players[S.myId]; return Math.hypot(p.x + 20 - x, p.y + 20 - y) < 10; }, [x, y], { timeout: 60000 });
    } catch (err) {
        console.error('walk failed', ok, x, y, await page.evaluate(() => { const { S, input } = window.__locmind; const p = S.players[S.myId]; return { name: p.nickname, x: p.x, y: p.y, t: input.target, path: input.path, modal: S.modalOpen, ae: document.activeElement.id || document.activeElement.tagName }; }));
        throw err;
    }
}
const shot = (page, name, opts = {}) => page.screenshot({ path: OUT + name, type: 'jpeg', quality: 88, ...opts });
const action = (page, a) => page.evaluate(x => window.__locmind.bus.emit('action', x), a);
const say = async (page, text) => { await page.keyboard.press('Enter'); await page.keyboard.type(text); await page.keyboard.press('Enter'); await sleep(200); };

async function doodle(page) {
    const box = await page.locator('#wb-canvas').boundingBox();
    const stroke = async (pts, color) => {
        if (color) await page.click(`#wb-colors .swatch-btn:nth-child(${color})`);
        await page.mouse.move(box.x + pts[0][0] * box.width, box.y + pts[0][1] * box.height);
        await page.mouse.down();
        for (const [x, y] of pts.slice(1)) await page.mouse.move(box.x + x * box.width, box.y + y * box.height, { steps: 3 });
        await page.mouse.up();
    };
    const circle = (cx, cy, rx, ry, n = 36) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(i / n * Math.PI * 2) * rx, cy + Math.sin(i / n * Math.PI * 2) * ry]);
    await stroke([[.08, .62], [.2, .3], [.32, .55], [.45, .25], [.58, .5]], 5);
    await stroke(circle(.76, .32, .11, .17), 2);
    await stroke([[.12, .86], [.4, .86], [.4, .74], [.12, .74], [.12, .86]], 4);
    await stroke([[.52, .82], [.66, .72], [.82, .84], [.9, .7]], 6);
}

// ------------------------------------------------------------------ sign in
{
    const p = await open();
    await login(p, 'Ada', 'e:🦊:orange');
    await sleep(900);
    await shot(p, 'login-dark.jpg');
    await p.context().browser().close();
}

// --------------------------------------------- a room with tools (dark)
const slot = W.buildSlots()[5];
const center = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
const ada = await player('Ada', 'e:🦊:orange');
const bob = await player('Bob', 'usr3.png');
const cem = await player('Cem', 'e:🤖:teal');
const dila = await player('Dila', 'usr2.png');
await go(ada, center.x, center.y);
await ada.keyboard.press('KeyE');
await ada.fill('#room-name', 'Design Lab');
await ada.click('#room-colors [data-color="purple"]');
await ada.click('#room-create-btn');
await ada.waitForFunction(id => window.__locmind.S.currentRoomId === id, slot.id);
await Promise.all([go(bob, center.x - 70, center.y + 40), go(cem, center.x + 60, center.y + 50), go(dila, center.x - 10, center.y - 70)]);
await cem.click('#statusbar'); await cem.click('#profile-pop .pp-status button:nth-child(2)');
await cem.fill('#profile-pop input.input', 'Shipping v3 🚀'); await cem.press('#profile-pop input.input', 'Enter'); await cem.keyboard.press('Escape');
await say(ada, 'Welcome to the lab! 👋');
await say(bob, 'Sketching the new layout');
await say(dila, '@Ada love the purple one');
await bob.keyboard.press('KeyY');
await ada.keyboard.press('KeyG'); await sleep(400);
await doodle(ada);
await ada.keyboard.press('KeyT');
await ada.keyboard.press('KeyH');
await ada.fill('#notes-text', 'Sprint 12\n• Ship the new UI\n• Write the docs\n• Celebrate 🎉');
await ada.keyboard.press('Escape');
await ada.evaluate(() => {
    const b = document.getElementById('win-board'); Object.assign(b.style, { top: '70px', right: '20px', left: 'auto', width: '560px', height: '400px' });
    const n = document.getElementById('win-notes'); Object.assign(n.style, { top: '486px', right: '250px', left: 'auto', width: '360px', height: '240px' });
});
await ada.evaluate(() => window.__locmind.S.socket.emit('timer:start', { seconds: 25 * 60, label: 'Focus sprint' }));
await sleep(1500);
await shot(ada, 'world-dark.jpg');

// room tools: poll, hands, timer and a player card
await ada.evaluate(() => ['win-board', 'win-notes'].forEach(id => { document.getElementById(id).hidden = true; }));
await ada.keyboard.press('KeyT');
await ada.keyboard.press('KeyO');
await ada.waitForSelector('#room-body .rt-form');
const forms = ada.locator('#room-body .rt-form');
await forms.nth(0).locator('input').first().fill('Which logo should we ship?');
await forms.nth(0).locator('.rt-opts input').nth(0).fill('Blue gradient');
await forms.nth(0).locator('.rt-opts input').nth(1).fill('Purple glass');
await forms.nth(0).locator('button[type=submit]').click();
await bob.waitForFunction(() => window.__locmind.S.room.poll);
for (const [p, i] of [[bob, 1], [cem, 1], [dila, 0]]) await p.evaluate(o => window.__locmind.S.socket.emit('poll:vote', { pollId: window.__locmind.S.room.poll.id, option: o }), i);
const bobId = await bob.evaluate(() => window.__locmind.S.myId);
await ada.evaluate(id => window.__locmind.bus.emit('player-click', id), bobId);
await sleep(900);
await shot(ada, 'room-tools.jpg');
await ada.keyboard.press('Escape');
await ada.keyboard.press('KeyO');

// ------------------------------------------------------------ auditorium
const A = W.AUDITORIUM;
for (const p of [ada, bob, cem, dila]) await p.evaluate(() => { const ae = document.activeElement; if (ae && ae.blur) ae.blur(); });
await Promise.all([
    go(cem, A.stage.x + A.stage.w / 2, A.stage.y + 80),
    go(ada, A.x + 560, A.y + 470), go(bob, A.x + 640, A.y + 470), go(dila, A.x + 600, A.y + 560)
]);
await cem.evaluate(() => window.__locmind.S.socket.emit('emoji', { emoji: '👏' }));
app.game.admin.announce('Town hall starts now — grab a seat in the Auditorium!');
await ada.evaluate(() => { window.__locmind.S.zoom = .82; });
await sleep(1600);
await shot(ada, 'auditorium.jpg');

// --------------------------------------------------------------- stadium
await Promise.all([go(ada, 2230, 520), go(bob, 2130, 650), go(cem, 2420, 440)]);
await ada.evaluate(() => { window.__locmind.S.zoom = 1; document.getElementById('announce').hidden = true; });
app.world.football.score = { blue: 2, red: 1 };
app.hub.emit('score', app.world.football.score);
await sleep(400);
await ada.keyboard.press('Space');
await sleep(700);
await shot(ada, 'stadium.jpg');
for (const p of [ada, bob, cem, dila]) await p.context().browser().close();

// ------------------------------------------------------------ light mode
{
    const a = await player('Ada', 'e:🦊:orange', { scheme: 'light' });
    const b = await player('Bob', 'usr3.png', { scheme: 'light' });
    await go(a, 560, 560); await go(b, 640, 640);
    await a.keyboard.press('KeyE');
    await a.fill('#room-name', 'Coffee Corner');
    await a.click('#room-colors [data-color="orange"]');
    await a.click('#room-create-btn');
    await a.waitForFunction(() => window.__locmind.S.currentRoomId);
    await say(b, 'Anyone up for a coffee? ☕');
    const aId = await a.evaluate(() => window.__locmind.S.myId);
    await b.evaluate(id => window.__locmind.S.socket.emit('dm', { to: id, text: 'Got a minute after the stand-up?' }), aId);
    await sleep(300);
    await a.evaluate(() => window.__locmind.bus.emit('action', 'dm'));
    await a.fill('#dm-input', 'Sure, see you in the Coffee Corner!');
    await a.press('#dm-input', 'Enter');
    await a.keyboard.press('Escape');
    await a.keyboard.press('KeyR');
    await a.evaluate(() => { const w = document.getElementById('win-dm'); Object.assign(w.style, { top: '290px', bottom: 'auto', left: '24px', right: 'auto', height: '400px' }); });
    await sleep(900);
    await shot(a, 'world-light.jpg');
    await a.context().browser().close(); await b.context().browser().close();
}

// ---------------------------------------------------------------- mobile
{
    const m = await player('Zeynep', 'usr2.png', { width: 390, height: 844, mobile: true, lang: 'tr-TR' });
    await go(m, 230, 230);
    await m.evaluate(() => window.__locmind.bus.emit('action', 'interact'));
    await m.fill('#room-name', 'Stüdyo');
    await m.click('#room-colors [data-color="teal"]');
    await m.tap('#room-create-btn');
    await sleep(4600);
    await shot(m, 'mobile.jpg');
    await m.context().browser().close();
}

// ----------------------------------------------------------- admin panel
{
    // a few more people so the dashboard has something to show
    const crowd = [];
    for (const [n, av] of [['Mert', 'usr1.png'], ['Selin', 'e:🐼:pink'], ['Linus', 'usr4.png']]) crowd.push(await player(n, av));
    await sleep(3200);
    const p = await open({ height: 1000 });
    await p.goto(BASE + 'admin');
    await p.fill('#tokenInput', 'screenshot-admin-token');
    await p.click('#loginForm button[type=submit]');
    await p.waitForSelector('#app:not([hidden])');
    await sleep(1200);
    await p.hover('#chartNetwork .chart-plot', { position: { x: 260, y: 70 } });
    await shot(p, 'admin.jpg');
    await p.click('.nav button[data-view=players]');
    await sleep(700);
    await shot(p, 'admin-players.jpg', { clip: { x: 0, y: 0, width: 1440, height: 640 } });
    await p.context().browser().close();
    for (const c of crowd) await c.context().browser().close();
}

// ----------------------------------------------------------------- hero
{
    const p = await open({ width: 1600, height: 880, scale: 1 });
    const img = f => `data:image/jpeg;base64,${fs.readFileSync(OUT + f).toString('base64')}`;
    await p.setContent(`<!doctype html><html><body style="margin:0;width:1600px;height:880px;overflow:hidden;background:radial-gradient(90% 80% at 20% 0%,#2a3f8f 0%,transparent 60%),radial-gradient(70% 70% at 100% 100%,#5b2a86 0%,transparent 60%),#0b1020;font-family:sans-serif">
      <img src="${img('world-light.jpg')}" style="position:absolute;left:48px;top:46px;width:660px;border-radius:22px;box-shadow:0 30px 70px rgba(0,0,0,.5);opacity:.97">
      <img src="${img('room-tools.jpg')}" style="position:absolute;left:250px;top:170px;width:1040px;border-radius:26px;box-shadow:0 40px 90px rgba(0,0,0,.6)">
      <img src="${img('mobile.jpg')}" style="position:absolute;right:56px;top:86px;width:322px;border-radius:44px;border:8px solid #0d0f17;box-shadow:0 40px 90px rgba(0,0,0,.6)">
    </body></html>`);
    await sleep(400);
    await shot(p, 'hero.jpg');
    await p.context().browser().close();
}

clearInterval(sampler);
for (const b of browsers) { try { await b.close(); } catch (_) { /* closed */ } }
await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('screenshots written to docs/');
process.exit(0);
