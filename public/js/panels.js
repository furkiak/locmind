// Side panels: people in earshot, rooms directory, emoji picker and chat.
import { S, W, bus, me, redraw, roomIdOf } from './state.js';
import { t } from './i18n.js';
import { h, byId, clear, setRangeFill } from './dom.js';
import { icon } from './icons.js';
import { send } from './net.js';
import { isSpeaking } from './audio.js';
import { wantsVoice } from './rtc.js';
import { play } from './sfx.js';
import { setUnread, getUnread, updateDock } from './ui.js';

const TINTS = ['#0A84FF', '#BF5AF2', '#FF375F', '#FF9F0A', '#30D158', '#64D2FF', '#5E5CE6'];
const tintOf = name => { let n = 0; for (const ch of name) n = (n * 31 + ch.codePointAt(0)) >>> 0; return TINTS[n % TINTS.length]; };

// ------------------------------------------------------------------ people

let peopleKey = '';
const personEls = new Map();

export function updatePeople(force = false) {
    const self = me(), panel = byId('people');
    if (!self) return;
    const list = Object.values(S.players).filter(p => p.id !== S.myId && wantsVoice(self, p, true)).sort((a, b) => a.nickname.localeCompare(b.nickname));
    const key = list.map(p => `${p.id}:${p.muted ? 1 : 0}`).join(',') + '|' + S.currentRoomId + '|' + S.settings.lang;
    if (list.length === 0) { panel.hidden = true; peopleKey = ''; personEls.clear(); return; }
    panel.hidden = false;
    if (force || key !== peopleKey) {
        peopleKey = key;
        personEls.clear();
        clear(panel);
        const room = S.currentRoomId ? S.rooms[S.currentRoomId] : null;
        panel.appendChild(h('h4', {}, `${t(room ? 'people_room' : 'people_nearby')} · ${list.length + 1}`));
        panel.appendChild(h('div', { class: 'person' },
            h('img', { src: '/' + self.avatar, alt: '' }),
            h('div', { class: 'name' }, self.nickname, h('small', {}, t('you')))));
        for (const p of list) {
            const vol = h('input', { class: 'range vol', type: 'range', min: 0, max: 3, step: .1, value: S.userVolumes[p.id] === undefined ? 1 : S.userVolumes[p.id], 'aria-label': p.nickname });
            setRangeFill(vol);
            vol.max = '3'; vol.style.setProperty('--fill-pct', `${(vol.value / 3) * 100}%`);
            vol.addEventListener('input', () => { S.userVolumes[p.id] = parseFloat(vol.value); vol.style.setProperty('--fill-pct', `${(vol.value / 3) * 100}%`); });
            const row = h('div', { class: 'person' },
                h('img', { src: '/' + p.avatar, alt: '' }),
                h('div', { class: 'name' }, p.nickname),
                p.muted ? h('span', { class: 'mute', html: icon('mic-off') }) : null,
                vol);
            personEls.set(p.id, row);
            panel.appendChild(row);
        }
    }
    const now = performance.now();
    for (const [id, row] of personEls) row.classList.toggle('speaking', isSpeaking(id, now));
}

// ------------------------------------------------------------------- rooms

export function toggleRooms(force) {
    const panel = byId('rooms-panel');
    const open = force === undefined ? panel.hidden : force;
    panel.hidden = !open;
    if (open) { byId('emoji-picker').hidden = true; renderRooms(); }
}

function renderRooms() {
    const panel = byId('rooms-panel');
    if (panel.hidden) return;
    clear(panel);
    const rows = [];
    const count = id => Object.values(S.players).filter(p => roomIdOf(p) === id).length;
    for (const r of Object.values(S.rooms).sort((a, b) => (b.builtin - a.builtin) || a.name.localeCompare(b.name))) {
        const col = W.ROOM_COLORS[r.color] || W.ROOM_COLORS.blue;
        const meta = r.builtin ? t('rooms_builtin') : [r.ownerName ? t('rooms_by', { name: r.ownerName }) : null, t('rooms_inside', { n: count(r.id) })].filter(Boolean).join(' · ');
        const name = r.builtin ? t('stadium') : r.name;
        const btn = h('button', { class: 'room-row', type: 'button', title: t('rooms_locate') },
            h('span', { class: 'swatch', style: { color: col, background: col } }),
            h('span', { class: 'meta' }, h('b', {}, (r.hasPassword ? '🔒 ' : '') + name), h('small', {}, meta)),
            h('span', { class: 'go', html: icon('pin') }));
        btn.addEventListener('click', () => { S.locate = { slotId: r.id, until: performance.now() + 12000 }; toggleRooms(false); redraw(); });
        rows.push(btn);
    }
    panel.appendChild(h('h4', {}, t('rooms_title')));
    rows.forEach(r => panel.appendChild(r));
    if (Object.values(S.rooms).every(r => r.builtin)) panel.appendChild(h('div', { class: 'empty-note' }, t('rooms_none')));
}
bus.on('rooms', renderRooms);
bus.on('players', renderRooms);
bus.on('lang', renderRooms);

