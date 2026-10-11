'use strict';

const env = process.env;

function int(value, fallback, min = 0) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= min ? n : fallback;
}

function list(value) {
    return typeof value === 'string' && value.trim() ? value.split(',').map(s => s.trim()).filter(Boolean) : [];
}

function iceServers() {
    if (env.ICE_SERVERS) {
        try {
            const parsed = JSON.parse(env.ICE_SERVERS);
            if (Array.isArray(parsed)) return parsed;
        } catch (_) { /* fall through to defaults */ }
        console.warn('ICE_SERVERS is not a valid JSON array, using defaults.');
    }
    const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (env.TURN_URL) {
        servers.push({ urls: list(env.TURN_URL), username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' });
    }
    return servers;
}

module.exports = {
    PORT: int(env.PORT, 3000),
    HOST: env.HOST || '0.0.0.0',
    // Same-origin by default. Set CORS_ORIGIN="https://a.example,https://b.example" to allow others.
    CORS_ORIGINS: list(env.CORS_ORIGIN),
    TRUST_PROXY: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    MAX_PLAYERS: int(env.MAX_PLAYERS, 150, 1),
    ICE_SERVERS: iceServers(),
    INVIDIOUS_INSTANCES: list(env.INVIDIOUS_INSTANCES).length
        ? list(env.INVIDIOUS_INSTANCES)
        : ['https://yewtu.be', 'https://inv.nadeko.net', 'https://invidious.nerdvpn.de'],
    AFK_LIMIT_MS: int(env.AFK_LIMIT_MINUTES, 30, 1) * 60 * 1000,
    AFK_GRACE_MS: 45 * 1000
};
