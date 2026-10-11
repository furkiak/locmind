// Regenerates the README screenshots in docs/ with a real browser.
//   CHROMIUM_PATH=/path/to/chrome node scripts/screenshots.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/app');
const W = require('../shared/world');
const { chromium } = await import('playwright-core');

const exe = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
if (!exe) { console.error('Set CHROMIUM_PATH to a Chromium/Chrome binary.'); process.exit(1); }

const OUT = new URL('../docs/', import.meta.url).pathname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = createApp({ LOG_LEVEL: 'silent', MAX_CONNECTIONS_PER_IP: 1000 });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${app.server.address().port}/`;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });

async function join(nick, { avatar = 'usr1.png', scheme = 'dark', width = 1440, height = 900, mobile = false, lang = 'en-US' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: lang, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, permissions: ['microphone', 'camera'] });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.fill('#nick', nick);
    await page.click(`#avatars [data-avatar="${avatar}"]`);
    await page.check('#tos', { force: true });
    return page;
}
async function enter(page) {
    await page.click('#join-btn');
    await page.waitForFunction(() => window.__locmind && window.__locmind.S.active, null, { timeout: 10000 });
}
const walk = async (page, x, y) => {
    await page.evaluate(([x, y]) => { window.__locmind.input.target = { x: x - 20, y: y - 20 }; }, [x, y]);
    await page.waitForFunction(([x, y]) => { const { S } = window.__locmind; const p = S.players[S.myId]; return Math.hypot(p.x + 20 - x, p.y + 20 - y) < 14; }, [x, y], { timeout: 40000 });
};
const route = async (page, pts) => { for (const [x, y] of pts) await walk(page, x, y); };
const shot = (page, name) => page.screenshot({ path: OUT + name, type: 'jpeg', quality: 90 });
const bus = (page, action) => page.evaluate(a => window.__locmind.bus.emit('action', a), action);

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
    await stroke(circle(.76, .32, .035, .055, 20), 3);
}

// ------------------------------------------------------------------ login
{
    const p = await join('Ada', { avatar: 'usr2.png' });
    await sleep(900);
    await shot(p, 'login-dark.jpg');
    await p.context().close();
}

// -------------------------------------------------- room scene (dark)
const slot = W.buildSlots()[5];            // a plot in the second row
const doorX = W.doorStart(slot) + W.C.DOOR_SIZE / 2;
const ada = await join('Ada', { avatar: 'usr2.png' });
const bob = await join('Bob', { avatar: 'usr3.png' });
const cem = await join('Cem', { avatar: 'usr4.png' });
await enter(ada); await enter(bob); await enter(cem);
const c = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
await walk(ada, c.x, c.y);
await ada.keyboard.press('KeyE');
await ada.fill('#room-name', 'Design Lab');
await ada.click('#room-colors [data-color="purple"]');
await ada.click('#room-create-btn');
await ada.waitForFunction(id => window.__locmind.S.currentRoomId === id, slot.id);
await Promise.all([route(bob, [[330, 900], [doorX - 50, slot.y + slot.h + 90]]), route(cem, [[330, 900], [doorX + 70, slot.y + slot.h + 150]])]);
await walk(bob, doorX, slot.y + slot.h + 40);
await walk(bob, doorX, slot.y + slot.h - 70);
await bob.waitForFunction(id => window.__locmind.S.currentRoomId === id, slot.id);
for (const [p, text] of [[ada, 'Welcome to the lab! 👋'], [bob, 'Sketching the new layout']]) {
    await p.keyboard.press('Enter'); await p.keyboard.type(text); await p.keyboard.press('Enter'); await sleep(250);
}
await ada.keyboard.press('KeyG');
await sleep(500);
await doodle(ada);
await ada.keyboard.press('KeyT');
await ada.keyboard.press('KeyH');
await ada.fill('#notes-text', 'Sprint 12\n• Ship the new UI\n• Write the docs\n• Celebrate 🎉');
await ada.evaluate(() => {
    const b = document.getElementById('win-board'); Object.assign(b.style, { top: '70px', right: '20px', left: 'auto', width: '560px', height: '400px' });
    const n = document.getElementById('win-notes'); Object.assign(n.style, { top: '490px', right: '240px', left: 'auto', width: '380px', height: '260px' });
});
await sleep(1500);
await shot(ada, 'world-dark.jpg');

// -------------------------------------------------------- stadium
await ada.keyboard.press('KeyT');
for (const [p] of [[ada], [bob], [cem]]) {
    await p.keyboard.press('Escape');
    if (p === ada) { for (const w of ['win-board', 'win-notes']) await p.evaluate(id => { const el = document.getElementById(id); if (!el.hidden) el.hidden = true; document.body.classList.remove('win-open'); }, w); }
}
const out = [[doorX, slot.y + slot.h - 20], [doorX, slot.y + slot.h + 80], [1500, 960]];
await Promise.all([route(ada, [...out, [2230, 520]]), route(bob, [...out, [2130, 650]]), route(cem, [[doorX + 70, slot.y + slot.h + 200], [1500, 960], [2420, 440]])]);
app.world.football.score = { blue: 2, red: 1 };
app.io.emit('score', app.world.football.score);
await sleep(500);
await ada.keyboard.press('Space');
await sleep(600);
await shot(ada, 'stadium.jpg');
await ada.context().close(); await bob.context().close(); await cem.context().close();

// ------------------------------------------------------ light mode
{
    const a = await join('Ada', { avatar: 'usr2.png', scheme: 'light' });
    const b = await join('Bob', { avatar: 'usr3.png', scheme: 'light' });
    await enter(a); await enter(b);
    await Promise.all([walk(a, 560, 560), walk(b, 640, 640)]);
    await a.keyboard.press('KeyE');
    await a.fill('#room-name', 'Coffee Corner');
    await a.click('#room-colors [data-color="orange"]');
    await a.click('#room-create-btn');
    await sleep(500);
    await b.keyboard.press('Enter'); await b.keyboard.type('Anyone up for a coffee? ☕'); await b.keyboard.press('Enter');
    await a.keyboard.press('KeyQ'); await sleep(300);
    await a.click('#emoji-picker .grid button:nth-child(4)');
    await a.keyboard.press('KeyR'); await sleep(900);
    await shot(a, 'world-light.jpg');
    await a.context().close(); await b.context().close();
}

// --------------------------------------------------------- mobile
{
    const m = await join('Zeynep', { avatar: 'usr2.png', width: 390, height: 844, mobile: true, lang: 'tr-TR' });
    await enter(m);
    await walk(m, 230, 230);
    await m.evaluate(() => window.__locmind.bus.emit('action', 'interact'));
    await m.fill('#room-name', 'Stüdyo');
    await m.click('#room-colors [data-color="teal"]');
    await m.tap('#room-create-btn');
    await sleep(900);
    await m.waitForFunction(() => document.querySelectorAll('#toasts .toast').length === 0 || true);
    await sleep(3600);
    await m.screenshot({ path: OUT + 'mobile.jpg', type: 'jpeg', quality: 90 });
    await m.context().close();
}

await browser.close();
await app.close();
console.log('screenshots written to docs/');
process.exit(0);
