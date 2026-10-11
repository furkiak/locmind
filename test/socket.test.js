'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../shared/world');
const { bootApp, client, join, walkTo, sleep, slotCenter } = require('./helpers');

const { C } = W;
const boot = bootApp;

test('protocol end to end', async t => {
    const ctx = await boot();
    const socks = [];
    t.after(async () => { socks.forEach(s => s.close()); await ctx.close(); });

    await t.test('join returns the world and announces the player', async () => {
        const a = await join(ctx, 'Alice'); socks.push(a);
        assert.equal(a.me.ok, true);
        assert.equal(a.me.slots.length, 22);
        assert.ok(a.me.emojis.images.length >= 4, 'emoji files are served from public/emoji');
        assert.ok(Array.isArray(a.me.iceServers), 'ICE servers come with the join answer');
        assert.ok(!JSON.stringify(a.me).includes('password'), 'no secrets in the world snapshot');
        const b = await join(ctx, 'Bob'); socks.push(b);
        const [pj] = await a.waitFor('player:join', p => p.nickname === 'Bob');
        assert.equal(pj.id, b.id);
        assert.equal(b.me.players.length, 2);
    });

    await t.test('garbage payloads never crash the server', async () => {
        const a = await join(ctx, 'Fuzzer'); socks.push(a);
        for (const ev of ['move', 'chat', 'emoji', 'room:create', 'room:password', 'wb:draw', 'wb:clear', 'note:set', 'music:add', 'music:skip', 'music:ended', 'music:remove', 'peer', 'join', 'kick']) {
            for (const payload of [undefined, null, 5, 'x', [], {}, { x: {}, y: [] }, { roomId: {} }]) {
                a.emit(ev, payload);
            }
        }
        await sleep(100);
        const res = await a.call('join', null);
        assert.equal(res.ok, true, 'server is still alive and joining is idempotent');
        a.close();
        await sleep(50);
        socks.pop();
    });

    await t.test('un-joined sockets are ignored', async () => {
        const lurker = await client(ctx); socks.push(lurker);
        const res = await lurker.call('room:create', { slotId: 'slot_1', name: 'x' });
        assert.equal(res.error, 'not-joined');
    });

    await t.test('rtc signalling is relayed only between known players with valid payloads', async () => {
        const [a, b] = socks;
        b.events.length = 0;
        a.emit('rtc:signal', { to: b.id, channel: 'audio', type: 'offer', data: { sdp: 'v=0', type: 'offer' } });
        const [sig] = await b.waitFor('rtc:signal');
        assert.equal(sig.from, a.id);
        assert.equal(sig.channel, 'audio');
        assert.equal(sig.type, 'offer');

        b.events.length = 0;
        a.emit('rtc:signal', { to: 'nobody', channel: 'audio', type: 'offer', data: {} });
        a.emit('rtc:signal', { to: b.id, channel: 'evil', type: 'offer', data: {} });
        a.emit('rtc:signal', { to: b.id, channel: 'audio', type: 'weird', data: {} });
        a.emit('rtc:signal', { to: b.id, channel: 'audio', type: 'offer', data: 'string' });
        a.emit('rtc:signal', { to: a.id, channel: 'audio', type: 'close' });
        await sleep(100);
        assert.ok(!b.events.some(e => e[0] === 'rtc:signal'));
        assert.ok(!a.events.some(e => e[0] === 'rtc:signal'), 'no echo to self');

        // only the fields a browser needs are relayed
        a.emit('rtc:signal', { to: b.id, channel: 'audio', type: 'candidate', data: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0, junk: 'x'.repeat(5000) } });
        const [cand] = await b.waitFor('rtc:signal', s => s.type === 'candidate');
        assert.deepEqual(Object.keys(cand.data).sort(), ['candidate', 'sdpMLineIndex', 'sdpMid']);

        // nobody can push signals at a player on the other side of the map
        const pa = ctx.world.players.get(a.id), pb = ctx.world.players.get(b.id);
        const saved = { x: pb.x, y: pb.y };
        pb.x = 3000; pb.y = 2800;
        b.events.length = 0;
        a.emit('rtc:signal', { to: b.id, channel: 'audio', type: 'offer', data: { sdp: 'v=0', type: 'offer' } });
        await sleep(100);
        assert.ok(!b.events.some(e => e[0] === 'rtc:signal'), 'far away players are out of reach');
        pb.x = saved.x; pb.y = saved.y;
        assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y) < 1000);
    });

    await t.test('status flags are broadcast and shown to late joiners', async () => {
        const [a, b] = socks;
        b.events.length = 0;
        a.emit('status', { muted: true, cam: true, screen: false });
        const [st] = await b.waitFor('player:status', x => x.id === a.id);
        assert.deepEqual([st.muted, st.cam, st.screen], [true, true, false]);
        const late = await join(ctx, 'Late'); socks.push(late);
        const seen = late.me.players.find(p => p.id === a.id);
        assert.equal(seen.muted, true);
        late.close(); socks.pop();
        a.emit('status', { muted: false, cam: false, screen: false });
    });

    await t.test('movement is batched and illegal jumps are snapped back', async () => {
        const [a, b] = socks;
        const p = ctx.world.players.get(a.id);
        a.emit('move', { x: p.x + 8, y: p.y + 2, dirX: 1, dirY: 0 });
        const [batch] = await b.waitFor('players:move', rows => rows.some(r => r[0] === p.n));
        const mine = batch.find(r => r[0] === p.n);
        // compact row: [short id, integer x, integer y, direction 0..63]
        assert.deepEqual(mine, [p.n, Math.round(p.x), Math.round(p.y), 32]);
        a.events.length = 0;
        a.emit('move', { x: 3000, y: 3000, dirX: 1, dirY: 0 });
        const [snap] = await a.waitFor('player:snap');
        assert.equal(snap.id, a.id);
    });

    await t.test('rooms: create, chat scoping, whiteboard, notes, password', async () => {
        const [a, b] = socks;
        const slot = ctx.world.slots[5];
        const c = slotCenter(slot);
        const pa = ctx.world.players.get(a.id);
        const pb = ctx.world.players.get(b.id);

        // not allowed from afar
        assert.equal((await a.call('room:create', { slotId: slot.id, name: 'Nope' })).error, 'not-in-slot');

        // walk Alice into the slot (no cheating by teleport)
        pa.x = slot.x - 80; pa.y = slot.y + 100; // test-only placement next to the plot
        await walkTo(ctx, a, c.x, c.y);
        const created = await a.call('room:create', { slotId: slot.id, name: 'Lab & <b>Co</b>', password: 'pw', color: 'purple' });
        assert.equal(created.ok, true, JSON.stringify(created));
        const [room] = await b.waitFor('room:created', r => r.id === slot.id);
        assert.equal(room.name, 'Lab & <b>Co</b>', 'raw text kept; clients escape on render');
        assert.equal(room.hasPassword, true);
        assert.equal(room.color, 'purple');
        assert.equal(room.password, undefined);

        const sync = await a.waitFor('room:sync', s => s.roomId === slot.id);
        assert.ok(sync[0].note);

        // room chat does not leak to outsiders
        b.events.length = 0;
        a.emit('chat', 'hello room');
        await sleep(150);
        assert.ok(!b.events.some(e => e[0] === 'chat'), 'private room chat stays private');
        assert.ok(a.events.some(e => e[0] === 'chat' && e[1].text === 'hello room'));

        // whiteboard + notes inside the room
        b.events.length = 0;
        a.emit('wb:draw', { c: '#ff0000', w: 4, s: [[0.1, 0.1, 0.2, 0.2]] });
        a.emit('wb:draw', { c: 'javascript:alert(1)', w: 4, s: [[0.1, 0.1, 0.2, 0.2]] });
        a.emit('note:set', { text: 'meeting notes' });
        const [upd] = await a.waitFor('note:update', n => n.text === 'meeting notes');
        assert.equal(upd.rev, 1);
        assert.equal(ctx.world.rooms.get(slot.id).whiteboard.length, 1, 'invalid colour rejected');

        // Bob cannot walk in without the password
        pb.x = W.doorStart(slot) + C.DOOR_SIZE / 2 - C.PLAYER_SIZE / 2;
        pb.y = slot.y + slot.h + 40;
        await sleep(20);
        pb.budget = 320;
        b.emit('move', { x: pb.x, y: slot.y + slot.h - 20, dirX: 0, dirY: -1 });
        await b.waitFor('player:snap');
        const bad = await b.call('room:password', { slotId: slot.id, password: 'wrong' });
        assert.equal(bad.ok, false);
        const good = await b.call('room:password', { slotId: slot.id, password: 'pw' });
        assert.equal(good.ok, true);
        pb.budget = 320;
        b.events.length = 0;
        b.emit('move', { x: pb.x, y: slot.y + slot.h - 20, dirX: 0, dirY: -1 });
        await sleep(100);
        assert.ok(!b.events.some(e => e[0] === 'player:snap'), 'allowed in after unlocking');
        await walkTo(ctx, b, c.x + 60, c.y + 20);
        const bSync = await b.waitFor('room:sync', s => s.roomId === slot.id);
        assert.equal(bSync[0].note.text, 'meeting notes', 'late joiner catches up');
        assert.equal(bSync[0].whiteboard.length, 1);
    });

    await t.test('music: titles come from the server, ended reports cannot skip songs', async () => {
        const [a, b] = socks;
        const id1 = 'dQw4w9WgXcQ', id2 = 'aaaaaaaaaaa';
        assert.equal((await a.call('music:add', { input: 'not a link' })).error, 'invalid-link');
        assert.equal((await a.call('music:add', { videoId: id1, title: '<img src=x onerror=alert(1)>' })).ok, true);
        assert.equal((await a.call('music:add', { input: `https://youtu.be/${id2}` })).ok, true);
        const [first] = await b.waitFor('music:update', u => u.current && u.current.videoId === id1 && u.queue.length === 1);
        assert.equal(first.current.title, `Title of ${id1}`);
        assert.equal(first.queue.length, 1);
        const songId = first.current.id;
        a.emit('music:ended', { songId });
        b.emit('music:ended', { songId });
        a.emit('music:ended', { songId });
        await sleep(150);
        const room = ctx.world.rooms.get(ctx.world.players.get(a.id).roomId);
        assert.equal(room.music.current.videoId, id2);
        assert.equal(room.music.queue.length, 0);
    });

    await t.test('room disappears once everybody has left', async () => {
        const [a, b] = socks;
        const slot = ctx.world.slots[5];
        a.events.length = 0;
        const c = slotCenter(slot);
        const doorX = W.doorStart(slot) + C.DOOR_SIZE / 2 - C.PLAYER_SIZE / 2;
        for (const s of [a, b]) {
            await walkTo(ctx, s, doorX, c.y + 10);
            await walkTo(ctx, s, doorX, slot.y + slot.h + 40);
        }
        await a.waitFor('room:destroyed', id => id === slot.id);
    });

    await t.test('football: only players inside the stadium can kick; score is shared', async () => {
        const [a, b] = socks;
        b.events.length = 0;
        a.emit('kick');
        await sleep(100);
        assert.ok(!b.events.some(e => e[0] === 'player:kick'), 'outside the stadium kicking does nothing');

        const f = W.STADIUM;
        const pa = ctx.world.players.get(a.id);
        pa.x = f.x - 60; pa.y = f.y + f.h / 2;
        await walkTo(ctx, a, f.x + f.w / 2 - 80, f.y + f.h / 2);
        a.emit('kick');
        await b.waitFor('player:kick', id => id === a.id);
        ctx.world.football.ball.x = f.x + 30; ctx.world.football.ball.y = f.y + f.h / 2;
        ctx.world.football.ball.vx = -25; ctx.world.football.lastTouch = 'Alice';
        const [goal] = await b.waitFor('goal', () => true, 3000);
        assert.equal(goal.team, 'red');
        assert.equal(goal.scorer, 'Alice');
        assert.equal(goal.score.red, 1);
    });

    await t.test('chat is rate limited and capped', async () => {
        const [a] = socks;
        a.events.length = 0;
        await sleep(3100);
        for (let i = 0; i < 20; i++) a.emit('chat', 'x'.repeat(500));
        await sleep(200);
        const chats = a.events.filter(e => e[0] === 'chat');
        assert.ok(chats.length >= 1 && chats.length <= 4, `got ${chats.length}`);
        assert.ok(chats[0][1].text.length <= 160);
    });

    await t.test('disconnect cleans up', async () => {
        const b = socks[1];
        const a = socks[0];
        const bid = b.id;
        a.events.length = 0;
        b.close();
        await a.waitFor('player:leave', id => id === bid);
        assert.ok(!ctx.world.players.has(bid));
    });
});

