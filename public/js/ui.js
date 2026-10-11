// HUD building blocks: toasts, modals, windows, dock, status chips, scoreboard, banners.
import { S, C, W, bus, me, redraw } from './state.js';
import { t } from './i18n.js';
import { h, byId, $, $$, clear, isTyping } from './dom.js';
import { icon, hydrateIcons } from './icons.js';
import { play } from './sfx.js';
import { spawnConfetti } from './render.js';
import { avatarEl } from './avatar.js';

// ------------------------------------------------------------------ toasts

export function toast(text, { type = 'info', title = '', ttl = 3800, icon: ic } = {}) {
    const box = byId('toasts');
    const glyph = ic || (type === 'error' ? 'alert' : type === 'success' ? 'check' : type === 'warn' ? 'alert' : 'info');
    const el = h('div', { class: `toast glass glass-strong ${type}`, role: 'status' },
        h('div', { class: 'ti', html: icon(glyph) }),
        h('div', {}, title ? h('b', {}, title) : null, h('span', { class: 'd' }, text)));
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ttl);
    return el;
}

export function errorToast(code) {
    const key = 'err_' + code;
    const msg = t(key);
    toast(msg === key ? t('err_server-error') : msg, { type: 'error' });
    play('error');
}

// ------------------------------------------------------------------ modals

let openModalId = null;
let modalOnClose = null;

export function openModal(id, { dismissible = true, onClose = null } = {}) {
    if (openModalId) closeModal();
    const el = byId(id), layer = byId('modal-layer');
    layer.hidden = false; el.hidden = false;
    layer.dataset.dismissible = dismissible ? '1' : '';
    openModalId = id; modalOnClose = onClose;
    S.modalOpen = true;
    requestAnimationFrame(() => {
        const first = el.querySelector('input:not([type=checkbox]):not([type=range]), select, button.btn-primary');
        if (first) first.focus({ preventScroll: true });
    });
}

export function closeModal() {
    if (!openModalId) return;
    byId(openModalId).hidden = true;
    byId('modal-layer').hidden = true;
    const cb = modalOnClose;
    openModalId = null; modalOnClose = null;
    S.modalOpen = false;
    byId('gameCanvas').focus({ preventScroll: true });
    if (cb) cb();
}

export const currentModal = () => openModalId;

export function initModals() {
    byId('modal-layer').addEventListener('pointerdown', e => {
        if (e.target === e.currentTarget && e.currentTarget.dataset.dismissible) closeModal();
    });
    $$('[data-modal-close]').forEach(b => b.addEventListener('click', closeModal));
}

// ----------------------------------------------------------------- windows

const parkable = new Set(['win-music']);
const Z_MIN = 5, Z_MAX = 9;   // windows live below the HUD (z-index 10) so popovers stay on top
let zTop = Z_MIN;
const savedSize = {};

function raise(win) {
    const all = $$('.win').filter(w => w !== win).sort((a, b) => (+a.style.zIndex || 0) - (+b.style.zIndex || 0));
    all.push(win);
    all.forEach((w, i) => { w.style.zIndex = Math.min(Z_MIN + i, Z_MAX); });
}

export function attachWindow(win) {
    const bar = $('.win-bar', win);
    win.addEventListener('pointerdown', () => raise(win), true);
    let drag = null;
    bar.addEventListener('pointerdown', e => {
        if (e.target.closest('button') || window.matchMedia('(max-width: 820px)').matches) return;
        const r = win.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
        bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', e => {
        if (!drag || e.pointerId !== drag.id) return;
        const x = Math.min(Math.max(e.clientX - drag.dx, 8 - win.offsetWidth + 80), window.innerWidth - 80);
        const y = Math.min(Math.max(e.clientY - drag.dy, 8), window.innerHeight - 60);
        win.style.left = x + 'px'; win.style.top = y + 'px'; win.style.right = 'auto'; win.style.bottom = 'auto';
    });
    const end = () => { drag = null; };
    bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    $$('[data-act="close"]', win).forEach(b => b.addEventListener('click', () => hideWindow(win.id)));
    $$('[data-act="zoom"]', win).forEach(b => b.addEventListener('click', () => toggleWindowZoom(win)));
    raise(win);
}

