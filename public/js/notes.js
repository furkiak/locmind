import { S, bus } from './state.js';
import { byId } from './dom.js';
import { send } from './net.js';
import { isWindowOpen, hideWindow } from './ui.js';

export function initNotes() {
    const ta = byId('notes-text'), count = byId('notes-count');
    let rev = 0, dirty = false, timer = null, noteRoom = null;

    const updateCount = () => { count.textContent = `${ta.value.length} / 5000`; };

    function flush() {
        timer = null;
        if (!dirty || !S.currentRoomId) return;
        dirty = false;
        send('note:set', { text: ta.value });
    }
    ta.addEventListener('input', () => {
        dirty = true; updateCount();
        if (!timer) timer = setTimeout(flush, 120);
    });
    ta.addEventListener('blur', flush);

    /** Applies remote text while keeping the local caret where the user expects it. */
    function applyRemote(text) {
        const old = ta.value;
        if (old === text) return;
        let pre = 0;
        const max = Math.min(old.length, text.length);
        while (pre < max && old[pre] === text[pre]) pre++;
        let suf = 0;
        while (suf < max - pre && old[old.length - 1 - suf] === text[text.length - 1 - suf]) suf++;
        const delta = text.length - old.length;
        const map = pos => (pos <= pre ? pos : pos >= old.length - suf ? pos + delta : pre);
        const s = map(ta.selectionStart), e = map(ta.selectionEnd), top = ta.scrollTop;
        ta.value = text;
        if (document.activeElement === ta) ta.setSelectionRange(s, e);
        ta.scrollTop = top;
        updateCount();
    }

    bus.on('room:sync', snap => {
        if (!snap.note) return;
        noteRoom = snap.roomId; rev = snap.note.rev;
        applyRemote(snap.note.text);
    });
    bus.on('note:update', d => {
        if (d.roomId !== noteRoom || d.rev <= rev) return;
        rev = d.rev;
        if (d.by === S.myId || dirty) return;   // my own echo, or I'm mid-edit (my flush wins)
        applyRemote(d.text);
    });
    bus.on('zone', ({ roomId }) => {
        if (roomId !== noteRoom) { noteRoom = roomId; rev = 0; dirty = false; ta.value = ''; updateCount(); }
        if (!roomId && isWindowOpen('win-notes')) hideWindow('win-notes');
    });

    byId('notes-export').addEventListener('click', () => {
        const blob = new Blob([ta.value], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'locmind-notes.txt';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    updateCount();
}
