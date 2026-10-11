// Shared room jukebox: the server owns the queue, every listener plays in sync.
import { S, bus, setSetting } from './state.js';
import { t } from './i18n.js';
import { h, byId, clear, setRangeFill } from './dom.js';
import { icon } from './icons.js';
import { send } from './net.js';
import { toast, isWindowOpen, hideWindow } from './ui.js';

const LINK_RE = /(?:youtube\.com\/|youtu\.be\/)/i;

export function initMusic() {
    let yt = null, ytReady = false, ytLoading = false;
    let state = null;              // last server snapshot { roomId, current, queue, elapsedMs, at }
    let playingId = null, musicRoom = null;
    const frame = document.querySelector('.yt-frame');

    function ensureYT() {
        if (yt || ytLoading) return;
        ytLoading = true;
        const create = () => {
            yt = new window.YT.Player('yt-player', {
                width: '100%', height: '100%',
                playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
                events: {
                    onReady: () => { ytReady = true; yt.setVolume(S.settings.musicVolume); if (state) apply(); },
                    onStateChange: e => {
                        if (e.data === window.YT.PlayerState.ENDED && playingId !== null) send('music:ended', { songId: playingId });
                        if (e.data === window.YT.PlayerState.CUED || e.data === -1) { try { yt.playVideo(); } catch (_) {} }
                    },
                    onError: () => { if (playingId !== null) send('music:ended', { songId: playingId }); }
                }
            });
        };
        if (window.YT && window.YT.Player) create();
        else {
            window.onYouTubeIframeAPIReady = create;
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.onerror = () => { ytLoading = false; };
            document.head.appendChild(tag);
        }
    }

    function render() {
        const titleEl = byId('music-title'), list = byId('music-queue');
        titleEl.textContent = state && state.current ? state.current.title : t('nothing_playing');
        frame.classList.toggle('is-playing', !!(state && state.current));
        clear(list);
        const q = state ? state.queue : [];
        if (!q.length) list.appendChild(h('li', { class: 'empty' }, t('queue_empty')));
        q.forEach((item, i) => {
            const rm = h('button', { class: 'icon-btn', type: 'button', title: t('close'), html: icon('x'), onClick: () => send('music:remove', { itemId: item.id }) });
            list.appendChild(h('li', {}, h('span', { class: 'muted' }, String(i + 1)), h('span', { class: 't', title: item.title }, item.title, ' ', h('small', {}, t('added_by', { name: item.addedBy }))), rm));
        });
    }

    function apply() {
        render();
        if (!state) return;
        if (state.current || isWindowOpen('win-music')) ensureYT();
        if (!ytReady) return;
        if (!state.current) {
            if (playingId !== null) { try { yt.stopVideo(); } catch (_) {} }
            playingId = null;
            return;
        }
        if (playingId !== state.current.id) {
            playingId = state.current.id;
            const start = Math.max(0, (state.elapsedMs + (performance.now() - state.at)) / 1000);
            yt.loadVideoById({ videoId: state.current.videoId, startSeconds: start });
        }
    }

    function stopAll() {
        state = null; playingId = null;
        if (ytReady) { try { yt.stopVideo(); } catch (_) {} }
        render();
    }

    bus.on('room:sync', snap => {
        if (!snap.music) return;
        musicRoom = snap.roomId;
        state = { roomId: snap.roomId, ...snap.music, at: performance.now() };
        apply();
    });
    bus.on('music:update', d => {
        if (d.roomId !== musicRoom) return;
        state = { ...d, at: performance.now() };
        apply();
    });
    bus.on('zone', ({ roomId }) => {
        if (roomId !== musicRoom) { musicRoom = roomId; stopAll(); }
        if (!roomId && isWindowOpen('win-music')) hideWindow('win-music');
    });
    bus.on('win', ({ id, open }) => { if (id === 'win-music' && open) ensureYT(); });
    bus.on('lang', render);

    // gentle drift correction so everybody hears the same second
    setInterval(() => {
        if (!ytReady || !state || !state.current || playingId !== state.current.id) return;
        try {
            if (yt.getPlayerState() !== 1) return;
            const expected = (state.elapsedMs + (performance.now() - state.at)) / 1000;
            if (Math.abs(yt.getCurrentTime() - expected) > 4) yt.seekTo(expected, true);
        } catch (_) { /* player not ready */ }
    }, 15000);

    // ---- controls
    const vol = byId('music-volume');
    vol.value = S.settings.musicVolume; setRangeFill(vol);
    vol.addEventListener('input', () => { setRangeFill(vol); setSetting('musicVolume', +vol.value); if (ytReady) yt.setVolume(+vol.value); });
    byId('music-skip').addEventListener('click', () => { if (state && state.current) send('music:skip', { songId: state.current.id }); });

    const results = byId('music-results');
    const showResults = list => {
        clear(results);
        results.hidden = false;
        if (!list.length) results.appendChild(h('li', {}, h('span', { class: 'a' }, t('search_none'))));
        list.forEach(r => results.appendChild(h('li', { onClick: () => { add({ videoId: r.videoId }); results.hidden = true; } },
            h('img', { src: `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
            h('div', {}, h('div', { class: 't' }, r.title), h('div', { class: 'a' }, r.author)))));
    };

    function add(payload) {
        send('music:add', payload, res => {
            if (res && res.ok) { byId('music-input').value = ''; return; }
            const err = res && res.error;
            toast(err === 'queue-full' ? t('queue_full') : err === 'invalid-link' ? t('invalid_link') : t('err_server-error'), { type: 'error' });
        });
    }

    byId('music-form').addEventListener('submit', async e => {
        e.preventDefault();
        const input = byId('music-input'), q = input.value.trim();
        if (!q) return;
        results.hidden = true;
        if (LINK_RE.test(q) || /^[\w-]{11}$/.test(q)) { add({ input: q }); return; }
        try {
            const res = await fetch('/api/yt/search?q=' + encodeURIComponent(q));
            if (!res.ok) throw new Error('search');
            showResults((await res.json()).results || []);
        } catch (_) {
            toast(t('search_failed'), { type: 'warn' });
        }
    });
    render();
}
