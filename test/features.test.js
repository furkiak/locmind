'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const W = require('../shared/world');
const { createApp } = require('../src/app');
const { bootApp, client, join, walkTo, sleep, slotCenter, enterPlot } = require('./helpers');

const { C } = W;

test('profiles, direct messages, waves, typing and chat history', async t => {
    const ctx = await bootApp();
    const a = await join(ctx, 'Ada', { avatar: 'e:🦊:orange', status: 'busy', statusText: 'Deep work' });
    const b = await join(ctx, 'Bob');
    t.after(async () => { a.close(); b.close(); await ctx.close(); });

    const me = a.me.players.find(p => p.id === a.id);
    assert.equal(me.avatar, 'e:🦊:orange');
    assert.equal(me.status, 'busy');
    assert.equal(me.statusText, 'Deep work');

    const res = await a.call('profile:set', { status: 'dnd', statusText: 'Presenting', avatar: 'e:💩:red' });
    assert.equal(res.status, 'dnd');
    assert.equal(res.avatar, 'e:🦊:orange', 'invalid avatar is ignored');
    const [prof] = await b.waitFor('player:profile', x => x.id === a.id);
    assert.equal(prof.statusText, 'Presenting');

    assert.equal((await a.call('dm', { to: b.id, text: 'psst <b>hi</b>' })).ok, true);
    const [dm] = await b.waitFor('dm');
    assert.equal(dm.text, 'psst <b>hi</b>');
    assert.equal(dm.fromName, 'Ada');
    await a.waitFor('dm', m => m.to === b.id);   // sender gets the echo for their own history
    assert.equal((await a.call('dm', { to: 'nobody', text: 'x' })).error, 'not-found');

    assert.equal((await a.call('wave', { to: b.id })).ok, true);
    assert.equal((await a.call('wave', { to: b.id })).error, 'rate-limit', 'one wave per person every few seconds');
    await b.waitFor('waved', w => w.from === a.id);

    a.emit('typing', { on: true });
    await b.waitFor('typing', x => x.id === a.id && x.on);

    a.emit('chat', 'public hello');
    await b.waitFor('chat', m => m.text === 'public hello');
    const c = await join(ctx, 'Cem');
    t.after(() => c.close());
    assert.ok(c.me.chat.some(m => m.text === 'public hello'), 'late joiners get the recent public chat');
});

test('admin word filter masks chat', async t => {
    const ctx = await bootApp();
    ctx.settings.set({ wordFilter: 'darn, heck' });
    const a = await join(ctx, 'Ada');
    t.after(async () => { a.close(); await ctx.close(); });
    a.emit('chat', 'oh heck, darned thing');
    const [m] = await a.waitFor('chat');
    assert.equal(m.text, 'oh ••••, darned thing');
});

