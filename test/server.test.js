const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { io: clientIo } = require('socket.io-client');
const server = require('../server');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function event(socket, name, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), timeout);
        socket.once(name, value => { clearTimeout(timer); resolve(value); });
    });
}
function eventWhere(socket, name, predicate, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(name, receive);
            reject(new Error(`Timed out waiting for matching ${name}`));
        }, timeout);
        function receive(value) {
            if (!predicate(value)) return;
            clearTimeout(timer);
            socket.off(name, receive);
            resolve(value);
        }
        socket.on(name, receive);
    });
}
function ack(socket, name, data) {
    return new Promise((resolve, reject) => socket.timeout(2000).emit(name, data,
        (error, result) => error ? reject(error) : resolve(result)));
}
async function connect(url) {
    const socket = clientIo(url, { autoConnect: false, transports: ['websocket'], reconnection: false });
    const ready = event(socket, 'connect');
    socket.connect();
    await ready;
    return socket;
}
async function join(socket, name) {
    const ready = event(socket, 'initWorld');
    socket.emit('joinGame', { nickname: name, avatar: 'usr1.png' });
    await ready;
}
async function moveTo(socket, x, y) {
    for (let attempt = 0; attempt < 30; attempt++) {
        const player = server.getPlayer(socket.id);
        const distance = Math.hypot(x - player.x, y - player.y);
        if (distance < 1) return;
        const step = Math.min(90, distance);
        const nextX = player.x + (x - player.x) / distance * step;
        const nextY = player.y + (y - player.y) / distance * step;
        socket.emit('move', { x: nextX, y: nextY, dirX: 0, dirY: 1 });
        await pause(12);
    }
    assert.fail(`Could not move ${socket.id} to ${x},${y}`);
}

