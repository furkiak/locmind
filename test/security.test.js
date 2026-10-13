'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, cleanMultiline, hashPassword, verifyPassword, RateLimiter } = require('../src/security');

test('cleanText strips control/bidi chars, collapses space and cuts by code points', () => {
    assert.equal(cleanText('  Hel\u0000lo‮   world  ', 20), 'Hello world');
    assert.equal(cleanText('😀😀😀😀', 2), '😀😀');
    assert.equal(cleanText(42, 5), '');
    assert.equal(cleanText(null, 5), '');
});

test('cleanText never double-escapes (raw text is kept, HTML escaping is the renderer\'s job)', () => {
    assert.equal(cleanText('Tom & <Jerry>', 30), 'Tom & <Jerry>');
});

test('cleanMultiline keeps newlines but removes control characters', () => {
    assert.equal(cleanMultiline('a\r\nb\u0000c', 100), 'a\nbc');
    assert.equal(cleanMultiline('abcdef', 3), 'abc');
});

test('password hashing verifies only the right password', () => {
    const rec = hashPassword('secret');
    assert.ok(verifyPassword('secret', rec));
    assert.ok(!verifyPassword('Secret', rec));
    assert.ok(!verifyPassword(undefined, rec));
    assert.ok(!verifyPassword('secret', null));
    assert.equal(rec.n, 16384, 'new hashes use the stronger cost and record it');
});

test('room passwords saved by older versions (cost 2048, no "n") still verify', () => {
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16);
    const legacy = { salt, hash: crypto.scryptSync('secret', salt, 32, { N: 2048 }) };
    assert.ok(verifyPassword('secret', legacy));
    assert.ok(!verifyPassword('wrong', legacy));
    // an unknown cost value from a damaged file never reaches scrypt
    assert.ok(verifyPassword('secret', { ...legacy, n: 999999999 }));
});

test('permanent rooms keep their password across a save and reload', () => {
    const { World } = require('../src/world');
    const a = new World();
    const plot = [...a.slotsById.values()].find(s => s.type === 'conference');
    assert.ok(a.createPermanentRoom({ slotId: plot.id, name: 'Vault', password: 'hunter2' }).ok);
    const saved = JSON.parse(JSON.stringify(a.permanentRooms()));
    assert.equal(saved[0].password.n, 16384);

    const b = new World();
    b.loadPermanentRooms(saved);
    const room = b.rooms.get(saved[0].slotId);
    assert.ok(verifyPassword('hunter2', room.password));
});

test('rate limiter enforces a sliding window', () => {
    let t = 1000;
    const rl = new RateLimiter(() => t);
    assert.ok(rl.allow('a', 'x', 2, 1000));
    assert.ok(rl.allow('a', 'x', 2, 1000));
    assert.ok(!rl.allow('a', 'x', 2, 1000));
    assert.ok(rl.allow('b', 'x', 2, 1000), 'other ids are independent');
    t += 1001;
    assert.ok(rl.allow('a', 'x', 2, 1000), 'window slid');
    rl.forget('a');
    assert.equal(rl.buckets.has('a:x'), false);
});

test('client address: only proxy-appended X-Forwarded-For entries are trusted', () => {
    const { clientIp } = require('../src/net/hub');
    const req = (xff, remote = '10.0.0.2') => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });
    // no proxy configured: the header is ignored completely
    assert.equal(clientIp(req('6.6.6.6'), 0), '10.0.0.2');
    // one proxy: an attacker can prepend anything, the proxy appends the real address last
    assert.equal(clientIp(req('6.6.6.6, 203.0.113.9'), 1), '203.0.113.9');
    assert.equal(clientIp(req('203.0.113.9'), true), '203.0.113.9');
    // two proxies (CDN + nginx): the second entry from the right
    assert.equal(clientIp(req('6.6.6.6, 203.0.113.9, 172.16.0.5'), 2), '203.0.113.9');
    assert.equal(clientIp(req(null, '::ffff:192.0.2.1'), 1), '192.0.2.1');
});

test('config: TRUST_PROXY accepts true/false or a hop count', () => {
    const { loadConfig } = require('../src/config');
    assert.equal(loadConfig({ argv: [], env: { TRUST_PROXY: 'true' } }).TRUST_PROXY, 1);
    assert.equal(loadConfig({ argv: [], env: { TRUST_PROXY: '2' } }).TRUST_PROXY, 2);
    assert.equal(loadConfig({ argv: [], env: {} }).TRUST_PROXY, 0);
});
