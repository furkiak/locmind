// Locmind client entry point: wires the modules together and runs the join flow.
import { S, W, bus, me, setSetting } from './state.js';
import { initI18n, t, applyI18n } from './i18n.js';
import { byId } from './dom.js';
import { hydrateIcons } from './icons.js';
import { initAudio, startMic, toggleMute, updateSpatial, updateSpeaking, isSpeaking, shutdownAudio, hasVoice, setPushToTalk, micLevel } from './audio.js';
import { initNet, joinWorld, send } from './net.js';
import { updateLinks, closeAllLinks, linkedIds, linkStats } from './rtc.js';
import { initInput } from './input.js';
import { startRender, preloadAvatars } from './render.js';
import {
    toast, errorToast, initModals, openModal, closeModal, currentModal, initWindows, hideWindow, toggleWindow, isWindowOpen,
    initHud, buildDock, updateDock, updateStatus, updateZone, updateScore, celebrateGoal, setConnBanner, showKicked, initAfk, idleMs, touchActivity,
    updateNet, updateMicMeter
} from './ui.js';
import { initSocial, openDm } from './social.js';
import { initRoomTools, toggleHand, toggleRoomTools } from './roomtools.js';
import { updatePeople, toggleRooms, toggleEmoji, openChat, closeChat, toggleChatLog, initChat } from './panels.js';
import { toggleCamera, toggleScreenShare, syncStatus, shutdownMedia } from './media.js';
import { initWhiteboard } from './whiteboard.js';
import { initNotes } from './notes.js';
import { initMusic } from './music.js';
import { initSettings, openSettings } from './settings.js';
import { buildAvatarMaker, initProfile, toggleProfile } from './profile.js';
import { kick, refreshZone, input, walkTo } from './movement.js';
import { play } from './sfx.js';

window.__locmind = { S, bus, linkedIds, linkStats, hasVoice, input, walkTo };   // handy for debugging and the end-to-end tests

// -------------------------------------------------------------- actions

function needRoom(id) {
    const room = S.currentRoomId ? S.rooms[S.currentRoomId] : null;
    if (!room || room.builtin) { toast(t('need_room'), { type: 'warn' }); return; }
    toggleWindow(id);
}

function openCreateRoom() {
    if (!S.currentSlotId) return;
    byId('room-name').value = ''; byId('room-pass').value = '';
    openModal('modal-create');
}

function closeTransient() {
    let closed = false;
    if (!byId('chatbar').hidden) { closeChat(); closed = true; }
    if (!byId('emoji-picker').hidden) { toggleEmoji(false); closed = true; }
    if (!byId('rooms-panel').hidden) { toggleRooms(false); closed = true; }
    if (!byId('profile-pop').hidden) { toggleProfile(false); closed = true; }
    if (!byId('player-card').hidden) { byId('player-card').hidden = true; closed = true; }
    return closed;
}

const actions = {
    mic: async () => {
        const ok = await toggleMute();
        if (!ok) toast(location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname) ? t('mic_error_https') : t('dock_mic_denied'), { type: 'warn', icon: 'mic-off' });
        syncStatus(); updateDock();
    },
    camera: toggleCamera,
    chat: openChat,
    chatlog: () => toggleChatLog(),
    emoji: () => toggleEmoji(),
    interact: openCreateRoom,
    board: () => needRoom('win-board'),
    notes: () => needRoom('win-notes'),
    music: () => needRoom('win-music'),
    share: toggleScreenShare,
    kick,
    rooms: () => toggleRooms(),
    settings: openSettings,
    hand: toggleHand,
    roomtools: toggleRoomTools,
    profile: () => toggleProfile(),
    gallery: () => toggleWindow('win-gallery'),
    dm: () => (isWindowOpen('win-dm') ? hideWindow('win-dm') : openDm(null)),
    escape: () => {
        if (currentModal()) { if (byId('modal-layer').dataset.dismissible) closeModal(); return; }
        if (closeTransient()) return;
    }
};
bus.on('action', name => { const fn = actions[name]; if (fn) fn(); });

// ------------------------------------------------------------ room modals