// ------------------------------------------------------------------- emoji

function buildEmoji() {
    const box = byId('emoji-picker');
    clear(box);
    const pick = value => { send('emoji', { emoji: value }); toggleEmoji(false); };
    box.appendChild(h('div', { class: 'sect' }, t('reactions')));
    const g1 = h('div', { class: 'grid' });
    S.emojis.unicode.forEach(e => g1.appendChild(h('button', { type: 'button', onClick: () => pick(e), 'aria-label': e }, e)));
    box.appendChild(g1);
    if (S.emojis.images.length) {
        box.appendChild(h('div', { class: 'sect' }, t('images')));
        const g2 = h('div', { class: 'grid' });
        S.emojis.images.forEach(f => g2.appendChild(h('button', { type: 'button', onClick: () => pick(f), 'aria-label': f }, h('img', { src: '/emoji/' + f, alt: '', loading: 'lazy' }))));
        box.appendChild(g2);
    }
}
bus.on('world', buildEmoji);
bus.on('lang', buildEmoji);

export function toggleEmoji(force) {
    const box = byId('emoji-picker');
    const open = force === undefined ? box.hidden : force;
    if (open) { byId('rooms-panel').hidden = true; byId('chatbar').hidden = true; }
    box.hidden = !open;
    updateDock();
}

bus.on('emoji', ({ id, emoji }) => {
    const p = S.players[id];
    if (!p) return;
    p.emoji = { value: emoji, born: performance.now() };
    redraw();
});
bus.on('player-kick', id => {
    const p = S.players[id];
    if (p && id !== S.myId) { p.kickAnim = performance.now(); redraw(); }
});

// -------------------------------------------------------------------- chat

let logOpen = false;
const history = [];

export function openChat() {
    toggleEmoji(false);
    const bar = byId('chatbar');
    bar.hidden = false;
    byId('chat-input').focus();
    updateDock();
}

export function closeChat() {
    const bar = byId('chatbar');
    if (bar.hidden) return;
    bar.hidden = true;
    byId('chat-input').blur();
    byId('gameCanvas').focus({ preventScroll: true });
    updateDock();
}

export function toggleChatLog(force) {
    logOpen = force === undefined ? !logOpen : force;
    byId('chatlog').hidden = !logOpen;
    if (logOpen) { setUnread(0); scrollLog(); }
}
const scrollLog = () => { const l = byId('chat-list'); l.scrollTop = l.scrollHeight; };

function addLogLine(msg) {
    const list = byId('chat-list');
    const li = h('li', {}, h('b', { style: { color: tintOf(msg.name) } }, msg.name), msg.text);
    if (msg.roomId) li.appendChild(h('span', { class: 'scope' }, t('scope_room')));
    list.appendChild(li);
    history.push(li);
    while (history.length > 120) history.shift().remove();
    scrollLog();
}

export function initChat() {
    byId('chatbar').addEventListener('submit', e => {
        e.preventDefault();
        const input = byId('chat-input');
        const text = input.value.trim();
        if (text) send('chat', { text });
        input.value = '';
        closeChat();
    });
    byId('chat-input').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeChat(); } });
    byId('chatlog-close').addEventListener('click', () => toggleChatLog(false));
}

bus.on('chat', msg => {
    const p = S.players[msg.id];
    const now = performance.now();
    if (p) { p.bubble = { text: msg.text, born: now, until: now + 4800 }; redraw(); }
    addLogLine(msg);
    if (msg.id !== S.myId) {
        play('message');
        if (!logOpen) setUnread(getUnread() + 1);
    }
});
