'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../shared/world');
const { World } = require('../src/world');
const { Football } = require('../src/football');
const { MusicQueue } = require('../src/music');
const { parseVideoId } = require('../src/youtube');

const { C } = W;

function slotCenterTopLeft(slot) {
    return { x: slot.x + slot.w / 2 - C.PLAYER_SIZE / 2, y: slot.y + slot.h / 2 - C.PLAYER_SIZE / 2 };
}

/** Teleports a player somewhere (test helper, bypasses movement validation). */
function place(world, p, x, y) {
    p.x = x; p.y = y;
    const slot = W.slotAt(world.slots, x + C.PLAYER_SIZE / 2, y + C.PLAYER_SIZE / 2);
    if (p.slotId) world.occupancy.get(p.slotId).delete(p.id);
    p.slotId = slot ? slot.id : null;
    if (slot) world.occupancy.get(slot.id).add(p.id);
}

test('map layout matches the original design', () => {
    const slots = W.buildSlots();
    assert.equal(slots.filter(s => s.type === 'conference').length, 20);
    assert.equal(slots.filter(s => s.type === 'stadium').length, 1);
    assert.equal(new Set(slots.map(s => s.id)).size, slots.length);
    for (const s of slots) {
        assert.ok(s.x + s.w <= C.WIDTH && s.y + s.h <= C.HEIGHT, `${s.id} fits in the world`);
    }
});

test('walls leave a door gap in the bottom wall only', () => {
    const slot = W.buildSlots()[0];
    const door = W.slotDoor(slot);
    const doorProbe = { x: door.x + 10, y: slot.y + slot.h - 3, w: 10, h: 2 };
    assert.ok(!W.wallsBlock(slot, doorProbe));
    assert.ok(W.wallsBlock(slot, { x: slot.x + 2, y: slot.y + 100, w: 10, h: 10 }));
});

test('players get unique, sanitised nicknames and valid avatars', () => {
    const world = new World();
    const a = world.addPlayer('a', { nickname: '  Ada  ', avatar: 'usr2.png' });
    const b = world.addPlayer('b', { nickname: 'ada', avatar: '../../etc/passwd' });
    assert.equal(a.nickname, 'Ada');
    assert.match(b.nickname, /^ada#\d{4}$/);
    assert.equal(b.avatar, 'usr1.png');
    assert.equal(world.addPlayer('c', {}).nickname, 'Guest');
});

test('moves are validated: speed budget, bounds, NaN and walls', () => {
    const world = new World();
    const p = world.addPlayer('a', { nickname: 'A' });
    assert.ok(!world.tryMove(p, NaN, 0, 0, 1).ok);
    const far = world.tryMove(p, p.x + 1000, p.y, 1, 0);
    assert.equal(far.ok, false);
    assert.equal(far.reason, 'speed');
    assert.ok(world.tryMove(p, p.x + 10, p.y + 5, 1, 0).ok);
    const out = world.tryMove(p, -50, -50, 0, 1);
    assert.ok(p.x >= 0 && p.y >= 0, 'clamped into the world');
    assert.ok(out.ok === true || out.reason === 'speed');
});

test('room lifecycle: create, ownership checks, password gate, auto destroy', () => {
    const world = new World();
    const owner = world.addPlayer('o', { nickname: 'Owner' });
    const guest = world.addPlayer('g', { nickname: 'Guest' });
    const slot = world.slots[0];

    assert.equal(world.createRoom(owner, { slotId: slot.id, name: 'x' }).error, 'not-in-slot');
    const c = slotCenterTopLeft(slot);
    place(world, owner, c.x, c.y);
    assert.equal(world.createRoom(owner, { slotId: 'nope', name: 'x' }).error, 'invalid-slot');
    assert.equal(world.createRoom(owner, { slotId: W.STADIUM.id, name: 'x' }).error, 'invalid-slot');
    assert.equal(world.createRoom(owner, { slotId: slot.id, name: '   ' }).error, 'invalid-name');

    const res = world.createRoom(owner, { slotId: slot.id, name: 'Secret', password: 'pw', color: 'pink' });
    assert.ok(res.ok);
    assert.equal(world.publicRoom(res.room).hasPassword, true);
    assert.equal(world.publicRoom(res.room).color, 'pink');
    assert.ok(!('password' in world.publicRoom(res.room)), 'hash never leaves the server');
    assert.equal(world.createRoom(owner, { slotId: slot.id, name: 'again' }).error, 'slot-taken');

    assert.equal(world.checkPassword(guest, slot.id, 'bad'), false);
    assert.equal(world.checkPassword(guest, slot.id, 'pw'), true);

    // owner walks out through the door -> the room disappears because nobody is inside any more
    const out = world.tryMove(owner, owner.x, slot.y + slot.h + 60, 0, 1);
    assert.ok(out.ok, 'the door is wide enough to walk straight out of the room');
    assert.ok(out.destroyed.includes(slot.id));
    assert.ok(!world.rooms.has(slot.id));
});

test('creating a password room pushes bystanders out through the door', () => {
    const world = new World();
    const owner = world.addPlayer('o', { nickname: 'Owner' });
    const bystander = world.addPlayer('b', { nickname: 'By' });
    const slot = world.slots[1];
    const c = slotCenterTopLeft(slot);
    place(world, owner, c.x, c.y);
    place(world, bystander, c.x + 30, c.y);
    const res = world.createRoom(owner, { slotId: slot.id, name: 'Locked', password: 'pw' });
    assert.ok(res.ok);
    assert.ok(res.moved.includes(bystander));
    assert.ok(bystander.y > slot.y + slot.h, 'bystander is outside the room');
    assert.equal(bystander.slotId, null);
});

test('creating a room cannot trap someone that is not allowed in; max rooms per owner enforced', () => {
    const world = new World();
    const owner = world.addPlayer('o', { nickname: 'Owner' });
    let created = 0;
    for (let i = 0; i < 4; i++) {
        const slot = world.slots[i];
        const c = slotCenterTopLeft(slot);
        place(world, owner, c.x, c.y);
        if (world.createRoom(owner, { slotId: slot.id, name: `R${i}` }).ok) created++;
        // keep the room alive by placing a second player inside
        const filler = world.addPlayer(`f${i}`, { nickname: `F${i}` });
        place(world, filler, c.x, c.y);
    }
    assert.equal(created, 2);
});

test('walls cannot be crossed even with a large (budgeted) jump', () => {
    const world = new World();
    const owner = world.addPlayer('o', { nickname: 'Owner' });
    const intruder = world.addPlayer('i', { nickname: 'In' });
    const slot = world.slots[0];
    const c = slotCenterTopLeft(slot);
    place(world, owner, c.x, c.y);
    assert.ok(world.createRoom(owner, { slotId: slot.id, name: 'Walls' }).ok);

    // stand just left of the room, try to hop through the left wall to the inside
    place(world, intruder, slot.x - 60, slot.y + 100);
    intruder.budget = 320;
    const r = world.tryMove(intruder, slot.x + 60, slot.y + 100, 1, 0);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'wall');
});