function initRoomModals() {
    const colors = byId('room-colors');
    let picked = 'blue';
    Object.entries(W.ROOM_COLORS).forEach(([name, hex]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'swatch-btn'; b.style.background = hex; b.dataset.color = name;
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(name === picked)); b.setAttribute('aria-label', name);
        b.addEventListener('click', () => { picked = name; colors.querySelectorAll('.swatch-btn').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
        colors.appendChild(b);
    });

    const create = () => {
        const name = byId('room-name').value.trim();
        if (!name) { byId('room-name').focus(); return; }
        send('room:create', { slotId: S.currentSlotId, name, password: byId('room-pass').value, color: picked }, res => {
            if (res && res.ok) { closeModal(); toast(t('room_created', { name }), { type: 'success', icon: 'home' }); play('unlock'); }
            else errorToast(res && res.error);
        });
    };
    byId('room-create-btn').addEventListener('click', create);
    ['room-name', 'room-pass'].forEach(id => byId(id).addEventListener('keydown', e => { if (e.key === 'Enter') create(); }));

    let gateRoom = null;
    bus.on('gate', roomId => {
        gateRoom = roomId;
        byId('enter-pass').value = ''; byId('pass-error').hidden = true;
        openModal('modal-password', { onClose: () => { gateRoom = null; } });
    });
    const submitPass = () => {
        const password = byId('enter-pass').value;
        if (!password || !gateRoom) return;
        const slotId = gateRoom;
        send('room:password', { slotId, password }, res => {
            if (res && res.ok) {
                S.unlocked.add(slotId);
                closeModal(); refreshZone();
                toast(t('unlocked'), { type: 'success', icon: 'lock' }); play('unlock');
            } else {
                const box = byId('pass-error');
                box.textContent = res && res.error === 'rate-limit' ? t('err_rate-limit') : t('wrong_password');
                box.hidden = false; play('error');
                const modal = byId('modal-password');
                modal.style.animation = 'none'; void modal.offsetWidth; modal.style.animation = 'shake .4s';
                byId('enter-pass').select();
            }
        });
    };
    byId('enter-pass-btn').addEventListener('click', submitPass);
    byId('enter-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submitPass(); });
}

// -------------------------------------------------------------- game flow

function showLoginError(key) {
    const box = byId('login-error');
    box.textContent = t(key); box.hidden = false;
    const card = document.querySelector('#login .login-card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
}

function waitForSocket(ms = 6000) {
    return new Promise(resolve => {
        if (S.socket.connected) return resolve(true);
        const timer = setTimeout(() => resolve(false), ms);
        S.socket.once('connect', () => { clearTimeout(timer); resolve(true); });
    });
}

let selectedAvatar = W.validAvatar(S.settings.avatar) ? S.settings.avatar : 'usr1.png';

const FALLBACK_CONFIG = { iceServers: [], youtube: false, afkLimitMs: 1800000, afkGraceMs: 45000 };
async function loadConfig() {
    try {
        const res = await fetch('/api/config', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        S.config = await res.json();
    } catch (_) { S.config = S.config || { ...FALLBACK_CONFIG }; }
    return S.config;
}

function showServerInfo(cfg) {
    const info = byId('server-info');
    const named = cfg.name && cfg.name !== 'Locmind';
    byId('server-name').textContent = named ? cfg.name : '';
    byId('server-name').hidden = !named;
    byId('server-motd').textContent = cfg.motd || '';
    byId('server-motd').hidden = !cfg.motd;
    info.hidden = !named && !cfg.motd;
    byId('server-pass-field').hidden = !cfg.passwordRequired;
}

const JOIN_ERRORS = { full: 'kicked_full', timeout: 'kicked_timeout', 'server-password': 'wrong_server_password', banned: 'kicked_banned', 'rate-limit': 'err_rate-limit' };

async function enterWorld() {
    const nick = byId('nick').value.trim();
    byId('login-error').hidden = true;
    if (!nick) { showLoginError('nick_required'); byId('nick').focus(); return; }
    if (!byId('tos').checked) { showLoginError('tos_required'); return; }
    const btn = byId('join-btn');
    btn.disabled = true; btn.textContent = t('joining');
    const restore = () => { btn.disabled = false; btn.textContent = t('join'); };

    initAudio();   // must happen inside the click handler
    showServerInfo(await loadConfig());
    S.serverPassword = byId('server-pass').value;
    if (S.config.passwordRequired && !S.serverPassword) { showLoginError('server_password_required'); byId('server-pass').focus(); restore(); return; }

    if (!(await waitForSocket())) { showLoginError('kicked_timeout'); restore(); return; }
    const res = await joinWorld(nick, selectedAvatar);
    if (!res.ok) {
        if (res.error === 'server-password') { byId('server-pass-field').hidden = false; byId('server-pass').select(); }
        showLoginError(JOIN_ERRORS[res.error] || 'kicked_error');
        restore();
        return;
    }

    setSetting('nick', nick); setSetting('avatar', selectedAvatar);
    S.active = true;
    byId('login').hidden = true;
    byId('hud').hidden = false;
    hydrateIcons(byId('hud'));
    buildDock(); updateStatus(); updateZone(); updateScore(false);
    byId('gameCanvas').focus();
    toast(t('welcome', { name: me().nickname }), { type: 'success', icon: 'star' });
    touchActivity();

    // microphone is optional: the world works without it
    startMic().then(() => { syncStatus(); updateDock(); });
}

function shutdown() {
    S.active = false;
    shutdownMedia();
    closeAllLinks();
    shutdownAudio();
    if (S.socket) S.socket.disconnect();
}

function initLogin() {
    byId('nick').value = S.settings.nick || '';
    const picker = () => buildAvatarMaker(byId('avatars'), { value: selectedAvatar, onChange: v => { selectedAvatar = v; } });
    picker();
    bus.on('lang', () => { if (!S.active) picker(); });
    loadConfig().then(showServerInfo);

    byId('join-btn').addEventListener('click', enterWorld);
    byId('nick').addEventListener('keydown', e => { if (e.key === 'Enter') enterWorld(); });
    byId('server-pass').addEventListener('keydown', e => { if (e.key === 'Enter') enterWorld(); });
    byId('tos-link').addEventListener('click', e => { e.preventDefault(); openModal('modal-terms'); });
    byId('reload-btn').addEventListener('click', () => location.reload());
    byId('score-reset').addEventListener('click', () => send('score:reset', {}));
    byId('btn-rooms').addEventListener('click', () => toggleRooms());
    byId('hint').addEventListener('click', () => { if (S.currentSlotId) openCreateRoom(); else kick(); });
}

// ------------------------------------------------------------- event wiring

function wireEvents() {
    bus.on('zone', ({ roomId, prev }) => {
        updateZone();
        if (prev && !roomId) { toggleEmoji(false); }
        if (!roomId) ['win-board', 'win-notes', 'win-music'].forEach(id => { if (isWindowOpen(id)) hideWindow(id); });
        if (S.screenStream && roomId !== prev) { import('./media.js').then(m => m.stopScreenShare()); }
        updateDock();
    });
    bus.on('players', updateStatus);
    bus.on('score', () => updateScore(true));
    bus.on('goal', celebrateGoal);
    bus.on('conn', state => setConnBanner(state === 'down'));
    bus.on('rejoined', () => {
        setConnBanner(false);
        toast(t('reconnected'), { type: 'success' });
        syncStatus(); refreshZone(); updateStatus(); updateZone();
    });
    bus.on('kicked', d => { shutdown(); showKicked(d && d.reason, d && d.message); });
    bus.on('lang', () => { applyI18n(); updateStatus(); updateZone(); });
    bus.on('canvas-press', () => { closeTransient(); });
    bus.on('heartbeat', () => send('heartbeat', {}));
    bus.on('profile-open', () => toggleProfile(true));
    bus.on('player-profile', p => { if (p && p.id === S.myId) updateStatus(); });
    bus.on('rtt', updateNet);
    bus.on('ptt', down => {
        if (!S.settings.ptt || S.micState !== 'on' || S.muted) { if (!down) setPushToTalk(false); return; }
        setPushToTalk(down);
        touchActivity();
    });
    bus.on('room-updated', room => { if (room.id === S.currentRoomId) updateZone(); });

    initAfk(() => { shutdown(); showKicked('afk'); });

    // main logic tick: voice links, spatial audio, people panel
    let wasOnStage = false;
    setInterval(() => {
        if (!S.active) return;
        const self = me();
        if (!self) return;
        const now = performance.now();
        updateSpeaking(now);
        if (isSpeaking(S.myId, now)) touchActivity();
        updateLinks(self);
        updateSpatial(self);
        updatePeople();
        updateMicMeter(micLevel());
        const stage = S.currentRoomId === W.C.AUDITORIUM_ID && W.onStage(self.x, self.y);
        if (stage !== wasOnStage) { wasOnStage = stage; updateZone(); }
    }, 150);

    setInterval(() => { if (S.active && S.connected && idleMs() < 60000) send('heartbeat', {}); }, 25000);

    // The dock buttons must not steal keyboard focus from the game.
    byId('dock').addEventListener('mousedown', e => { if (e.target.closest('.dock-btn')) e.preventDefault(); });
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* offline shell is optional */ }));
}

function boot() {
    initI18n();
    hydrateIcons();
    initSettings();
    initModals();
    initWindows();
    initHud();
    initChat();
    initWhiteboard();
    initNotes();
    initMusic();
    initRoomModals();
    initSocial();
    initRoomTools();
    initProfile();
    preloadAvatars();
    initNet();
    initInput(byId('gameCanvas'));
    initLogin();
    wireEvents();
    startRender();
    registerServiceWorker();
}

boot();