test('room owner tools: settings, password change, kick; raise hand, polls, timer', async t => {
    const ctx = await bootApp();
    const owner = await join(ctx, 'Owner');
    const guest = await join(ctx, 'Guest');
    const third = await join(ctx, 'Third');
    t.after(async () => { owner.close(); guest.close(); third.close(); await ctx.close(); });
    const slot = ctx.world.slots[6];
    await enterPlot(ctx, owner, slot);
    assert.equal((await owner.call('room:create', { slotId: slot.id, name: 'Team', password: 'one', topic: 'Weekly sync' })).ok, true);
    assert.equal(ctx.world.publicRoom(ctx.world.rooms.get(slot.id)).topic, 'Weekly sync');

    // guest unlocks and walks in, third only learns the old password
    assert.equal((await guest.call('room:password', { slotId: slot.id, password: 'one' })).ok, true);
    assert.equal((await third.call('room:password', { slotId: slot.id, password: 'one' })).ok, true);
    const door = { x: W.doorStart(slot) + C.DOOR_SIZE / 2 - C.PLAYER_SIZE / 2, y: slot.y + slot.h + 30 };
    const pg = ctx.world.players.get(guest.id);
    pg.x = door.x; pg.y = door.y;
    await walkTo(ctx, guest, door.x, slot.y + slot.h - 80);
    assert.equal(pg.roomId, slot.id);

    // only the owner can change settings
    assert.equal((await guest.call('room:settings', { slotId: slot.id, name: 'Hijack' })).error, 'not-owner');
    assert.equal((await owner.call('room:settings', { slotId: slot.id, name: 'Core Team', color: 'pink', password: 'two' })).ok, true);
    const [upd] = await third.waitFor('room:updated', r => r.id === slot.id);
    assert.equal(upd.name, 'Core Team');
    assert.equal(upd.color, 'pink');
    assert.equal(pg.roomId, slot.id, 'people inside keep access after a password change');
    const p3 = ctx.world.players.get(third.id);
    p3.x = door.x; p3.y = door.y; p3.budget = 320;
    third.emit('move', { x: door.x, y: slot.y + slot.h - 20, dirX: 0, dirY: -1 });
    await third.waitFor('player:snap');
    assert.notEqual(p3.roomId, slot.id, 'the old password no longer opens the door');

    // raise hand
    guest.emit('hand', { up: true });
    const [hands] = await owner.waitFor('hands:update', h => h.hands.length === 1);
    assert.equal(hands.hands[0].name, 'Guest');
    owner.emit('hand', { target: guest.id, up: false });
    await owner.waitFor('hands:update', h => h.hands.length === 0);

    // poll
    assert.equal((await guest.call('poll:create', { question: 'Lunch?', options: ['Pizza', 'Sushi', ''] })).ok, true);
    const [pu] = await owner.waitFor('poll:update', u => u.poll && u.poll.question === 'Lunch?');
    assert.deepEqual(pu.poll.options, ['Pizza', 'Sushi']);
    owner.emit('poll:vote', { pollId: pu.poll.id, option: 1 });
    guest.emit('poll:vote', { pollId: pu.poll.id, option: 1 });
    guest.emit('poll:vote', { pollId: pu.poll.id, option: 0 });   // changing your mind replaces the vote
    await sleep(100);
    const tally = ctx.world.publicPoll(ctx.world.rooms.get(slot.id));
    assert.deepEqual(tally.counts, [1, 1]);
    assert.equal(tally.total, 2);
    owner.emit('poll:close', { pollId: pu.poll.id });
    await guest.waitFor('poll:update', u => u.poll && u.poll.closed);

    // timer
    assert.equal((await owner.call('timer:start', { seconds: 300, label: 'Retro' })).ok, true);
    const [tu] = await guest.waitFor('timer:update', u => u.timer);
    assert.ok(tu.timer.remainingMs > 299000 && tu.timer.remainingMs <= 300000);
    assert.equal((await owner.call('timer:start', { seconds: 1 })).ok, false, 'silly durations are refused');

    // kick: guest is pushed out and cannot come back for a while
    assert.equal((await guest.call('room:kick', { slotId: slot.id, target: owner.id })).error, 'not-owner');
    assert.equal((await owner.call('room:kick', { slotId: slot.id, target: guest.id })).ok, true);
    await guest.waitFor('moderation', m => m.type === 'room-kick');
    assert.equal(pg.roomId, null);
    assert.ok(pg.y > slot.y + slot.h);
    assert.equal((await guest.call('room:password', { slotId: slot.id, password: 'two' })).ok, false, 'banned from this room');
});

