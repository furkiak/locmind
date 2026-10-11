// Shared room jukebox: the server owns the queue, every listener plays in sync.
// Two sources: the self-hosted library (plain <audio>, no third party) and YouTube (when the operator enables it).
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
    let tab = 'library';
    let tracks = null, libraryLoading = false;
    const frame = document.querySelector('.yt-frame');
    const audio = byId('music-audio');
    const youtubeOn = () => !!(S.server ? S.server.youtube : S.config && S.config.youtube);
    const libraryOn = () => !!(S.server ? S.server.library : S.config && S.config.library);
    const expectedSec = () => Math.max(0, (state.elapsedMs + (performance.now() - state.at)) / 1000);

    // ---------------------------------------------------------- YouTube player
    function ensureYT() {
        if (yt || ytLoading || !youtubeOn()) return;
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
    const ytStop = () => { if (ytReady) { try { yt.stopVideo(); } catch (_) {} } };

    // ---------------------------------------------------------- library player
    audio.volume = S.settings.musicVolume / 100;
    audio.addEventListener('ended', () => { if (playingId !== null) send('music:ended', { songId: playingId }); });
    audio.addEventListener('error', () => { if (playingId !== null && state && state.current && state.current.source === 'library') send('music:ended', { songId: playingId }); });
    const audioStop = () => { audio.pause(); audio.removeAttribute('src'); audio.load(); };

    // ---------------------------------------------------------------- render
    function render() {
        const titleEl = byId('music-title'), list = byId('music-queue');
        const cur = state && state.current;
        titleEl.textContent = cur ? cur.title : t('nothing_playing');
        frame.classList.toggle('is-playing', !!cur && cur.source !== 'library');
        frame.classList.toggle('is-library', !!cur && cur.source === 'library');
        byId('music-eq').hidden = !(cur && cur.source === 'library');
        clear(list);
        const q = state ? state.queue : [];
        if (!q.length) list.appendChild(h('li', { class: 'empty' }, t('queue_empty')));
        q.forEach((item, i) => {
            const rm = h('button', { class: 'icon-btn', type: 'button', title: t('close'), html: icon('x'), onClick: () => send('music:remove', { itemId: item.id }) });
            list.appendChild(h('li', {}, h('span', { class: 'muted' }, String(i + 1)), h('span', { class: 't', title: item.title }, item.title, ' ', h('small', {}, t('added_by', { name: item.addedBy }))), rm));
        });
        renderTabs();
    }

    function renderTabs() {
        const tabs = byId('music-tabs');
        const yton = youtubeOn(), libon = libraryOn();
        if (!libon && tab === 'library') tab = 'youtube';
        if (!yton && tab === 'youtube') tab = 'library';
        tabs.hidden = !(yton && libon);
        tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
        byId('music-library').hidden = tab !== 'library' || !libon;
        byId('music-youtube').hidden = tab !== 'youtube' || !yton;
        byId('upload-btn').hidden = !(S.server && S.server.uploads);
    }

    function renderLibrary() {
        const list = clear(byId('library-list'));
        if (!tracks) { list.append(h('li', { class: 'muted' }, h('span', { class: 'a' }, t('loading')))); return; }
        const q = byId('library-filter').value.trim().toLowerCase();
        const shown = tracks.filter(tr => !q || `${tr.title} ${tr.artist || ''}`.toLowerCase().includes(q));
        if (!shown.length) list.append(h('li', {}, h('span', { class: 'a' }, tracks.length ? t('search_none') : t('library_empty'))));
        for (const tr of shown.slice(0, 200)) {
            list.append(h('li', { onClick: () => add({ trackId: tr.id }) },
                h('span', { class: 'lib-ic', html: icon('music') }),
                h('div', {}, h('div', { class: 't' }, tr.title), h('div', { class: 'a' }, [tr.artist, tr.source === 'upload' && tr.uploadedBy ? t('uploaded_by', { name: tr.uploadedBy }) : null].filter(Boolean).join(' · '))),
                h('span', { class: 'lib-add', html: icon('plus') })));
        }
    }

    async function loadLibrary(force = false) {
        if (!libraryOn() || libraryLoading || (tracks && !force)) { renderLibrary(); return; }
        libraryLoading = true;
        try {
            const res = await fetch('/api/music/library', { headers: { 'X-Locmind-Token': S.resume || '' }, cache: 'no-store' });
            const data = res.ok ? await res.json() : { tracks: [] };
            tracks = data.tracks || [];
            if (S.server) S.server.uploads = !!data.uploads;
        } catch (_) { tracks = tracks || []; }
        libraryLoading = false;
        renderTabs();
        renderLibrary();
    }

    // ------------------------------------------------------------------ sync
    function apply() {
        render();
        if (!state) return;
        const cur = state.current;
        if (!cur) {
            if (playingId !== null) { ytStop(); audioStop(); }
            playingId = null;
            return;
        }
        if (cur.source === 'library') {
            if (playingId !== cur.id) {
                playingId = cur.id;
                ytStop();
                audio.src = `/media/music/${encodeURIComponent(cur.trackId)}`;
                const seek = () => { try { audio.currentTime = expectedSec(); } catch (_) {} };
                audio.addEventListener('loadedmetadata', seek, { once: true });
                audio.play().catch(() => toast(t('music_tap_to_play'), { icon: 'music' }));
            }
            return;
        }
        // YouTube
        ensureYT();
        if (!ytReady) return;
        if (playingId !== cur.id) {
            playingId = cur.id;
            audioStop();
            yt.loadVideoById({ videoId: cur.videoId, startSeconds: expectedSec() });
        }
    }

    function stopAll() {
        state = null; playingId = null;
        ytStop(); audioStop();
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
    bus.on('win', ({ id, open }) => {
        if (id !== 'win-music' || !open) return;
        renderTabs();
        if (tab === 'library') loadLibrary(); else ensureYT();
    });
    bus.on('library:update', () => { tracks = null; if (isWindowOpen('win-music') && tab === 'library') loadLibrary(true); });
    bus.on('world', () => { tracks = null; renderTabs(); });
    bus.on('lang', () => { render(); renderLibrary(); });

    // gentle drift correction so everybody hears the same second
    setInterval(() => {
        if (!state || !state.current || playingId !== state.current.id) return;
        const expected = expectedSec();
        if (state.current.source === 'library') {
            if (!audio.paused && audio.duration && Math.abs(audio.currentTime - expected) > 3 && expected < audio.duration) audio.currentTime = expected;
            return;
        }
        if (!ytReady) return;
        try {
            if (yt.getPlayerState() !== 1) return;
            if (Math.abs(yt.getCurrentTime() - expected) > 4) yt.seekTo(expected, true);
        } catch (_) { /* player not ready */ }
    }, 10000);

    // -------------------------------------------------------------- controls
    const vol = byId('music-volume');
    vol.value = S.settings.musicVolume; setRangeFill(vol);
    vol.addEventListener('input', () => {
        setRangeFill(vol); setSetting('musicVolume', +vol.value);
        audio.volume = +vol.value / 100;
        if (ytReady) yt.setVolume(+vol.value);
    });
    byId('music-skip').addEventListener('click', () => { if (state && state.current) send('music:skip', { songId: state.current.id }); });
    byId('music-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        tab = b.dataset.tab;
        renderTabs();
        if (tab === 'library') loadLibrary(); else ensureYT();
    }));
    byId('library-filter').addEventListener('input', renderLibrary);
    byId('library-filter').addEventListener('keydown', e => e.stopPropagation());

    // ---- uploads
    const upInput = byId('upload-input'), bar = byId('upload-progress');
    upInput.addEventListener('change', () => {
        const file = upInput.files && upInput.files[0];
        upInput.value = '';
        if (!file) return;
        const max = S.server && S.server.uploadMaxBytes;
        if (max && file.size > max) { toast(t('upload_too_big', { mb: Math.round(max / 1048576) }), { type: 'error' }); return; }
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/music/upload');
        xhr.setRequestHeader('X-Locmind-Token', S.resume || '');
        xhr.setRequestHeader('X-Title', encodeURIComponent(file.name.replace(/\.[^.]+$/, '').slice(0, 80)));
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        bar.hidden = false; bar.firstChild.style.width = '0%';
        xhr.upload.onprogress = e => { if (e.lengthComputable) bar.firstChild.style.width = `${Math.round(e.loaded / e.total * 100)}%`; };
        xhr.onloadend = () => {
            bar.hidden = true;
            let res = {};
            try { res = JSON.parse(xhr.responseText || '{}'); } catch (_) { /* not json */ }
            if (xhr.status === 200 && res.ok) {
                toast(t('upload_done', { title: res.track.title }), { type: 'success', icon: 'music' });
                tracks = null; loadLibrary(true);
                add({ trackId: res.track.id });
            } else {
                const key = { 'quota-full': 'upload_quota', 'rate-limit': 'err_rate-limit', 'uploads-disabled': 'upload_disabled', 'too-large': 'upload_too_big', 'not-audio': 'upload_not_audio' }[res.error] || 'upload_failed';
                toast(t(key, { mb: max ? Math.round(max / 1048576) : '' }), { type: 'error' });
            }
        };
        xhr.send(file);
    });

    function add(payload) {
        send('music:add', payload, res => {
            if (res && res.ok) { byId('music-input').value = ''; byId('music-results').hidden = true; return; }
            const err = res && res.error;
            toast(err === 'queue-full' ? t('queue_full') : err === 'invalid-link' ? t('invalid_link') : err === 'youtube-disabled' ? t('youtube_disabled') : t('err_server-error'), { type: 'error' });
        });
    }

    const results = byId('music-results');
    const showResults = list => {
        clear(results);
        results.hidden = false;
        if (!list.length) results.appendChild(h('li', {}, h('span', { class: 'a' }, t('search_none'))));
        list.forEach(r => results.appendChild(h('li', { onClick: () => { add({ videoId: r.videoId }); results.hidden = true; } },
            h('img', { src: `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
            h('div', {}, h('div', { class: 't' }, r.title), h('div', { class: 'a' }, r.author)))));
    };

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
