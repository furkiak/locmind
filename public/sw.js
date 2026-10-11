// Offline shell for Locmind. Network first (so an update is picked up immediately), the cache only
// answers when the server cannot be reached. Realtime, API and media requests are never cached.
const CACHE = 'locmind-shell-v3';
const SHELL = [
    '/', '/index.html', '/manifest.webmanifest', '/favicon.svg',
    '/css/theme.css', '/css/app.css', '/shared/world.js',
    '/js/main.js', '/js/state.js', '/js/dom.js', '/js/icons.js', '/js/i18n.js', '/js/sfx.js', '/js/audio.js', '/js/rtc.js',
    '/js/net.js', '/js/transport.js', '/js/movement.js', '/js/input.js', '/js/render.js', '/js/ui.js', '/js/panels.js',
    '/js/media.js', '/js/whiteboard.js', '/js/notes.js', '/js/music.js', '/js/settings.js', '/js/theme-init.js',
    '/js/avatar.js', '/js/profile.js', '/js/social.js', '/js/roomtools.js', '/js/path.js',
    '/usr1.png', '/usr2.png', '/usr3.png', '/usr4.png', '/icons/icon-192.png'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => { /* partial cache is fine */ }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k.startsWith('locmind-') && k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

const BYPASS = /^\/(api|ws|media|metrics|healthz|admin)(\/|$)/;

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin || BYPASS.test(url.pathname)) return;
    event.respondWith((async () => {
        try {
            const res = await fetch(req);
            if (res.ok && res.type === 'basic') {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
            }
            return res;
        } catch (err) {
            const hit = await caches.match(req, { ignoreSearch: true });
            if (hit) return hit;
            if (req.mode === 'navigate') { const shell = await caches.match('/'); if (shell) return shell; }
            throw err;
        }
    })());
});
