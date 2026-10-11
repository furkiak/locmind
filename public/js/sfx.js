// Tiny synthesised UI sounds: no audio files, no external requests.
import { S } from './state.js';

let ctx = null, out = null;
export function initSfx(audioContext, destination) { ctx = audioContext; out = destination; }

function tone(freq, start, dur, { type = 'sine', gain = .12, to = null } = {}) {
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.02);
}

const SOUNDS = {
    join: () => { tone(620, 0, .12, { to: 880 }); tone(880, .08, .14, { gain: .08 }); },
    leave: () => { tone(560, 0, .16, { to: 380 }); },
    message: () => { tone(1040, 0, .09, { type: 'triangle', gain: .07 }); },
    pop: () => { tone(480, 0, .08, { to: 760, type: 'triangle', gain: .08 }); },
    error: () => { tone(220, 0, .18, { type: 'sawtooth', gain: .05, to: 170 }); },
    unlock: () => { tone(660, 0, .1); tone(990, .09, .18); },
    chime: () => { tone(784, 0, .22, { gain: .08 }); tone(1175, .12, .4, { gain: .07 }); },
    hand: () => { tone(700, 0, .12, { to: 980, type: 'triangle', gain: .07 }); },
    kick: () => { tone(160, 0, .1, { to: 70, gain: .2 }); },
    goal: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .1, .28, { type: 'triangle', gain: .1 })); tone(1318, .45, .5, { type: 'triangle', gain: .09 }); }
};

export function play(name) {
    if (!ctx || !out || !S.settings.sfx || ctx.state !== 'running') return;
    try { SOUNDS[name] && SOUNDS[name](); } catch (_) { /* audio is best-effort */ }
}
