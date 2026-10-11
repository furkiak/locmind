'use strict';

const MAX_QUEUE = 30;

/**
 * Per-room shared jukebox. Every queued item has a unique id so concurrent
 * "ended" reports from several listeners can never skip more than one song.
 */
class MusicQueue {
    constructor(now = Date.now) {
        this.now = now;
        this.current = null;
        this.queue = [];
        this.startedAt = 0;
        this.seq = 0;
    }

    add({ videoId, title, addedBy }) {
        if (this.queue.length >= MAX_QUEUE) return null;
        const item = { id: ++this.seq, videoId, title, addedBy };
        this.queue.push(item);
        if (!this.current) this.advance();
        return item;
    }

    advance() {
        const next = this.queue.shift() || null;
        this.current = next;
        this.startedAt = next ? this.now() : 0;
        return next;
    }

    /** Called when a listener reports the current song finished (or failed to load). */
    ended(songId) {
        if (!this.current || this.current.id !== songId) return false;
        this.advance();
        return true;
    }

    skip() {
        if (!this.current) return false;
        this.advance();
        return true;
    }

    remove(itemId) {
        const idx = this.queue.findIndex(i => i.id === itemId);
        if (idx === -1) return false;
        this.queue.splice(idx, 1);
        return true;
    }

    /** `elapsedMs` is relative to the server clock, so clients never depend on their own clock. */
    snapshot() {
        return {
            current: this.current,
            queue: this.queue,
            elapsedMs: this.current ? Math.max(0, this.now() - this.startedAt) : 0
        };
    }
}

module.exports = { MusicQueue, MAX_QUEUE };
