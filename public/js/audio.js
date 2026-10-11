// Web Audio graph: microphone -> send stream, remote voices -> (gain, stereo pan) -> master.
import { S, C, bus, roomIdOf } from './state.js';
import { clamp } from './dom.js';
import { initSfx } from './sfx.js';

let ctx = null, master = null, sendDest = null, micGain = null;
let micStream = null, micSource = null, micAnalyser = null, micBuf = null;
const voices = new Map();           // player id -> voice nodes
const speakingUntil = new Map();    // player id -> timestamp
const SPEAK_THRESHOLD = 0.055;
const SPEAK_HOLD_MS = 280;

export const audioContext = () => ctx;
export const sendStream = () => (sendDest ? sendDest.stream : null);

/** Must be called from a user gesture (the "Enter" click) so the context may start. */
export function initAudio() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = S.settings.volume / 100;
    master.connect(ctx.destination);

    sendDest = ctx.createMediaStreamDestination();
    micGain = ctx.createGain();
    micGain.gain.value = 0;
    micGain.connect(sendDest);
    try { // keeps the (silent) outgoing track alive even without a microphone
        const keep = ctx.createConstantSource();
        keep.offset.value = 0;
        keep.connect(sendDest);
        keep.start();
    } catch (_) { /* older Safari */ }

    initSfx(ctx, master);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); });
    return ctx;
}

export function setMasterVolume(pct) {
    if (master) master.gain.setTargetAtTime(clamp(pct, 0, 150) / 100, ctx.currentTime, .02);
}

// --------------------------------------------------------------- microphone

function stopMicNodes() {
    if (micSource) { try { micSource.disconnect(); } catch (_) {} micSource = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    micAnalyser = null;
}

export async function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { S.micState = 'none'; bus.emit('mic-state'); return false; }
    try {
        const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
        if (S.settings.micId) audio.deviceId = { ideal: S.settings.micId };
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        stopMicNodes();
        micStream = stream;
        micSource = ctx.createMediaStreamSource(stream);
        micSource.connect(micGain);
        micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 512;
        micBuf = new Uint8Array(micAnalyser.fftSize);
        micSource.connect(micAnalyser);
        stream.getAudioTracks()[0].addEventListener('ended', () => { S.micState = 'none'; bus.emit('mic-state'); });
        S.micState = 'on';
        applyMute();
        bus.emit('mic-state');
        return true;
    } catch (err) {
        S.micState = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'none';
        applyMute();
        bus.emit('mic-state');
        return false;
    }
}

function applyMute() {
    if (!micGain) return;
    const open = S.micState === 'on' && !S.muted;
    micGain.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, .015);
}

export async function toggleMute() {
    if (S.micState !== 'on') {
        // First press after a denied / missing microphone retries the permission.
        const ok = await startMic();
        if (!ok) return false;
        S.muted = false;
    } else {
        S.muted = !S.muted;
    }
    applyMute();
    bus.emit('mic-state');
    return true;
}

export async function listMics() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (_) { return []; }
}

// ------------------------------------------------------------ remote voices

export function attachVoice(id, stream) {
    if (!ctx) return;
    detachVoice(id);
    // Chrome only pulls remote WebRTC audio when it is attached to a media element.
    const el = new Audio();
    el.srcObject = stream; el.muted = true; el.autoplay = true;
    el.play && el.play().catch(() => {});

    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain(); gain.gain.value = 0;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(analyser);
    src.connect(gain);
    if (panner) { gain.connect(panner); panner.connect(master); } else gain.connect(master);
    voices.set(id, { el, src, gain, panner, analyser, buf: new Uint8Array(analyser.fftSize) });
}

export function detachVoice(id) {
    const v = voices.get(id);
    if (!v) return;
    try { v.src.disconnect(); v.gain.disconnect(); if (v.panner) v.panner.disconnect(); } catch (_) {}
    v.el.srcObject = null;
    voices.delete(id);
    speakingUntil.delete(id);
}

export const hasVoice = id => voices.has(id);

export function userVolume(id) { return S.userVolumes[id] === undefined ? 1 : S.userVolumes[id]; }

/** Distance attenuation + stereo placement for every connected voice. */
export function updateSpatial(self) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [id, v] of voices) {
        const p = S.players[id];
        let vol = 0, pan = 0;
        if (p) {
            const theirRoom = roomIdOf(p), dx = p.x - self.x, dy = p.y - self.y, dist = Math.hypot(dx, dy);
            if (S.currentRoomId || theirRoom) {
                if (S.currentRoomId === theirRoom) { vol = 1; pan = clamp(dx / 700, -1, 1) * .5; }
            } else if (dist < C.HEAR_DISTANCE) {
                vol = Math.pow(1 - dist / C.HEAR_DISTANCE, 1.4);
                pan = clamp(dx / (C.HEAR_DISTANCE * .7), -1, 1) * .9;
            }
        }
        v.gain.gain.setTargetAtTime(vol * userVolume(id), t, .06);
        if (v.panner) v.panner.pan.setTargetAtTime(S.settings.spatial ? pan : 0, t, .08);
    }
}

// ---------------------------------------------------------------- speaking

function level(analyser, buf) {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) { const d = Math.abs(buf[i] - 128); if (d > peak) peak = d; }
    return peak / 128;
}

export function updateSpeaking(now) {
    if (micAnalyser && S.micState === 'on' && !S.muted && level(micAnalyser, micBuf) > SPEAK_THRESHOLD) speakingUntil.set(S.myId, now + SPEAK_HOLD_MS);
    for (const [id, v] of voices) {
        if (level(v.analyser, v.buf) > SPEAK_THRESHOLD && v.gain.gain.value > .02) speakingUntil.set(id, now + SPEAK_HOLD_MS);
    }
}

export const isSpeaking = (id, now = performance.now()) => (speakingUntil.get(id) || 0) > now;
export function anySpeaking(now = performance.now()) {
    for (const until of speakingUntil.values()) if (until > now) return true;
    return false;
}

export function shutdownAudio() {
    for (const id of Array.from(voices.keys())) detachVoice(id);
    stopMicNodes();
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
}
