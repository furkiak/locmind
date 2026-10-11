'use strict';

/*
 * Self-hosted music library: files dropped into MEDIA_DIR/music (by the operator) and
 * MEDIA_DIR/uploads (by players, when allowed). Track ids are HMACs of the path so they
 * cannot be guessed; titles come from ID3v2 tags when present, otherwise from the file name.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanText } = require('./security');

const AUDIO_EXT = new Set(['.mp3', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.wav', '.weba', '.webm']);

/** Very small ID3v2 reader: title (TIT2) and artist (TPE1). */
function readId3(file) {
    let fd;
    try {
        fd = fs.openSync(file, 'r');
        const head = Buffer.alloc(10);
        if (fs.readSync(fd, head, 0, 10, 0) < 10 || head.toString('latin1', 0, 3) !== 'ID3') return {};
        const version = head[3];
        const size = (head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f);
        const tag = Buffer.alloc(Math.min(size, 256 * 1024));
        fs.readSync(fd, tag, 0, tag.length, 10);
        const out = {};
        let off = 0;
        while (off + 10 <= tag.length) {
            const id = tag.toString('latin1', off, off + 4);
            if (!/^[A-Z0-9]{4}$/.test(id)) break;
            const fsize = version >= 4
                ? (tag[off + 4] & 0x7f) << 21 | (tag[off + 5] & 0x7f) << 14 | (tag[off + 6] & 0x7f) << 7 | (tag[off + 7] & 0x7f)
                : tag.readUInt32BE(off + 4);
            if (fsize <= 0 || off + 10 + fsize > tag.length) break;
            if (id === 'TIT2' || id === 'TPE1') out[id === 'TIT2' ? 'title' : 'artist'] = decodeText(tag.subarray(off + 10, off + 10 + fsize));
            off += 10 + fsize;
        }
        return out;
    } catch (_) {
        return {};
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

function decodeText(b) {
    const enc = b[0], body = b.subarray(1);
    let s;
    if (enc === 1) {                                   // UTF-16 with BOM
        const le = body[0] === 0xFF && body[1] === 0xFE;
        const data = body.subarray(2);
        s = le ? data.toString('utf16le') : Buffer.from(data).swap16().toString('utf16le');
    } else if (enc === 2) s = Buffer.from(body).swap16().toString('utf16le');
    else if (enc === 3) s = body.toString('utf8');
    else s = body.toString('latin1');
    return s.replace(/\0+$/g, '').trim();
}

/** Checks the first bytes so only real audio files are accepted as uploads. */
function sniffAudio(buf) {
    if (buf.length < 12) return null;
    if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0)) return '.mp3';
    if (buf.toString('latin1', 0, 4) === 'OggS') return '.ogg';
    if (buf.toString('latin1', 0, 4) === 'fLaC') return '.flac';
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return '.wav';
    if (buf.toString('latin1', 4, 8) === 'ftyp') return '.m4a';
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return '.webm';
    return null;
}

function titleFromName(file) {
    return path.basename(file, path.extname(file)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

class Library {
    constructor({ mediaDir, secret, log = null }) {
        this.musicDir = path.join(mediaDir, 'music');
        this.uploadDir = path.join(mediaDir, 'uploads');
        this.secret = secret;
        this.log = log;
        this.tracks = new Map();   // id -> track
        fs.mkdirSync(this.musicDir, { recursive: true });
        fs.mkdirSync(this.uploadDir, { recursive: true });
        this.scan();
        this.watchers = [];
        for (const dir of [this.musicDir, this.uploadDir]) {
            try {
                const w = fs.watch(dir, { persistent: false }, () => this.scheduleScan());
                w.on('error', () => {});
                this.watchers.push(w);
            } catch (_) { /* fs.watch is best effort */ }
        }
    }

    idFor(rel) { return crypto.createHmac('sha256', this.secret).update(rel).digest('base64url').slice(0, 22); }

    scheduleScan() {
        clearTimeout(this.scanTimer);
        this.scanTimer = setTimeout(() => this.scan(), 400);
        this.scanTimer.unref();
    }

    scan() {
        const next = new Map();
        const walk = (dir, source, depth = 0) => {
            let entries = [];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
            for (const e of entries) {
                if (e.name.startsWith('.')) continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory() && depth < 4) { walk(full, source, depth + 1); continue; }
                if (!e.isFile() || !AUDIO_EXT.has(path.extname(e.name).toLowerCase())) continue;
                const rel = path.relative(source === 'upload' ? this.uploadDir : this.musicDir, full);
                const id = this.idFor(`${source}:${rel}`);
                let stat;
                try { stat = fs.statSync(full); } catch (_) { continue; }
                const prev = this.tracks.get(id);
                if (prev && prev.mtimeMs === stat.mtimeMs) { next.set(id, prev); continue; }
                let meta = {};
                if (source === 'upload') { try { meta = JSON.parse(fs.readFileSync(full + '.json', 'utf8')); } catch (_) { meta = {}; } }
                const tags = path.extname(full).toLowerCase() === '.mp3' ? readId3(full) : {};
                const title = cleanText(meta.title || tags.title || titleFromName(full), 80) || 'Untitled';
                next.set(id, {
                    id, file: full, source, size: stat.size, mtimeMs: stat.mtimeMs,
                    title, artist: cleanText(meta.artist || tags.artist || '', 60),
                    uploadedBy: cleanText(meta.uploadedBy || '', 20), createdAt: meta.createdAt || stat.mtimeMs
                });
            }
        };
        walk(this.musicDir, 'library');
        walk(this.uploadDir, 'upload');
        this.tracks = next;
    }

    list() {
        return Array.from(this.tracks.values())
            .sort((a, b) => a.title.localeCompare(b.title))
            .map(t => ({ id: t.id, title: t.title, artist: t.artist, source: t.source, size: t.size, uploadedBy: t.uploadedBy }));
    }

    get(id) { return typeof id === 'string' ? this.tracks.get(id) || null : null; }

    uploadedBytes() {
        let n = 0;
        for (const t of this.tracks.values()) if (t.source === 'upload') n += t.size;
        return n;
    }

    /** Stores an uploaded file after checking it really is audio. */
    saveUpload(buf, { title, uploadedBy }) {
        const ext = sniffAudio(buf);
        if (!ext) return { ok: false, error: 'not-audio' };
        const name = crypto.randomBytes(9).toString('base64url') + ext;
        const full = path.join(this.uploadDir, name);
        fs.writeFileSync(full, buf, { mode: 0o640 });
        fs.writeFileSync(full + '.json', JSON.stringify({ title: cleanText(title, 80), uploadedBy: cleanText(uploadedBy, 20), createdAt: Date.now() }), { mode: 0o640 });
        this.scan();
        const id = this.idFor(`upload:${name}`);
        return { ok: true, track: this.get(id) };
    }

    remove(id) {
        const t = this.get(id);
        if (!t) return false;
        try { fs.unlinkSync(t.file); } catch (_) { /* gone already */ }
        try { fs.unlinkSync(t.file + '.json'); } catch (_) { /* no sidecar */ }
        this.tracks.delete(id);
        return true;
    }

    close() { for (const w of this.watchers) w.close(); clearTimeout(this.scanTimer); }
}

module.exports = { Library, sniffAudio, readId3, titleFromName };
