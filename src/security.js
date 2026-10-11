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

const CSP = [
    "default-src 'self'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://i.ytimg.com https://*.ytimg.com",
    "media-src 'self' blob: mediastream:",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
].join('; ');

function securityHeaders(req, res, next) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
}

module.exports = { cleanText, cleanMultiline, isPlainObject, hashPassword, verifyPassword, RateLimiter, securityHeaders, CSP };
