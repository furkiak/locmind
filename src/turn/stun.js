'use strict';

/*
 * STUN message codec (RFC 5389 / RFC 8489) with the TURN (RFC 5766 / RFC 8656) attributes.
 * Handles MESSAGE-INTEGRITY (HMAC-SHA1) and FINGERPRINT (CRC-32) on both encode and decode.
 */

const crypto = require('crypto');
const net = require('net');

const MAGIC = 0x2112A442;
const HEADER = 20;

const METHOD = Object.freeze({ BINDING: 0x001, ALLOCATE: 0x003, REFRESH: 0x004, SEND: 0x006, DATA: 0x007, CREATE_PERMISSION: 0x008, CHANNEL_BIND: 0x009 });
const CLASS = Object.freeze({ REQUEST: 0, INDICATION: 1, SUCCESS: 2, ERROR: 3 });
const ATTR = Object.freeze({
    MAPPED_ADDRESS: 0x0001, USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, UNKNOWN_ATTRIBUTES: 0x000A,
    CHANNEL_NUMBER: 0x000C, LIFETIME: 0x000D, XOR_PEER_ADDRESS: 0x0012, DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015,
    XOR_RELAYED_ADDRESS: 0x0016, REQUESTED_ADDRESS_FAMILY: 0x0017, EVEN_PORT: 0x0018, REQUESTED_TRANSPORT: 0x0019,
    DONT_FRAGMENT: 0x001A, XOR_MAPPED_ADDRESS: 0x0020, RESERVATION_TOKEN: 0x0022, SOFTWARE: 0x8022, FINGERPRINT: 0x8028
});

const messageType = (method, cls) => (method & 0x000F) | ((method & 0x0070) << 1) | ((method & 0x0F80) << 2) | ((cls & 1) << 4) | ((cls & 2) << 7);
const splitType = t => ({
    method: (t & 0x000F) | ((t & 0x00E0) >> 1) | ((t & 0x3E00) >> 2),
    cls: ((t & 0x0010) >> 4) | ((t & 0x0100) >> 7)
});

// ------------------------------------------------------------------ CRC-32
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

/** True when the first byte looks like a STUN message (top two bits zero). */
const isStun = buf => buf.length >= HEADER && (buf[0] & 0xC0) === 0 && buf.readUInt32BE(4) === MAGIC;
/** ChannelData messages start with 0b01 (channel numbers 0x4000-0x7FFF). */
const isChannelData = buf => buf.length >= 4 && (buf[0] & 0xC0) === 0x40;

/**
 * Parses a STUN message. Returns null for anything malformed.
 * @returns {{method:number, cls:number, tid:Buffer, attrs:Array<[number, Buffer]>, raw:Buffer, integrityAt:number, fingerprintAt:number}|null}
 */
function decode(buf) {
    if (!isStun(buf)) return null;
    const len = buf.readUInt16BE(2);
    if (len % 4 !== 0 || HEADER + len > buf.length) return null;
    const { method, cls } = splitType(buf.readUInt16BE(0));
    const msg = { method, cls, tid: buf.subarray(8, 20), attrs: [], raw: buf.subarray(0, HEADER + len), integrityAt: -1, fingerprintAt: -1 };
    let off = HEADER;
    const end = HEADER + len;
    while (off + 4 <= end) {
        const type = buf.readUInt16BE(off), alen = buf.readUInt16BE(off + 2);
        if (off + 4 + alen > end) return null;
        if (msg.fingerprintAt >= 0) return null;              // nothing may follow FINGERPRINT
        if (type === ATTR.MESSAGE_INTEGRITY) msg.integrityAt = off;
        else if (type === ATTR.FINGERPRINT) msg.fingerprintAt = off;
        else if (msg.integrityAt >= 0) { off += 4 + alen + ((4 - (alen % 4)) % 4); continue; } // ignored after MI
        msg.attrs.push([type, buf.subarray(off + 4, off + 4 + alen)]);
        off += 4 + alen + ((4 - (alen % 4)) % 4);
    }
    if (off !== end) return null;
    return msg;
}

const attr = (msg, type) => { for (const [t, v] of msg.attrs) if (t === type) return v; return null; };
const attrs = (msg, type) => msg.attrs.filter(([t]) => t === type).map(([, v]) => v);

// ------------------------------------------------------------- addresses

function encodeXorAddress(address, port, tid) {
    const v6 = net.isIPv6(address);
    const out = Buffer.alloc(v6 ? 20 : 8);
    out[1] = v6 ? 0x02 : 0x01;
    out.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
    if (!v6) {
        const ip = address.split('.').reduce((a, o) => (a << 8 | Number(o)) >>> 0, 0);
        out.writeUInt32BE((ip ^ MAGIC) >>> 0, 4);
    } else {
        const raw = ipv6ToBuffer(address);
        const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xA4, 0x42]), tid]);
        for (let i = 0; i < 16; i++) out[4 + i] = raw[i] ^ key[i];
    }
    return out;
}

function decodeXorAddress(buf, tid) {
    if (!buf || buf.length < 8) return null;
    const family = buf[1];
    const port = buf.readUInt16BE(2) ^ (MAGIC >>> 16);
    if (family === 0x01 && buf.length === 8) {
        const ip = (buf.readUInt32BE(4) ^ MAGIC) >>> 0;
        return { family: 4, address: [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.'), port };
    }
    if (family === 0x02 && buf.length === 20) {
        const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xA4, 0x42]), tid]);
        const raw = Buffer.alloc(16);
        for (let i = 0; i < 16; i++) raw[i] = buf[4 + i] ^ key[i];
        return { family: 6, address: bufferToIpv6(raw), port };
    }
    return null;
}

