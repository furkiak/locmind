'use strict';

/* Runtime metrics: a short in-memory history for the admin dashboard and a Prometheus endpoint. */

const { monitorEventLoopDelay } = require('perf_hooks');
const os = require('os');

class Metrics {
    constructor({ hub, world, getTurn = () => null, intervalMs = 5000, keep = 180 }) {
        this.hub = hub;
        this.world = world;
        this.getTurn = getTurn;
        this.history = [];
        this.keep = keep;
        this.http = { total: 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
        this.loop = monitorEventLoopDelay({ resolution: 20 });
        this.loop.enable();
        this.lastCpu = process.cpuUsage();
        this.lastAt = process.hrtime.bigint();
        this.lastBytes = { in: 0, out: 0, turn: 0 };
        this.startedAt = Date.now();
        this.timer = setInterval(() => this.sample(), intervalMs);
        this.timer.unref();
        this.sample();
    }

    countHttp(status) {
        this.http.total++;
        const k = `${Math.floor(status / 100)}xx`;
        if (this.http[k] !== undefined) this.http[k]++;
    }

    sample() {
        const now = process.hrtime.bigint();
        const elapsedUs = Number(now - this.lastAt) / 1000;
        const cpu = process.cpuUsage(this.lastCpu);
        this.lastCpu = process.cpuUsage();
        this.lastAt = now;
        const s = this.hub.stats;
        const turn = this.getTurn();
        const turnBytes = turn ? turn.stats.bytesRelayed : 0;
        const secs = elapsedUs / 1e6 || 1;
        const point = {
            t: Date.now(),
            players: this.world.players.size,
            rooms: Array.from(this.world.rooms.values()).filter(r => !r.builtin).length,
            cpu: Math.round((cpu.user + cpu.system) / elapsedUs * 1000) / 10,          // % of one core
            rss: process.memoryUsage().rss,
            heap: process.memoryUsage().heapUsed,
            loopP50: Math.round(this.loop.percentile(50) / 1e4) / 100,                 // ms
            loopP99: Math.round(this.loop.percentile(99) / 1e4) / 100,
            inKBs: Math.round((s.bytesIn - this.lastBytes.in) / secs / 102.4) / 10,
            outKBs: Math.round((s.bytesOut - this.lastBytes.out) / secs / 102.4) / 10,
            turnKBs: Math.round((turnBytes - this.lastBytes.turn) / secs / 102.4) / 10,
            turnAllocations: turn ? turn.allocations.size : 0
        };
        this.lastBytes = { in: s.bytesIn, out: s.bytesOut, turn: turnBytes };
        this.loop.reset();
        this.history.push(point);
        if (this.history.length > this.keep) this.history.shift();
        return point;
    }

    overview() {
        const turn = this.getTurn();
        return {
            uptime: Math.round((Date.now() - this.startedAt) / 1000),
            node: process.version,
            platform: `${os.type()} ${os.release()} ${os.arch()}`,
            cpus: os.cpus().length,
            load: os.loadavg(),
            current: {
                ...this.history[this.history.length - 1],
                players: this.world.players.size,
                rooms: Array.from(this.world.rooms.values()).filter(r => !r.builtin).length,
                rss: process.memoryUsage().rss
            },
            history: this.history,
            hub: { ...this.hub.stats, clients: this.hub.clients.size },
            http: this.http,
            turn: turn ? turn.snapshot() : null
        };
    }

    prometheus() {
        const p = this.history[this.history.length - 1] || {};
        const s = this.hub.stats;
        const turn = this.getTurn();
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage();
        const lines = [];
        const metric = (name, type, help, value, labels = '') => {
            lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}${labels} ${value}`);
        };
        metric('locmind_players', 'gauge', 'Players currently in the world', this.world.players.size);
        metric('locmind_rooms', 'gauge', 'Player built and permanent rooms', p.rooms || 0);
        metric('locmind_ws_clients', 'gauge', 'Open WebSocket connections', this.hub.clients.size);
        metric('locmind_ws_connections_total', 'counter', 'Accepted WebSocket connections', s.connections);
        metric('locmind_ws_rejected_total', 'counter', 'Rejected WebSocket upgrades', s.rejected);
        metric('locmind_ws_messages_in_total', 'counter', 'Messages received', s.messagesIn);
        metric('locmind_ws_messages_out_total', 'counter', 'Messages sent', s.messagesOut);
        metric('locmind_ws_bytes_in_total', 'counter', 'Bytes received', s.bytesIn);
        metric('locmind_ws_bytes_out_total', 'counter', 'Bytes sent', s.bytesOut);
        metric('locmind_http_requests_total', 'counter', 'HTTP requests', this.http.total);
        metric('locmind_turn_allocations', 'gauge', 'Active TURN allocations', turn ? turn.allocations.size : 0);
        metric('locmind_turn_relayed_bytes_total', 'counter', 'Bytes relayed by TURN', turn ? turn.stats.bytesRelayed : 0);
        metric('locmind_eventloop_lag_p99_seconds', 'gauge', 'Event loop delay p99 over the last sample', (p.loopP99 || 0) / 1000);
        metric('process_resident_memory_bytes', 'gauge', 'Resident memory', mem.rss);
        metric('process_heap_used_bytes', 'gauge', 'V8 heap used', mem.heapUsed);
        metric('process_cpu_seconds_total', 'counter', 'CPU time', (cpu.user + cpu.system) / 1e6);
        metric('process_start_time_seconds', 'gauge', 'Start time', Math.floor(this.startedAt / 1000));
        return lines.join('\n') + '\n';
    }

    close() { clearInterval(this.timer); this.loop.disable(); }
}

module.exports = { Metrics };
