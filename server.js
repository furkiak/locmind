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
    const base = `${app.secure ? 'https' : 'http'}://localhost:${config.PORT}`;
    log.info(`${config.SERVER_NAME} ${app.version} is running`, { url: base });
    log.info('admin panel', { url: `${base}/admin` });
    if (app.secretsCreated && !app.adminTokenFromEnv) log.info(`admin token (shown once, also stored in ${config.DATA_DIR}/secrets.json)`, { token: app.adminToken });
    else if (!app.adminTokenFromEnv) log.info(`admin token is stored in ${config.DATA_DIR}/secrets.json`);
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
