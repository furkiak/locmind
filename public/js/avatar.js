// Avatars are either one of the bundled pictures ("usr2.png") or an emoji on a colour ("e:🦊:orange").
import { W } from './state.js';
import { h } from './dom.js';

export const STATUS_COLORS = { available: '#30D158', busy: '#FF453A', away: '#FF9F0A', dnd: '#BF5AF2' };

export function parseAvatar(a) {
    const m = /^e:(.+):(\w+)$/.exec(a || '');
    if (m && W.AVATAR_EMOJIS.includes(m[1]) && W.ROOM_COLORS[m[2]]) return { kind: 'emoji', emoji: m[1], colorName: m[2], color: W.ROOM_COLORS[m[2]] };
    return { kind: 'image', src: '/' + (W.AVATARS.includes(a) ? a : W.AVATARS[0]) };
}

export const emojiAvatar = (emoji, color) => `e:${emoji}:${color}`;

/** Small round avatar for lists, cards and toasts. */
export function avatarEl(a, { size = 30, status = null, cls = '' } = {}) {
    const info = parseAvatar(a);
    const el = h('span', { class: `av ${cls}`, style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * .56) + 'px' } });
    if (info.kind === 'emoji') {
        el.style.background = `radial-gradient(circle at 30% 25%, color-mix(in srgb, ${info.color} 70%, #fff), ${info.color})`;
        el.textContent = info.emoji;
    } else {
        el.append(h('img', { src: info.src, alt: '', draggable: 'false' }));
    }
    if (status && STATUS_COLORS[status]) el.append(h('i', { class: 'av-status', style: { background: STATUS_COLORS[status] }, title: status }));
    return el;
}

/** Paints an emoji avatar into a square canvas (used for the world sprites). */
export function paintEmojiAvatar(g, info, size, font) {
    const r = size / 2;
    const grad = g.createRadialGradient(r * .7, r * .55, r * .1, r, r, r);
    grad.addColorStop(0, mix(info.color, '#ffffff', .35));
    grad.addColorStop(1, info.color);
    g.beginPath(); g.arc(r, r, r - 3, 0, Math.PI * 2); g.fillStyle = grad; g.fill();
    g.font = `${Math.round(size * .52)}px ${font}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(info.emoji, r, r + size * .04);
}

function mix(a, b, k) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
