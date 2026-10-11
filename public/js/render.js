// Canvas renderer: world, rooms, stadium, players, effects and the minimap.
import { S, W, C, bus, me, redraw, roomIdOf } from './state.js';
import { isSpeaking, anySpeaking } from './audio.js';
import { step, input } from './movement.js';
import { typingNow } from './social.js';
import { t } from './i18n.js';
import { clamp } from './dom.js';
import { parseAvatar, paintEmojiAvatar, STATUS_COLORS } from './avatar.js';

const PS = C.PLAYER_SIZE;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, sans-serif';
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');

let dpr = 1;
let animating = false;
let lastMini = 0;

// -------------------------------------------------------------- palette

const PALETTES = {
    dark: {
        void: '#04060c', voidA: '#0b1126', voidB: '#04060c', floorA: '#0f1630', floorB: '#0a1024', dot: 'rgba(255,255,255,.075)', edge: 'rgba(10,132,255,.55)',
        slot: 'rgba(255,255,255,.035)', slotHere: 'rgba(255,255,255,.09)', slotLine: 'rgba(255,255,255,.17)', plus: 'rgba(255,255,255,.28)',
        aurora: .16, label: 'rgba(18,22,40,.78)', labelText: '#fff', apron: '#0c1228', name: 'rgba(14,18,34,.72)', nameText: '#fff', bubble: 'rgba(255,255,255,.96)', bubbleText: '#10131f'
    },
    light: {
        void: '#d6ddeb', voidA: '#e3e9f6', voidB: '#cfd7e8', floorA: '#f7f9fe', floorB: '#e9eef8', dot: 'rgba(30,50,90,.14)', edge: 'rgba(0,122,255,.5)',
        slot: 'rgba(255,255,255,.55)', slotHere: 'rgba(255,255,255,.9)', slotLine: 'rgba(40,60,110,.22)', plus: 'rgba(40,60,110,.35)',
        aurora: .20, label: 'rgba(255,255,255,.88)', labelText: '#10131f', apron: '#dbe3f2', name: 'rgba(255,255,255,.85)', nameText: '#10131f', bubble: '#ffffff', bubbleText: '#10131f'
    }
};
const AURORA = [[500, 500, 900, '10,132,255'], [2400, 520, 1000, '48,209,88'], [1000, 1800, 1100, '191,90,242'], [2500, 2200, 1000, '255,55,95'], [1700, 1400, 800, '100,210,255']];
let palKey = '', pal = PALETTES.dark;
function palette() {
    const key = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    if (key !== palKey) { palKey = key; pal = PALETTES[key]; sprites.clear(); dotPattern = null; stadiumCache = null; auditoriumCache = null; redraw(); }
    return pal;
}

// -------------------------------------------------------------- helpers

function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else {
        r = Math.min(r, w / 2, h / 2);
        ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
}

const widthCache = new Map();
function textWidth(text, font) {
    const k = font + '|' + text;
    let w = widthCache.get(k);
    if (w === undefined) {
        ctx.font = font; w = ctx.measureText(text).width;
        if (widthCache.size > 600) widthCache.clear();
        widthCache.set(k, w);
    }
    return w;
}

function pill(cx, cy, text, { font = `600 12px ${FONT}`, bg, fg, padX = 9, h = 20, dot = null }) {
    const tw = textWidth(text, font) + (dot ? 14 : 0);
    const w = tw + padX * 2;
    rr(cx - w / 2, cy - h / 2, w, h, h / 2); ctx.fillStyle = bg; ctx.fill();
    ctx.font = font; ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let tx = cx - tw / 2;
    if (dot) { ctx.beginPath(); ctx.arc(tx + 4, cy, 3.5, 0, Math.PI * 2); ctx.fillStyle = dot; ctx.fill(); ctx.fillStyle = fg; tx += 14; }
    ctx.fillText(text, tx, cy + .5);
}

// -------------------------------------------------------------- sprites

const avatarImgs = {};
const sprites = new Map();
function avatarSprite(name) {
    const k = name + '|' + palKey;
    let s = sprites.get(k);
    if (s) return s;
    const info = parseAvatar(name);
    const size = 96, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    if (info.kind === 'emoji') paintEmojiAvatar(g, info, size, FONT);
    else {
        const img = avatarImgs[info.src.slice(1)];
        if (!img || !img.complete || !img.naturalWidth) return null;
        g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2); g.closePath();
        g.save(); g.clip(); g.drawImage(img, 3, 3, size - 6, size - 6); g.restore();
    }
    if (sprites.size > 300) sprites.clear();
    g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    g.lineWidth = 3; g.strokeStyle = palKey === 'light' ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.55)'; g.stroke();
    sprites.set(k, c);
    return c;
}
export function preloadAvatars() {
    W.AVATARS.forEach(name => {
        const img = new Image(); img.src = '/' + name;
        img.onload = () => { sprites.clear(); redraw(); };
        avatarImgs[name] = img;
    });
}

