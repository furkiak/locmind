'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const { loadConfig } = require('./config');
const { createLogger } = require('./log');
const { applySecurityHeaders, RateLimiter } = require('./security');
const { Router, sendJson, sendText, readJson, readBody, HttpError } = require('./http/router');
const { StaticFiles, sendFile } = require('./http/static');
const { generateSelfSigned } = require('./http/selfsigned');
const { Hub, clientIp } = require('./net/hub');
const { World } = require('./world');
const { createGame } = require('./game');
const { YouTubeService } = require('./youtube');
const { Store } = require('./store');
const { TurnServer, classifyIp } = require('./turn/server');
const { Bans, Settings } = require('./moderation');
const { Library } = require('./library');
const { Metrics } = require('./metrics');
const { safeEqual } = require('./game/context');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const VERSION = require('../package.json').version;

function listEmojis() {
    const dir = path.join(PUBLIC_DIR, 'emoji');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => /\.(png|gif|jpe?g|webp)$/i.test(f)).sort();
}

function tlsFor(cfg, store, log) {
    if (cfg.TLS_CERT && cfg.TLS_KEY) return { cert: fs.readFileSync(cfg.TLS_CERT), key: fs.readFileSync(cfg.TLS_KEY) };
    if (!cfg.TLS_SELF_SIGNED) return null;
    const dir = path.join(store.dir, 'tls');
    const certFile = path.join(dir, 'cert.pem'), keyFile = path.join(dir, 'key.pem');
    if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const { cert, key } = generateSelfSigned();
        fs.writeFileSync(certFile, cert);
        fs.writeFileSync(keyFile, key, { mode: 0o600 });
        log.info('generated a self-signed certificate', { file: certFile });
    }
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
}

/**
 * Builds the whole application without listening, so tests can start it on an ephemeral port.
 * @param {object} [overrides]  config values (already parsed) that win over everything else
 */
