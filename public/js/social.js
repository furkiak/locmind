// People to people: player card, direct messages, waves, typing indicator, mentions,
// announcements, moderation notices and desktop notifications.
import { S, C, bus, me, redraw, isBlocked, setSetting, roomIdOf } from './state.js';
import { t } from './i18n.js';
import { h, byId, clear, isTyping } from './dom.js';
import { icon } from './icons.js';
import { send } from './net.js';
import { toast, showWindow, isWindowOpen, setBadge, updateDock } from './ui.js';
import { avatarEl, STATUS_COLORS } from './avatar.js';
import { walkTo } from './movement.js';
import { hasVoice } from './audio.js';
import { play } from './sfx.js';

const PS = C.PLAYER_SIZE;
const quiet = () => { const p = me(); return !!p && p.status === 'dnd'; };

// ------------------------------------------------------------ notifications

/** Desktop notification while the tab is in the background (opt-in, silent in "do not disturb"). */
export function notify(title, body, onClick) {
    if (!S.settings.notify || !document.hidden || quiet()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const n = new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'locmind-' + title });
        n.onclick = () => { window.focus(); n.close(); if (onClick) onClick(); };
    } catch (_) { /* some browsers only allow notifications from a service worker */ }
}

export async function enableNotifications(on) {
    if (!on) { setSetting('notify', false); return true; }
    if (!('Notification' in window)) { toast(t('notify_unsupported'), { type: 'warn' }); return false; }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') { toast(t('notify_denied'), { type: 'warn' }); setSetting('notify', false); return false; }
    setSetting('notify', true);
    return true;
}

function clickableToast(text, opts, onClick) {
    const el = toast(text, opts);
    el.classList.add('clickable');
    el.addEventListener('click', () => { el.remove(); onClick(); });
    return el;
}

// ------------------------------------------------------------- player card

let cardId = null;

function screenPos(p) {
    return {
        x: (p.rx + PS / 2 - S.cam.x) * S.zoom + window.innerWidth / 2,
        y: (p.ry + PS / 2 - S.cam.y) * S.zoom + window.innerHeight / 2
    };
}

export function openCard(id) {
    const p = S.players[id];
    if (!p || id === S.myId) return;
    cardId = id;
    const card = byId('player-card');
    card.hidden = false;
    renderCard();
    // next to the avatar, kept on screen
    const pos = screenPos(p), w = card.offsetWidth, hgt = card.offsetHeight;
    if (window.matchMedia('(max-width: 820px)').matches) { card.style.left = ''; card.style.top = ''; return; }
    let x = pos.x + 34, y = pos.y - hgt / 2;
    if (x + w > window.innerWidth - 12) x = pos.x - 34 - w;
    y = Math.max(12, Math.min(window.innerHeight - hgt - 110, y));
    card.style.left = Math.max(12, x) + 'px';
    card.style.top = y + 'px';
}

export function closeCard() {
    cardId = null;
    byId('player-card').hidden = true;
}

function cardAction(ic, label, fn, cls = '') {
    return h('button', { type: 'button', class: `card-act ${cls}`, onClick: fn }, h('span', { html: icon(ic) }), h('small', {}, label));
}

function renderCard() {
    const card = byId('player-card');
    const p = S.players[cardId];
    if (!p) { closeCard(); return; }
    const self = me();
    clear(card);
    const room = roomIdOf(p) ? S.rooms[roomIdOf(p)] : null;
    const dist = self ? Math.round(Math.hypot(p.x - self.x, p.y - self.y) / 10) : 0;
    const where = room ? (room.builtin ? (room.type === 'stadium' ? t('stadium') : t('auditorium')) : room.name) : t('meters_away', { n: dist });
    const blocked = isBlocked(p.id);

    card.append(
        h('button', { type: 'button', class: 'icon-btn card-x', 'aria-label': t('close'), html: icon('x'), onClick: closeCard }),
        h('div', { class: 'card-head' },
            avatarEl(p.avatar, { size: 58, status: p.status }),
            h('div', {},
                h('b', {}, p.nickname),
                h('small', { class: 'card-status' }, h('i', { style: { background: STATUS_COLORS[p.status] || STATUS_COLORS.available } }), t('status_' + (p.status || 'available'))),
                p.statusText ? h('span', { class: 'card-note' }, p.statusText) : null,
                h('small', { class: 'muted' }, where))),
        h('div', { class: 'card-actions' },
            cardAction('send', t('message'), () => { openDm(p.id); closeCard(); }),
            cardAction('hand', t('wave'), () => wave(p.id)),
            cardAction('walk', t('walk_to'), () => { if (walkTo(p.x + 50, p.y)) closeCard(); else toast(t('no_path'), { type: 'warn' }); }),
            cardAction('follow', S.follow === p.id ? t('unfollow') : t('follow'), () => {
                S.follow = S.follow === p.id ? null : p.id;
                bus.emit('follow', S.follow);
                renderCard();
            }, S.follow === p.id ? 'is-on' : '')));

    if (hasVoice(p.id)) {
        const vol = h('input', { class: 'range', type: 'range', min: 0, max: 3, step: .1, value: S.userVolumes[p.id] === undefined ? 1 : S.userVolumes[p.id], 'aria-label': t('volume') });
        const fill = () => vol.style.setProperty('--fill-pct', `${(vol.value / 3) * 100}%`);
        fill();
        vol.addEventListener('input', () => { S.userVolumes[p.id] = parseFloat(vol.value); fill(); });
        card.append(h('label', { class: 'card-row' }, h('span', { html: icon('volume') }), vol));
    }

    const extra = h('div', { class: 'card-extra' });
    const myRoom = S.currentRoomId ? S.rooms[S.currentRoomId] : null;
    if (myRoom && myRoom.owner === S.myId && roomIdOf(p) === myRoom.id) {
        if (S.room.hands.some(x => x.id === p.id)) extra.append(h('button', { type: 'button', class: 'btn btn-sm', onClick: () => send('hand', { up: false, target: p.id }) }, t('lower_hand')));
        extra.append(h('button', { type: 'button', class: 'btn btn-sm btn-danger', onClick: () => removeFromRoom(p) }, t('remove_from_room')));
    }
    extra.append(h('button', { type: 'button', class: 'btn btn-sm', onClick: () => toggleBlock(p) }, h('span', { html: icon('slash') }), blocked ? t('unblock') : t('block')));
    card.append(extra);
}