function ipv6ToBuffer(addr) {
    let a = addr.split('%')[0];
    if (a.includes('.')) {                               // ::ffff:1.2.3.4
        const idx = a.lastIndexOf(':');
        const v4 = a.slice(idx + 1).split('.').map(Number);
        a = a.slice(0, idx + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
    }
    const [head, tail] = a.split('::');
    const h = head ? head.split(':') : [];
    const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
    const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
    const out = Buffer.alloc(16);
    groups.forEach((g, i) => out.writeUInt16BE(parseInt(g || '0', 16), i * 2));
    return out;
}

function bufferToIpv6(buf) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(buf.readUInt16BE(i).toString(16));
    // compress the longest run of zeros
    let best = -1, bestLen = 0;
    for (let i = 0; i < 8;) {
        if (groups[i] !== '0') { i++; continue; }
        let j = i; while (j < 8 && groups[j] === '0') j++;
        if (j - i > bestLen && j - i > 1) { best = i; bestLen = j - i; }
        i = j;
    }
    if (best < 0) return groups.join(':');
    return groups.slice(0, best).join(':') + '::' + groups.slice(best + bestLen).join(':');
}

function errorCodeValue(code, reason) {
    const r = Buffer.from(reason || '', 'utf8');
    const out = Buffer.alloc(4 + r.length);
    out[2] = Math.floor(code / 100);
    out[3] = code % 100;
    r.copy(out, 4);
    return out;
}

const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; };

// ------------------------------------------------------------------ encode

/**
 * @param {object} m
 * @param {number} m.method
 * @param {number} m.cls
 * @param {Buffer} m.tid
 * @param {Array<[number, Buffer]>} m.attrs
 * @param {object} [o]
 * @param {Buffer} [o.key]          MESSAGE-INTEGRITY key
 * @param {boolean} [o.fingerprint]
 */
function encode({ method, cls, tid, attrs: list = [] }, { key = null, fingerprint = true } = {}) {
    const parts = [];
    let len = 0;
    for (const [type, value] of list) {
        const pad = (4 - (value.length % 4)) % 4;
        const head = Buffer.alloc(4);
        head.writeUInt16BE(type, 0);
        head.writeUInt16BE(value.length, 2);
        parts.push(head, value);
        if (pad) parts.push(Buffer.alloc(pad));
        len += 4 + value.length + pad;
    }
    const header = Buffer.alloc(HEADER);
    header.writeUInt16BE(messageType(method, cls), 0);
    header.writeUInt32BE(MAGIC, 4);
    tid.copy(header, 8);
    let body = Buffer.concat(parts, len);
    if (key) {
        header.writeUInt16BE(len + 24, 2);
        const mac = crypto.createHmac('sha1', key).update(header).update(body).digest();
        const mi = Buffer.alloc(24);
        mi.writeUInt16BE(ATTR.MESSAGE_INTEGRITY, 0);
        mi.writeUInt16BE(20, 2);
        mac.copy(mi, 4);
        body = Buffer.concat([body, mi]);
        len += 24;
    }
    if (fingerprint) {
        header.writeUInt16BE(len + 8, 2);
        const crc = (crc32(Buffer.concat([header, body])) ^ 0x5354554e) >>> 0;
        const fp = Buffer.alloc(8);
        fp.writeUInt16BE(ATTR.FINGERPRINT, 0);
        fp.writeUInt16BE(4, 2);
        fp.writeUInt32BE(crc, 4);
        body = Buffer.concat([body, fp]);
        len += 8;
    }
    header.writeUInt16BE(len, 2);
    return Buffer.concat([header, body]);
}

/** Verifies MESSAGE-INTEGRITY of a decoded message with `key`. */
function checkIntegrity(msg, key) {
    if (msg.integrityAt < 0) return false;
    const head = Buffer.from(msg.raw.subarray(0, msg.integrityAt));
    head.writeUInt16BE(msg.integrityAt - HEADER + 24, 2);
    const mac = crypto.createHmac('sha1', key).update(head).digest();
    const got = msg.raw.subarray(msg.integrityAt + 4, msg.integrityAt + 24);
    return got.length === 20 && crypto.timingSafeEqual(mac, got);
}

function checkFingerprint(msg) {
    if (msg.fingerprintAt < 0) return true;
    const head = Buffer.from(msg.raw.subarray(0, msg.fingerprintAt));
    head.writeUInt16BE(msg.fingerprintAt - HEADER + 8, 2);
    return ((crc32(head) ^ 0x5354554e) >>> 0) === msg.raw.readUInt32BE(msg.fingerprintAt + 4);
}

/** Long-term credential key: MD5(username ":" realm ":" password). */
const longTermKey = (username, realm, password) => crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest();

module.exports = {
    MAGIC, HEADER, METHOD, CLASS, ATTR, messageType, splitType, crc32, isStun, isChannelData,
    decode, encode, attr, attrs, encodeXorAddress, decodeXorAddress, errorCodeValue, u32,
    checkIntegrity, checkFingerprint, longTermKey, ipv6ToBuffer, bufferToIpv6
};
