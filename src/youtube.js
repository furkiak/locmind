'use strict';

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const URL_RE = /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

function parseVideoId(input) {
    if (typeof input !== 'string') return null;
    const text = input.trim();
    if (ID_RE.test(text)) return text;
    const m = text.match(URL_RE);
    return m ? m[1] : null;
}

async function fetchJson(url, fetchImpl, timeoutMs) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const res = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'Locmind/2.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

class YouTubeService {
    constructor({ instances = [], fetchImpl = globalThis.fetch, timeoutMs = 4500 } = {}) {
        this.instances = instances;
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.titles = new Map(); // videoId -> title (bounded)
    }

    remember(videoId, title) {
        if (!title) return;
        if (this.titles.size > 500) this.titles.delete(this.titles.keys().next().value);
        this.titles.set(videoId, title);
    }

    /** Resolves a trustworthy title for a video (oEmbed, no API key needed). */
    async title(videoId) {
        if (this.titles.has(videoId)) return this.titles.get(videoId);
        if (typeof this.fetch !== 'function') return null;
        try {
            const url = 'https://www.youtube.com/oembed?format=json&url=' +
                encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
            const data = await fetchJson(url, this.fetch, this.timeoutMs);
            const title = typeof data.title === 'string' ? data.title : null;
            this.remember(videoId, title);
            return title;
        } catch (_) {
            return null;
        }
    }

    /** Searches through the configured Invidious instances, first one that answers wins. */
    async search(query) {
        if (typeof this.fetch !== 'function') throw new Error('search-unavailable');
        for (const base of this.instances) {
            try {
                const data = await fetchJson(
                    `${base.replace(/\/$/, '')}/api/v1/search?type=video&q=${encodeURIComponent(query)}`,
                    this.fetch, this.timeoutMs);
                if (!Array.isArray(data)) continue;
                const results = data
                    .filter(v => v && ID_RE.test(v.videoId || ''))
                    .slice(0, 6)
                    .map(v => ({
                        videoId: v.videoId,
                        title: String(v.title || '').slice(0, 120),
                        author: String(v.author || '').slice(0, 60),
                        seconds: Number.isFinite(v.lengthSeconds) ? v.lengthSeconds : 0
                    }));
                results.forEach(r => this.remember(r.videoId, r.title.slice(0, 80)));
                return results;
            } catch (_) { /* try next instance */ }
        }
        throw new Error('search-unavailable');
    }
}

module.exports = { parseVideoId, YouTubeService, ID_RE };
