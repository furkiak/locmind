'use strict';

/*
 * Configuration with this priority: command line flags > environment > config file > defaults.
 *   node server.js --port 8080 --data-dir /var/lib/locmind
 *   PORT=8080 node server.js
 *   node server.js --config ./locmind.json     ({"PORT": 8080, ...})
 * Flags map to the environment names: --turn-port -> TURN_PORT.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    PORT: 3000,
    HOST: '0.0.0.0',
    TRUST_PROXY: false,
    CORS_ORIGIN: '',
    MAX_PLAYERS: 150,
    AFK_LIMIT_MINUTES: 30,
    SERVER_NAME: 'Locmind',
    SERVER_PASSWORD: '',
    ADMIN_TOKEN: '',
    DATA_DIR: './data',
    MEDIA_DIR: './media',
    ALLOW_UPLOADS: true,
    UPLOAD_MAX_MB: 25,
    UPLOAD_QUOTA_MB: 1024,
    YOUTUBE: true,
    INVIDIOUS_INSTANCES: 'https://yewtu.be,https://inv.nadeko.net,https://invidious.nerdvpn.de',
    TURN: true,
    TURN_PORT: 3478,
    TURN_RELAY_PORTS: '49160-49359',
    TURN_PUBLIC_IP: '',
    TURN_SECRET: '',
    TURN_ALLOW_PRIVATE_PEERS: false,
    TURN_MAX_ALLOCATIONS_PER_IP: 10,
    TURN_BANDWIDTH_KBPS: 4000,
    EXTERNAL_STUN: false,
    ICE_SERVERS: '',
    TLS_CERT: '',
    TLS_KEY: '',
    TLS_SELF_SIGNED: false,
    LOG_LEVEL: 'info',
    LOG_FORMAT: '',
    METRICS: true,
    MAX_CONNECTIONS_PER_IP: 16
};

const BOOL = v => v === true || v === 1 || /^(1|true|yes|on)$/i.test(String(v));
const INT = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const LIST = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim()).filter(Boolean);

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        let [k, v] = a.slice(2).split(/=(.*)/s);
        if (v === undefined) { const next = argv[i + 1]; if (next !== undefined && !next.startsWith('--')) { v = next; i++; } else v = 'true'; }
        out[k.toUpperCase().replace(/-/g, '_')] = v;
    }
    return out;
}

function loadConfig({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd() } = {}) {
    const args = parseArgs(argv);
    let file = {};
    const filePath = args.CONFIG || env.LOCMIND_CONFIG || (fs.existsSync(path.join(cwd, 'locmind.json')) ? path.join(cwd, 'locmind.json') : '');
    if (filePath) {
        try { file = JSON.parse(fs.readFileSync(path.resolve(cwd, filePath), 'utf8')); }
        catch (err) { throw new Error(`Cannot read config file ${filePath}: ${err.message}`); }
    }
    const raw = {};
    for (const key of Object.keys(DEFAULTS)) {
        raw[key] = args[key] !== undefined ? args[key] : env[key] !== undefined && env[key] !== '' ? env[key] : file[key] !== undefined ? file[key] : DEFAULTS[key];
    }
    // backwards compatible names
    if (!raw.TURN_URL && env.TURN_URL) raw.TURN_URL = env.TURN_URL;

    const [relayMin, relayMax] = String(raw.TURN_RELAY_PORTS).split('-').map(n => INT(n, 0));
    const cfg = {
        PORT: INT(raw.PORT, 3000),
        HOST: String(raw.HOST),
        TRUST_PROXY: BOOL(raw.TRUST_PROXY),
        CORS_ORIGINS: LIST(raw.CORS_ORIGIN),
        MAX_PLAYERS: Math.max(1, INT(raw.MAX_PLAYERS, 150)),
        AFK_LIMIT_MS: Math.max(1, INT(raw.AFK_LIMIT_MINUTES, 30)) * 60 * 1000,
        AFK_GRACE_MS: 45 * 1000,
        SERVER_NAME: String(raw.SERVER_NAME).slice(0, 40) || 'Locmind',
        SERVER_PASSWORD: String(raw.SERVER_PASSWORD || ''),
        ADMIN_TOKEN: String(raw.ADMIN_TOKEN || ''),
        DATA_DIR: path.resolve(cwd, String(raw.DATA_DIR)),
        MEDIA_DIR: path.resolve(cwd, String(raw.MEDIA_DIR)),
        ALLOW_UPLOADS: BOOL(raw.ALLOW_UPLOADS),
        UPLOAD_MAX_BYTES: Math.max(1, INT(raw.UPLOAD_MAX_MB, 25)) * 1024 * 1024,
        UPLOAD_QUOTA_BYTES: Math.max(1, INT(raw.UPLOAD_QUOTA_MB, 1024)) * 1024 * 1024,
        YOUTUBE: BOOL(raw.YOUTUBE),
        INVIDIOUS_INSTANCES: BOOL(raw.YOUTUBE) ? LIST(raw.INVIDIOUS_INSTANCES) : [],
        TURN: BOOL(raw.TURN),
        TURN_PORT: INT(raw.TURN_PORT, 3478),
        TURN_RELAY_MIN: relayMin || 49160,
        TURN_RELAY_MAX: relayMax || relayMin + 199 || 49359,
        TURN_PUBLIC_IP: String(raw.TURN_PUBLIC_IP || ''),
        TURN_SECRET: String(raw.TURN_SECRET || ''),
        TURN_ALLOW_PRIVATE_PEERS: BOOL(raw.TURN_ALLOW_PRIVATE_PEERS),
        TURN_MAX_ALLOCATIONS_PER_IP: Math.max(1, INT(raw.TURN_MAX_ALLOCATIONS_PER_IP, 10)),
        TURN_BANDWIDTH_BPS: Math.max(64, INT(raw.TURN_BANDWIDTH_KBPS, 4000)) * 1000 / 8,
        EXTERNAL_STUN: BOOL(raw.EXTERNAL_STUN),
        ICE_SERVERS_OVERRIDE: null,
        TURN_EXTERNAL: raw.TURN_URL ? { urls: LIST(raw.TURN_URL), username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' } : null,
        TLS_CERT: String(raw.TLS_CERT || ''),
        TLS_KEY: String(raw.TLS_KEY || ''),
        TLS_SELF_SIGNED: BOOL(raw.TLS_SELF_SIGNED),
        LOG_LEVEL: String(raw.LOG_LEVEL || 'info'),
        LOG_FORMAT: String(raw.LOG_FORMAT || ''),
        METRICS: BOOL(raw.METRICS),
        MAX_CONNECTIONS_PER_IP: Math.max(1, INT(raw.MAX_CONNECTIONS_PER_IP, 16))
    };
    if (raw.ICE_SERVERS) {
        try {
            const parsed = typeof raw.ICE_SERVERS === 'string' ? JSON.parse(raw.ICE_SERVERS) : raw.ICE_SERVERS;
            if (Array.isArray(parsed)) cfg.ICE_SERVERS_OVERRIDE = parsed;
        } catch (_) { throw new Error('ICE_SERVERS must be a JSON array'); }
    }
    return cfg;
}

module.exports = { loadConfig, parseArgs, DEFAULTS };
