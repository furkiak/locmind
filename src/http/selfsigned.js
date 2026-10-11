'use strict';

/*
 * Self-signed X.509 certificate generator (no openssl needed), so a LAN install can serve
 * HTTPS - which browsers require for microphone and camera access on anything but localhost.
 * EC P-256 key, SHA-256 signature, SANs for localhost, the hostname and every local IP.
 */

const crypto = require('crypto');
const os = require('os');
const net = require('net');

function len(n) {
    if (n < 0x80) return Buffer.from([n]);
    const bytes = [];
    while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p)))); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const int = buf => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const oid = str => {
    const parts = str.split('.').map(Number);
    const out = [40 * parts[0] + parts[1]];
    for (const n of parts.slice(2)) {
        const stack = [n & 0x7f];
        let v = n >> 7;
        while (v > 0) { stack.unshift(0x80 | (v & 0x7f)); v >>= 7; }
        out.push(...stack);
    }
    return tlv(0x06, Buffer.from(out));
};
const utf8 = s => tlv(0x0c, Buffer.from(s, 'utf8'));
const octets = b => tlv(0x04, b);
const bits = b => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const explicit = (n, p) => tlv(0xa0 + n, p);
const utcTime = d => {
    const p = v => String(v).padStart(2, '0');
    return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`));
};

function ipBytes(ip) {
    if (net.isIPv4(ip)) return Buffer.from(ip.split('.').map(Number));
    const { ipv6ToBuffer } = require('../turn/stun');
    return ipv6ToBuffer(ip);
}

function localNames() {
    const dns = new Set(['localhost', os.hostname()]);
    const ips = new Set(['127.0.0.1', '::1']);
    for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (!i.address.startsWith('fe80')) ips.add(i.address);
    return { dns: Array.from(dns).filter(n => /^[A-Za-z0-9.-]+$/.test(n)), ips: Array.from(ips) };
}

/** @returns {{key: string, cert: string}} PEM strings */
function generateSelfSigned({ commonName = 'Locmind', days = 825, dns, ips } = {}) {
    const names = localNames();
    dns = dns || names.dns;
    ips = ips || names.ips;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const sigAlg = seq(oid('1.2.840.10045.4.3.2'));                       // ecdsa-with-SHA256
    const name = seq(set(seq(oid('2.5.4.3'), utf8(commonName))), set(seq(oid('2.5.4.10'), utf8('Locmind self-signed'))));
    const now = new Date(Date.now() - 60000);
    const until = new Date(now.getTime() + days * 86400000);
    const san = seq(...dns.map(d => tlv(0x82, Buffer.from(d))), ...ips.map(ip => tlv(0x87, ipBytes(ip))));
    const extensions = explicit(3, seq(
        seq(oid('2.5.29.17'), octets(san)),                                   // subjectAltName
        seq(oid('2.5.29.19'), tlv(0x01, Buffer.from([0xff])), octets(seq())), // basicConstraints (critical, CA:false)
        seq(oid('2.5.29.15'), tlv(0x01, Buffer.from([0xff])), octets(tlv(0x03, Buffer.from([0x07, 0x80])))), // keyUsage: digitalSignature
        seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1'))))          // extKeyUsage: serverAuth
    ));
    const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
    const tbs = seq(
        explicit(0, int(Buffer.from([2]))),
        int(serial),
        sigAlg,
        name,
        seq(utcTime(now), utcTime(until)),
        name,
        publicKey.export({ type: 'spki', format: 'der' }),
        extensions
    );
    const signature = crypto.sign('sha256', tbs, privateKey);
    const der = seq(tbs, sigAlg, bits(signature));
    const pem = (label, buf) => `-----BEGIN ${label}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
    return { cert: pem('CERTIFICATE', der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

module.exports = { generateSelfSigned };
