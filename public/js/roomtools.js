// Room tools: owner settings, raise hand queue, polls and a shared timer (rooms and the auditorium).
import { S, W, C, bus, me, roomIdOf } from './state.js';
import { t } from './i18n.js';
import { h, byId, clear, isTyping } from './dom.js';
import { icon } from './icons.js';
import { send } from './net.js';
import { toast, showWindow, hideWindow, isWindowOpen, toggleWindow, errorToast } from './ui.js';
import { avatarEl } from './avatar.js';
import { play } from './sfx.js';

const myRoom = () => (S.currentRoomId ? S.rooms[S.currentRoomId] : null);
const isOwner = room => !!room && room.owner === S.myId;
const handUp = () => S.room.hands.some(x => x.id === S.myId);

export function toggleHand() {
    const room = myRoom();
    if (!room || room.type === 'stadium') { toast(t('need_room'), { type: 'warn' }); return; }
    send('hand', { up: !handUp() });
    if (!handUp()) play('hand');
}

export function toggleRoomTools() {
    const room = myRoom();
    if (!room || room.type === 'stadium') { toast(t('need_room'), { type: 'warn' }); return; }
    toggleWindow('win-room');
}

function section(title, ...children) {
    return h('section', { class: 'rt-sec' }, h('h3', {}, title), ...children);
}

