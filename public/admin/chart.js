// Small dependency-free SVG line chart for the admin dashboard.
// One y axis, 2px lines, a 10% area wash for single series, an end dot with its value,
// and a crosshair that snaps to the nearest sample with a tooltip listing every series.

const NS = 'http://www.w3.org/2000/svg';
const M = { top: 12, right: 64, bottom: 24, left: 44 };

function svg(tag, attrs = {}, parent) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        // colours may be CSS custom properties, which only resolve through the style attribute
        if (k === 'fill' || k === 'stroke') el.style[k] = v;
        else el.setAttribute(k, v);
    }
    if (parent) parent.appendChild(el);
    return el;
}

/** Rounds the top of the scale to a clean number and returns 3-5 ticks. */
export function niceScale(max, minTop = 1) {
    const top = Math.max(max, minTop);
    const raw = top / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
    const n = Math.ceil(top / step);
    return { max: step * n, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}

export function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
    return `${+v.toFixed(a < 10 && a % 1 ? 1 : 0)}`;
}

const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const clockSec = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export class LineChart {
    /**
     * @param {HTMLElement} host
     * @param {{series: {key: string, label: string, color: string}[], format: (v:number)=>string, minTop?: number, height?: number, describe: string}} opts
     */
    constructor(host, opts) {
        this.host = host;
        this.opts = { height: 156, minTop: 1, ...opts };
        this.data = [];
        this.focus = -1;
        host.classList.add('chart');

        if (this.opts.series.length > 1) {
            const legend = document.createElement('div');
            legend.className = 'chart-legend';
            for (const s of this.opts.series) {
                const item = document.createElement('span');
                const key = document.createElement('i');
                key.className = 'line-key';
                key.style.background = s.color;
                item.append(key, document.createTextNode(s.label));
                legend.append(item);
            }
            host.append(legend);
        }

        this.wrap = document.createElement('div');
        this.wrap.className = 'chart-plot';
        this.wrap.tabIndex = 0;
        this.wrap.setAttribute('role', 'img');
        this.wrap.setAttribute('aria-label', this.opts.describe);
        host.append(this.wrap);
        this.svg = svg('svg', { class: 'chart-svg', 'aria-hidden': 'true' }, this.wrap);
        this.tip = document.createElement('div');
        this.tip.className = 'chart-tip';
        this.tip.hidden = true;
        this.wrap.append(this.tip);

        this.wrap.addEventListener('pointermove', e => this.pointer(e));
        this.wrap.addEventListener('pointerleave', () => this.setFocus(-1));
        this.wrap.addEventListener('blur', () => this.setFocus(-1));
        this.wrap.addEventListener('focus', () => this.setFocus(this.data.length - 1));
        this.wrap.addEventListener('keydown', e => {
            if (!this.data.length) return;
            if (e.key === 'ArrowLeft') { this.setFocus(Math.max(0, (this.focus < 0 ? this.data.length : this.focus) - 1)); e.preventDefault(); }
            if (e.key === 'ArrowRight') { this.setFocus(Math.min(this.data.length - 1, this.focus + 1)); e.preventDefault(); }
        });
        this.ro = new ResizeObserver(() => this.render());
        this.ro.observe(this.wrap);
    }

    update(points) {
        this.data = points;
        this.render();
    }

    get width() { return Math.max(240, this.wrap.clientWidth); }

    render() {
        const { series, format, minTop, height } = this.opts;
        const W = this.width, H = height;
        const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
        const s = this.svg;
        s.setAttribute('viewBox', `0 0 ${W} ${H}`);
        s.setAttribute('width', W);
        s.setAttribute('height', H);
        while (s.firstChild) s.removeChild(s.firstChild);

        const d = this.data;
        let max = 0;
        for (const p of d) for (const sr of series) max = Math.max(max, p[sr.key] || 0);
        const scale = niceScale(max, minTop);
        this.scale = scale;
        const t0 = d.length ? d[0].t : 0, t1 = d.length ? d[d.length - 1].t : 1;
        const x = t => M.left + (t1 === t0 ? pw : (t - t0) / (t1 - t0) * pw);
        const y = v => M.top + ph - (v / scale.max) * ph;
        this.x = x; this.y = y;

        // grid + y ticks
        const grid = svg('g', { class: 'grid' }, s);
        for (const tv of scale.ticks) {
            const yy = Math.round(y(tv)) + .5;
            svg('line', { x1: M.left, x2: M.left + pw, y1: yy, y2: yy }, grid);
            const label = svg('text', { x: M.left - 8, y: yy + 4, 'text-anchor': 'end', class: 'tick' }, grid);
            label.textContent = compact(tv);
        }
        // x ticks: start, (middle when there is room), end; seconds for short spans
        if (d.length > 1) {
            const fmt = t1 - t0 < 180000 ? clockSec : clock;
            const ticks = [[t0, 'start'], [t1, 'end']];
            if (pw >= 260) ticks.splice(1, 0, [t0 + (t1 - t0) / 2, 'middle']);
            for (const [tt, anchor] of ticks) {
                const label = svg('text', { x: x(tt), y: H - 6, 'text-anchor': anchor, class: 'tick' }, grid);
                label.textContent = fmt(tt);
            }
        }

        if (!d.length) return;
        const marks = svg('g', {}, s);
        for (const sr of series) {
            const pts = d.map(p => `${x(p.t).toFixed(1)},${y(p[sr.key] || 0).toFixed(1)}`);
            if (series.length === 1 && d.length > 1) {
                svg('path', { d: `M${x(d[0].t)},${y(0)} L${pts.join(' L')} L${x(d[d.length - 1].t)},${y(0)} Z`, fill: sr.color, 'fill-opacity': .1, stroke: 'none' }, marks);
            }
            svg('polyline', { points: pts.join(' '), fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, marks);
        }

        // end dots and end labels (pushed apart only when they would overlap)
        const last = d[d.length - 1];
        const ends = series.map(sr => ({ sr, v: last[sr.key] || 0, y: y(last[sr.key] || 0) })).sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].ly = ends[i - 1].y + 14;
        for (const e of ends) {
            svg('circle', { cx: x(last.t), cy: e.y, r: 4, fill: e.sr.color, class: 'end-dot' }, marks);
            const ly = e.ly || e.y;
            if (e.ly) svg('line', { x1: x(last.t) + 6, x2: x(last.t) + 10, y1: e.y, y2: ly, class: 'leader' }, marks);
            const label = svg('text', { x: x(last.t) + 10, y: ly + 4, class: 'end-label' }, marks);
            label.textContent = format(e.v);
        }

        // crosshair layer
        this.cross = svg('g', { class: 'cross' }, s);
        this.setFocus(this.focus >= d.length ? d.length - 1 : this.focus, true);
    }

    pointer(e) {
        if (!this.data.length) return;
        const rect = this.wrap.getBoundingClientRect();
        const px = e.clientX - rect.left;
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < this.data.length; i++) {
            const dx = Math.abs(this.x(this.data[i].t) - px);
            if (dx < bestDist) { bestDist = dx; best = i; }
        }
        this.setFocus(best);
    }

    setFocus(i, silent = false) {
        this.focus = i;
        const c = this.cross;
        if (!c) return;
        while (c.firstChild) c.removeChild(c.firstChild);
        if (i < 0 || !this.data[i]) { this.tip.hidden = true; return; }
        const p = this.data[i];
        const xx = Math.round(this.x(p.t)) + .5;
        svg('line', { x1: xx, x2: xx, y1: M.top, y2: this.opts.height - M.bottom, class: 'cross-line' }, c);
        for (const sr of this.opts.series) svg('circle', { cx: xx, cy: this.y(p[sr.key] || 0), r: 4, fill: sr.color, class: 'end-dot' }, c);

        const tip = this.tip;
        tip.textContent = '';
        const time = document.createElement('div');
        time.className = 'tip-time';
        time.textContent = clockSec(p.t);
        tip.append(time);
        for (const sr of this.opts.series) {
            const row = document.createElement('div');
            row.className = 'tip-row';
            const key = document.createElement('i');
            key.className = 'line-key';
            key.style.background = sr.color;
            const val = document.createElement('strong');
            val.textContent = this.opts.format(p[sr.key] || 0);
            const name = document.createElement('span');
            name.textContent = sr.label;
            row.append(key, val, name);
            tip.append(row);
        }
        tip.hidden = false;
        const W = this.width;
        const left = xx + 12 + tip.offsetWidth > W ? xx - 12 - tip.offsetWidth : xx + 12;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = `${M.top}px`;
        if (!silent) this.wrap.setAttribute('aria-valuetext', `${clockSec(p.t)}: ${this.opts.series.map(sr => `${sr.label} ${this.opts.format(p[sr.key] || 0)}`).join(', ')}`);
    }

    destroy() { this.ro.disconnect(); }
}

/** Tiny sparkline for stat tiles: de-emphasised line, current point in the accent. */
export function sparkline(host, values, { width = 96, height = 28 } = {}) {
    while (host.firstChild) host.removeChild(host.firstChild);
    if (values.length < 2) return;
    const s = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true', class: 'spark' }, host);
    const max = Math.max(...values, 1e-9), min = Math.min(...values, 0);
    const span = max - min || 1;
    const x = i => 2 + i / (values.length - 1) * (width - 6);
    const y = v => height - 4 - (v - min) / span * (height - 8);
    svg('polyline', { points: values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '), class: 'spark-line' }, s);
    svg('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 3, class: 'spark-dot' }, s);
}
