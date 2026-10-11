'use strict';

/* Bans and runtime settings, persisted through the Store. */

const crypto = require('crypto');
const { cleanText } = require('./security');

class Bans {
    constructor(store) {
        this.store = store;
        this.list = (store.read('bans', []) || []).filter(b => b && b.ip);
    }

    save() { this.store.write('bans', this.list); }

    active(now = Date.now()) { return this.list.filter(b => !b.until || b.until > now); }

    isBanned(ip, now = Date.now()) { return !!ip && this.list.some(b => b.ip === ip && (!b.until || b.until > now)); }

    add({ ip, name = '', minutes = 0, reason = '' }) {
        if (!ip) return null;
        const ban = {
            id: crypto.randomBytes(6).toString('hex'), ip, name: cleanText(name, 20), reason: cleanText(reason, 120),
            createdAt: Date.now(), until: minutes > 0 ? Date.now() + minutes * 60000 : null
        };
        this.list = this.list.filter(b => b.ip !== ip);
        this.list.push(ban);
        this.save();
        return ban;
    }

    remove(id) {
        const before = this.list.length;
        this.list = this.list.filter(b => b.id !== id);
        if (this.list.length !== before) { this.save(); return true; }
        return false;
    }

    sweep() {
        const before = this.list.length;
        this.list = this.active();
        if (this.list.length !== before) this.save();
    }
}

const SETTING_DEFAULTS = { motd: '', serverPassword: '', allowUploads: null, wordFilter: '' };

class Settings {
    constructor(store, cfg) {
        this.store = store;
        this.cfg = cfg;
        this.values = { ...SETTING_DEFAULTS, ...(store.read('settings', {}) || {}) };
        this.compileFilter();
    }

    get() { return { ...this.values }; }

    /** Server password: the environment wins over the value set in the admin panel. */
    serverPassword() { return this.cfg.SERVER_PASSWORD || this.values.serverPassword || ''; }
    uploadsAllowed() { return this.values.allowUploads === null ? this.cfg.ALLOW_UPLOADS : !!this.values.allowUploads; }

    set(patch) {
        if (typeof patch.motd === 'string') this.values.motd = cleanText(patch.motd, 280);
        if (typeof patch.serverPassword === 'string') this.values.serverPassword = patch.serverPassword.slice(0, 64);
        if (typeof patch.allowUploads === 'boolean') this.values.allowUploads = patch.allowUploads;
        if (typeof patch.wordFilter === 'string') this.values.wordFilter = patch.wordFilter.slice(0, 2000);
        this.compileFilter();
        this.store.write('settings', this.values);
        return this.get();
    }

    compileFilter() {
        const words = String(this.values.wordFilter || '').split(/[,\n]/).map(w => w.trim()).filter(w => w.length >= 2).slice(0, 200);
        this.filterRe = words.length
            ? new RegExp(`(^|[^\\p{L}\\p{N}])(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'giu')
            : null;
    }

    /** Masks blocked words in chat text. */
    filter(text) {
        if (!this.filterRe) return text;
        return text.replace(this.filterRe, (_, pre, word) => pre + '•'.repeat(Array.from(word).length));
    }
}

module.exports = { Bans, Settings };