test('real Socket.IO packets enforce room chat, media grants and input limits', async t => {
    await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.http.address().port}`;
    const clients = [];
    t.after(async () => {
        for (const socket of clients) socket.disconnect();
        await new Promise(resolve => server.close(resolve));
    });
    const forbiddenOrigin = await fetch(url + '/socket.io/?EIO=4&transport=polling',
        { headers: { Origin: 'https://not-allowed.example' } });
    assert.equal(forbiddenOrigin.status, 403);

    const a = await connect(url); clients.push(a);
    const invalid = event(a, 'requestError');
    a.emit('joinGame', null);
    assert.equal((await invalid).event, 'joinGame');
    await join(a, 'A');

    const b = await connect(url); clients.push(b); await join(b, 'B');
    const c = await connect(url); clients.push(c); await join(c, 'C');
    const d = await connect(url); clients.push(d); await join(d, 'D');
    const outside = await connect(url); clients.push(outside); await join(outside, 'Outside');

    for (const socket of [a, b]) await moveTo(socket, 200, 200);
    for (const socket of [c, d]) await moveTo(socket, 550, 200);
    const createdA = event(a, 'roomUpdate');
    a.emit('createRoom', { slotId: 'slot_1', name: 'Room A', password: 'secret-a' });
    const roomA = (await createdA).room;
    assert.equal(roomA.id, 'slot_1');
    assert.equal(roomA.hasPassword, true);
    assert.equal(roomA.passwordHash, undefined);
    assert.equal(roomA.passwordSalt, undefined);
    const createdC = eventWhere(c, 'roomUpdate', update => update.room?.id === 'slot_2');
    c.emit('createRoom', { slotId: 'slot_2', name: 'Room C', password: 'secret-c' });
    assert.equal((await createdC).room.id, 'slot_2');

    const rejectedMove = event(b, 'playerMoved');
    b.emit('move', { x: 201, y: 201, dirX: 0, dirY: 1 });
    assert.equal((await rejectedMove).x, 200);
    assert.equal(server.getPlayer(b.id).roomId, null);
    const wrongPassword = event(b, 'passwordResult');
    b.emit('checkPassword', { slotId: 'slot_1', password: 'wrong' });
    assert.equal((await wrongPassword).success, false);
    const passwordB = event(b, 'passwordResult');
    b.emit('checkPassword', { slotId: 'slot_1', password: 'secret-a' });
    assert.equal((await passwordB).success, true);
    await moveTo(b, 205, 205);
    const passwordD = event(d, 'passwordResult');
    d.emit('checkPassword', { slotId: 'slot_2', password: 'secret-c' });
    assert.equal((await passwordD).success, true);
    await moveTo(d, 555, 205);
    assert.deepEqual([a, b, c, d].map(socket => server.getPlayer(socket.id).roomId),
        ['slot_1', 'slot_1', 'slot_2', 'slot_2']);

    const inbox = new Map(clients.map(socket => [socket.id, []]));
    for (const socket of clients) socket.on('chatMessage', message => inbox.get(socket.id).push(message));
    const text = 'private-packet-must-not-leak';
    a.emit('sendChat', text);
    await pause(120);
    assert.equal(inbox.get(a.id)[0].text, text);
    assert.equal(inbox.get(b.id)[0].text, text);
    assert.deepEqual(inbox.get(c.id), []);
    assert.deepEqual(inbox.get(d.id), []);
    assert.deepEqual(inbox.get(outside.id), []);
    outside.emit('sendChat', 'public-only');
    await pause(120);
    assert.equal(inbox.get(outside.id)[0].text, 'public-only');
    assert.equal(inbox.get(a.id).length, 1);

    const roomMusic = event(a, 'music-update');
    a.emit('music-add', { roomId: 'slot_1', videoId: 'dQw4w9WgXcQ', title: 'Private title' });
    assert.equal((await roomMusic).current.title, 'Private title');
    const newcomer = await connect(url); clients.push(newcomer);
    const world = event(newcomer, 'initWorld');
    newcomer.emit('joinGame', { nickname: 'Newcomer', avatar: 'usr1.png' });
    assert.equal((await world).rooms.slot_1.currentSong, null);

    for (const [socket, peer] of [[a, 'peer-a'], [b, 'peer-b'], [c, 'peer-c'], [d, 'peer-d']])
        socket.emit('sendPeerId', peer);
    await pause(40);
    assert.equal((await ack(a, 'media-authorize', { targetPeerId: 'peer-b', type: 'voice' })).allowed, true);
    assert.equal((await ack(c, 'media-authorize', { targetPeerId: 'peer-b', type: 'screenshare' })).allowed, false);
    const grant = await ack(a, 'media-authorize', { targetPeerId: 'peer-b', type: 'camera' });
    assert.equal(grant.allowed, true);
    assert.equal((await ack(c, 'media-verify', {
        token: grant.token, callerPeerId: 'peer-a', type: 'camera'
    })).allowed, false);
    const fresh = await ack(a, 'media-authorize', { targetPeerId: 'peer-b', type: 'camera' });
    assert.equal((await ack(b, 'media-verify', {
        token: fresh.token, callerPeerId: 'peer-a', type: 'camera'
    })).allowed, true);
    assert.equal((await ack(b, 'media-verify', {
        token: fresh.token, callerPeerId: 'peer-a', type: 'camera'
    })).allowed, false);

    const invalidRoom = event(outside, 'requestError');
    outside.emit('createRoom', { slotId: 'missing', name: 'Never', password: '' });
    assert.equal((await invalidRoom).event, 'createRoom');
    assert.equal(server.roomIds().length, 3);
    const invalidMove = event(outside, 'requestError');
    outside.emit('move', null);
    assert.equal((await invalidMove).event, 'move');
    assert.ok(server.getPlayer(outside.id));
    for (const [name, payload] of [
        ['sendChat', { text: 'wrong type' }],
        ['sendChat', 'x'.repeat(61)],
        ['music-remove', null],
        ['wb-draw', null],
        ['note-update', null],
        ['move', { x: '100', y: 100, dirX: 0, dirY: 1 }]
    ]) {
        const rejected = event(outside, 'requestError');
        outside.emit(name, payload);
        assert.equal((await rejected).event, name);
    }
    const remoteCreate = event(outside, 'requestError');
    outside.emit('createRoom', { slotId: 'slot_3', name: 'Remote', password: '' });
    assert.equal((await remoteCreate).event, 'createRoom');
    assert.equal(server.roomIds().length, 3);

    const emoji = await fetch(url + '/emoji/1.png');
    assert.equal(emoji.status, 200);
    assert.match(emoji.headers.get('content-type'), /^image\/png/);
    const peerScript = await fetch(url + '/vendor/peerjs.min.js');
    assert.equal(peerScript.status, 200);
    assert.match(peerScript.headers.get('content-type'), /javascript/);

    for (let index = 0; index < 54; index++) {
        const player = await connect(url); clients.push(player);
        await join(player, `Guest ${index}`);
    }
    assert.equal(clients.length, 60);
    const overflow = await connect(url); clients.push(overflow);
    const fullWorld = event(overflow, 'requestError');
    overflow.emit('joinGame', { nickname: 'Over capacity', avatar: 'usr1.png' });
    assert.equal((await fullWorld).event, 'joinGame');
    assert.equal(server.getPlayer(overflow.id), undefined);

    const leavingId = b.id;
    const revokeA = eventWhere(a, 'media-revoked', message => message.id === leavingId);
    b.disconnect();
    assert.equal((await revokeA).id, leavingId);
});

test('the shipped inline client script parses', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const script = html.match(/<script>\s*([\s\S]*?)<\/script>/);
    assert.ok(script);
    assert.doesNotThrow(() => new vm.Script(script[1], { filename: 'public/index.html' }));
});