test('server password, IP bans and the admin API', async t => {
    const ctx = await bootApp({ SERVER_PASSWORD: 'letmein', ADMIN_TOKEN: 'admin-secret' });
    t.after(() => ctx.close());
    const cfg = await (await fetch(ctx.url + '/api/config')).json();
    assert.equal(cfg.passwordRequired, true);

    const anon = await client(ctx);
    assert.equal((await anon.call('join', { nickname: 'X' })).error, 'server-password');
    assert.equal((await anon.call('join', { nickname: 'X', serverPassword: 'nope' })).error, 'server-password');
    const ok = await anon.call('join', { nickname: 'X', serverPassword: 'letmein' });
    assert.equal(ok.ok, true);
    t.after(() => anon.close());

    const api = (path, opts = {}) => fetch(ctx.url + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.token === false ? {} : { authorization: `Bearer ${opts.token || 'admin-secret'}` }) } });
    assert.equal((await api('/api/admin/overview', { token: false })).status, 401);
    assert.equal((await api('/api/admin/overview', { token: 'wrong' })).status, 401);
    const ov = await (await api('/api/admin/overview')).json();
    assert.equal(ov.current.players, 1);
    assert.ok(Array.isArray(ov.history));

    const players = (await (await api('/api/admin/players')).json()).players;
    assert.equal(players[0].nickname, 'X');
    assert.equal(players[0].ip, '127.0.0.1');

    // mute + announce
    assert.equal((await (await api(`/api/admin/players/${anon.id}/mute`, { method: 'POST', body: JSON.stringify({ minutes: 5 }) })).json()).ok, true);
    await anon.waitFor('moderation', m => m.type === 'chat-muted');
    anon.emit('chat', 'can you hear me');
    await sleep(100);
    assert.ok(!anon.events.some(e => e[0] === 'chat'), 'muted players cannot chat');
    await api('/api/admin/announce', { method: 'POST', body: JSON.stringify({ text: 'Maintenance at 5' }) });
    await anon.waitFor('announce', a => a.text === 'Maintenance at 5');

    // permanent room survives a restart, together with its notes
    const slot = ctx.world.slots[2];
    const created = await (await api('/api/admin/rooms', { method: 'POST', body: JSON.stringify({ slotId: slot.id, name: 'Lobby', color: 'teal', topic: 'Say hi' }) })).json();
    assert.equal(created.ok, true);
    assert.equal(created.room.permanent, true);
    ctx.world.rooms.get(slot.id).note = { text: 'house rules', rev: 1 };
    ctx.store.write('rooms', ctx.world.permanentRooms());

    // ban kicks and blocks the address (this test client is 127.0.0.1)
    const banned = await (await api(`/api/admin/players/${anon.id}/ban`, { method: 'POST', body: JSON.stringify({ minutes: 1, reason: 'spam' }) })).json();
    assert.equal(banned.ok, true);
    await anon.waitFor('kicked', k => k.reason === 'banned');
    await assert.rejects(client(ctx), /403/);
    const bans = (await (await api('/api/admin/bans')).json()).bans;
    assert.equal(bans.length, 1);
    assert.equal((await (await api(`/api/admin/bans/${bans[0].id}`, { method: 'DELETE' })).json()).ok, true);
    const back = await client(ctx);
    back.close();

    // settings
    const st = await (await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ motd: 'Welcome to the lab' }) })).json();
    assert.equal(st.settings.motd, 'Welcome to the lab');
    assert.equal((await (await fetch(ctx.url + '/api/config')).json()).motd, 'Welcome to the lab');

    // restart with the same data directory
    await ctx.close();
    const again = createApp({ LOG_LEVEL: 'silent', TURN: false, DATA_DIR: ctx.config.DATA_DIR, MEDIA_DIR: ctx.config.MEDIA_DIR });
    t.after(() => again.close());
    const room = again.world.rooms.get(slot.id);
    assert.ok(room && room.permanent);
    assert.equal(room.note.text, 'house rules');
    assert.equal(again.settings.get().motd, 'Welcome to the lab');
});

test('admin brute force protection', async t => {
    const ctx = await bootApp({ ADMIN_TOKEN: 'right' });
    t.after(() => ctx.close());
    for (let i = 0; i < 20; i++) await fetch(ctx.url + '/api/admin/overview', { headers: { authorization: 'Bearer wrong' } });
    const r = await fetch(ctx.url + '/api/admin/overview', { headers: { authorization: 'Bearer right' } });
    assert.equal(r.status, 429, 'locked out after too many wrong tokens');
});