const emojiImgs = {};
function emojiImage(file) {
    if (!emojiImgs[file]) { const i = new Image(); i.src = '/emoji/' + file; i.onload = redraw; emojiImgs[file] = i; }
    return emojiImgs[file];
}
const isImageEmoji = e => /\.(png|gif|jpe?g|webp)$/i.test(e);

let dotPattern = null;
function getDotPattern() {
    if (dotPattern) return dotPattern;
    const c = document.createElement('canvas'); c.width = c.height = 50;
    const g = c.getContext('2d');
    g.fillStyle = pal.dot; g.beginPath(); g.arc(25, 25, 1.6, 0, Math.PI * 2); g.fill();
    dotPattern = ctx.createPattern(c, 'repeat');
    return dotPattern;
}

// -------------------------------------------------------------- stadium

let stadiumCache = null;
function stadiumSprite() {
    if (stadiumCache && stadiumCache.lang === S.settings.lang) return stadiumCache.canvas;
    const f = W.STADIUM, pad = 70, scale = 1;
    const c = document.createElement('canvas');
    c.width = (f.w + pad * 2) * scale; c.height = (f.h + pad * 2) * scale;
    const g = c.getContext('2d');
    g.translate(pad, pad);
    const rrect = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };

    rrect(-50, -50, f.w + 100, f.h + 100, 46); g.fillStyle = pal.apron; g.fill();
    g.save(); rrect(0, 0, f.w, f.h, 8); g.clip();
    const grad = g.createLinearGradient(0, 0, 0, f.h); grad.addColorStop(0, '#1f9d55'); grad.addColorStop(1, '#168a47');
    g.fillStyle = grad; g.fillRect(0, 0, f.w, f.h);
    const stripe = f.w / 12;
    for (let i = 0; i < 12; i += 2) { g.fillStyle = 'rgba(255,255,255,.055)'; g.fillRect(i * stripe, 0, stripe, f.h); }
    const vg = g.createRadialGradient(f.w / 2, f.h / 2, f.h * .3, f.w / 2, f.h / 2, f.w * .62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.28)');
    g.fillStyle = vg; g.fillRect(0, 0, f.w, f.h);
    g.restore();

    g.strokeStyle = 'rgba(255,255,255,.88)'; g.lineWidth = 4; g.lineCap = 'round';
    rrect(0, 0, f.w, f.h, 8); g.stroke();
    g.beginPath(); g.moveTo(f.w / 2, 0); g.lineTo(f.w / 2, f.h); g.stroke();
    g.beginPath(); g.arc(f.w / 2, f.h / 2, 82, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(f.w / 2, f.h / 2, 5, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.9)'; g.fill();
    for (const left of [true, false]) {
        const bx = left ? 0 : f.w - 170, gx = left ? 0 : f.w - 70;
        g.strokeRect(bx, f.h / 2 - 170, 170, 340);
        g.strokeRect(gx, f.h / 2 - 90, 70, 180);
        g.beginPath(); g.arc(left ? 130 : f.w - 130, f.h / 2, 4, 0, Math.PI * 2); g.fill();
    }
    // goals (nets)
    const gy = f.h / 2 - f.goalSize / 2;
    for (const [left, col] of [[true, '10,132,255'], [false, '255,69,58']]) {
        const gx = left ? -f.goalDepth : f.w;
        g.fillStyle = `rgba(${col},.22)`; g.fillRect(gx, gy, f.goalDepth, f.goalSize);
        g.strokeStyle = `rgba(${col},.95)`; g.lineWidth = 4; g.strokeRect(gx, gy, f.goalDepth, f.goalSize);
        g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.35)';
        g.beginPath();
        for (let y = gy; y <= gy + f.goalSize; y += 14) { g.moveTo(gx, y); g.lineTo(gx + f.goalDepth, y); }
        for (let x = gx; x <= gx + f.goalDepth; x += 10) { g.moveTo(x, gy); g.lineTo(x, gy + f.goalSize); }
        g.stroke();
    }
    g.fillStyle = pal.labelText; g.textAlign = 'center'; g.font = `800 34px ${FONT}`;
    g.globalAlpha = .85; g.fillText(t('stadium').toUpperCase(), f.w / 2, -62 + 14); g.globalAlpha = 1;
    stadiumCache = { canvas: c, pad, lang: S.settings.lang };
    return c;
}

