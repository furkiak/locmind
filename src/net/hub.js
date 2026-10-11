'use strict';

/*
 * A tiny realtime "hub" on top of the WebSocket server: named events, acknowledgements,
 * rooms and broadcasts. Wire format (JSON text frames):
 *   client -> server   [event, payload]            or [event, payload, ackId]
 *   server -> client   [event, payload]            and ["ack", ackId, response]
 * Messages are encoded once per broadcast and the same bytes are written to every socket.
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { attachWebSocketServer } = require('./websocket');
const { textFrame } = require('./frames');

const EVENT_RE = /^[a-z][a-z0-9:_-]{0,39}$/i;
const SLOW_CLIENT_BYTES = 2 * 1024 * 1024;   // a client this far behind gets dropped
const VOLATILE_SKIP_BYTES = 128 * 1024;      // volatile messages are skipped above this backlog

const encode = (event, payload) => textFrame(JSON.stringify([event, payload === undefined ? null : payload]));

function clientIp(req, trustProxy) {
    let ip = req.socket.remoteAddress || '';
    if (trustProxy) {
        const fwd = req.headers['x-forwarded-for'];
        if (typeof fwd === 'string' && fwd) ip = fwd.split(',')[0].trim();
    }
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

class Client {
    constructor(hub, conn, req, ip) {
        this.id = crypto.randomBytes(15).toString('base64url');
        this.hub = hub;
        this.conn = conn;
        this.ip = ip;
        this.userAgent = String(req.headers['user-agent'] || '').slice(0, 200);
        this.connectedAt = Date.now();
        this.rooms = new Set();
        this.handlers = new Map();
        this.disconnectHandlers = [];
        this.connected = true;
        this.data = {};
        this.windowStart = Date.now();
        this.windowCount = 0;
        this.strikes = 0;
    }

    on(event, fn) {
        if (event === 'disconnect') this.disconnectHandlers.push(fn);
        else this.handlers.set(event, fn);
        return this;
    }

    emit(event, payload) { this.hub.sendFrame(this, encode(event, payload)); }

    join(room) {
        if (this.rooms.has(room)) return;
        this.rooms.add(room);
        let set = this.hub.rooms.get(room);
        if (!set) { set = new Set(); this.hub.rooms.set(room, set); }
        set.add(this);
    }

    leave(room) {
        if (!this.rooms.delete(room)) return;
        const set = this.hub.rooms.get(room);
        if (set) { set.delete(this); if (!set.size) this.hub.rooms.delete(room); }
    }

    /** Everybody except this client. */
    get broadcast() { return { emit: (event, payload) => this.hub.fanout(this.hub.clients.values(), encode(event, payload), this) }; }

    /** Members of a room (or a single client id) except this client. */
    to(target) { return { emit: (event, payload) => this.hub.fanout(this.hub.targets(target), encode(event, payload), this) }; }

    disconnect(code = 1000, reason = '') { if (this.connected) this.conn.close(code, reason); }
}

class Hub {
    /**
     * @param {import('http').Server} server
     * @param {object} [o]
     * @param {string[]} [o.allowedOrigins]  extra origins allowed to connect (same origin always is)
     * @param {(ip:string)=>boolean} [o.isBanned]
     */
    constructor(server, { path = '/ws', maxPayload = 64 * 1024, trustProxy = false, allowedOrigins = [], maxConnsPerIp = 16, connRatePerMin = 60, maxMessagesPerSec = 400, isBanned = () => false } = {}) {
        this.events = new EventEmitter();
        this.events.on('error', err => console.error('[hub]', err));
        this.clients = new Map();
        this.rooms = new Map();
        this.trustProxy = trustProxy;
        this.allowedOrigins = new Set(allowedOrigins);
        this.maxConnsPerIp = maxConnsPerIp;
        this.connRatePerMin = connRatePerMin;
        this.maxMessagesPerSec = maxMessagesPerSec;
        this.isBanned = isBanned;
        this.perIp = new Map();      // ip -> live connection count
        this.attempts = new Map();   // ip -> [timestamps]
        this.stats = { messagesIn: 0, messagesOut: 0, bytesIn: 0, bytesOut: 0, connections: 0, rejected: 0 };

        this.ws = attachWebSocketServer(server, {
            path,
            maxPayload,
            verify: req => this.verify(req),
            onConnection: (conn, req) => this.accept(conn, req)
        });
        this.sweeper = setInterval(() => {
            const cutoff = Date.now() - 60000;
            for (const [ip, list] of this.attempts) {
                const fresh = list.filter(t => t > cutoff);
                if (fresh.length) this.attempts.set(ip, fresh); else this.attempts.delete(ip);
            }
        }, 60000);
        this.sweeper.unref();
    }

