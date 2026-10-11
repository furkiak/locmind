'use strict';

/*
 * Node.js client for the hub protocol (used by the tests, the load generator and bots).
 * API mirrors the browser transport: on / once / off / onAny / emit(event, payload, ack) / close.
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { acceptKey } = require('./frames');
const { WebSocketConnection } = require('./websocket');

function openWebSocket(url, { headers = {}, path = '/ws', timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const secure = u.protocol === 'https:' || u.protocol === 'wss:';
        const key = crypto.randomBytes(16).toString('base64');
        const req = (secure ? https : http).request({
            host: u.hostname,
            port: u.port || (secure ? 443 : 80),
            path,
            rejectUnauthorized: false,
            headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key, ...headers }
        });
        const timer = setTimeout(() => { req.destroy(new Error('timeout')); }, timeoutMs);
        req.on('upgrade', (res, socket, head) => {
            clearTimeout(timer);
            if (res.headers['sec-websocket-accept'] !== acceptKey(key)) { socket.destroy(); reject(new Error('bad accept key')); return; }
            const conn = new WebSocketConnection(socket, { isServer: false, maxPayload: 16 * 1024 * 1024 });
            resolve(conn);
            // let the caller attach its listeners before the first (buffered) frames are parsed
            if (head && head.length) setImmediate(() => socket.emit('data', head));
        });
        req.on('response', res => { clearTimeout(timer); res.resume(); reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })); });
        req.on('error', err => { clearTimeout(timer); reject(err); });
        req.end();
    });
}

class HubClient {
    constructor(url, { reconnection = false, headers = {} } = {}) {
        this.url = url;
        this.headers = headers;
        this.reconnection = reconnection;
        this.handlers = new Map();
        this.anyHandlers = [];
        this.acks = new Map();
        this.seq = 0;
        this.connected = false;
        this.id = null;
        this.conn = null;
        this.closed = false;
        this.open();
    }

    async open() {
        try {
            this.conn = await openWebSocket(this.url, { headers: this.headers });
        } catch (err) {
            this.fire('connect_error', err);
            if (this.reconnection && !this.closed) setTimeout(() => this.open(), 500);
            return;
        }
        if (this.closed) { this.conn.close(); return; }
        this.conn.on('message', data => this.receive(data));
        this.conn.on('close', (code, reason) => {
            const was = this.connected;
            this.connected = false;
            for (const cb of this.acks.values()) cb({ ok: false, error: 'disconnected' });
            this.acks.clear();
            if (was) this.fire('disconnect', reason || code);
            if (this.reconnection && !this.closed) setTimeout(() => this.open(), 500);
        });
    }

    receive(data) {
        let msg;
        try { msg = JSON.parse(data); } catch (_) { return; }
        const [event, payload, extra] = msg;
        if (event === 'hello') { this.id = payload.id; this.connected = true; this.fire('connect'); return; }
        if (event === 'ack') {
            const cb = this.acks.get(payload);
            this.acks.delete(payload);
            if (cb) cb(extra);
            return;
        }
        for (const fn of this.anyHandlers) fn(event, payload);
        this.fire(event, payload);
    }

    fire(event, payload) {
        const list = this.handlers.get(event);
        if (list) for (const fn of Array.from(list)) fn(payload);
    }

    on(event, fn) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(fn);
        return this;
    }

    off(event, fn) { const l = this.handlers.get(event); if (l) l.delete(fn); return this; }
    once(event, fn) { const w = p => { this.off(event, w); fn(p); }; return this.on(event, w); }
    onAny(fn) { this.anyHandlers.push(fn); return this; }

    emit(event, payload, ack) {
        if (!this.conn || this.conn.readyState !== 1) { if (ack) ack({ ok: false, error: 'disconnected' }); return; }
        const msg = [event, payload === undefined ? null : payload];
        if (typeof ack === 'function') { const id = ++this.seq; this.acks.set(id, ack); msg.push(id); }
        this.conn.send(JSON.stringify(msg));
    }

    /** Sends a raw text frame (tests use it to send malformed data). */
    sendRaw(text) { if (this.conn) this.conn.send(text); }

    close() {
        this.closed = true;
        if (this.conn) this.conn.close();
    }
}

const connect = (url, opts) => new HubClient(url, opts);

module.exports = { connect, HubClient, openWebSocket };