test('reconnect resumes the previous session (position, unlocks) and replaces a lingering connection', async t => {
    const ctx = await boot();
    const socks = [];
    t.after(async () => { socks.forEach(s => s.close()); await ctx.close(); });

    const owner = await join(ctx, 'Owner'); socks.push(owner);
    const guest = await join(ctx, 'Guest'); socks.push(guest);
    const slot = ctx.world.slots[7];
    const c = slotCenter(slot);
    const po = ctx.world.players.get(owner.id);
    po.x = slot.x - 80; po.y = slot.y + 100;
    await walkTo(ctx, owner, c.x, c.y);
    assert.equal((await owner.call('room:create', { slotId: slot.id, name: 'Vault', password: 'pw' })).ok, true);
    assert.equal((await guest.call('room:password', { slotId: slot.id, password: 'pw' })).ok, true);

    // the guest's connection dies (the server still believes it is alive) and a new one resumes
    const token = guest.me.token;
    assert.ok(token);
    const gp = ctx.world.players.get(guest.id);
    const before = { x: gp.x, y: gp.y };
    const back = await client(ctx); socks.push(back);
    const res = await back.call('join', { nickname: 'Guest', resume: token });
    assert.equal(res.ok, true);
    assert.deepEqual(res.unlocked, [slot.id], 'unlock survived the reconnect');
    const me = res.players.find(p => p.id === back.id);
    assert.equal(me.nickname, 'Guest', 'no #1234 suffix: the stale session was taken over');
    assert.equal(me.x, before.x);
    assert.equal(ctx.world.players.size, 2, 'old and new session are not both online');
    assert.ok(!ctx.world.players.has(guest.id));

    // a stolen / unknown token gets a fresh spawn
    const stranger = await client(ctx); socks.push(stranger);
    const res2 = await stranger.call('join', { nickname: 'Eve', resume: 'deadbeef' });
    assert.equal(res2.ok, true);
    assert.deepEqual(res2.unlocked, []);
});

