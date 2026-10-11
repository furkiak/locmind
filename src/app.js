'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');

const config = require('./config');
const { securityHeaders, RateLimiter } = require('./security');
const { World } = require('./world');
const { createGame } = require('./game');
const { YouTubeService } = require('./youtube');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|ico|woff2?)$/i;

function listEmojis() {
    const dir = path.join(PUBLIC_DIR, 'emoji');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => /\.(png|gif|jpe?g|webp)$/i.test(f)).sort();
}

/**
 * Builds the whole application (http + socket.io) without listening,
 * so tests can start it on an ephemeral port.
 */
function createApp(overrides = {}) {
    const cfg = { ...config, ...overrides };
    const app = express();
    app.disable('x-powered-by');
    if (cfg.TRUST_PROXY) app.set('trust proxy', 1);

    const server = http.createServer(app);
    const io = new Server(server, {
        maxHttpBufferSize: 64 * 1024,
        pingInterval: 20000,
        pingTimeout: 20000,
        cors: cfg.CORS_ORIGINS.length ? { origin: cfg.CORS_ORIGINS, methods: ['GET', 'POST'] } : undefined
    });

    const world = new World();
    const youtube = new YouTubeService({ instances: cfg.INVIDIOUS_INSTANCES, fetchImpl: overrides.fetchImpl });
    const limiter = new RateLimiter();
    const game = createGame(io, { world, youtube, config: cfg, emojiFiles: listEmojis(), limiter });

    app.use(securityHeaders);
    app.use(compression());

    app.get('/healthz', (_req, res) => {
        res.json({ ok: true, players: world.players.size, rooms: world.rooms.size - 1, uptime: Math.round(process.uptime()) });
    });

    app.get('/api/config', (_req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({
            iceServers: cfg.ICE_SERVERS,
            search: cfg.INVIDIOUS_INSTANCES.length > 0,
            afkLimitMs: cfg.AFK_LIMIT_MS,
            afkGraceMs: cfg.AFK_GRACE_MS
        });
    });

    const searchLimiter = new RateLimiter();
    const searchSweep = setInterval(() => searchLimiter.sweep(), 60000);
    searchSweep.unref();
    app.get('/api/yt/search', async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
        if (q.length < 2) return res.status(400).json({ error: 'invalid-query' });
        if (!searchLimiter.allow(req.ip, 'search', 8, 30000)) return res.status(429).json({ error: 'rate-limit' });
        try {
            res.json({ results: await youtube.search(q) });
        } catch (_) {
            res.status(503).json({ error: 'search-unavailable' });
        }
    });

    const staticOpts = {
        etag: true,
        setHeaders(res, filePath) {
            res.setHeader('Cache-Control', IMAGE_RE.test(filePath) ? 'public, max-age=86400' : 'no-cache');
        }
    };
    app.use('/shared', express.static(path.join(ROOT, 'shared'), staticOpts));
    app.use(express.static(PUBLIC_DIR, staticOpts));

    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
        console.error(err);
        res.status(500).json({ error: 'server-error' });
    });

    function close() {
        game.stop();
        clearInterval(searchSweep);
        return new Promise(resolve => {
            io.close(() => resolve());
        });
    }

    return { app, server, io, world, close, config: cfg };
}

module.exports = { createApp };
