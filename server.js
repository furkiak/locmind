#!/usr/bin/env node
'use strict';

const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

let config;
try { config = loadConfig(); }
catch (err) { console.error(err.message); process.exit(1); }

const app = createApp({}, config);
const { server, close, log } = app;

server.on('error', err => {
    log.error(err.code === 'EADDRINUSE' ? `Port ${config.PORT} is already in use.` : 'server error', err.code === 'EADDRINUSE' ? undefined : err);
    process.exit(1);
});

server.listen(config.PORT, config.HOST, () => {
    const proto = server.cert || config.TLS_CERT || config.TLS_SELF_SIGNED ? 'https' : 'http';
    log.info(`${config.SERVER_NAME} is running`, { url: `${proto}://localhost:${config.PORT}` });
    if (app.onListening) app.onListening();
});

let closing = false;
function shutdown(signal) {
    if (closing) return;
    closing = true;
    log.info(`${signal} received, shutting down`);
    setTimeout(() => process.exit(0), 5000).unref();
    close().then(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', err => log.error('unhandled rejection', err));

module.exports = app;
