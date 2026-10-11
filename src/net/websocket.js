'use strict';

/*
 * Minimal, dependency free WebSocket server (RFC 6455) for Node's http/https server.
 * Text and binary messages, fragmentation, ping/pong keep-alive, close handshake,
 * backpressure introspection and strict validation of everything a client sends.
 */

const { EventEmitter } = require('events');
const { OP, acceptKey, encodeFrame, closePayload, validCloseCode, Receiver, ProtocolError } = require('./frames');

const KEY_RE = /^[A-Za-z0-9+/]{22}==$/;

function uncork(conn) {
    conn.corked = false;
    if (!conn.socket.destroyed) conn.socket.uncork();
}

class WebSocketConnection extends EventEmitter {
    constructor(socket, { maxPayload = 64 * 1024, isServer = true } = {}) {
        super();
        this.socket = socket;
        this.isServer = isServer;
        this.readyState = 1; // OPEN
        this.alive = true;
        this.closeTimer = null;
        this.receiver = new Receiver({
            expectMasked: isServer,
            maxPayload,
            onFrame: (op, data) => this.onFrame(op, data)
        });
        socket.setNoDelay(true);
        socket.setTimeout(0);
        socket.on('data', chunk => {
            this.alive = true;
            try { this.receiver.push(chunk); }
            catch (err) { this.fail(err instanceof ProtocolError ? err.code : 1011, err.message); }
        });
        socket.on('error', () => { /* reported through close */ });
        socket.on('close', () => this.finish(1006, ''));
        socket.on('end', () => { if (this.readyState === 1) this.finish(1006, ''); });
    }

    get bufferedAmount() { return this.socket.writableLength; }

    onFrame(op, data) {
        if (op === OP.TEXT || op === OP.BINARY) { if (this.readyState === 1) this.emit('message', data, op === OP.BINARY); return; }
        if (op === OP.PING) { this.writeRaw(encodeFrame(OP.PONG, data, !this.isServer)); return; }
        if (op === OP.PONG) { this.emit('pong'); return; }
        // close
        let code = 1005, reason = '';
        if (data.length === 1) return this.fail(1002, 'bad close frame');
        if (data.length >= 2) {
            code = data.readUInt16BE(0);
            if (!validCloseCode(code)) return this.fail(1002, 'bad close code');
            reason = data.subarray(2).toString('utf8');
        }
        if (this.readyState === 1) {
            this.readyState = 2;
            this.writeRaw(encodeFrame(OP.CLOSE, closePayload(code === 1005 ? 1000 : code), !this.isServer));
        }
        this.receiver.dead = true;
        this.socket.end();
        this.finish(code, reason);
    }

    /**
     * Writes an already encoded frame (lets a broadcaster encode once and fan out).
     * Frames written during the same tick are corked and leave in one writev() system call.
     */
    writeRaw(frame) {
        if (this.readyState > 2 || this.socket.destroyed) return false;
        if (!this.corked) {
            this.corked = true;
            this.socket.cork();
            process.nextTick(uncork, this);
        }
        return this.socket.write(frame);
    }

    send(data) {
        if (this.readyState !== 1) return false;
        const isText = typeof data === 'string';
        return this.writeRaw(encodeFrame(isText ? OP.TEXT : OP.BINARY, isText ? Buffer.from(data, 'utf8') : data, !this.isServer));
    }

    ping() { this.writeRaw(encodeFrame(OP.PING, Buffer.alloc(0), !this.isServer)); }

    close(code = 1000, reason = '') {
        if (this.readyState !== 1) return;
        this.readyState = 2;
        this.writeRaw(encodeFrame(OP.CLOSE, closePayload(code, reason), !this.isServer));
        this.receiver.dead = true;
        this.closeTimer = setTimeout(() => this.socket.destroy(), 2000);
        this.closeTimer.unref();
        this.socket.end();
        this.finish(code, reason);
    }

    fail(code, reason) {
        if (this.readyState === 1) {
            this.readyState = 2;
            this.writeRaw(encodeFrame(OP.CLOSE, closePayload(code, reason), !this.isServer));
        }
        this.receiver.dead = true;
        this.socket.end();
        setTimeout(() => this.socket.destroy(), 500).unref();
        this.finish(code, reason);
    }

    terminate() {
        this.receiver.dead = true;
        this.socket.destroy();
        this.finish(1006, 'terminated');
    }

    finish(code, reason) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        clearTimeout(this.closeTimer);
        this.emit('close', code, reason);
    }
}

function reject(socket, status, headers = {}) {
    const text = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 426: 'Upgrade Required', 429: 'Too Many Requests', 503: 'Service Unavailable' }[status] || 'Error';
    const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n${extra}\r\n${text}`);
}

/**
 * Accepts WebSocket upgrades on `path`.
 * @param {import('http').Server} server
 * @param {object} o
 * @param {string} o.path
 * @param {(req) => ({ok:boolean, status?:number})} [o.verify]   origin / ban / rate checks
 * @param {(conn: WebSocketConnection, req) => void} o.onConnection
 */
function attachWebSocketServer(server, { path, verify = () => ({ ok: true }), onConnection, maxPayload = 64 * 1024, pingIntervalMs = 25000 }) {
    const conns = new Set();

    const onUpgrade = (req, socket, head) => {
        socket.on('error', () => {});
        let pathname;
        try { pathname = new URL(req.url, 'http://x').pathname; } catch (_) { return reject(socket, 400); }
        if (pathname !== path) return reject(socket, 404);
        if (req.method !== 'GET' || String(req.headers.upgrade).toLowerCase() !== 'websocket') return reject(socket, 400);
        if (!/\bupgrade\b/i.test(String(req.headers.connection))) return reject(socket, 400);
        if (req.headers['sec-websocket-version'] !== '13') return reject(socket, 426, { 'Sec-WebSocket-Version': '13' });
        const key = req.headers['sec-websocket-key'];
        if (typeof key !== 'string' || !KEY_RE.test(key)) return reject(socket, 400);
        const v = verify(req);
        if (!v || !v.ok) return reject(socket, (v && v.status) || 403);

        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
        const conn = new WebSocketConnection(socket, { maxPayload, isServer: true });
        conns.add(conn);
        conn.on('close', () => conns.delete(conn));
        onConnection(conn, req);
        if (head && head.length) socket.emit('data', head);
    };
    server.on('upgrade', onUpgrade);

    // One timer for every connection: ping, and drop whoever did not answer the last ping.
    const heartbeat = setInterval(() => {
        for (const c of conns) {
            if (!c.alive) { c.terminate(); continue; }
            c.alive = false;
            c.ping();
        }
    }, pingIntervalMs);
    heartbeat.unref();

    return {
        connections: conns,
        close() {
            clearInterval(heartbeat);
            server.off('upgrade', onUpgrade);
            for (const c of conns) c.close(1001, 'server shutting down');
        }
    };
}

module.exports = { attachWebSocketServer, WebSocketConnection };
