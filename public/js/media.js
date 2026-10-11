// Camera and screen sharing (local capture + remote viewers).
import { S, bus, me, redraw } from './state.js';
import { t } from './i18n.js';
import { h, byId } from './dom.js';
import { icon } from './icons.js';
import { send } from './net.js';
import { closeChannel } from './rtc.js';
import { toast, updateDock, attachWindow } from './ui.js';

/** Tells everybody about my mic / camera / screen state (drives the badges). */
export function syncStatus() {
    const p = me();
    const muted = S.muted || S.micState !== 'on';
    if (p) { p.muted = muted; p.cam = !!S.camStream; p.screen = !!S.screenStream; }
    send('status', { muted, cam: !!S.camStream, screen: !!S.screenStream });
    redraw();
}

// ------------------------------------------------------------------ camera

function setVideo(id, stream, local) {
    let v = S.videos[id];
    if (!v) {
        v = h('video', { playsinline: '', autoplay: '', muted: local ? '' : null });
        v.muted = !!local;
        byId('video-layer').appendChild(v);
        S.videos[id] = v;
    }
    v.srcObject = stream;
    v.play().catch(() => {});
    const p = S.players[id];
    if (p) p.hasVideo = true;
    redraw();
}

function dropVideo(id) {
    const v = S.videos[id];
    if (v) { v.srcObject = null; v.remove(); delete S.videos[id]; }
    const p = S.players[id];
    if (p) p.hasVideo = false;
    redraw();
}

export async function toggleCamera() {
    if (S.camStream) { stopCamera(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast(t('mic_error_https'), { type: 'error' }); return; }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' }, audio: false });
        S.camStream = stream;
        stream.getVideoTracks()[0].addEventListener('ended', stopCamera);
        setVideo(S.myId, stream, true);
        syncStatus();
        updateDock();
    } catch (err) {
        toast(String(err && err.message || err), { type: 'error', icon: 'video-off' });
    }
}

export function stopCamera() {
    if (!S.camStream) return;
    S.camStream.getTracks().forEach(tr => tr.stop());
    S.camStream = null;
    closeChannel('camera');
    dropVideo(S.myId);
    syncStatus();
    updateDock();
}

bus.on('rtc:camera', ({ id, stream }) => setVideo(id, stream, false));
// A new socket id after a reconnect: re-attach my own camera preview to the new id.
bus.on('rejoined', () => {
    Object.keys(S.videos).forEach(id => { if (!S.players[id]) dropVideo(id); });
    if (S.camStream) setVideo(S.myId, S.camStream, true);
});
bus.on('rtc:camera-end', ({ id }) => dropVideo(id));
bus.on('player-left', id => { dropVideo(id); removeScreenWindow(id); });
bus.on('player-status', p => {
    if (!p.cam) dropVideo(p.id);
    if (!p.screen) removeScreenWindow(p.id);
});

// ------------------------------------------------------------ screen share

export async function toggleScreenShare() {
    if (S.screenStream) { stopScreenShare(); return; }
    const room = S.currentRoomId ? S.rooms[S.currentRoomId] : null;
    if (!room || room.builtin) { toast(t('need_room'), { type: 'warn' }); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast(t('mic_error_https'), { type: 'error' }); return; }
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
        S.screenStream = stream;
        stream.getVideoTracks()[0].addEventListener('ended', stopScreenShare);
        syncStatus();
        updateDock();
    } catch (_) { /* user cancelled the picker */ }
}

export function stopScreenShare() {
    if (!S.screenStream) return;
    S.screenStream.getTracks().forEach(tr => tr.stop());
    S.screenStream = null;
    closeChannel('screen');
    syncStatus();
    updateDock();
}

let cascade = 0;
function removeScreenWindow(id) {
    const win = byId('screen-' + id);
    if (win) { const v = win.querySelector('video'); if (v) v.srcObject = null; win.remove(); }
}

bus.on('rtc:screen', ({ id, stream }) => {
    let win = byId('screen-' + id);
    if (!win) {
        const p = S.players[id];
        const name = p ? p.nickname : '…';
        const video = h('video', { autoplay: '', playsinline: '' });
        video.muted = true;
        win = h('section', { class: 'win glass screen-win', id: 'screen-' + id, dataset: { dynamic: '1' } },
            h('header', { class: 'win-bar' },
                h('div', { class: 'traffic' },
                    h('button', { class: 'tl tl-close', type: 'button', 'data-act': 'close', 'aria-label': t('close') }),
                    h('button', { class: 'tl tl-zoom', type: 'button', 'data-act': 'zoom', 'aria-label': t('fullscreen') })),
                h('h2', { html: icon('monitor') }, h('span', {}, t('screen_of', { name })))),
            video);
        const off = (cascade++ % 5) * 28;
        win.style.top = 110 + off + 'px'; win.style.left = 170 + off + 'px';
        byId('win-screens').appendChild(win);
        attachWindow(win);
        win.querySelector('.tl-zoom').addEventListener('dblclick', () => video.requestFullscreen && video.requestFullscreen());
        video.addEventListener('dblclick', () => video.requestFullscreen && video.requestFullscreen());
    }
    const video = win.querySelector('video');
    video.srcObject = stream;
    video.play().catch(() => {});
});
bus.on('rtc:screen-end', ({ id }) => removeScreenWindow(id));

export function shutdownMedia() {
    stopCamera();
    stopScreenShare();
    Object.keys(S.videos).forEach(dropVideo);
    document.querySelectorAll('.screen-win').forEach(w => w.remove());
}
