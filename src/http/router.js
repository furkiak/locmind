'use strict';

/** Minimal router: exact paths and ":param" segments, sync or async handlers. */
class Router {
    constructor() { this.routes = []; }

    add(method, pattern, handler) {
        const keys = [];
        const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '$');
        this.routes.push({ method, re, keys, handler });
        return this;
    }

    get(p, h) { return this.add('GET', p, h); }
    post(p, h) { return this.add('POST', p, h); }
    put(p, h) { return this.add('PUT', p, h); }
    delete(p, h) { return this.add('DELETE', p, h); }

    match(method, pathname) {
        for (const r of this.routes) {
            if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
            const m = r.re.exec(pathname);
            if (!m) continue;
            const params = {};
            r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch (_) { params[k] = m[i + 1]; } });
            return { handler: r.handler, params };
        }
        return null;
    }
}

function sendJson(res, status, data, headers = {}) {
    const body = Buffer.from(JSON.stringify(data));
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
    res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
    const body = Buffer.from(text);
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    res.end(body);
}

class HttpError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/** Reads a request body up to `limit` bytes. */
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > limit) { req.resume(); reject(new HttpError(413, 'too-large')); return; }
        const chunks = [];
        let size = 0, over = false;
        req.on('data', c => {
            if (over) return;
            size += c.length;
            // stop collecting; the caller answers and the connection is closed after the response
            if (size > limit) { over = true; chunks.length = 0; req.pause(); reject(new HttpError(413, 'too-large')); return; }
            chunks.push(c);
        });
        req.on('end', () => { if (!over) resolve(Buffer.concat(chunks, size)); });
        req.on('error', reject);
    });
}

async function readJson(req, limit = 64 * 1024) {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) throw new HttpError(415, 'json-required');
    const buf = await readBody(req, limit);
    try { return JSON.parse(buf.toString('utf8') || 'null'); } catch (_) { throw new HttpError(400, 'invalid-json'); }
}

module.exports = { Router, sendJson, sendText, readBody, readJson, HttpError };
