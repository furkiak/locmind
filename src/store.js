'use strict';

/*
 * Tiny JSON persistence for self-hosters: one file per collection inside DATA_DIR,
 * atomic writes (temp file + rename), debounced saves and a flush on shutdown.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
    constructor(dir, { log = null } = {}) {
        this.dir = dir;
        this.log = log;
        this.timers = new Map();
        this.pending = new Map();
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    file(name) {
        if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error('bad store name');
        return path.join(this.dir, name + '.json');
    }

    read(name, fallback) {
        try { return JSON.parse(fs.readFileSync(this.file(name), 'utf8')); }
        catch (err) {
            if (err.code !== 'ENOENT' && this.log) this.log.warn(`could not read ${name}.json, using defaults`, { err: err.message });
            return fallback;
        }
    }

    write(name, data, { mode = 0o600 } = {}) {
        const target = this.file(name);
        const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
        fs.renameSync(tmp, target);
    }

    /** Coalesces frequent saves (whiteboards, notes) into one write per `ms`. */
    schedule(name, getData, ms = 1500) {
        this.pending.set(name, getData);
        if (this.timers.has(name)) return;
        const t = setTimeout(() => this.flushOne(name), ms);
        t.unref();
        this.timers.set(name, t);
    }

    flushOne(name) {
        clearTimeout(this.timers.get(name));
        this.timers.delete(name);
        const get = this.pending.get(name);
        this.pending.delete(name);
        if (!get) return;
        try { this.write(name, get()); } catch (err) { if (this.log) this.log.error(`could not save ${name}.json`, err); }
    }

    flush() { for (const name of Array.from(this.pending.keys())) this.flushOne(name); }

    /** Secrets that must survive restarts (TURN secret, admin token). Generated on first start. */
    secrets() {
        const s = this.read('secrets', {});
        let changed = false;
        if (!s.turnSecret) { s.turnSecret = crypto.randomBytes(32).toString('base64url'); changed = true; }
        if (!s.adminToken) { s.adminToken = crypto.randomBytes(18).toString('base64url'); changed = true; }
        if (changed) this.write('secrets', s);
        return { ...s, created: changed };
    }
}

module.exports = { Store };