function removeFromRoom(p) {
    send('room:kick', { slotId: S.currentRoomId, target: p.id }, res => {
        if (res && res.ok) { toast(t('removed_from_room', { name: p.nickname }), { type: 'success' }); closeCard(); }
        else toast(t('err_' + (res && res.error)) === 'err_' + (res && res.error) ? t('err_server-error') : t('err_' + res.error), { type: 'error' });
    });
}

function toggleBlock(p) {
    const list = S.settings.blocked.slice();
    const i = list.indexOf(p.nickname);
    if (i >= 0) list.splice(i, 1); else list.push(p.nickname);
    setSetting('blocked', list.slice(-200));
    toast(t(i >= 0 ? 'unblocked' : 'blocked', { name: p.nickname }), { icon: 'slash' });
    if (i < 0) { p.bubble = null; redraw(); }
    renderCard();
}

function wave(id) {
    send('wave', { to: id }, res => {
        if (res && res.ok) { toast(t('waved_at', { name: S.players[id] ? S.players[id].nickname : '' }), { icon: 'hand', ttl: 2200 }); play('pop'); }
        else if (res && res.error === 'rate-limit') toast(t('err_rate-limit'), { type: 'warn' });
    });
}

bus.on('player-click', openCard);
bus.on('player-left', id => { if (id === cardId) closeCard(); if (S.follow === id) S.follow = null; });
bus.on('player-profile', p => { if (p && p.id === cardId) renderCard(); });
bus.on('canvas-press', () => { if (cardId) closeCard(); });

bus.on('waved', ({ from, name }) => {
    if (isBlocked(from)) return;
    const p = S.players[from];
    if (p) { p.emoji = { value: '👋', born: performance.now() }; redraw(); }
    if (!quiet()) play('message');
    clickableToast(t('waved_you', { name }), { icon: 'hand', title: '👋' }, () => openCard(from));
    notify(t('waved_you', { name }), '', () => openCard(from));
});

// ------------------------------------------------------------ direct messages

const threads = new Map();   // peer id -> { name, avatar, msgs: [], unread }
let activePeer = null;

function thread(id, name) {
    let th = threads.get(id);
    if (!th) { th = { name, msgs: [], unread: 0 }; threads.set(id, th); }
    if (name) th.name = name;
    return th;
}

function totalUnread() { let n = 0; for (const th of threads.values()) n += th.unread; return n; }

export function openDm(id) {
    const p = S.players[id];
    if (id) { thread(id, p ? p.nickname : '').unread = 0; activePeer = id; }
    showWindow('win-dm');
    renderDm();
    setBadge('dm', totalUnread());
    setTimeout(() => byId('dm-input').focus(), 30);
}