export function initWindows() {
    $$('.win').forEach(win => {
        if (parkable.has(win.id)) { win.hidden = false; win.classList.add('is-parked'); }
        attachWindow(win);
    });
}

function toggleWindowZoom(win) {
    if (savedSize[win.id]) {
        Object.assign(win.style, savedSize[win.id]);
        delete savedSize[win.id];
    } else {
        savedSize[win.id] = { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
        const w = Math.min(window.innerWidth - 40, 1100), hh = Math.min(window.innerHeight - 120, 760);
        Object.assign(win.style, { left: (window.innerWidth - w) / 2 + 'px', top: '56px', width: w + 'px', height: hh + 'px', right: 'auto', bottom: 'auto' });
    }
    bus.emit('win-resize', win.id);
}

export function isWindowOpen(id) {
    const win = byId(id);
    return parkable.has(id) ? !win.classList.contains('is-parked') : !win.hidden;
}

export function showWindow(id) {
    const win = byId(id);
    if (parkable.has(id)) win.classList.remove('is-parked'); else win.hidden = false;
    raise(win);
    bus.emit('win', { id, open: true });
}

export function hideWindow(id) {
    const win = byId(id);
    // a focused field inside a hidden window would swallow every keyboard shortcut
    if (win.contains(document.activeElement)) document.activeElement.blur();
    if (win.dataset.dynamic) { win.remove(); bus.emit('win', { id, open: false }); return; }
    if (parkable.has(id)) win.classList.add('is-parked'); else win.hidden = true;
    bus.emit('win', { id, open: false });
    if (!isTyping()) byId('gameCanvas').focus({ preventScroll: true });
}

export function toggleWindow(id) {
    isWindowOpen(id) ? hideWindow(id) : showWindow(id);
}

// -------------------------------------------------------------------- dock

const DOCK = [
    { id: 'mic', group: 'base', action: 'mic' },
    { id: 'camera', group: 'base', action: 'camera' },
    'div',
    { id: 'chat', group: 'comms', action: 'chat' },
    { id: 'emoji', group: 'comms', action: 'emoji' },
    { id: 'dm', group: 'comms', action: 'dm' },
    { id: 'gallery', group: 'gallery', action: 'gallery' },
    'div:tools',
    { id: 'hand', group: 'tools', action: 'hand' },
    { id: 'roomtools', group: 'tools', action: 'roomtools' },
    { id: 'board', group: 'room', action: 'board' },
    { id: 'notes', group: 'room', action: 'notes' },
    { id: 'music', group: 'room', action: 'music' },
    { id: 'share', group: 'share', action: 'share' },
    'div:stadium',
    { id: 'kick', group: 'stadium', action: 'kick' }
];
const dockEls = {};
const badges = { chat: 0, dm: 0 };

export function buildDock() {
    const dock = byId('dock');
    clear(dock);
    const groups = {};
    for (const item of DOCK) {
        if (typeof item === 'string') {
            const [, g] = item.split(':');
            const d = h('span', { class: 'div' });
            if (g) { d.dataset.group = g; dockEls['div:' + g] = d; }
            dock.appendChild(d);
            continue;
        }
        const btn = h('button', { class: 'dock-btn', type: 'button', id: 'dock-' + item.id, 'aria-label': item.id });
        btn.addEventListener('click', () => bus.emit('action', item.action));
        // keep focus on the canvas so WASD still works after clicking
        btn.addEventListener('pointerup', () => { if (!isTyping()) btn.blur(); });
        dockEls[item.id] = btn;
        if (!groups[item.group]) { groups[item.group] = h('div', { class: 'group', dataset: { group: item.group } }); dock.appendChild(groups[item.group]); }
        groups[item.group].appendChild(btn);
    }
    // push-to-talk on touch screens: hold the microphone button
    const mic = dockEls.mic;
    mic.addEventListener('pointerdown', () => { if (S.settings.ptt && S.micState === 'on' && !S.muted) bus.emit('ptt', true); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) mic.addEventListener(ev, () => { if (S.pttDown) bus.emit('ptt', false); });
    updateDock();
}

function setBtn(id, { icon: ic, tip, cls = '' }) {
    const el = dockEls[id];
    if (!el) return;
    el.className = 'dock-btn ' + cls;
    el.dataset.tip = tip;
    el.setAttribute('aria-label', tip);
    const n = badges[id] || 0;
    el.innerHTML = icon(ic) + (n > 0 ? `<span class="badge">${Math.min(n, 9)}</span>` : '');
}

export function updateDock() {
    const micLive = S.micState === 'on' && !S.muted;
    const ptt = S.settings.ptt && micLive;
    setBtn('mic', {
        icon: micLive ? 'mic' : 'mic-off',
        tip: S.micState === 'on' ? (ptt ? t('dock_ptt') : t(S.muted ? 'dock_mic_off' : 'dock_mic_on')) : t('dock_mic_denied'),
        cls: micLive ? (ptt ? (S.pttDown ? 'is-on is-green' : 'is-ptt') : '') : (S.micState === 'on' ? 'is-off' : 'is-warn')
    });
    setBtn('camera', { icon: S.camStream ? 'video' : 'video-off', tip: t(S.camStream ? 'dock_cam_on' : 'dock_cam_off'), cls: S.camStream ? 'is-on is-green' : '' });
    setBtn('chat', { icon: 'chat', tip: t('dock_chat'), cls: !byId('chatbar').hidden ? 'is-on' : '' });
    setBtn('emoji', { icon: 'smile', tip: t('dock_emoji'), cls: !byId('emoji-picker').hidden ? 'is-on' : '' });
    setBtn('dm', { icon: 'send', tip: t('dock_dm'), cls: isWindowOpen('win-dm') ? 'is-on' : '' });
    setBtn('gallery', { icon: 'grid', tip: t('dock_gallery'), cls: isWindowOpen('win-gallery') ? 'is-on' : '' });
    const handUp = S.room.hands.some(x => x.id === S.myId);
    setBtn('hand', { icon: 'hand', tip: t(handUp ? 'dock_hand_down' : 'dock_hand_up'), cls: handUp ? 'is-on is-amber' : '' });
    setBtn('roomtools', { icon: 'poll', tip: t('dock_roomtools'), cls: isWindowOpen('win-room') ? 'is-on' : '' });
    setBtn('board', { icon: 'pen', tip: t('dock_board'), cls: isWindowOpen('win-board') ? 'is-on' : '' });
    setBtn('notes', { icon: 'note', tip: t('dock_notes'), cls: isWindowOpen('win-notes') ? 'is-on' : '' });
    setBtn('music', { icon: 'music', tip: t('dock_music'), cls: isWindowOpen('win-music') ? 'is-on' : '' });
    setBtn('share', { icon: S.screenStream ? 'monitor-off' : 'monitor', tip: t(S.screenStream ? 'dock_share_stop' : 'dock_share'), cls: S.screenStream ? 'is-off' : '' });
    setBtn('kick', { icon: 'ball', tip: t('dock_kick'), cls: '' });

    const room = S.currentRoomId ? S.rooms[S.currentRoomId] : null;
    const inRoom = !!room && !room.builtin, inStadium = S.currentRoomId === C.STADIUM_ID;
    const inAuditorium = S.currentRoomId === C.AUDITORIUM_ID;
    const onStage = inAuditorium && me() && W.onStage(me().x, me().y);
    const cams = Object.keys(S.videos).length > 0;
    toggleGroup('room', inRoom);
    toggleGroup('tools', !!room && !inStadium);
    toggleGroup('share', inRoom || onStage || !!S.screenStream);
    toggleGroup('stadium', inStadium);
    toggleGroup('gallery', cams || isWindowOpen('win-gallery'));
    if (dockEls['div:tools']) dockEls['div:tools'].hidden = !room || inStadium;
    if (dockEls['div:stadium']) dockEls['div:stadium'].hidden = !inStadium;
}

/** Microphone level meter on the dock button (0..1). */
export function updateMicMeter(level) {
    const el = dockEls.mic;
    if (el) el.style.setProperty('--lvl', level.toFixed(2));
}

function toggleGroup(name, show) {
    const g = byId('dock').querySelector(`.group[data-group="${name}"]`);
    if (!g) return;
    const was = !g.classList.contains('is-hidden');
    g.classList.toggle('is-hidden', !show);
    if (show && !was) { g.classList.remove('pop'); void g.offsetWidth; g.classList.add('pop'); }
}

export function setBadge(id, n) { badges[id] = n; updateDock(); }
export const getBadge = id => badges[id] || 0;

export function setUnread(n) { setBadge('chat', n); }
export const getUnread = () => getBadge('chat');

// ---------------------------------------------------- status / zone / hint

let avatarKey = '';
export function updateStatus() {
    const p = me();
    if (p) {
        byId('status-name').textContent = p.nickname;
        const key = `${p.avatar}|${p.status}`;
        if (key !== avatarKey) { avatarKey = key; byId('status-avatar').replaceChildren(avatarEl(p.avatar, { size: 26, status: p.status })); }
    }
    byId('status-online').textContent = Object.keys(S.players).length;
    updateNet();
}

/** Connection quality from the transport round trip time. */
export function updateNet() {
    const dot = byId('status-dot'), label = byId('net-rtt');
    const rtt = S.rtt;
    let cls = '';
    if (!S.connected) cls = ' wait';
    else if (rtt !== null && rtt > 400) cls = ' off';
    else if (rtt !== null && rtt > 150) cls = ' slow';
    dot.className = 'dot' + cls;
    label.textContent = S.connected && rtt !== null ? `${rtt} ms` : '';
    byId('net-chip').title = S.connected ? t('net_quality', { ms: rtt === null ? '…' : rtt }) : t('reconnecting');
}

function hintNodes(key, kbdText) {
    const parts = t(key, { key: '\u0000' }).split('\u0000');
    return [parts[0], h('kbd', {}, kbdText), parts[1] || ''];
}

export function updateZone() {
    const chip = byId('zone-chip'), zi = byId('zone-icon'), zt = byId('zone-text');
    const room = S.currentRoomId ? S.rooms[S.currentRoomId] : null;
    chip.classList.remove('is-room', 'is-locked');
    let ic = 'mic', text = t('zone_public');
    if (room && room.type === 'stadium') { ic = 'ball'; text = t('zone_stadium'); chip.classList.add('is-room'); }
    else if (room && room.type === 'auditorium') {
        const stage = W.onStage(me().x, me().y);
        ic = stage ? 'megaphone' : 'users'; text = t(stage ? 'zone_stage' : 'zone_audience'); chip.classList.add('is-room');
    }
    else if (room) { ic = room.hasPassword ? 'lock' : 'users'; text = t('zone_room', { name: room.name }); chip.classList.add('is-room'); }
    zi.innerHTML = icon(ic);
    zt.textContent = text;

    const hint = byId('hint');
    if (S.currentSlotId) { hint.hidden = false; hint.replaceChildren(...hintNodes('hint_build', 'E')); }
    else if (S.currentRoomId === C.STADIUM_ID) { hint.hidden = false; hint.replaceChildren(...hintNodes('hint_kick', 'Space')); }
    else hint.hidden = true;

    const sb = byId('scoreboard');
    sb.hidden = S.currentRoomId !== C.STADIUM_ID;
    updateScore(false);
    updateDock();
}

let lastScore = '0:0';
export function updateScore(animate = true) {
    byId('score-blue').textContent = S.score.blue;
    byId('score-red').textContent = S.score.red;
    const key = `${S.score.blue}:${S.score.red}`;
    if (animate && key !== lastScore) {
        const sb = byId('scoreboard');
        sb.classList.remove('bump'); void sb.offsetWidth; sb.classList.add('bump');
    }
    lastScore = key;
}

export function celebrateGoal(g) {
    const team = t(g.team === 'blue' ? 'goal_team_blue' : 'goal_team_red');
    const sub = g.scorer ? t('goal_by', { name: g.scorer, team }) : t('goal_plain', { team });
    const f = W.STADIUM;
    spawnConfetti(f.x + (g.team === 'blue' ? f.w : 0), f.y + f.h / 2);
    spawnConfetti(f.x + f.w / 2, f.y + f.h / 2);
    if (S.currentRoomId === C.STADIUM_ID) {
        const banner = byId('goal-banner');
        banner.replaceChildren(h('div', {}, h('b', {}, t('goal')), h('span', {}, sub)));
        banner.firstChild.addEventListener('animationend', () => banner.replaceChildren());
        play('goal');
    } else {
        toast(sub, { title: `⚽ ${t('goal')}`, icon: 'ball', ttl: 3200 });
    }
    redraw();
}

// ------------------------------------------------------------ connection

export function setConnBanner(down) { byId('conn-banner').hidden = !down; updateStatus(); }

export function showKicked(reason, message = '') {
    const map = { afk: 'kicked_afk', full: 'kicked_full', timeout: 'kicked_timeout', 'server-error': 'kicked_error', admin: 'kicked_admin', banned: 'kicked_banned', replaced: 'kicked_replaced' };
    byId('kicked-text').textContent = t(map[reason] || 'kicked_default') + (message ? ` “${message}”` : '');
    byId('reload-btn').hidden = reason === 'banned';
    if (openModalId) closeModal();
    byId('hud').hidden = true;
    byId('kicked').hidden = false;
    S.modalOpen = true;
}

// ----------------------------------------------------------------- AFK

let lastActivity = Date.now();
let afkCountdown = null;
export const touchActivity = () => { if (!afkCountdown) lastActivity = Date.now(); };
export const idleMs = () => Date.now() - lastActivity;

export function initAfk(onTimeout) {
    for (const evt of ['keydown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(evt, touchActivity, { passive: true });
    let lastMove = 0;
    window.addEventListener('pointermove', () => { const n = Date.now(); if (n - lastMove > 1500) { lastMove = n; touchActivity(); } }, { passive: true });
    setInterval(() => {
        if (!S.active || afkCountdown) return;
        if (Date.now() - lastActivity > (S.config ? S.config.afkLimitMs : 1800000)) {
            let left = Math.round((S.config ? S.config.afkGraceMs : 45000) / 1000);
            byId('afk-count').textContent = left;
            openModal('modal-afk', { dismissible: false });
            afkCountdown = setInterval(() => {
                left--;
                byId('afk-count').textContent = left;
                if (left <= 0) { clearInterval(afkCountdown); afkCountdown = null; closeModal(); onTimeout(); }
            }, 1000);
        }
    }, 5000);
    byId('afk-here').addEventListener('click', () => {
        clearInterval(afkCountdown); afkCountdown = null;
        closeModal();
        lastActivity = Date.now();
        bus.emit('heartbeat');
    });
}

function syncWindowClass() {
    const any = $$('.win').some(w => (w.hidden ? false : !w.classList.contains('is-parked')));
    document.body.classList.toggle('win-open', any);
}

export function initHud() {
    hydrateIcons();
    bus.on('win', syncWindowClass);
    buildDock();
    bus.on('lang', () => { buildDock(); updateZone(); });
    bus.on('mic-state', updateDock);
    bus.on('room-tools', updateDock);
    bus.on('rtc:camera', () => setTimeout(updateDock));
    bus.on('rtc:camera-end', () => setTimeout(updateDock));
    bus.on('win', updateDock);
}