function createApp(overrides = {}, baseConfig = null) {
    const cfg = { ...(baseConfig || loadConfig({ argv: [], env: process.env })), ...overrides };
    const log = overrides.logger || createLogger({ level: cfg.LOG_LEVEL, format: cfg.LOG_FORMAT || undefined });

    const store = overrides.store || new Store(cfg.DATA_DIR, { log });
    const secrets = store.secrets();
    const turnSecret = cfg.TURN_SECRET || secrets.turnSecret;
    const adminToken = cfg.ADMIN_TOKEN || secrets.adminToken;
    const tlsMaterial = overrides.tls || tlsFor(cfg, store, log);
    const bans = new Bans(store);
    const settings = new Settings(store, cfg);
    let library = null;
    try { library = new Library({ mediaDir: cfg.MEDIA_DIR, secret: turnSecret, log }); }
    catch (err) { log.warn(`music library disabled (${err.message})`); }

    const router = new Router();
    const statics = new StaticFiles([
        { prefix: '/shared', dir: path.join(ROOT, 'shared') },
        { prefix: '/', dir: PUBLIC_DIR }
    ]);
    let metrics = null;

    const handler = async (req, res) => {
        let pathname;
        try { pathname = new URL(req.url, 'http://x').pathname; } catch (_) { res.writeHead(400); res.end(); return; }
        if (metrics) res.on('finish', () => metrics.countHttp(res.statusCode));
        applySecurityHeaders(req, res, { youtube: cfg.YOUTUBE, trustProxy: cfg.TRUST_PROXY });
        try {
            const route = router.match(req.method, pathname);
            if (route) { await route.handler(req, res, route.params); return; }
            if (statics.serve(req, res, pathname)) return;
            sendJson(res, 404, { error: 'not-found' });
        } catch (err) {
            if (err instanceof HttpError) {
                if (!req.complete) { res.setHeader('Connection', 'close'); res.on('finish', () => req.destroy()); }   // unread body left behind
                if (!res.headersSent) sendJson(res, err.status, { error: err.code });
                return;
            }
            log.error('http error', err);
            if (!res.headersSent) sendJson(res, 500, { error: 'server-error' });
            else res.destroy();
        }
    };

    const server = tlsMaterial ? https.createServer(tlsMaterial, handler) : http.createServer(handler);
    // Slow-loris and idle-connection protection.
    server.headersTimeout = 20000;
    server.requestTimeout = 300000;
    server.keepAliveTimeout = 5000;
    server.maxHeadersCount = 64;

    const hub = new Hub(server, {
        path: '/ws',
        trustProxy: cfg.TRUST_PROXY,
        allowedOrigins: cfg.CORS_ORIGINS,
        maxConnsPerIp: cfg.MAX_CONNECTIONS_PER_IP,
        connRatePerMin: Math.max(30, cfg.MAX_CONNECTIONS_PER_IP * 4),
        isBanned: ip => bans.isBanned(ip)
    });
    hub.on('error', err => log.error('realtime handler failed', err));

    const world = new World();
    world.loadPermanentRooms(store.read('rooms', []));
    const youtube = new YouTubeService({ instances: cfg.INVIDIOUS_INSTANCES, fetchImpl: overrides.fetchImpl });

    // ---------------------------------------------------------- STUN / TURN
    const iceExtras = [];
    if (cfg.EXTERNAL_STUN) iceExtras.push({ urls: ['stun:stun.l.google.com:19302'] });
    if (cfg.TURN_EXTERNAL) iceExtras.push(cfg.TURN_EXTERNAL);
    const iceProviders = [];
    let turn = null;
    const turnReady = (async () => {
        if (!cfg.TURN) return;
        const t = new TurnServer({
            port: cfg.TURN_PORT, host: cfg.HOST === '::' ? '0.0.0.0' : cfg.HOST, publicIp: cfg.TURN_PUBLIC_IP, secret: turnSecret,
            relayMin: cfg.TURN_RELAY_MIN, relayMax: cfg.TURN_RELAY_MAX, allowPrivatePeers: cfg.TURN_ALLOW_PRIVATE_PEERS,
            maxAllocationsPerIp: cfg.TURN_MAX_ALLOCATIONS_PER_IP, bandwidthBps: cfg.TURN_BANDWIDTH_BPS, log,
            tlsOptions: tlsMaterial, tlsPort: cfg.TURN_TLS_PORT
        });
        try {
            await t.start();
            turn = t;
            log.info('STUN/TURN relay ready', { port: t.port, tls: t.tls ? t.tlsPort : 'off', relayIp: t.publicIp, relayPorts: `${t.relayMin}-${t.relayMax}` });
            if (!cfg.TURN_PUBLIC_IP && classifyIp(t.publicIp) !== 'public') {
                log.warn(`the relay advertises ${t.publicIp}, which only works inside this network; set TURN_PUBLIC_IP to the server's public address for visitors from the internet`);
            }
        } catch (err) {
            log.warn(`STUN/TURN could not start (${err.message}); voice still works on simple networks`);
        }
    })();
    iceProviders.push((client, player) => {
        if (!turn) return [];
        const host = cfg.TURN_HOST || client.host || turn.publicIp;
        const h = host.includes(':') ? `[${host}]` : host;
        const { username, credential } = turn.credentials(player.id);
        const urls = [`stun:${h}:${turn.port}`, `turn:${h}:${turn.port}?transport=udp`, `turn:${h}:${turn.port}?transport=tcp`];
        if (turn.tls) urls.push(`turns:${h}:${turn.tlsPort}?transport=tcp`);
        return [{ urls, username, credential }];
    });
    const iceServersFor = (client, player) => {
        if (cfg.ICE_SERVERS_OVERRIDE) return cfg.ICE_SERVERS_OVERRIDE;
        return [...iceProviders.flatMap(fn => fn(client, player)), ...iceExtras];
    };

    const game = createGame(hub, {
        world, youtube, config: cfg, cfg, log, store, bans, settings, library,
        emojiFiles: listEmojis(), iceServersFor
    });
    metrics = new Metrics({ hub, world, getTurn: () => turn });

    // ------------------------------------------------------------- helpers
    const playerByToken = req => {
        const token = req.headers['x-locmind-token'];
        if (typeof token !== 'string' || token.length > 64) return null;
        for (const p of world.players.values()) if (p.token === token) return p;
        return null;
    };
    const authLimiter = new RateLimiter();
    const isAdmin = req => {
        const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
        if (!m) return false;
        return safeEqual(m[1], adminToken);
    };
    const ADMIN_FAIL_LIMIT = 20, ADMIN_FAIL_WINDOW = 10 * 60 * 1000;
    const requireAdmin = req => {
        const ip = clientIp(req, cfg.TRUST_PROXY);
        // brute force protection: too many wrong tokens lock the address out for a while, even with the right one
        if (authLimiter.count(ip, 'admin-fail', ADMIN_FAIL_WINDOW) >= ADMIN_FAIL_LIMIT) throw new HttpError(429, 'rate-limit');
        if (isAdmin(req)) return;
        authLimiter.allow(ip, 'admin-fail', ADMIN_FAIL_LIMIT, ADMIN_FAIL_WINDOW);
        throw new HttpError(401, 'unauthorized');
    };
    const sweep = setInterval(() => authLimiter.sweep(10 * 60 * 1000), 60000);
    sweep.unref();

    // -------------------------------------------------------------- public
    router.get('/healthz', (_req, res) => {
        sendJson(res, 200, { ok: true, version: VERSION, players: world.players.size, uptime: Math.round(process.uptime()) });
    });

    router.get('/api/config', (_req, res) => {
        sendJson(res, 200, {
            name: cfg.SERVER_NAME,
            version: VERSION,
            motd: settings.get().motd,
            passwordRequired: !!settings.serverPassword(),
            youtube: cfg.YOUTUBE,
            search: cfg.YOUTUBE && cfg.INVIDIOUS_INSTANCES.length > 0,
            library: !!library,
            uploads: !!library && settings.uploadsAllowed(),
            afkLimitMs: cfg.AFK_LIMIT_MS,
            afkGraceMs: cfg.AFK_GRACE_MS,
            turn: turn ? { port: turn.port, tls: turn.tls ? turn.tlsPort : null } : null
        });
    });

    const searchLimiter = new RateLimiter();
    const searchSweep = setInterval(() => searchLimiter.sweep(), 60000);
    searchSweep.unref();
    router.get('/api/yt/search', async (req, res) => {
        if (!cfg.YOUTUBE) return sendJson(res, 404, { error: 'disabled' });
        const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 100);
        if (q.length < 2) return sendJson(res, 400, { error: 'invalid-query' });
        if (!searchLimiter.allow(clientIp(req, cfg.TRUST_PROXY), 'search', 8, 30000)) return sendJson(res, 429, { error: 'rate-limit' });
        try { sendJson(res, 200, { results: await youtube.search(q) }); }
        catch (_) { sendJson(res, 503, { error: 'search-unavailable' }); }
    });

    // --------------------------------------------------------------- music
    router.get('/api/music/library', (req, res) => {
        if (!library) return sendJson(res, 404, { error: 'disabled' });
        if (!playerByToken(req) && !isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized' });
        sendJson(res, 200, { tracks: library.list(), uploads: settings.uploadsAllowed(), maxBytes: cfg.UPLOAD_MAX_BYTES });
    });

    router.get('/media/music/:id', (req, res, params) => {
        const track = library && library.get(params.id);
        if (!track || !sendFile(req, res, track.file)) sendJson(res, 404, { error: 'not-found' });
    });

    const uploadLimiter = new RateLimiter();
    router.post('/api/music/upload', async (req, res) => {
        if (!library || !settings.uploadsAllowed()) throw new HttpError(403, 'uploads-disabled');
        const p = playerByToken(req);
        if (!p) throw new HttpError(401, 'unauthorized');
        if (!uploadLimiter.allow(p.token, 'upload', 6, 10 * 60 * 1000)) throw new HttpError(429, 'rate-limit');
        const declared = Number(req.headers['content-length']) || 0;
        const room = cfg.UPLOAD_QUOTA_BYTES - library.uploadedBytes();
        if (declared > room || room <= 0) throw new HttpError(507, 'quota-full');
        // a streamed body has no length up front: never read more than the size limit or the free quota
        const body = await readBody(req, Math.min(cfg.UPLOAD_MAX_BYTES, room)).catch(err => {
            throw err instanceof HttpError && err.status === 413 && room < cfg.UPLOAD_MAX_BYTES ? new HttpError(507, 'quota-full') : err;
        });
        if (library.uploadedBytes() + body.length > cfg.UPLOAD_QUOTA_BYTES) throw new HttpError(507, 'quota-full');
        let title = '';
        try { title = decodeURIComponent(String(req.headers['x-title'] || '')); } catch (_) { title = ''; }
        const r = library.saveUpload(body, { title: title || 'Untitled', uploadedBy: p.nickname });
        if (!r.ok) throw new HttpError(415, r.error);
        hub.emit('library:update', { by: p.nickname, title: r.track.title });
        log.info('music uploaded', { by: p.nickname, title: r.track.title, bytes: body.length });
        sendJson(res, 200, { ok: true, track: { id: r.track.id, title: r.track.title } });
    });

    // ------------------------------------------------------------- metrics
    router.get('/metrics', (req, res) => {
        const ip = clientIp(req, false);
        // a request relayed by a local reverse proxy is not a local request
        const local = (ip === '127.0.0.1' || ip === '::1') && !req.headers['x-forwarded-for'] && !req.headers.forwarded;
        if (!cfg.METRICS || (!local && !isAdmin(req))) return sendJson(res, 404, { error: 'not-found' });
        sendText(res, 200, metrics.prometheus(), 'text/plain; version=0.0.4');
    });

    // --------------------------------------------------------------- admin
    const admin = game.admin;
    const body = req => readJson(req, 32 * 1024).then(b => (b && typeof b === 'object' ? b : {}));

    router.post('/api/admin/login', (req, res) => { requireAdmin(req); sendJson(res, 200, { ok: true, name: cfg.SERVER_NAME }); });
    router.get('/api/admin/overview', (req, res) => {
        requireAdmin(req);
        sendJson(res, 200, { name: cfg.SERVER_NAME, version: VERSION, ...metrics.overview(), settings: settings.get(), envPassword: !!cfg.SERVER_PASSWORD, uploadsUsed: library ? library.uploadedBytes() : 0, uploadQuota: cfg.UPLOAD_QUOTA_BYTES });
    });
    router.get('/api/admin/players', (req, res) => { requireAdmin(req); sendJson(res, 200, { players: admin.players() }); });
    router.post('/api/admin/players/:id/kick', async (req, res, { id }) => { requireAdmin(req); const b = await body(req); sendJson(res, 200, { ok: admin.kick(id, b.message) }); });
    router.post('/api/admin/players/:id/ban', async (req, res, { id }) => {
        requireAdmin(req);
        const b = await body(req);
        const ban = admin.ban(id, { minutes: Math.max(0, Number(b.minutes) || 0), reason: b.reason });
        log.warn('player banned', { id, minutes: b.minutes || 'forever' });
        sendJson(res, ban ? 200 : 404, ban ? { ok: true, ban } : { error: 'not-found' });
    });
    router.post('/api/admin/players/:id/mute', async (req, res, { id }) => { requireAdmin(req); const b = await body(req); sendJson(res, 200, { ok: admin.mute(id, Math.max(0, Number(b.minutes) || 0)) }); });
    router.post('/api/admin/announce', async (req, res) => { requireAdmin(req); const b = await body(req); sendJson(res, 200, { ok: admin.announce(b.text) }); });
    router.get('/api/admin/rooms', (req, res) => { requireAdmin(req); sendJson(res, 200, { rooms: admin.rooms() }); });
    router.post('/api/admin/rooms', async (req, res) => { requireAdmin(req); const r = admin.createPermanentRoom(await body(req)); sendJson(res, r.ok ? 200 : 400, r); });
    router.delete('/api/admin/rooms/:id', (req, res, { id }) => { requireAdmin(req); const r = admin.closeRoom(id); sendJson(res, r.ok ? 200 : 404, r); });
    router.get('/api/admin/bans', (req, res) => { requireAdmin(req); sendJson(res, 200, { bans: bans.active() }); });
    router.delete('/api/admin/bans/:id', (req, res, { id }) => { requireAdmin(req); sendJson(res, 200, { ok: bans.remove(id) }); });
    router.put('/api/admin/settings', async (req, res) => { requireAdmin(req); sendJson(res, 200, { ok: true, settings: settings.set(await body(req)) }); });
    router.get('/api/admin/music', (req, res) => { requireAdmin(req); sendJson(res, 200, { tracks: library ? library.list() : [] }); });
    router.delete('/api/admin/music/:id', (req, res, { id }) => { requireAdmin(req); const ok = admin.removeTrack(id); if (ok) hub.emit('library:update', {}); sendJson(res, 200, { ok }); });

    async function close() {
        game.stop();
        metrics.close();
        clearInterval(searchSweep);
        clearInterval(sweep);
        hub.close();
        if (library) library.close();
        await turnReady;
        if (turn) await turn.close();
        store.flush();
        await new Promise(resolve => {
            server.close(() => resolve());
            if (server.closeAllConnections) server.closeAllConnections();
        });
    }

    return {
        server, hub, io: hub, world, game, router, close, config: cfg, log, store, bans, settings, library, metrics, iceProviders,
        ready: turnReady, get turn() { return turn; }, adminToken, adminTokenFromEnv: !!cfg.ADMIN_TOKEN, secretsCreated: secrets.created, version: VERSION, secure: !!tlsMaterial
    };
}

module.exports = { createApp, VERSION };