    verify(req) {
        const ip = clientIp(req, this.trustProxy);
        const reject = status => { this.stats.rejected++; return { ok: false, status }; };
        if (this.isBanned(ip)) return reject(403);
        const origin = req.headers.origin;
        if (origin) {
            let host;
            try { host = new URL(origin).host; } catch (_) { return reject(403); }
            if (host !== req.headers.host && !this.allowedOrigins.has(origin)) return reject(403);
        }
        const now = Date.now();
        const list = (this.attempts.get(ip) || []).filter(t => t > now - 60000);
        list.push(now);
        this.attempts.set(ip, list);
        if (list.length > this.connRatePerMin) return reject(429);
        if ((this.perIp.get(ip) || 0) >= this.maxConnsPerIp) return reject(429);
        return { ok: true };
    }

    accept(conn, req) {
        const ip = clientIp(req, this.trustProxy);
        const client = new Client(this, conn, req, ip);
        this.clients.set(client.id, client);
        this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
        this.stats.connections++;

        conn.on('message', (data, binary) => this.receive(client, data, binary));
        conn.on('close', () => {
            if (!client.connected) return;
            client.connected = false;
            this.clients.delete(client.id);
            for (const room of Array.from(client.rooms)) client.leave(room);
            const n = (this.perIp.get(ip) || 1) - 1;
            if (n > 0) this.perIp.set(ip, n); else this.perIp.delete(ip);
            for (const fn of client.disconnectHandlers) {
                try { fn(); } catch (err) { this.events.emit('error', err); }
            }
        });

        client.emit('hello', { id: client.id });
        this.events.emit('connection', client);
    }

    receive(client, data, binary) {
        this.stats.messagesIn++;
        this.stats.bytesIn += data.length;
        const now = Date.now();
        if (now - client.windowStart >= 1000) { client.windowStart = now; client.windowCount = 0; }
        if (++client.windowCount > this.maxMessagesPerSec) { client.disconnect(1008, 'flood'); return; }
        let msg;
        if (!binary) { try { msg = JSON.parse(data); } catch (_) { msg = null; } }
        if (!Array.isArray(msg) || typeof msg[0] !== 'string' || !EVENT_RE.test(msg[0])) {
            if (++client.strikes > 10) client.disconnect(1008, 'protocol');
            return;
        }
        const [event, payload, ackId] = msg;
        if (event === 'ping') { client.emit('pong', typeof payload === 'number' ? payload : 0); return; }
        let ack;
        if (Number.isInteger(ackId) && ackId >= 0 && ackId < 2 ** 31) {
            let used = false;
            ack = response => {
                if (used) return;
                used = true;
                this.sendFrame(client, textFrame(JSON.stringify(['ack', ackId, response === undefined ? null : response])));
            };
        }
        const handler = client.handlers.get(event);
        if (!handler) { if (ack) ack({ ok: false, error: 'unknown-event' }); return; }
        try {
            const r = handler(payload, ack);
            if (r && typeof r.catch === 'function') r.catch(err => this.events.emit('error', err));
        } catch (err) {
            this.events.emit('error', err);
        }
    }

    sendFrame(client, frame, volatile = false) {
        if (!client.connected) return;
        const backlog = client.conn.bufferedAmount;
        if (backlog > SLOW_CLIENT_BYTES) { client.conn.terminate(); return; }
        if (volatile && backlog > VOLATILE_SKIP_BYTES) return;
        client.conn.writeRaw(frame);
        this.stats.messagesOut++;
        this.stats.bytesOut += frame.length;
    }

    fanout(clients, frame, except = null, volatile = false) {
        for (const c of clients) if (c !== except) this.sendFrame(c, frame, volatile);
    }

    targets(target) {
        const room = this.rooms.get(target);
        if (room) return room;
        const one = this.clients.get(target);
        return one ? [one] : [];
    }

    /** Subscribe to hub level events: 'connection' (client) and 'error' (err). */
    on(event, fn) { this.events.on(event, fn); return this; }

    /** Broadcast to every connected client. */
    emit(event, payload) { this.fanout(this.clients.values(), encode(event, payload)); }

    to(target) { return { emit: (event, payload) => this.fanout(this.targets(target), encode(event, payload)) }; }

    get volatile() {
        return {
            emit: (event, payload) => this.fanout(this.clients.values(), encode(event, payload), null, true),
            to: target => ({ emit: (event, payload) => this.fanout(this.targets(target), encode(event, payload), null, true) })
        };
    }

    close() {
        clearInterval(this.sweeper);
        this.ws.close();
    }
}

module.exports = { Hub, clientIp };
