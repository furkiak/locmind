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
