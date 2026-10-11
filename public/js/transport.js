// Realtime transport over a plain WebSocket (no client library needed).
// Wire format: [event, payload, ackId?]  /  server replies ["ack", ackId, response].

const ACK_TIMEOUT_MS = 10000;

export class Transport {
    constructor(path = '/ws') {
        this.url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
        this.handlers = new Map();
        this.acks = new Map();
        this.seq = 0;
        this.connected = false;
        this.id = null;
        this.attempt = 0;
        this.manual = false;
        this.rtt = null;
        this.ws = null;
        this.open();
        this.pinger = setInterval(() => { if (this.connected) this.send(['ping', performance.now()]); }, 5000);
    }

    open() {
        let ws;
        try { ws = new WebSocket(this.url); } catch (_) { this.retry(); return; }
        this.ws = ws;
        ws.onmessage = e => this.receive(e.data);
        ws.onclose = e => {
            if (this.ws !== ws) return;
            const was = this.connected;
            this.connected = false;
            for (const [, a] of this.acks) { clearTimeout(a.timer); a.cb({ ok: false, error: 'disconnected' }); }
            this.acks.clear();
            if (e.code >= 4000 && e.code < 5000) this.manual = true;   // the server told us to go away
            if (was) this.fire('disconnect', e.code);
            if (!this.manual) this.retry();
        };
        ws.onerror = () => {};
    }

    retry() {
        const delay = Math.min(8000, 400 * 2 ** this.attempt++) + Math.random() * 400;
        this.fire('reconnecting', { attempt: this.attempt, delay });
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.open(), delay);
    }

    receive(raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { return; }
        if (!Array.isArray(msg)) return;
        const [event, payload, extra] = msg;
        if (event === 'hello') { this.id = payload.id; this.connected = true; this.attempt = 0; this.fire('connect'); return; }
        if (event === 'ack') {
            const a = this.acks.get(payload);
            if (a) { this.acks.delete(payload); clearTimeout(a.timer); a.cb(extra); }
            return;
        }
        if (event === 'pong') { this.rtt = Math.round(performance.now() - payload); this.fire('rtt', this.rtt); return; }
        this.fire(event, payload);
    }

    fire(event, payload) {
        const set = this.handlers.get(event);
        if (set) for (const fn of Array.from(set)) { try { fn(payload); } catch (err) { console.error(`[transport ${event}]`, err); } }
    }

    send(msg) {
        if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    }

    emit(event, payload, ack) {
        if (!this.connected) { if (typeof ack === 'function') ack({ ok: false, error: 'disconnected' }); return; }
        const msg = [event, payload === undefined ? null : payload];
        if (typeof ack === 'function') {
            const id = ++this.seq;
            const timer = setTimeout(() => { if (this.acks.delete(id)) ack({ ok: false, error: 'timeout' }); }, ACK_TIMEOUT_MS);
            this.acks.set(id, { cb: ack, timer });
            msg.push(id);
        }
        this.send(msg);
    }

    on(event, fn) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(fn);
        return this;
    }

    off(event, fn) { const s = this.handlers.get(event); if (s) s.delete(fn); return this; }
    once(event, fn) { const w = p => { this.off(event, w); fn(p); }; return this.on(event, w); }

    /** Closes for good (kicked, AFK, leaving). */
    disconnect() {
        this.manual = true;
        clearInterval(this.pinger);
        clearTimeout(this.retryTimer);
        if (this.ws) this.ws.close(1000);
    }

    /** Simulates a network drop (the transport reconnects on its own). */
    drop() { if (this.ws) this.ws.close(3000); }
}
