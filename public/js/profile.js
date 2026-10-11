// Avatar maker (pictures or emoji on a colour) and the "my profile" popover: status, status text, avatar.
import { S, W, bus, me, setSetting, redraw } from './state.js';
import { t } from './i18n.js';
import { h, byId, clear } from './dom.js';
import { send } from './net.js';
import { avatarEl, parseAvatar, emojiAvatar, STATUS_COLORS } from './avatar.js';
import { toast } from './ui.js';

/**
 * Renders the avatar picker into `host`: the bundled pictures, then an emoji grid and colour swatches.
 * Calls onChange(value) whenever the choice changes.
 */
export function buildAvatarMaker(host, { value, onChange }) {
    clear(host);
    let current = value;
    let emoji = '😎', color = 'blue';
    const info = parseAvatar(value);
    if (info.kind === 'emoji') { emoji = info.emoji; color = info.colorName; }

    const pics = h('div', { class: 'avatars', role: 'radiogroup', 'aria-label': t('avatar') });
    const picButtons = W.AVATARS.map(name => {
        const b = h('button', { type: 'button', class: 'avatar', role: 'radio', dataset: { avatar: name }, 'aria-label': name },
            h('img', { src: '/' + name, alt: '', width: 56, height: 56 }));
        b.addEventListener('click', () => choose(name));
        pics.append(b);
        return b;
    });
    const customBtn = h('button', { type: 'button', class: 'avatar avatar-custom', role: 'radio', dataset: { avatar: 'custom' }, 'aria-label': t('avatar_custom') });
    customBtn.addEventListener('click', () => { choose(emojiAvatar(emoji, color)); maker.hidden = false; });
    pics.append(customBtn);

    const faces = h('div', { class: 'maker-faces' });
    const faceButtons = W.AVATAR_EMOJIS.map(e => {
        const b = h('button', { type: 'button', 'aria-label': e }, e);
        b.addEventListener('click', () => { emoji = e; choose(emojiAvatar(emoji, color)); });
        faces.append(b);
        return [e, b];
    });
    const colors = h('div', { class: 'swatches maker-colors', role: 'radiogroup' });
    const colorButtons = Object.entries(W.ROOM_COLORS).map(([name, hex]) => {
        const b = h('button', { type: 'button', class: 'swatch-btn', role: 'radio', 'aria-label': name, style: { background: hex } });
        b.addEventListener('click', () => { color = name; choose(emojiAvatar(emoji, color)); });
        colors.append(b);
        return [name, b];
    });
    const maker = h('div', { class: 'avatar-maker', hidden: info.kind !== 'emoji' }, faces, colors);
    host.append(pics, maker);

    function paint() {
        const custom = current.startsWith('e:');
        picButtons.forEach(b => { const on = b.dataset.avatar === current; b.classList.toggle('is-selected', on); b.setAttribute('aria-checked', String(on)); });
        customBtn.classList.toggle('is-selected', custom);
        customBtn.setAttribute('aria-checked', String(custom));
        clear(customBtn).append(avatarEl(emojiAvatar(emoji, color), { size: 56 }));
        faceButtons.forEach(([e, b]) => b.classList.toggle('is-on', e === emoji));
        colorButtons.forEach(([n, b]) => b.setAttribute('aria-checked', String(n === color)));
        if (!custom) maker.hidden = true;
    }
    function choose(v) { current = v; paint(); onChange(v); }
    paint();
    return { get value() { return current; } };
}

// ------------------------------------------------------------------ profile popover

let open = false;

export function toggleProfile(force) {
    const pop = byId('profile-pop');
    open = force === undefined ? pop.hidden : force;
    pop.hidden = !open;
    if (open) render();
}

function setProfile(patch) {
    send('profile:set', patch, res => {
        if (!res || !res.ok) { toast(t('err_rate-limit'), { type: 'warn' }); return; }
        const p = me();
        if (p) { p.status = res.status; p.statusText = res.statusText; p.avatar = res.avatar; }
        setSetting('status', res.status);
        setSetting('statusText', res.statusText);
        setSetting('avatar', res.avatar);
        bus.emit('player-profile', p);
        bus.emit('players');
        redraw();
        render();
    });
}

function render() {
    const pop = byId('profile-pop');
    if (pop.hidden) return;
    const p = me();
    if (!p) return;
    clear(pop);
    pop.append(h('div', { class: 'pp-head' },
        avatarEl(p.avatar, { size: 46, status: p.status }),
        h('div', {}, h('b', {}, p.nickname), h('small', {}, t('status_' + p.status)))));

    const statuses = h('div', { class: 'pp-status', role: 'radiogroup', 'aria-label': t('status') });
    for (const st of W.STATUSES) {
        const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(st === p.status), class: st === p.status ? 'is-on' : '' },
            h('i', { style: { background: STATUS_COLORS[st] } }), t('status_' + st));
        b.addEventListener('click', () => setProfile({ status: st }));
        statuses.append(b);
    }
    pop.append(statuses);

    const text = h('input', { class: 'input', maxlength: 40, value: p.statusText || '', placeholder: t('status_text_ph'), 'aria-label': t('status_text_ph') });
    const saveText = () => { if (text.value.trim() !== (p.statusText || '')) setProfile({ statusText: text.value }); };
    text.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveText(); text.blur(); } e.stopPropagation(); });
    text.addEventListener('blur', saveText);
    pop.append(text);

    const makerHost = h('div', { class: 'pp-maker' });
    pop.append(h('div', { class: 'pp-label' }, t('avatar')), makerHost);
    let pending = null;
    buildAvatarMaker(makerHost, {
        value: p.avatar,
        onChange: v => { clearTimeout(pending); pending = setTimeout(() => { if (v !== me().avatar) setProfile({ avatar: v }); }, 400); }
    });
}

export function initProfile() {
    byId('statusbar').addEventListener('click', e => { e.stopPropagation(); toggleProfile(); });
    bus.on('canvas-press', () => { if (open) toggleProfile(false); });
    bus.on('lang', render);
}