test('music library: uploads are sniffed, listed for players, streamed with ranges, queueable', async t => {
    const ctx = await bootApp();
    const a = await join(ctx, 'DJ');
    t.after(async () => { a.close(); await ctx.close(); });
    const token = a.me.token;

    assert.equal((await fetch(ctx.url + '/api/music/library')).status, 401, 'players only');
    const fake = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), Buffer.alloc(4096, 1)]);
    const notAudio = await fetch(ctx.url + '/api/music/upload', { method: 'POST', headers: { 'x-locmind-token': token, 'content-type': 'application/octet-stream' }, body: Buffer.from('<script>alert(1)</script> not audio at all') });
    assert.equal(notAudio.status, 415);
    const up = await fetch(ctx.url + '/api/music/upload', { method: 'POST', headers: { 'x-locmind-token': token, 'x-title': encodeURIComponent('Lo-fi Beat ☕'), 'content-type': 'audio/mpeg' }, body: fake });
    assert.equal(up.status, 200);
    const { track } = await up.json();
    assert.equal(track.title, 'Lo-fi Beat ☕');
    await a.waitFor('library:update');

    const lib = await (await fetch(ctx.url + '/api/music/library', { headers: { 'x-locmind-token': token } })).json();
    assert.equal(lib.tracks.length, 1);
    const part = await fetch(ctx.url + `/media/music/${track.id}`, { headers: { range: 'bytes=0-2' } });
    assert.equal(part.status, 206);
    assert.equal(Buffer.from(await part.arrayBuffer()).toString('latin1'), 'ID3');
    assert.equal((await fetch(ctx.url + '/media/music/does-not-exist')).status, 404);

    const slot = ctx.world.slots[9];
    await enterPlot(ctx, a, slot);
    assert.equal((await a.call('room:create', { slotId: slot.id, name: 'Studio' })).ok, true);
    assert.equal((await a.call('music:add', { trackId: track.id })).ok, true);
    const [mu] = await a.waitFor('music:update', u => u.current);
    assert.equal(mu.current.source, 'library');
    assert.equal(mu.current.trackId, track.id);
    assert.equal((await a.call('music:add', { trackId: 'nope' })).error, 'not-found');
});

test('uploads respect the size limit and can be disabled', async t => {
    const ctx = await bootApp({ UPLOAD_MAX_BYTES: 1024 });
    const a = await join(ctx, 'U');
    t.after(async () => { a.close(); await ctx.close(); });
    const big = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), Buffer.alloc(4096)]);
    const r = await fetch(ctx.url + '/api/music/upload', { method: 'POST', headers: { 'x-locmind-token': a.me.token }, body: big });
    assert.equal(r.status, 413);
    ctx.settings.set({ allowUploads: false });
    const r2 = await fetch(ctx.url + '/api/music/upload', { method: 'POST', headers: { 'x-locmind-token': a.me.token }, body: Buffer.alloc(10) });
    assert.equal(r2.status, 403);
});

test('metrics are only exposed to localhost or the admin', async t => {
    const ctx = await bootApp({ ADMIN_TOKEN: 'tok' });
    t.after(() => ctx.close());
    const text = await (await fetch(ctx.url + '/metrics')).text();
    assert.match(text, /locmind_players 0/);
    assert.match(text, /process_resident_memory_bytes \d+/);
});

test('self-signed HTTPS works out of the box', async t => {
    const ctx = await bootApp({ TLS_SELF_SIGNED: true });
    t.after(() => ctx.close());
    assert.ok(ctx.url.startsWith('https://'));
    const body = await new Promise((resolve, reject) => {
        https.get(ctx.url + '/healthz', { rejectUnauthorized: false }, res => {
            let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, d, hsts: res.headers['strict-transport-security'] }));
        }).on('error', reject);
    });
    assert.equal(body.status, 200);
    assert.ok(body.hsts, 'HSTS on TLS responses');
    const s = await client(ctx);
    s.close();
});

test('auditorium is a built-in room on the map', async t => {
    const ctx = await bootApp();
    const a = await join(ctx, 'Speaker');
    t.after(async () => { a.close(); await ctx.close(); });
    assert.ok(a.me.rooms.some(r => r.type === 'auditorium' && r.builtin));
    assert.ok(W.onStage(W.AUDITORIUM.stage.x + 50, W.AUDITORIUM.stage.y + 50));
    assert.ok(!W.onStage(W.AUDITORIUM.x + 20, W.AUDITORIUM.y + 600));
});
