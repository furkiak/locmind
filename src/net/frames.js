'use strict';

/*
 * RFC 6455 framing shared by the server and the Node client.
 * - encodeFrame() builds a complete frame (optionally masked, as clients must).
 * - Receiver is an incremental parser that copes with frames split across TCP
 *   chunks, fragmentation, control frames, size limits and UTF-8 validation.
 */

const crypto = require('crypto');

const OP = Object.freeze({ CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA });
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const utf8 = new TextDecoder('utf-8', { fatal: true });

const acceptKey = key => crypto.createHash('sha1').update(key + GUID).digest('base64');

function encodeFrame(opcode, payload = Buffer.alloc(0), mask = false) {
    const len = payload.length;
    const extra = len < 126 ? 0 : len < 65536 ? 2 : 8;
    const headLen = 2 + extra + (mask ? 4 : 0);
    const out = Buffer.allocUnsafe(headLen + len);
    out[0] = 0x80 | opcode;
    if (len < 126) out[1] = len;
    else if (len < 65536) { out[1] = 126; out.writeUInt16BE(len, 2); }
    else { out[1] = 127; out.writeUInt32BE(Math.floor(len / 0x100000000), 2); out.writeUInt32BE(len >>> 0, 6); }
    if (mask) {
        out[1] |= 0x80;
        const key = crypto.randomBytes(4);
        key.copy(out, 2 + extra);
        for (let i = 0; i < len; i++) out[headLen + i] = payload[i] ^ key[i & 3];
    } else {
        payload.copy(out, headLen);
    }
    return out;
}

const textFrame = (str, mask = false) => encodeFrame(OP.TEXT, Buffer.from(str, 'utf8'), mask);

function closePayload(code, reason = '') {
    if (!code) return Buffer.alloc(0);
    const r = Buffer.from(String(reason).slice(0, 100), 'utf8');
    const buf = Buffer.allocUnsafe(2 + r.length);
    buf.writeUInt16BE(code, 0);
    r.copy(buf, 2);
    return buf;
}

const validCloseCode = c => (c >= 1000 && c <= 1003) || (c >= 1007 && c <= 1014) || (c >= 3000 && c <= 4999);

class ProtocolError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

const S_HEAD = 0, S_LEN16 = 1, S_LEN64 = 2, S_MASK = 3, S_DATA = 4;

class Receiver {
    /**
     * @param {object} o
     * @param {boolean} o.expectMasked  true on the server (clients must mask), false on a client
     * @param {number}  o.maxPayload    largest message (after reassembly) in bytes
     * @param {(opcode:number, data:Buffer)=>void} o.onFrame  complete messages and control frames
     */
    constructor({ expectMasked, maxPayload, onFrame }) {
        this.expectMasked = expectMasked;
        this.maxPayload = maxPayload;
        this.onFrame = onFrame;
        this.chunks = [];
        this.buffered = 0;
        this.state = S_HEAD;
        this.fin = false; this.opcode = 0; this.masked = false; this.len = 0; this.mask = null;
        this.fragments = null; this.fragOpcode = 0; this.fragBytes = 0;
        this.dead = false;
    }

    push(chunk) {
        if (this.dead) return;
        this.chunks.push(chunk);
        this.buffered += chunk.length;
        this.run();
    }

    take(n) {
        this.buffered -= n;
        const first = this.chunks[0];
        if (n === first.length) return this.chunks.shift();
        if (n < first.length) { this.chunks[0] = first.subarray(n); return first.subarray(0, n); }
        const out = Buffer.allocUnsafe(n);
        let off = 0;
        while (off < n) {
            const c = this.chunks[0], k = Math.min(n - off, c.length);
            c.copy(out, off, 0, k);
            off += k;
            if (k === c.length) this.chunks.shift(); else this.chunks[0] = c.subarray(k);
        }
        return out;
    }

    run() {
        while (!this.dead) {
            if (this.state === S_HEAD) {
                if (this.buffered < 2) return;
                const b = this.take(2);
                this.fin = (b[0] & 0x80) !== 0;
                if (b[0] & 0x70) throw new ProtocolError(1002, 'reserved bits set');
                this.opcode = b[0] & 0x0f;
                this.masked = (b[1] & 0x80) !== 0;
                this.len = b[1] & 0x7f;
                const control = this.opcode >= 0x8;
                if (![OP.CONT, OP.TEXT, OP.BINARY, OP.CLOSE, OP.PING, OP.PONG].includes(this.opcode)) throw new ProtocolError(1002, 'bad opcode');
                if (control && (!this.fin || this.len > 125)) throw new ProtocolError(1002, 'bad control frame');
                if (this.masked !== this.expectMasked) throw new ProtocolError(1002, this.expectMasked ? 'unmasked client frame' : 'masked server frame');
                this.state = this.len === 126 ? S_LEN16 : this.len === 127 ? S_LEN64 : (this.masked ? S_MASK : S_DATA);
                if (this.state === S_MASK || this.state === S_DATA) this.checkSize();
            } else if (this.state === S_LEN16) {
                if (this.buffered < 2) return;
                this.len = this.take(2).readUInt16BE(0);
                this.state = this.masked ? S_MASK : S_DATA;
                this.checkSize();
            } else if (this.state === S_LEN64) {
                if (this.buffered < 8) return;
                const b = this.take(8);
                if (b.readUInt32BE(0) !== 0) throw new ProtocolError(1009, 'frame too large');
                this.len = b.readUInt32BE(4);
                this.state = this.masked ? S_MASK : S_DATA;
                this.checkSize();
            } else if (this.state === S_MASK) {
                if (this.buffered < 4) return;
                this.mask = this.take(4);
                this.state = S_DATA;
            } else {
                if (this.buffered < this.len) return;
                const data = this.len ? this.take(this.len) : Buffer.alloc(0);
                if (this.masked && this.len) {
                    // socket chunks belong to us, so unmasking in place is safe (and avoids a copy)
                    const m = this.mask;
                    for (let i = 0; i < data.length; i++) data[i] ^= m[i & 3];
                }
                this.state = S_HEAD;
                this.frame(data);
            }
        }
    }

    checkSize() {
        const total = (this.opcode === OP.CONT ? this.fragBytes : 0) + this.len;
        if (total > this.maxPayload) throw new ProtocolError(1009, 'message too big');
    }

    frame(data) {
        const op = this.opcode;
        if (op >= 0x8) { this.onFrame(op, data); return; }
        if (op === OP.CONT) {
            if (!this.fragments) throw new ProtocolError(1002, 'unexpected continuation');
            this.fragments.push(data);
            this.fragBytes += data.length;
            if (!this.fin) return;
            const whole = Buffer.concat(this.fragments, this.fragBytes);
            const kind = this.fragOpcode;
            this.fragments = null; this.fragBytes = 0;
            this.deliver(kind, whole);
            return;
        }
        if (this.fragments) throw new ProtocolError(1002, 'new message inside a fragmented one');
        if (!this.fin) { this.fragments = [data]; this.fragOpcode = op; this.fragBytes = data.length; return; }
        this.deliver(op, data);
    }

    deliver(op, data) {
        if (op === OP.TEXT) {
            let text;
            try { text = utf8.decode(data); } catch (_) { throw new ProtocolError(1007, 'invalid utf-8'); }
            this.onFrame(OP.TEXT, text);
        } else {
            this.onFrame(OP.BINARY, data);
        }
    }
}

module.exports = { OP, acceptKey, encodeFrame, textFrame, closePayload, validCloseCode, Receiver, ProtocolError };