const fmtTime = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60), hh = Math.floor(m / 60);
    return hh ? `${hh}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
export const timerLeft = () => (S.room.timer ? S.room.timer.remainingMs - (performance.now() - S.room.timer.at) : 0);

// ------------------------------------------------------------------ render

let draft = null;   // unsaved owner form values survive re-renders

function render() {
    if (!isWindowOpen('win-room')) return;
    const body = byId('room-body');
    if (body.contains(document.activeElement) && document.activeElement.matches('input, textarea')) { renderLive(); return; }
    const room = myRoom();
    clear(body);
    if (!room || room.type === 'stadium') { body.append(h('p', { class: 'muted rt-empty' }, t('need_room'))); return; }
    const title = room.builtin ? t('auditorium') : room.name;
    byId('room-win-title').textContent = title;

    // header: who is here, topic
    const people = Object.values(S.players).filter(p => roomIdOf(p) === room.id);
    body.append(h('div', { class: 'rt-head' },
        h('span', { class: 'rt-swatch', style: { background: W.ROOM_COLORS[room.color] || W.ROOM_COLORS.blue } }),
        h('div', {}, h('b', {}, title), h('small', {}, [room.ownerName ? t('rooms_by', { name: room.ownerName }) : room.permanent ? t('rooms_permanent') : t('rooms_builtin'), t('rooms_inside', { n: people.length })].join(' · ')),
            room.topic ? h('p', { class: 'rt-topic' }, room.topic) : null)));

    body.append(handsSection(room), pollSection(room), timerSection(room));
    if (isOwner(room)) body.append(ownerSection(room, people));
}

function handsSection(room) {
    const list = h('ol', { class: 'rt-hands' });
    if (!S.room.hands.length) list.append(h('li', { class: 'muted' }, t('hands_none')));
    S.room.hands.forEach((x, i) => {
        const p = S.players[x.id];
        list.append(h('li', {},
            h('span', { class: 'rt-n' }, String(i + 1)),
            p ? avatarEl(p.avatar, { size: 24 }) : null,
            h('span', { class: 'rt-name' }, x.name),
            h('small', { class: 'muted', dataset: { since: x.at } }, ''),
            isOwner(room) || x.id === S.myId ? h('button', { type: 'button', class: 'icon-btn', title: t('lower_hand'), 'aria-label': t('lower_hand'), html: icon('x'), onClick: () => send('hand', { up: false, target: x.id }) }) : null));
    });
    return section(t('hands'), list,
        h('button', { type: 'button', class: 'btn btn-sm' + (handUp() ? ' btn-primary' : ''), onClick: toggleHand }, h('span', { html: icon('hand') }), handUp() ? t('dock_hand_down') : t('dock_hand_up')));
}

function pollSection(room) {
    const poll = S.room.poll;
    const sec = section(t('poll'));
    if (poll) {
        const max = Math.max(1, ...poll.counts);
        const box = h('div', { class: 'rt-poll' + (poll.closed ? ' is-closed' : '') }, h('b', { class: 'rt-q' }, poll.question));
        poll.options.forEach((opt, i) => {
            const pct = poll.total ? Math.round(poll.counts[i] / poll.total * 100) : 0;
            const b = h('button', { type: 'button', class: 'rt-opt' + (poll.counts[i] === max && poll.total ? ' is-lead' : ''), disabled: poll.closed, onClick: () => send('poll:vote', { pollId: poll.id, option: i }) },
                h('i', { style: { width: pct + '%' } }), h('span', {}, opt), h('small', {}, `${poll.counts[i]} · ${pct}%`));
            box.append(b);
        });
        box.append(h('small', { class: 'muted' }, `${t('poll_votes', { n: poll.total })} · ${t('rooms_by', { name: poll.byName })}${poll.closed ? ' · ' + t('poll_closed') : ''}`));
        if (!poll.closed) box.append(h('button', { type: 'button', class: 'btn btn-sm', onClick: () => send('poll:close', { pollId: poll.id }) }, t('poll_close')));
        sec.append(box);
    }
    if (!poll || poll.closed) sec.append(pollForm());
    return sec;
}

function pollForm() {
    const q = h('input', { class: 'input', maxlength: 120, placeholder: t('poll_question') });
    const opts = h('div', { class: 'rt-opts' });
    const addOpt = (v = '') => {
        if (opts.children.length >= 6) return;
        opts.append(h('input', { class: 'input', maxlength: 60, value: v, placeholder: t('poll_option', { n: opts.children.length + 1 }) }));
    };
    addOpt(t('yes')); addOpt(t('no'));
    const form = h('form', { class: 'rt-form' }, q, opts,
        h('div', { class: 'rt-row' },
            h('button', { type: 'button', class: 'btn btn-sm', onClick: () => addOpt() }, h('span', { html: icon('plus') }), t('poll_add_option')),
            h('button', { type: 'submit', class: 'btn btn-sm btn-primary' }, t('poll_start'))));
    form.addEventListener('submit', e => {
        e.preventDefault();
        const options = Array.from(opts.querySelectorAll('input')).map(i => i.value.trim()).filter(Boolean);
        if (!q.value.trim() || options.length < 2) { toast(t('poll_invalid'), { type: 'warn' }); return; }
        send('poll:create', { question: q.value, options }, res => { if (!res || !res.ok) errorToast(res && res.error); });
    });
    form.addEventListener('keydown', e => e.stopPropagation());
    return form;
}

function timerSection(room) {
    const sec = section(t('timer'));
    const tm = S.room.timer;
    if (tm && timerLeft() > 0) {
        sec.append(h('div', { class: 'rt-timer' },
            h('b', { id: 'rt-timer-left' }, fmtTime(timerLeft())),
            h('span', { class: 'muted' }, [tm.label, t('rooms_by', { name: tm.byName })].filter(Boolean).join(' · ')),
            h('button', { type: 'button', class: 'btn btn-sm', onClick: () => send('timer:stop', {}) }, t('timer_stop'))));
        return sec;
    }
    const label = h('input', { class: 'input', maxlength: 40, placeholder: t('timer_label') });
    const custom = h('input', { class: 'input rt-min', type: 'number', min: 1, max: 240, value: 15, 'aria-label': t('minutes') });
    const start = minutes => send('timer:start', { seconds: Math.round(minutes * 60), label: label.value }, res => { if (!res || !res.ok) errorToast(res && res.error); });
    const presets = h('div', { class: 'rt-row' }, ...[1, 5, 10, 25].map(m => h('button', { type: 'button', class: 'btn btn-sm', onClick: () => start(m) }, t('n_min', { n: m }))));
    const form = h('form', { class: 'rt-form' }, label, presets,
        h('div', { class: 'rt-row' }, custom, h('span', { class: 'muted' }, t('minutes')), h('button', { type: 'submit', class: 'btn btn-sm btn-primary' }, t('timer_start'))));
    form.addEventListener('submit', e => { e.preventDefault(); const m = Number(custom.value); if (m > 0) start(Math.min(240, m)); });
    form.addEventListener('keydown', e => e.stopPropagation());
    sec.append(form);
    return sec;
}

function ownerSection(room, people) {
    if (!draft || draft.id !== room.id) draft = { id: room.id, name: room.name, topic: room.topic || '', color: room.color, password: '' };
    const name = h('input', { class: 'input', maxlength: 20, value: draft.name, 'aria-label': t('room_name') });
    const topic = h('input', { class: 'input', maxlength: 80, value: draft.topic, placeholder: t('topic_ph'), 'aria-label': t('topic') });
    const pass = h('input', { class: 'input', type: 'password', maxlength: 20, autocomplete: 'new-password', placeholder: room.hasPassword ? t('password_keep') : t('password_none'), 'aria-label': t('password') });
    name.addEventListener('input', () => { draft.name = name.value; });
    topic.addEventListener('input', () => { draft.topic = topic.value; });
    const swatches = h('div', { class: 'swatches', role: 'radiogroup' });
    for (const [cname, hex] of Object.entries(W.ROOM_COLORS)) {
        const b = h('button', { type: 'button', class: 'swatch-btn', role: 'radio', 'aria-label': cname, 'aria-checked': String(draft.color === cname), style: { background: hex } });
        b.addEventListener('click', () => { draft.color = cname; swatches.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b))); });
        swatches.append(b);
    }
    const save = patch => send('room:settings', { slotId: room.id, ...patch }, res => {
        if (res && res.ok) { toast(t('room_saved'), { type: 'success' }); draft = null; pass.value = ''; render(); }
        else errorToast(res && res.error);
    });
    const form = h('form', { class: 'rt-form' },
        h('label', { class: 'field' }, h('span', {}, t('room_name')), name),
        h('label', { class: 'field' }, h('span', {}, t('topic')), topic),
        h('div', { class: 'field' }, h('span', {}, t('room_color')), swatches),
        h('label', { class: 'field' }, h('span', {}, t('password')), pass),
        h('div', { class: 'rt-row' },
            room.hasPassword ? h('button', { type: 'button', class: 'btn btn-sm', onClick: () => save({ clearPassword: true }) }, t('password_remove')) : null,
            h('button', { type: 'submit', class: 'btn btn-sm btn-primary' }, t('save'))));
    form.addEventListener('submit', e => {
        e.preventDefault();
        const patch = { name: name.value, topic: topic.value, color: draft.color };
        if (pass.value) patch.password = pass.value;
        save(patch);
    });
    form.addEventListener('keydown', e => e.stopPropagation());

    const members = h('ul', { class: 'rt-members' });
    for (const p of people) {
        if (p.id === S.myId) continue;
        members.append(h('li', {}, avatarEl(p.avatar, { size: 24, status: p.status }), h('span', { class: 'rt-name' }, p.nickname),
            h('button', { type: 'button', class: 'btn btn-sm btn-danger', onClick: () => send('room:kick', { slotId: room.id, target: p.id }, res => {
                if (res && res.ok) toast(t('removed_from_room', { name: p.nickname }), { type: 'success' }); else errorToast(res && res.error);
            }) }, t('remove'))));
    }
    if (!members.children.length) members.append(h('li', { class: 'muted' }, t('room_alone')));
    return section(t('owner_settings'), form, h('h4', {}, t('people_room')), members);
}

/** Cheap updates that must not rebuild forms (countdown, "raised 2 min ago"). */
function renderLive() {
    const el = document.getElementById('rt-timer-left');
    if (el) el.textContent = fmtTime(timerLeft());
}

// ------------------------------------------------------------- timer chip

let lastTimerKey = '';
function tick() {
    const chip = byId('timer-chip');
    const tm = S.room.timer;
    const left = timerLeft();
    if (!tm || !S.currentRoomId) { chip.hidden = true; lastTimerKey = ''; return; }
    chip.hidden = false;
    byId('timer-left').textContent = fmtTime(left);
    byId('timer-label').textContent = tm.label || '';
    chip.classList.toggle('is-done', left <= 0);
    chip.classList.toggle('is-soon', left > 0 && left <= 10000);
    const key = `${tm.totalMs}|${tm.label}|${left <= 0}`;
    if (left <= 0 && lastTimerKey && !lastTimerKey.endsWith('true')) { play('chime'); toast(t('timer_done', { label: tm.label || t('timer') }), { icon: 'clock', type: 'success' }); }
    lastTimerKey = key;
    renderLive();
}

export function initRoomTools() {
    bus.on('room-tools', what => { render(); if (what === 'hands') bus.emit('players'); });
    bus.on('room-updated', room => { if (room.id === S.currentRoomId) { draft = null; render(); } });
    bus.on('zone', ({ roomId }) => {
        if (!roomId || roomId === C.STADIUM_ID) { S.room = { hands: [], poll: null, timer: null }; if (isWindowOpen('win-room')) hideWindow('win-room'); }
        draft = null;
        render();
    });
    bus.on('players', render);
    bus.on('lang', render);
    bus.on('win', ({ id, open }) => { if (id === 'win-room' && open) render(); });
    bus.on('poll-new', poll => {
        if (poll.byName === (me() && me().nickname)) return;
        play('chime');
        const el = toast(poll.question, { title: t('poll_new'), icon: 'poll', ttl: 7000 });
        el.classList.add('clickable');
        el.addEventListener('click', () => { el.remove(); showWindow('win-room'); });
    });
    setInterval(tick, 500);
    byId('timer-chip').addEventListener('click', () => { if (!isTyping()) showWindow('win-room'); });
}