test('built-in TURN: join answer carries per-player, verifiable credentials', async t => {
    const relay = 52000 + Math.floor(Math.random() * 5000);
    const ctx = await boot({ TURN: true, TURN_PORT: 0, TURN_PUBLIC_IP: '127.0.0.1', TURN_RELAY_MIN: relay, TURN_RELAY_MAX: relay + 20 });
    const a = await join(ctx, 'Relay');
    t.after(async () => { a.close(); await ctx.close(); });
    const ice = a.me.iceServers;
    assert.equal(ice.length, 1);
    assert.ok(ice[0].urls.some(u => u.startsWith('turn:127.0.0.1:') && u.endsWith('transport=udp')));
    assert.ok(ice[0].urls.some(u => u.startsWith('stun:')));
    assert.match(ice[0].username, new RegExp(`^\\d+:${a.id}$`));
    assert.equal(ice[0].credential, ctx.turn.passwordFor(ice[0].username));
    const cfg = await (await fetch(ctx.url + '/api/config')).json();
    assert.equal(cfg.turn.port, ctx.turn.port);
});

test('http endpoints and headers', async t => {
    const ctx = await boot();
    t.after(() => ctx.close());
    const get = path => fetch(ctx.url + path);

    const health = await (await get('/healthz')).json();
    assert.equal(health.ok, true);

    const cfg = await (await get('/api/config')).json();
    assert.equal(typeof cfg.name, 'string');

    const index = await get('/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(index.headers.get('x-powered-by'), null);

    assert.equal((await get('/shared/world.js')).status, 200);
    assert.equal((await get('/emoji/1.png')).status, 200);
    assert.equal((await get('/api/yt/search?q=a')).status, 400);
    assert.equal((await get('/../server.js')).status, 404);
    assert.equal((await get('/%2e%2e/server.js')).status, 404);
    assert.equal((await get('/js/%00main.js')).status, 404);
    const js = await fetch(ctx.url + '/js/main.js', { headers: { 'accept-encoding': 'br' } });
    assert.equal(js.headers.get('content-encoding'), 'br');
    const etag = js.headers.get('etag');
    assert.equal((await fetch(ctx.url + '/js/main.js', { headers: { 'if-none-match': etag } })).status, 304);
    const part = await fetch(ctx.url + '/usr1.png', { headers: { range: 'bytes=0-9' } });
    assert.equal(part.status, 206);
    assert.equal((await part.arrayBuffer()).byteLength, 10);
});
