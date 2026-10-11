'use strict';

const crypto = require('crypto');

// Control characters, bidi overrides and zero-width characters are never legit in names/chat.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Normalises user text: string-coerce, strip unsafe characters, collapse spaces, cut by code points. */
function cleanText(value, maxLen) {
    if (typeof value !== 'string') return '';
    const text = value.normalize('NFC').replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
    const chars = Array.from(text);
    return chars.length > maxLen ? chars.slice(0, maxLen).join('') : text;
}

/** Multi-line variant for the shared notepad (keeps line breaks). */
function cleanMultiline(value, maxLen) {
    if (typeof value !== 'string') return '';
    const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, '');
    const chars = Array.from(text);
    return chars.length > maxLen ? chars.slice(0, maxLen).join('') : text;
}

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, 32, { N: 2048 });
    return { salt, hash };
}

function verifyPassword(password, record) {
    if (!record || typeof password !== 'string') return false;
    const hash = crypto.scryptSync(password, record.salt, 32, { N: 2048 });
    return crypto.timingSafeEqual(hash, record.hash);
}

/** Sliding-window rate limiter keyed by (id, action). */
class RateLimiter {
    constructor(now = Date.now) {
        this.now = now;
        this.buckets = new Map();
    }

    allow(id, action, limit, windowMs) {
        const key = `${id}:${action}`;
        const t = this.now();
        let stamps = this.buckets.get(key);
        if (!stamps) { stamps = []; this.buckets.set(key, stamps); }
        let drop = 0;
        while (drop < stamps.length && stamps[drop] <= t - windowMs) drop++;
        if (drop) stamps.splice(0, drop);
        if (stamps.length >= limit) return false;
        stamps.push(t);
        return true;
    }

    /** Number of events recorded for (id, action) inside the window, without recording a new one. */
    count(id, action, windowMs) {
        const stamps = this.buckets.get(`${id}:${action}`);
        if (!stamps) return 0;
        const t = this.now();
        return stamps.filter(s => s > t - windowMs).length;
    }

    forget(id) {
        const prefix = `${id}:`;
        for (const key of this.buckets.keys()) if (key.startsWith(prefix)) this.buckets.delete(key);
    }

    /** Drops idle buckets (used for IP keyed limiters that never get an explicit forget()). */
    sweep(maxAgeMs = 60000) {
        const t = this.now();
        for (const [key, stamps] of this.buckets) {
            if (!stamps.length || stamps[stamps.length - 1] < t - maxAgeMs) this.buckets.delete(key);
        }
    }
}

const HOST_RE = /^[A-Za-z0-9.\-:[\]]{1,255}$/;

/** Builds the Content-Security-Policy for one request (YouTube sources only when enabled). */
function buildCsp(req, { youtube = false } = {}) {
    const host = HOST_RE.test(String(req.headers.host || '')) ? req.headers.host : '';
    const ws = host ? ` ws://${host} wss://${host}` : '';
    const yt = youtube;
    return [
        "default-src 'self'",
        "script-src 'self'" + (yt ? ' https://www.youtube.com https://s.ytimg.com' : ''),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:" + (yt ? ' https://i.ytimg.com' : ''),
        "media-src 'self' blob: mediastream:",
        "frame-src " + (yt ? 'https://www.youtube.com https://www.youtube-nocookie.com' : "'none'"),
        "connect-src 'self'" + ws,
        "font-src 'self'",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'"
    ].join('; ');
}

function isSecureRequest(req, trustProxy) {
    if (req.socket && req.socket.encrypted) return true;
    return trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function applySecurityHeaders(req, res, { youtube = false, trustProxy = false } = {}) {
    res.setHeader('Content-Security-Policy', buildCsp(req, { youtube }));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (isSecureRequest(req, trustProxy)) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

module.exports = { cleanText, cleanMultiline, isPlainObject, hashPassword, verifyPassword, RateLimiter, buildCsp, applySecurityHeaders, isSecureRequest };
