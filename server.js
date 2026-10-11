'use strict';

const config = require('./src/config');
const { createApp } = require('./src/app');

const { server, close, world } = createApp();

server.on('error', err => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${config.PORT} is already in use.` : err);
    process.exit(1);
});

server.listen(config.PORT, config.HOST, () => {
    console.log(`Locmind is running on http://localhost:${config.PORT}`);
});

let closing = false;
function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down...`);
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref();
    close().then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

module.exports = { server, world };