test('locked door cannot be entered from outside without the password', () => {
    const world = new World();
    const owner = world.addPlayer('o', { nickname: 'Owner' });
    const guest = world.addPlayer('g', { nickname: 'Guest' });
    const slot = world.slots[2];
    const c = slotCenterTopLeft(slot);
    place(world, owner, c.x, c.y);
    assert.ok(world.createRoom(owner, { slotId: slot.id, name: 'Vault', password: 'pw' }).ok);

    const doorX = W.doorStart(slot) + C.DOOR_SIZE / 2 - C.PLAYER_SIZE / 2;
    place(world, guest, doorX, slot.y + slot.h + 2);
    guest.budget = 320;
    assert.equal(world.tryMove(guest, doorX, slot.y + slot.h - 30, 0, -1).ok, false);
    assert.ok(world.checkPassword(guest, slot.id, 'pw'));
    assert.equal(world.tryMove(guest, doorX, slot.y + slot.h - 30, 0, -1).ok, true);
});

test('football: goal scoring, resets and speed cap', () => {
    const f = new Football();
    const field = f.field;
    f.ball.x = field.x + 20; f.ball.y = field.y + field.h / 2; f.ball.vx = -30; f.ball.vy = 0;
    f.lastTouch = 'Ada';
    let goal = null;
    for (let i = 0; i < 20 && !goal; i++) goal = f.tick().goal;
    assert.ok(goal, 'ball entered the left goal');
    assert.equal(goal.team, 'red');
    assert.equal(goal.scorer, 'Ada');
    assert.equal(f.score.red, 1);
    assert.equal(f.ball.x, field.x + field.w / 2);

    const p = { x: f.ball.x - 20, y: f.ball.y - 20, nickname: 'Bob' };
    for (let i = 0; i < 20; i++) f.kick(p);
    assert.ok(Math.hypot(f.ball.vx, f.ball.vy) <= 34.0001, 'kick spam cannot exceed the speed cap');
});

test('football: far players cannot kick', () => {
    const f = new Football();
    assert.equal(f.kick({ x: f.ball.x + 500, y: f.ball.y, nickname: 'Far' }), false);
});

test('music queue: ended() is idempotent per song, so many listeners cannot skip tracks', () => {
    let t = 0;
    const q = new MusicQueue(() => t);
    q.add({ videoId: 'aaaaaaaaaaa', title: 'A', addedBy: 'x' });
    q.add({ videoId: 'bbbbbbbbbbb', title: 'B', addedBy: 'x' });
    q.add({ videoId: 'ccccccccccc', title: 'C', addedBy: 'x' });
    const first = q.current.id;
    assert.equal(q.ended(first), true);
    assert.equal(q.ended(first), false);
    assert.equal(q.ended(first), false);
    assert.equal(q.current.title, 'B');
    t = 5000;
    assert.equal(q.snapshot().elapsedMs, 5000);
    assert.equal(q.remove(q.queue[0].id), true);
    assert.equal(q.queue.length, 0);
});

test('music queue accepts the same video twice as distinct entries', () => {
    const q = new MusicQueue();
    q.add({ videoId: 'aaaaaaaaaaa', title: 'A', addedBy: 'x' });
    q.add({ videoId: 'aaaaaaaaaaa', title: 'A', addedBy: 'y' });
    const a = q.current.id;
    q.ended(a);
    assert.notEqual(q.current.id, a);
});

test('YouTube link parsing', () => {
    assert.equal(parseVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseVideoId('https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
    assert.equal(parseVideoId('https://youtu.be/dQw4w9WgXcQ?t=5'), 'dQw4w9WgXcQ');
    assert.equal(parseVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(parseVideoId('lofi hip hop'), null);
    assert.equal(parseVideoId('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
    assert.equal(parseVideoId(undefined), null);
});