// ----------------------------------------------------------- auditorium

let auditoriumCache = null;
function auditoriumSprite() {
    const key = S.settings.lang + palKey;
    if (auditoriumCache && auditoriumCache.key === key) return auditoriumCache.canvas;
    const a = W.AUDITORIUM, st = a.stage, pad = 70;
    const c = document.createElement('canvas');
    c.width = a.w + pad * 2; c.height = a.h + pad * 2;
    const g = c.getContext('2d');
    g.translate(pad - a.x, pad - a.y);
    const rrect = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
    const light = palKey === 'light';

    // hall floor
    rrect(a.x, a.y, a.w, a.h, 36);
    const floor = g.createLinearGradient(0, a.y, 0, a.y + a.h);
    floor.addColorStop(0, light ? '#ece6fb' : '#1b1638'); floor.addColorStop(1, light ? '#f6f3fd' : '#120f26');
    g.fillStyle = floor; g.fill();
    g.lineWidth = 3; g.strokeStyle = light ? 'rgba(175,82,222,.45)' : 'rgba(191,90,242,.5)'; g.stroke();

    // stage with a warm spotlight
    const spot = g.createRadialGradient(st.x + st.w / 2, st.y, 10, st.x + st.w / 2, st.y + st.h / 2, st.w * .75);
    spot.addColorStop(0, 'rgba(255,214,10,.35)'); spot.addColorStop(1, 'rgba(255,214,10,0)');
    g.fillStyle = spot; g.fillRect(st.x - st.w * .4, st.y - 40, st.w * 1.8, st.h + 160);
    rrect(st.x, st.y, st.w, st.h, 22);
    const sg = g.createLinearGradient(0, st.y, 0, st.y + st.h);
    sg.addColorStop(0, light ? '#d9c8f7' : '#3b2a6e'); sg.addColorStop(1, light ? '#c4aef0' : '#2a1e52');
    g.fillStyle = sg; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,214,10,.75)'; g.stroke();
    g.fillStyle = light ? 'rgba(60,30,110,.55)' : 'rgba(255,255,255,.55)'; g.font = `800 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t('stage').toUpperCase(), st.x + st.w / 2, st.y + st.h - 26);

    // rows of seats facing the stage
    g.fillStyle = light ? 'rgba(120,90,190,.18)' : 'rgba(191,90,242,.16)';
    for (let row = 0; row < 7; row++) {
        const y = st.y + st.h + 90 + row * 80;
        if (y > a.y + a.h - 60) break;
        const span = 340 + row * 60, n = Math.floor(span / 56);
        for (let i = 0; i < n; i++) { rrect(a.x + a.w / 2 - span / 2 + i * 56 + 6, y, 44, 26, 9); g.fill(); }
    }
    auditoriumCache = { canvas: c, pad, key };
    return c;
}

// -------------------------------------------------------------- scene

function view() {
    const w = window.innerWidth / S.zoom, h = window.innerHeight / S.zoom;
    return { x0: S.cam.x - w / 2, y0: S.cam.y - h / 2, x1: S.cam.x + w / 2, y1: S.cam.y + h / 2 };
}
const visible = (v, x, y, w, h, pad = 80) => x + w + pad > v.x0 && x - pad < v.x1 && y + h + pad > v.y0 && y - pad < v.y1;

function drawFloor(v) {
    const g = ctx.createLinearGradient(0, 0, 0, C.HEIGHT);
    g.addColorStop(0, pal.floorA); g.addColorStop(1, pal.floorB);
    rr(0, 0, C.WIDTH, C.HEIGHT, 70); ctx.fillStyle = g; ctx.fill();
    ctx.save(); rr(0, 0, C.WIDTH, C.HEIGHT, 70); ctx.clip();
    // soft aurora behind everything: gives the glass UI some colour to refract
    for (const [x, y, r, rgb] of AURORA) {
        if (!visible(v, x - r, y - r, r * 2, r * 2, 0)) continue;
        const ag = ctx.createRadialGradient(x, y, 0, x, y, r);
        ag.addColorStop(0, `rgba(${rgb},${pal.aurora})`); ag.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = ag; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.fillStyle = getDotPattern(); ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    ctx.restore();
    rr(0, 0, C.WIDTH, C.HEIGHT, 70);
    ctx.lineWidth = 3; ctx.strokeStyle = pal.edge; ctx.shadowColor = pal.edge; ctx.shadowBlur = 24; ctx.stroke(); ctx.shadowBlur = 0;
}

function drawSlot(slot, now) {
    const { x, y, w, h } = slot, room = S.rooms[slot.id];
    if (slot.type === 'stadium') {
        const sp = stadiumSprite();
        ctx.drawImage(sp, x - stadiumCache.pad, y - stadiumCache.pad);
        return;
    }
    if (slot.type === 'auditorium') {
        const sp = auditoriumSprite();
        ctx.drawImage(sp, x - auditoriumCache.pad, y - auditoriumCache.pad);
        let count = 0;
        for (const id in S.players) if (roomIdOf(S.players[id]) === slot.id) count++;
        pill(x + w / 2, y - 24, t('auditorium') + (count ? `  · ${count}` : ''), { font: `650 14px ${FONT}`, bg: pal.label, fg: pal.labelText, padX: 13, h: 28, dot: W.ROOM_COLORS.purple });
        return;
    }
    if (!room) {
        const here = S.currentSlotId === slot.id;
        rr(x, y, w, h, 20); ctx.fillStyle = here ? pal.slotHere : pal.slot; ctx.fill();
        ctx.setLineDash([10, 9]); ctx.lineWidth = 2; ctx.strokeStyle = here ? W.ROOM_COLORS.blue : pal.slotLine; ctx.stroke(); ctx.setLineDash([]);
        const cx = x + w / 2, cy = y + h / 2, s = here ? 22 + Math.sin(now / 260) * 2 : 18;
        ctx.strokeStyle = here ? W.ROOM_COLORS.blue : pal.plus; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy); ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s); ctx.stroke();
        return;
    }
    const col = W.ROOM_COLORS[room.color] || W.ROOM_COLORS.blue;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, col + '30'); g.addColorStop(1, col + '0d');
    rr(x, y, w, h, 12); ctx.fillStyle = g; ctx.fill();

    ctx.save();
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 16;
    for (const r of W.slotWalls(slot)) { rr(r.x - .5, r.y - .5, r.w + 1, r.h + 1, 2.5); ctx.fill(); }
    ctx.restore();

    // door threshold
    const d0 = W.doorStart(slot);
    ctx.strokeStyle = col + '99'; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(d0 + 4, y + h - 2.5); ctx.lineTo(d0 + C.DOOR_SIZE - 4, y + h - 2.5); ctx.stroke(); ctx.setLineDash([]);

    const locked = room.hasPassword && !(room.owner === S.myId || S.unlocked.has(room.id));
    let count = 0;
    for (const id in S.players) if (roomIdOf(S.players[id]) === room.id) count++;
    const label = (room.hasPassword ? '🔒 ' : '') + room.name;
    pill(x + w / 2, y - 24, label + (count ? `  · ${count}` : ''), { font: `650 14px ${FONT}`, bg: pal.label, fg: pal.labelText, padX: 13, h: 28, dot: locked ? W.ROOM_COLORS.red : col });
    if (room.topic && S.zoom > .55) {
        ctx.save(); ctx.globalAlpha = .8;
        ctx.font = `500 12px ${FONT}`; ctx.fillStyle = pal.labelText; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        let topic = room.topic;
        while (topic.length > 4 && textWidth(topic, ctx.font) > w - 24) topic = topic.slice(0, -2);
        ctx.fillText(topic === room.topic ? topic : topic + '…', x + w / 2, y + 22);
        ctx.restore();
    }
}

function drawBall(now) {
    const b = S.ball;
    if (!b) return;
    const r = b.radius;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(b.rx + 2, b.ry + r * .85, r * .95, r * .38, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(b.rx - r * .35, b.ry - r * .4, r * .1, b.rx, b.ry, r);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfd6e4');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.rx, b.ry, r, 0, Math.PI * 2); ctx.fill();
    const rot = (b.rx + b.ry) / r;
    ctx.save(); ctx.translate(b.rx, b.ry); ctx.rotate(rot);
    ctx.fillStyle = '#1b2030'; ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r * .42, Math.sin(a) * r * .42); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(27,32,48,.55)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * .42, Math.sin(a) * r * .42); ctx.lineTo(Math.cos(a) * r * .95, Math.sin(a) * r * .95); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(b.rx, b.ry, r, 0, Math.PI * 2); ctx.stroke();
}

function wrapText(text, font, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (textWidth(test, font) > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    // very long words
    return lines.flatMap(l => {
        if (textWidth(l, font) <= maxW) return [l];
        const out = []; let cur = '';
        for (const ch of Array.from(l)) { if (textWidth(cur + ch, font) > maxW) { out.push(cur); cur = ch; } else cur += ch; }
        if (cur) out.push(cur);
        return out;
    });
}

function drawPlayer(p, now) {
    const cx = p.rx + PS / 2, cy = p.ry + PS / 2, isMe = p.id === S.myId;
    ctx.fillStyle = 'rgba(0,0,0,.26)'; ctx.beginPath(); ctx.ellipse(cx, cy + PS / 2 - 1, PS * .42, PS * .15, 0, 0, Math.PI * 2); ctx.fill();

    if (isSpeaking(p.id, now)) {
        const pulse = 4 + Math.sin(now / 140) * 2.5;
        ctx.save(); ctx.strokeStyle = W.ROOM_COLORS.green; ctx.lineWidth = 3; ctx.shadowColor = W.ROOM_COLORS.green; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(cx, cy, PS / 2 + pulse, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (p.kickAnim) {
        const k = (now - p.kickAnim) / 380;
        if (k < 1) { ctx.strokeStyle = `rgba(255,159,10,${1 - k})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, PS / 2 + k * 46, 0, Math.PI * 2); ctx.stroke(); }
        else p.kickAnim = 0;
    }

    const sprite = avatarSprite(p.avatar);
    if (p.status === 'away') ctx.globalAlpha = .6;
    if (sprite) ctx.drawImage(sprite, cx - PS / 2 - 2, cy - PS / 2 - 2, PS + 4, PS + 4);
    else { ctx.fillStyle = W.ROOM_COLORS.indigo; ctx.beginPath(); ctx.arc(cx, cy, PS / 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (S.follow === p.id) { ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = W.ROOM_COLORS.teal; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, PS / 2 + 7, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    if (isMe) { ctx.strokeStyle = W.ROOM_COLORS.blue; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, PS / 2 + 3, 0, Math.PI * 2); ctx.stroke(); }

    // facing marker
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.arc(cx + p.dirX * (PS / 2 + 5), cy + p.dirY * (PS / 2 + 5), 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;

    if (p.muted) {
        const bx = cx + PS / 2 - 3, by = cy + PS / 2 - 3;
        ctx.fillStyle = W.ROOM_COLORS.red; ctx.beginPath(); ctx.arc(bx, by, 7.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(bx - 3, by + 3); ctx.lineTo(bx + 3, by - 3); ctx.stroke();
    }

    pill(cx, cy + PS / 2 + 14, p.nickname, { bg: pal.name, fg: pal.nameText, h: 19, padX: 8, dot: p.status && p.status !== 'available' ? STATUS_COLORS[p.status] : null });

    // raised hand (rooms and the auditorium), with the queue position
    const hand = S.room.hands.findIndex(x => x.id === p.id);
    if (hand >= 0 && roomIdOf(p) === S.currentRoomId) {
        const hx = cx - PS / 2 + 1, hy = cy - PS / 2 + 1, bob = Math.sin(now / 300) * 1.5;
        ctx.save();
        ctx.fillStyle = '#FFD60A'; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(hx, hy + bob, 11, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.font = `14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✋', hx, hy + bob + 1);
        ctx.fillStyle = '#1c1c1e'; ctx.font = `800 10px ${FONT}`; ctx.fillText(String(hand + 1), hx + 10, hy + bob - 9);
        ctx.restore();
    }

    // everything above the head stacks upwards
    let top = cy - PS / 2 - 12;
    if (p.cam && p.hasVideo) {
        const vid = S.videos && S.videos[p.id];
        if (vid && vid.readyState >= 2 && vid.videoWidth) {
            const size = isMe ? 56 : 68, ccy = top - size / 2 - 2;
            ctx.save(); ctx.beginPath(); ctx.arc(cx, ccy, size / 2, 0, Math.PI * 2); ctx.clip();
            const vw = vid.videoWidth, vh = vid.videoHeight, s = Math.max(size / vw, size / vh);
            ctx.translate(cx, ccy); if (isMe) ctx.scale(-1, 1);
            ctx.drawImage(vid, -vw * s / 2, -vh * s / 2, vw * s, vh * s);
            ctx.restore();
            ctx.lineWidth = 3; ctx.strokeStyle = W.ROOM_COLORS.green; ctx.beginPath(); ctx.arc(cx, ccy, size / 2, 0, Math.PI * 2); ctx.stroke();
            top -= size + 8;
        }
    }
    if (p.emoji) {
        const age = now - p.emoji.born;
        if (age > 3200) p.emoji = null;
        else {
            const rise = 1 - Math.pow(1 - Math.min(age / 500, 1), 3), alpha = age > 2700 ? 1 - (age - 2700) / 500 : 1;
            const pop = age < 260 ? .6 + .4 * (age / 260) + Math.sin(age / 260 * Math.PI) * .25 : 1;
            const ey = top - 24 - rise * 14;
            ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, ey); ctx.scale(pop, pop);
            if (isImageEmoji(p.emoji.value)) { const im = emojiImage(p.emoji.value); if (im.complete && im.naturalWidth) ctx.drawImage(im, -22, -22, 44, 44); }
            else { ctx.font = `34px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.emoji.value, 0, 2); }
            ctx.restore();
            top -= 52;
        }
    }
    if (!p.bubble && typingNow(p)) {
        const bw = 44, bh = 24, by = top - bh - 6;
        ctx.save();
        rr(cx - bw / 2, by, bw, bh, 12); ctx.fillStyle = pal.bubble; ctx.fill();
        for (let i = 0; i < 3; i++) {
            const k = (Math.sin(now / 160 - i * .9) + 1) / 2;
            ctx.globalAlpha = .35 + k * .65;
            ctx.fillStyle = pal.bubbleText; ctx.beginPath(); ctx.arc(cx - 10 + i * 10, by + bh / 2 - k * 2, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
    if (p.bubble) {
        const left = p.bubble.until - now;
        if (left <= 0) p.bubble = null;
        else {
            const font = `500 14px ${FONT}`, lines = wrapText(p.bubble.text, font, 190);
            const wMax = Math.max(...lines.map(l => textWidth(l, font))), bw = wMax + 24, bh = lines.length * 18 + 16;
            const by = top - bh - 8, alpha = Math.min(1, left / 350, (now - p.bubble.born) / 120 + .2);
            ctx.save(); ctx.globalAlpha = alpha;
            ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
            rr(cx - bw / 2, by, bw, bh, 16); ctx.fillStyle = pal.bubble; ctx.fill();
            ctx.beginPath(); ctx.moveTo(cx - 7, by + bh - .5); ctx.lineTo(cx + 7, by + bh - .5); ctx.lineTo(cx, by + bh + 8); ctx.closePath(); ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = pal.bubbleText; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            lines.forEach((l, i) => ctx.fillText(l, cx, by + 8 + 9 + i * 18 + .5));
            ctx.restore();
        }
    }
}

function drawRoute(now) {
    const self = me();
    if (!self || !input.target) return;
    const pts = [input.target, ...(input.path || [])];
    ctx.save();
    ctx.setLineDash([2, 10]); ctx.lineDashOffset = -now / 40; ctx.lineCap = 'round';
    ctx.strokeStyle = palKey === 'light' ? 'rgba(0,122,255,.55)' : 'rgba(100,210,255,.6)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(self.rx + PS / 2, self.ry + PS / 2);
    for (const q of pts) ctx.lineTo(q.x + PS / 2, q.y + PS / 2);
    ctx.stroke();
    const end = pts[pts.length - 1];
    ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(end.x + PS / 2, end.y + PS / 2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

function drawFx(now) {
    for (let i = S.fx.length - 1; i >= 0; i--) {
        const f = S.fx[i], age = now - f.born;
        if (f.type === 'ripple') {
            if (age > 650) { S.fx.splice(i, 1); continue; }
            const k = age / 650;
            ctx.strokeStyle = `rgba(10,132,255,${.8 * (1 - k)})`; ctx.lineWidth = 3 * (1 - k) + 1;
            ctx.beginPath(); ctx.arc(f.x, f.y, 6 + k * 26, 0, Math.PI * 2); ctx.stroke();
        } else if (f.type === 'confetti') {
            if (age > 2600) { S.fx.splice(i, 1); continue; }
            const dt = age / 1000;
            for (const q of f.parts) {
                const px = f.x + q.vx * dt, py = f.y + q.vy * dt + 520 * dt * dt;
                ctx.save(); ctx.globalAlpha = Math.max(0, 1 - age / 2600); ctx.translate(px, py); ctx.rotate(q.rot + q.spin * dt);
                ctx.fillStyle = q.color; ctx.fillRect(-q.s / 2, -q.s / 4, q.s, q.s / 2); ctx.restore();
            }
        }
    }
}

export function spawnConfetti(x, y) {
    const colors = ['#0A84FF', '#FF375F', '#FFD60A', '#30D158', '#BF5AF2', '#64D2FF', '#FF9F0A'];
    const parts = Array.from({ length: 90 }, () => {
        const a = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 520;
        return { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260, rot: Math.random() * 6, spin: (Math.random() - .5) * 18, s: 8 + Math.random() * 8, color: colors[(Math.random() * colors.length) | 0] };
    });
    S.fx.push({ type: 'confetti', x, y, born: performance.now(), parts });
}

// ------------------------------------------------------ locate (compass)

function drawLocate(now) {
    const loc = S.locate;
    if (!loc) return;
    if (now > loc.until) { S.locate = null; return; }
    const slot = S.slotsById[loc.slotId];
    if (!slot) { S.locate = null; return; }
    const room = S.rooms[loc.slotId];
    const col = room ? (W.ROOM_COLORS[room.color] || '#0A84FF') : '#30D158';
    const wx = slot.x + slot.w / 2, wy = slot.y + slot.h / 2;
    const sx = (wx - S.cam.x) * S.zoom + window.innerWidth / 2, sy = (wy - S.cam.y) * S.zoom + window.innerHeight / 2;
    const m = 70, W_ = window.innerWidth, H_ = window.innerHeight;
    const pulse = (Math.sin(now / 220) + 1) / 2;
    if (sx > 0 && sx < W_ && sy > 0 && sy < H_) {
        ctx.save();
        ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.globalAlpha = .4 + pulse * .5;
        rr(slot.x - 10 - pulse * 6, slot.y - 10 - pulse * 6, slot.w + 20 + pulse * 12, slot.h + 20 + pulse * 12, 26); ctx.stroke(); ctx.restore();
        return;
    }
    // arrow clamped to the screen border
    const cx = W_ / 2, cy = H_ / 2, dx = sx - cx, dy = sy - cy, k = Math.min((cx - m) / Math.abs(dx || 1e-6), (cy - m) / Math.abs(dy || 1e-6));
    const ax = cx + dx * k, ay = cy + dy * k, ang = Math.atan2(dy, dx);
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(ax, ay); ctx.rotate(ang);
    ctx.shadowColor = col; ctx.shadowBlur = 18; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-14, -16); ctx.lineTo(-6, 0); ctx.lineTo(-14, 16); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const me_ = me(), dist = me_ ? Math.round(Math.hypot(wx - me_.x, wy - me_.y) / 10) : 0;
    pill(ax - Math.cos(ang) * 44, ay - Math.sin(ang) * 44, `${room ? room.name : t('stadium')} · ${dist} m`, { bg: pal.label, fg: pal.labelText, h: 24, padX: 11, font: `650 12px ${FONT}` });
    ctx.restore();
}

// -------------------------------------------------------------- minimap

function drawMinimap() {
    const w = mini.width / dpr, h = mini.height / dpr;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.clearRect(0, 0, w, h);
    const sc = Math.min(w / C.WIDTH, h / C.HEIGHT), ox = (w - C.WIDTH * sc) / 2, oy = (h - C.HEIGHT * sc) / 2;
    const rrm = (x, y, ww, hh, r) => { mctx.beginPath(); mctx.roundRect ? mctx.roundRect(x, y, ww, hh, r) : mctx.rect(x, y, ww, hh); };
    for (const s of S.slots) {
        const room = S.rooms[s.id];
        rrm(ox + s.x * sc, oy + s.y * sc, s.w * sc, s.h * sc, 3);
        if (s.type === 'stadium') mctx.fillStyle = 'rgba(48,209,88,.55)';
        else if (s.type === 'auditorium') mctx.fillStyle = 'rgba(191,90,242,.5)';
        else if (room) mctx.fillStyle = (W.ROOM_COLORS[room.color] || '#0A84FF') + 'cc';
        else mctx.fillStyle = palKey === 'light' ? 'rgba(40,60,110,.16)' : 'rgba(255,255,255,.14)';
        mctx.fill();
    }
    const v = view();
    mctx.strokeStyle = palKey === 'light' ? 'rgba(0,0,0,.4)' : 'rgba(255,255,255,.5)'; mctx.lineWidth = 1;
    mctx.strokeRect(ox + clamp(v.x0, 0, C.WIDTH) * sc, oy + clamp(v.y0, 0, C.HEIGHT) * sc, (clamp(v.x1, 0, C.WIDTH) - clamp(v.x0, 0, C.WIDTH)) * sc, (clamp(v.y1, 0, C.HEIGHT) - clamp(v.y0, 0, C.HEIGHT)) * sc);
    for (const id in S.players) {
        const p = S.players[id], isMe = id === S.myId;
        mctx.fillStyle = isMe ? '#0A84FF' : (palKey === 'light' ? '#222' : '#fff');
        mctx.beginPath(); mctx.arc(ox + (p.rx + PS / 2) * sc, oy + (p.ry + PS / 2) * sc, isMe ? 3.6 : 2.4, 0, Math.PI * 2); mctx.fill();
        if (isMe) { mctx.strokeStyle = 'rgba(10,132,255,.5)'; mctx.lineWidth = 2; mctx.stroke(); }
    }
}

// ----------------------------------------------------------------- loop

function update(dt, now) {
    animating = false;
    const self = me();
    for (const id in S.players) {
        const p = S.players[id];
        if (id !== S.myId) {
            const dx = p.x - p.rx, dy = p.y - p.ry;
            if (Math.abs(dx) > 220 || Math.abs(dy) > 220) { p.rx = p.x; p.ry = p.y; }
            else if (Math.abs(dx) > .15 || Math.abs(dy) > .15) { const k = 1 - Math.exp(-dt * 16); p.rx += dx * k; p.ry += dy * k; animating = true; }
            else { p.rx = p.x; p.ry = p.y; }
        }
        if (p.emoji || p.bubble || p.kickAnim || (p.typing && p.typing > now)) animating = true;
        if (p.cam && p.hasVideo) animating = true;
    }
    if (S.ball) {
        const b = S.ball, dx = b.x - b.rx, dy = b.y - b.ry;
        if (Math.abs(dx) > 150 || Math.abs(dy) > 150) { b.rx = b.x; b.ry = b.y; }
        else if (Math.abs(dx) > .1 || Math.abs(dy) > .1) { const k = 1 - Math.exp(-dt * 24); b.rx += dx * k; b.ry += dy * k; animating = true; }
    }
    if (self) {
        const tx = self.rx + PS / 2, ty = self.ry + PS / 2;
        if (Math.hypot(tx - S.cam.x, ty - S.cam.y) > 1500) { S.cam.x = tx; S.cam.y = ty; }
        else {
            const k = 1 - Math.exp(-dt * 9);
            S.cam.x += (tx - S.cam.x) * k; S.cam.y += (ty - S.cam.y) * k;
            if (Math.abs(tx - S.cam.x) > .2 || Math.abs(ty - S.cam.y) > .2) animating = true;
        }
    }
    if (S.fx.length || S.locate || S.currentSlotId || S.room.hands.length || (input.path && input.path.length)) animating = true;
    if (anySpeaking(now)) animating = true;
}

function draw(now) {
    palette();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vg = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    vg.addColorStop(0, pal.voidA); vg.addColorStop(1, pal.voidB);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * S.zoom, 0, 0, dpr * S.zoom, dpr * (window.innerWidth / 2 - S.cam.x * S.zoom), dpr * (window.innerHeight / 2 - S.cam.y * S.zoom));
    const v = view();
    drawFloor(v);
    for (const slot of S.slots) if (visible(v, slot.x, slot.y, slot.w, slot.h, 90)) drawSlot(slot, now);
    if (S.ball && visible(v, S.ball.rx, S.ball.ry, 1, 1)) drawBall(now);
    drawLocate(now);
    if (input.path && input.path.length) drawRoute(now);
    const list = Object.values(S.players).filter(p => visible(v, p.rx, p.ry, PS, PS, 160)).sort((a, b) => a.ry - b.ry);
    for (const p of list) drawPlayer(p, now);
    drawFx(now);
    if (now - lastMini > 90 && !document.getElementById('minimap-wrap').classList.contains('is-off')) { drawMinimap(); lastMini = now; }
    S.needsRedraw = false;
}

function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    const cw = Math.max(100, mini.parentElement.clientWidth - 16);
    mini.width = Math.round(cw * dpr); mini.height = Math.round(cw * .9 * dpr);
    mini.style.height = '';
    redraw();
}

export function startRender() {
    resize();
    window.addEventListener('resize', resize);
    bus.on('setting', ({ key }) => { if (key === 'lang') { stadiumCache = null; auditoriumCache = null; } redraw(); });
    let last = performance.now();
    const frame = now => {
        const dt = Math.min((now - last) / 1000, .1);
        last = now;
        if (S.active && me()) {
            step(dt);
            update(dt, now);
            if (S.needsRedraw || animating) draw(now);
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}
