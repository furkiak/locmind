'use strict';

/*
 * Static file serving without dependencies: safe path resolution, strong ETags,
 * in-memory cache with lazily built gzip / brotli variants, Range requests for media.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.flac': 'audio/flac', '.wav': 'audio/wav', '.weba': 'audio/webm', '.webm': 'audio/webm'
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.map']);
const LONG_CACHE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff2']);
const MAX_CACHED = 2 * 1024 * 1024;

const mimeOf = file => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

/** Resolves a URL path inside `root`, or returns null for anything suspicious. */
function safeJoin(root, urlPath) {
    let decoded;
    try { decoded = decodeURIComponent(urlPath); } catch (_) { return null; }
    if (decoded.includes('\0') || decoded.includes('\\')) return null;
    const full = path.join(root, path.normalize('/' + decoded));
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    return full;
}

function pickEncoding(req, ext, size) {
    if (!COMPRESSIBLE.has(ext) || size < 512) return null;
    const ae = String(req.headers['accept-encoding'] || '');
    if (/\bbr\b/.test(ae)) return 'br';
    if (/\bgzip\b/.test(ae)) return 'gzip';
    return null;
}

function parseRange(header, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
    if (!m) return null;
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null && end === null) return null;
    if (start === null) { start = Math.max(0, size - end); end = size - 1; }
    else if (end === null || end >= size) end = size - 1;
    if (start > end || start >= size) return 'unsatisfiable';
    return { start, end };
}

class StaticFiles {
    /**
     * @param {Array<{prefix:string, dir:string}>} mounts  URL prefix -> directory (first match wins)
     */
    constructor(mounts) {
        this.mounts = mounts.map(m => ({ prefix: m.prefix, dir: path.resolve(m.dir) }));
        this.cache = new Map();
    }

    resolve(urlPath) {
        for (const m of this.mounts) {
            if (m.prefix === '/' || urlPath === m.prefix || urlPath.startsWith(m.prefix + '/')) {
                const rest = m.prefix === '/' ? urlPath : urlPath.slice(m.prefix.length) || '/';
                const file = safeJoin(m.dir, rest);
                if (file) return file;
            }
        }
        return null;
    }

    entry(file, stat) {
        const hit = this.cache.get(file);
        if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
        const body = fs.readFileSync(file);
        const e = {
            mtimeMs: stat.mtimeMs, size: stat.size, body,
            etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"',
            variants: {}
        };
        this.cache.set(file, e);
        return e;
    }

    variant(e, enc) {
        if (!e.variants[enc]) {
            e.variants[enc] = enc === 'br'
                ? zlib.brotliCompressSync(e.body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } })
                : zlib.gzipSync(e.body, { level: 9 });
        }
        return e.variants[enc];
    }

    /** Returns true when the request was handled. */
    serve(req, res, urlPath, extraHeaders = {}) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return false;
        let file = this.resolve(urlPath);
        if (!file) return false;
        let stat;
        try {
            stat = fs.statSync(file);
            if (stat.isDirectory()) { file = path.join(file, 'index.html'); stat = fs.statSync(file); }
        } catch (_) { return false; }
        if (!stat.isFile()) return false;

        const ext = path.extname(file).toLowerCase();
        const headers = {
            'Content-Type': mimeOf(file),
            'Cache-Control': LONG_CACHE.has(ext) ? 'public, max-age=86400' : 'no-cache',
            'Accept-Ranges': 'bytes',
            ...extraHeaders
        };

        if (stat.size > MAX_CACHED) return this.stream(req, res, file, stat, headers);

        const e = this.entry(file, stat);
        headers.ETag = e.etag;
        if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); res.end(); return true; }

        const range = req.headers.range ? parseRange(req.headers.range, e.size) : null;
        if (range === 'unsatisfiable') { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${e.size}` }); res.end(); return true; }
        if (range) {
            headers['Content-Range'] = `bytes ${range.start}-${range.end}/${e.size}`;
            headers['Content-Length'] = range.end - range.start + 1;
            res.writeHead(206, headers);
            res.end(req.method === 'HEAD' ? undefined : e.body.subarray(range.start, range.end + 1));
            return true;
        }
        const enc = pickEncoding(req, ext, e.size);
        const body = enc ? this.variant(e, enc) : e.body;
        if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';
        if (enc) headers['Content-Encoding'] = enc;
        headers['Content-Length'] = body.length;
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : body);
        return true;
    }

    stream(req, res, file, stat, headers) {
        const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
        headers.ETag = etag;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
        const range = req.headers.range ? parseRange(req.headers.range, stat.size) : null;
        if (range === 'unsatisfiable') { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}` }); res.end(); return true; }
        let start = 0, end = stat.size - 1, status = 200;
        if (range) { ({ start, end } = range); status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`; }
        headers['Content-Length'] = end - start + 1;
        res.writeHead(status, headers);
        if (req.method === 'HEAD') { res.end(); return true; }
        const rs = fs.createReadStream(file, { start, end });
        rs.on('error', () => res.destroy());
        rs.pipe(res);
        return true;
    }
}

module.exports = { StaticFiles, safeJoin, parseRange, mimeOf };
