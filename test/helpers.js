'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const made = [];
/** A throw-away data directory, removed when the test process exits. */
function tmpDir(prefix = 'locmind-test-') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(dir);
    return dir;
}
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* ignore */ } } });

module.exports = { tmpDir };
