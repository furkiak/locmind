'use strict';

/* Leveled logger: pretty output on a terminal, JSON lines otherwise (or LOG_FORMAT=json). */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger({ level = 'info', format = process.stdout.isTTY ? 'pretty' : 'json', out = process.stdout } = {}) {
    const min = LEVELS[level] || LEVELS.info;
    const write = (lvl, msg, fields) => {
        if (LEVELS[lvl] < min) return;
        if (format === 'json') {
            out.write(JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...fields }) + '\n');
        } else {
            const color = { debug: 90, info: 36, warn: 33, error: 31 }[lvl];
            const extra = fields && Object.keys(fields).length ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ') : '';
            out.write(`\x1b[${color}m${lvl.padEnd(5)}\x1b[0m ${msg}${extra}\n`);
        }
    };
    return {
        debug: (m, f) => write('debug', m, f), info: (m, f) => write('info', m, f),
        warn: (m, f) => write('warn', m, f), error: (m, f) => write('error', m, f instanceof Error ? { err: f.stack || f.message } : f)
    };
}

module.exports = { createLogger };