function renderDm() {
    if (!isWindowOpen('win-dm')) return;
    const bar = clear(byId('dm-threads'));
    if (!activePeer && threads.size) activePeer = threads.keys().next().value;
    for (const [id, th] of threads) {
        const p = S.players[id];
        const chip = h('button', { type: 'button', class: 'dm-chip' + (id === activePeer ? ' is-on' : '') + (p ? '' : ' is-away') },
            p ? avatarEl(p.avatar, { size: 22 }) : h('span', { class: 'av', html: icon('users') }),
            h('span', {}, th.name), th.unread ? h('b', { class: 'dot-badge' }, String(th.unread)) : null);
        chip.addEventListener('click', () => { activePeer = id; th.unread = 0; setBadge('dm', totalUnread()); renderDm(); });
        bar.append(chip);
    }
    const list = clear(byId('dm-list'));
    const th = activePeer ? threads.get(activePeer) : null;
    if (!th) list.append(h('li', { class: 'dm-empty' }, t('dm_empty')));
    else {
        for (const m of th.msgs) {
            const mine = m.from === S.myId;
            list.append(h('li', { class: mine ? 'mine' : '' }, h('span', {}, m.text), h('time', {}, new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))));
        }
        if (!S.players[activePeer]) list.append(h('li', { class: 'dm-empty' }, t('dm_offline', { name: th.name })));
    }
    list.scrollTop = list.scrollHeight;
    byId('dm-input').disabled = !th || !S.players[activePeer];
}

bus.on('dm', m => {
    const peer = m.from === S.myId ? m.to : m.from;
    if (m.from !== S.myId && isBlocked(m.from)) return;
    const th = thread(peer, m.from === S.myId ? m.toName : m.fromName);
    th.msgs.push(m);
    if (th.msgs.length > 200) th.msgs.shift();
    if (m.from !== S.myId) {
        const visible = isWindowOpen('win-dm') && activePeer === peer;
        if (!visible) {
            th.unread++;
            clickableToast(m.text, { title: t('dm_from', { name: m.fromName }), icon: 'send', ttl: 6000 }, () => openDm(peer));
        }
        if (!quiet()) play('message');
        notify(t('dm_from', { name: m.fromName }), m.text, () => openDm(peer));
    }
    setBadge('dm', totalUnread());
    renderDm();
});
bus.on('win', ({ id, open }) => { if (id === 'win-dm' && open) { renderDm(); if (activePeer) { thread(activePeer).unread = 0; setBadge('dm', totalUnread()); } } });
bus.on('players', renderDm);
bus.on('lang', renderDm);

function initDm() {
    byId('dm-form').addEventListener('submit', e => {
        e.preventDefault();
        const input = byId('dm-input');
        const text = input.value.trim();
        if (!text || !activePeer) return;
        send('dm', { to: activePeer, text }, res => {
            if (res && res.ok) { input.value = ''; return; }
            toast(res && res.error === 'not-found' ? t('dm_offline', { name: thread(activePeer).name }) : res && res.error === 'muted' ? t('chat_muted') : t('err_rate-limit'), { type: 'warn' });
        });
    });
    byId('dm-input').addEventListener('keydown', e => e.stopPropagation());
}

// ----------------------------------------------------------------- typing

let typingSent = false, typingTimer = null;
function setTyping(on) {
    clearTimeout(typingTimer);
    if (on) typingTimer = setTimeout(() => setTyping(false), 4000);
    if (on === typingSent) return;
    typingSent = on;
    send('typing', { on });
}

bus.on('typing', ({ id, on }) => {
    const p = S.players[id];
    if (!p || isBlocked(id)) return;
    p.typing = on ? performance.now() + 6000 : 0;
    redraw();
});
bus.on('chat', m => { const p = S.players[m.id]; if (p) p.typing = 0; });

// ----------------------------------------------------- announcements, moderation

let announceTimer = null;
bus.on('announce', ({ text }) => {
    const box = byId('announce');
    box.replaceChildren(h('span', { class: 'ann-icon', html: icon('megaphone') }), h('div', {}, h('b', {}, t('announcement')), h('p', {}, text)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': t('close'), html: icon('x'), onClick: () => { box.hidden = true; } }));
    box.hidden = false;
    box.classList.remove('in'); void box.offsetWidth; box.classList.add('in');
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { box.hidden = true; }, 12000);
    play('message');
    bus.emit('chat:system', `📣 ${text}`);
    notify(t('announcement'), text);
});

bus.on('moderation', d => {
    if (d.type === 'chat-muted') {
        const until = new Date(d.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        toast(t('chat_muted_until', { time: until }), { type: 'warn', icon: 'slash', ttl: 6000 });
    } else if (d.type === 'chat-unmuted') toast(t('chat_unmuted'), { type: 'success' });
    else if (d.type === 'room-kick') toast(t('room_kicked', { name: d.roomName || '' }), { type: 'warn', icon: 'home', ttl: 6000 });
});

// ------------------------------------------------------------------ init

export function initSocial() {
    initDm();
    const input = byId('chat-input');
    input.addEventListener('input', () => setTyping(input.value.trim().length > 0));
    input.addEventListener('blur', () => setTyping(false));
    byId('chatbar').addEventListener('submit', () => setTyping(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && cardId && !isTyping()) closeCard(); });
    bus.on('lang', () => { if (cardId) renderCard(); });
    updateDock();
}

export const typingNow = p => p.typing && p.typing > performance.now();
