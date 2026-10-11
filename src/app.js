'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const { loadConfig } = require('./config');
const { createLogger } = require('./log');
const { applySecurityHeaders, RateLimiter } = require('./security');
const { Router, sendJson, HttpError } = require('./http/router');
const { StaticFiles } = require('./http/static');
const { Hub, clientIp } = require('./net/hub');
const { World } = require('./world');
const { createGame } = require('./game');
const { YouTubeService } = require('./youtube');
const { Store } = require('./store');
const { TurnServer } = require('./turn/server');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function listEmojis() {
    const dir = path.join(PUBLIC_DIR, 'emoji');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => /\.(png|gif|jpe?g|webp)$/i.test(f)).sort();
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
    const tlsMaterial = overrides.tls || (cfg.TLS_CERT && cfg.TLS_KEY ? { cert: fs.readFileSync(cfg.TLS_CERT), key: fs.readFileSync(cfg.TLS_KEY) } : null);

    const router = new Router();
    const statics = new StaticFiles([
        { prefix: '/shared', dir: path.join(ROOT, 'shared') },
        { prefix: '/', dir: PUBLIC_DIR }
    ]);

    const handler = async (req, res) => {
        let pathname;
        try { pathname = new URL(req.url, 'http://x').pathname; } catch (_) { res.writeHead(400); res.end(); return; }
        applySecurityHeaders(req, res, { youtube: cfg.YOUTUBE, trustProxy: cfg.TRUST_PROXY });
        try {
            const route = router.match(req.method, pathname);
            if (route) { await route.handler(req, res, route.params); return; }
            if (statics.serve(req, res, pathname)) return;
            sendJson(res, 404, { error: 'not-found' });
        } catch (err) {
            if (err instanceof HttpError) { if (!res.headersSent) sendJson(res, err.status, { error: err.code }); return; }
            log.error('http error', err);
            if (!res.headersSent) sendJson(res, 500, { error: 'server-error' });
            else res.destroy();
        }
    };

    const server = tlsMaterial ? https.createServer(tlsMaterial, handler) : http.createServer(handler);
    // Slow-loris and idle-connection protection.
    server.headersTimeout = 20000;
    server.requestTimeout = 120000;
    server.keepAliveTimeout = 5000;
    server.maxHeadersCount = 64;

    const hub = new Hub(server, {
        path: '/ws',
        trustProxy: cfg.TRUST_PROXY,
        allowedOrigins: cfg.CORS_ORIGINS,
        maxConnsPerIp: cfg.MAX_CONNECTIONS_PER_IP,
        connRatePerMin: Math.max(30, cfg.MAX_CONNECTIONS_PER_IP * 4)
    });
    hub.on('error', err => log.error('realtime handler failed', err));

    const world = new World();
    const youtube = new YouTubeService({ instances: cfg.INVIDIOUS_INSTANCES, fetchImpl: overrides.fetchImpl });
    // ICE servers handed to each player when they join (TURN credentials are per player).
    const iceExtras = [];
    if (cfg.EXTERNAL_STUN) iceExtras.push({ urls: ['stun:stun.l.google.com:19302'] });
    if (cfg.TURN_EXTERNAL) iceExtras.push(cfg.TURN_EXTERNAL);
    const iceProviders = [];
    const iceServersFor = (client, player) => {
        if (cfg.ICE_SERVERS_OVERRIDE) return cfg.ICE_SERVERS_OVERRIDE;
        return [...iceProviders.flatMap(fn => fn(client, player)), ...iceExtras];
    };

    // Built-in STUN/TURN: voice and video work behind NATs and firewalls without any third party.
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

    const game = createGame(hub, { world, youtube, config: cfg, emojiFiles: listEmojis(), limiter: new RateLimiter(), iceServersFor });

    // ------------------------------------------------------------------ routes
    router.get('/healthz', (_req, res) => {
        sendJson(res, 200, { ok: true, players: world.players.size, rooms: world.rooms.size - 1, uptime: Math.round(process.uptime()) });
    });

    router.get('/api/config', (_req, res) => {
        sendJson(res, 200, {
            name: cfg.SERVER_NAME,
            youtube: cfg.YOUTUBE,
            search: cfg.YOUTUBE && cfg.INVIDIOUS_INSTANCES.length > 0,
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

    async function close() {
        game.stop();
        clearInterval(searchSweep);
        hub.close();
        await turnReady;
        if (turn) await turn.close();
        store.flush();
        await new Promise(resolve => {
            server.close(() => resolve());
            if (server.closeAllConnections) server.closeAllConnections();
        });
    }

    return {
        server, hub, io: hub, world, game, router, close, config: cfg, log, store, iceProviders,
        ready: turnReady, get turn() { return turn; }, adminToken
    };
}

module.exports = { createApp };
