'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const W = require('../shared/world');
const { cleanText, hashPassword, verifyPassword } = require('./security');
const { MusicQueue } = require('./music');
const { Football } = require('./football');

const { C, STADIUM, AUDITORIUM } = W;
const PS = C.PLAYER_SIZE;

const MOVE_BUDGET_RATE = C.SPEED * 1.8;  // px / s a player may "earn"
const MOVE_BUDGET_CAP = 320;             // burst allowance (network jitter, tab lag)
const MAX_ROOMS_PER_OWNER = 2;
const ROOM_GRACE_MS = 60 * 1000;         // a room whose last occupant *dropped* survives this long (reconnects)
const ROOM_KICK_BAN_MS = 10 * 60 * 1000;
const MAX_WB_BATCHES = 600;
const CHAT_HISTORY = 40;

const hasColor = c => Object.prototype.hasOwnProperty.call(W.ROOM_COLORS, c);

class World extends EventEmitter {
    constructor(now = Date.now) {
        super();
        this.now = now;
        this.slots = W.buildSlots();
        this.slotsById = new Map(this.slots.map(s => [s.id, s]));
        this.players = new Map();
        this.rooms = new Map();
        this.occupancy = new Map(this.slots.map(s => [s.id, new Set()]));
        this.football = new Football();
        this.publicChat = [];
        this.rooms.set(STADIUM.id, this._newRoom({ id: STADIUM.id, name: 'Football Arena', owner: null, builtin: true, type: 'stadium', color: 'green' }));
        this.rooms.set(AUDITORIUM.id, this._newRoom({ id: AUDITORIUM.id, name: 'Auditorium', owner: null, builtin: true, type: 'auditorium', color: 'purple' }));
    }

    _newRoom({ id, name, owner, ownerToken = null, color, passwordRecord = null, builtin = false, permanent = false, type = 'conference', topic = '' }) {
        return {
            id, name, owner, ownerToken, color, type, builtin, permanent, topic,
            uid: crypto.randomBytes(8).toString('hex'),   // distinguishes two rooms that reuse the same plot
            password: passwordRecord,
            banned: new Map(),       // player token -> until (kicked by the owner)
            whiteboard: [],          // batches: { c, w, s: [[x0,y0,x1,y1], ...] }
            note: { text: '', rev: 0 },
            music: new MusicQueue(this.now),
            chat: [],
            poll: null,
            hands: [],
            timer: null,
            expiresAt: null
        };
    }

    // ---------------------------------------------------------------- players

    /**
     * @param {object} [resume] state of a previous session of the same player (see takeResume in game.js)
     * @param {object} [meta]   { ip } - kept server side for moderation
     */
    addPlayer(id, { nickname, avatar, status, statusText }, resume = null, meta = {}) {
        let name = cleanText(nickname, 15) || 'Guest';
        const taken = new Set(Array.from(this.players.values(), p => p.nickname.toLowerCase()));
        if (taken.has(name.toLowerCase())) {
            let candidate;
            do { candidate = `${name}#${Math.floor(1000 + Math.random() * 9000)}`; } while (taken.has(candidate.toLowerCase()));
            name = candidate;
        }
        const spawn = resume ? { x: resume.x, y: resume.y } : this._spawnPoint();
        const t = this.now();
        this.seqN = (this.seqN || 0) % 0x7fffffff + 1;
        const player = {
            id, n: this.seqN, nickname: name,
            avatar: W.validAvatar(avatar) ? avatar : W.AVATARS[0],
            status: W.STATUSES.includes(status) ? status : 'available',
            statusText: cleanText(statusText, 40),
            x: spawn.x, y: spawn.y, dirX: 0, dirY: 1,
            slotId: null, roomId: null,
            muted: false, cam: false, screen: false,
            token: resume ? resume.token : crypto.randomBytes(16).toString('hex'),
            unlocked: new Set(resume ? resume.unlocked : []),
            chatMutedUntil: resume ? resume.chatMutedUntil || 0 : 0,
            ip: meta.ip || '',
            joinedAt: t,
            budget: MOVE_BUDGET_CAP, lastMoveAt: t, lastActive: t
        };
        this.players.set(id, player);
        if (resume) {
            for (const room of this.rooms.values()) if (room.ownerToken === player.token) room.owner = id;
            this._enterWorldAt(player);
        }
        return player;
    }

    /** Puts a (resumed) player into the occupancy/membership books and evicts them from rooms they may not enter. */
    _enterWorldAt(p) {
        const slot = W.slotAt(this.slots, p.x + PS / 2, p.y + PS / 2);
        const room = slot ? this.rooms.get(slot.id) : null;
        if (room && !this._canEnter(p, room)) {
            this._placeAtDoor(p, slot);
            return this._enterWorldAt(p);
        }
        p.slotId = slot ? slot.id : null;
        if (slot) this.occupancy.get(slot.id).add(p.id);
        if (room) room.expiresAt = null;
        p.roomId = room ? room.id : null;
    }

    /** Slot ids of the rooms (still alive) this player has unlocked. */
    unlockedSlots(p) {
        const out = [];
        for (const room of this.rooms.values()) if (p.unlocked.has(room.uid)) out.push(room.id);
        return out;
    }

    _spawnPoint() {
        let x = 30, y = 60;
        for (let i = 0; i < 60; i++) {
            x = 20 + Math.random() * 50;
            y = 60 + Math.random() * 640;
            let free = true;
            for (const p of this.players.values()) {
                if (Math.hypot(p.x - x, p.y - y) < PS * 1.5) { free = false; break; }
            }
            if (free) break;
        }
        return { x, y };
    }

    publicPlayer(p) {
        return {
            id: p.id, n: p.n, nickname: p.nickname, avatar: p.avatar, status: p.status, statusText: p.statusText,
            x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY, muted: p.muted, cam: p.cam, screen: p.screen
        };
    }

    publicPlayers() { return Array.from(this.players.values(), p => this.publicPlayer(p)); }

    /** Applies profile changes; returns true when something changed. */
    setProfile(p, { status, statusText, avatar } = {}) {
        let changed = false;
        if (status !== undefined && W.STATUSES.includes(status) && status !== p.status) { p.status = status; changed = true; }
        if (statusText !== undefined) {
            const t = cleanText(statusText, 40);
            if (t !== p.statusText) { p.statusText = t; changed = true; }
        }
        if (avatar !== undefined && W.validAvatar(avatar) && avatar !== p.avatar) { p.avatar = avatar; changed = true; }
        return changed;
    }

    /**
     * Removes a player; returns the ids of rooms that vanished because they became empty.
     * With `grace` (connection lost, not walked away) an emptied room lingers for a while so the
     * player can reconnect into it.
     */
    removePlayer(id, { grace = false } = {}) {
        const p = this.players.get(id);
        if (!p) return { player: null, destroyed: [], room: null };
        this.players.delete(id);
        const destroyed = [];
        const room = p.roomId ? this.rooms.get(p.roomId) : null;
        if (room) this.lowerHand(room, id);
        if (p.slotId) {
            this.occupancy.get(p.slotId).delete(id);
            if (grace) this._hold(p.slotId); else this._collect(p.slotId, destroyed);
        }
        return { player: p, destroyed, room };
    }

    _hold(slotId) {
        const room = this.rooms.get(slotId);
        if (!room) return;
        if (room.builtin) { this._collect(slotId, []); return; }
        if (!room.permanent && this.occupancy.get(slotId).size === 0) room.expiresAt = this.now() + ROOM_GRACE_MS;
    }

    /** Destroys rooms whose grace period ran out. Returns their ids. */
    sweepRooms() {
        const t = this.now(), gone = [];
        for (const room of Array.from(this.rooms.values())) {
            for (const [token, until] of room.banned) if (until < t) room.banned.delete(token);
            if (room.timer && room.timer.endsAt < t - 60000) room.timer = null;
            if (!room.expiresAt) continue;
            if (this.occupancy.get(room.id).size > 0) { room.expiresAt = null; continue; }
            if (room.expiresAt <= t) { this.rooms.delete(room.id); gone.push(room.id); }
        }
        return gone;
    }

    // ------------------------------------------------------------------ rooms

    publicRoom(room) {
        const owner = room.owner ? this.players.get(room.owner) : null;
        return {
            id: room.id, name: room.name, color: room.color, type: room.type, topic: room.topic,
            builtin: room.builtin, permanent: room.permanent, hasPassword: !!room.password, owner: room.owner,
            ownerName: owner ? owner.nickname : null,
            occupants: this.occupancy.get(room.id) ? this.occupancy.get(room.id).size : 0
        };
    }

    publicRooms() { return Array.from(this.rooms.values(), r => this.publicRoom(r)); }

    _canEnter(p, room) {
        const ban = room.banned.get(p.token);
        if (ban && ban > this.now()) return false;
        return !room.password || room.owner === p.id || p.unlocked.has(room.uid);
    }

    /** Destroys a conference room whose slot became empty (permanent and built-in rooms stay). */
    _collect(slotId, destroyed) {
        const room = this.rooms.get(slotId);
        if (!room) return;
        if (this.occupancy.get(slotId).size > 0) return;
        if (room.builtin) {
            if (slotId === STADIUM.id) { this.football.reset(true); this.emit('football:reset'); }
            return;
        }
        if (room.permanent) {
            room.poll = null; room.hands = []; room.timer = null;
            return;
        }
        this.rooms.delete(slotId);
        destroyed.push(slotId);
    }

    _placeAtDoor(p, slot) {
        p.x = W.doorStart(slot) + C.DOOR_SIZE / 2 - PS / 2;
        p.y = Math.min(C.HEIGHT - PS, slot.y + slot.h + 24);
    }

    /** Moves a player out through the door of `slot`. Returns the membership change, if any. */
    _eject(p, slot) {
        this._placeAtDoor(p, slot);
        if (p.slotId) this.occupancy.get(p.slotId).delete(p.id);
        p.slotId = null;
        const prev = p.roomId;
        p.roomId = null;
        const room = prev ? this.rooms.get(prev) : null;
        if (room) this.lowerHand(room, p.id);
        return prev ? { player: p, from: prev, to: null } : null;
    }

    /**
     * Installs a room on a plot and sorts out who may stay inside.
     * @returns {{moved: object[], membership: object[]}}
     */
    _install(room, slot, keep = null) {
        this.rooms.set(slot.id, room);
        const moved = [], membership = [];
        const inflated = { x: slot.x - PS, y: slot.y - PS, w: slot.w + PS * 2, h: slot.h + PS * 2 };
        for (const other of this.players.values()) {
            if (other === keep) continue;
            const rect = { x: other.x, y: other.y, w: PS, h: PS };
            if (!W.rectsIntersect(rect, inflated)) continue;
            if (!this._canEnter(other, room) || W.wallsBlock(slot, rect)) {
                const change = this._eject(other, slot);
                moved.push(other);
                if (change) membership.push(change);
            } else if (other.slotId === slot.id && other.roomId !== slot.id) {
                membership.push({ player: other, from: other.roomId, to: slot.id });
                other.roomId = slot.id;
            }
        }
        return { moved, membership };
    }

    createRoom(p, { slotId, name, password, color, topic }) {
        const slot = this.slotsById.get(slotId);
        if (!slot || slot.type !== 'conference') return { ok: false, error: 'invalid-slot' };
        if (this.rooms.has(slotId)) return { ok: false, error: 'slot-taken' };
        if (p.slotId !== slotId) return { ok: false, error: 'not-in-slot' };
        const roomName = cleanText(name, 20);
        if (!roomName) return { ok: false, error: 'invalid-name' };
        let owned = 0;
        for (const r of this.rooms.values()) if (r.owner === p.id) owned++;
        if (owned >= MAX_ROOMS_PER_OWNER) return { ok: false, error: 'too-many-rooms' };

        const pass = typeof password === 'string' ? password.slice(0, 20) : '';
        const room = this._newRoom({
            id: slotId, name: roomName, owner: p.id, ownerToken: p.token,
            color: hasColor(color) ? color : 'blue',
            topic: cleanText(topic, 80),
            passwordRecord: pass ? hashPassword(pass) : null
        });
        p.unlocked.add(room.uid);

        // The owner appears in the middle of the new room.
        p.x = slot.x + slot.w / 2 - PS / 2;
        p.y = slot.y + slot.h / 2 - PS / 2;
        const res = this._install(room, slot, p);
        res.moved.unshift(p);
        res.membership.unshift({ player: p, from: p.roomId, to: slotId });
        p.roomId = slotId; // the owner's slot is already tracked (they were standing on it)
        return { ok: true, room, moved: res.moved, membership: res.membership };
    }

    checkPassword(p, slotId, password) {
        const room = this.rooms.get(slotId);
        if (!room || !room.password || typeof password !== 'string') return false;
        const ban = room.banned.get(p.token);
        if (ban && ban > this.now()) return false;
        if (!verifyPassword(password, room.password)) return false;
        p.unlocked.add(room.uid);
        return true;
    }

    _ownedRoom(p, slotId) {
        const room = this.rooms.get(slotId);
        if (!room || room.builtin || room.permanent) return null;
        return room.owner === p.id ? room : null;
    }

    /** Owner edits: name, colour, topic, password (set or clear). */
    updateRoom(p, slotId, { name, color, topic, password, clearPassword } = {}) {
        const room = this._ownedRoom(p, slotId);
        if (!room) return { ok: false, error: 'not-owner' };
        if (name !== undefined) {
            const n = cleanText(name, 20);
            if (!n) return { ok: false, error: 'invalid-name' };
            room.name = n;
        }
        if (color !== undefined && hasColor(color)) room.color = color;
        if (topic !== undefined) room.topic = cleanText(topic, 80);
        const lockedOut = [];
        if (clearPassword) room.password = null;
        else if (typeof password === 'string' && password) {
            room.password = hashPassword(password.slice(0, 20));
            // A new password locks out everybody who only knew the old one, but not the people inside.
            const oldUid = room.uid, inside = this.occupancy.get(slotId);
            room.uid = crypto.randomBytes(8).toString('hex');
            for (const o of this.players.values()) {
                if (!o.unlocked.delete(oldUid)) continue;
                if (!inside.has(o.id) && o !== p) lockedOut.push(o.id);
            }
            for (const id of inside) { const o = this.players.get(id); if (o) o.unlocked.add(room.uid); }
            p.unlocked.add(room.uid);
        }
        return { ok: true, room, lockedOut };
    }

    /** The owner removes someone from their room (and keeps them out for a while). */
    kickFromRoom(p, slotId, targetId) {
        const room = this._ownedRoom(p, slotId);
        if (!room) return { ok: false, error: 'not-owner' };
        const target = this.players.get(targetId);
        if (!target || target === p || target.slotId !== slotId) return { ok: false, error: 'not-in-room' };
        room.banned.set(target.token, this.now() + ROOM_KICK_BAN_MS);
        target.unlocked.delete(room.uid);
        const change = this._eject(target, this.slotsById.get(slotId));
        return { ok: true, target, change };
    }

    // ------------------------------------------------------- admin / permanent

    /** Admin: create (or replace) a room that never disappears. */
    createPermanentRoom({ slotId, name, color, topic, password, passwordRecord }) {
        const slot = this.slotsById.get(slotId);
        if (!slot || slot.type !== 'conference') return { ok: false, error: 'invalid-slot' };
        const roomName = cleanText(name, 20);
        if (!roomName) return { ok: false, error: 'invalid-name' };
        const old = this.rooms.get(slotId);
        const room = this._newRoom({
            id: slotId, name: roomName, owner: null, color: hasColor(color) ? color : 'indigo', permanent: true,
            topic: cleanText(topic, 80),
            passwordRecord: passwordRecord || (typeof password === 'string' && password ? hashPassword(password.slice(0, 20)) : null)
        });
        if (old) { room.whiteboard = old.whiteboard; room.note = old.note; room.chat = old.chat; }
        const res = this._install(room, slot);
        return { ok: true, room, replaced: !!old, ...res };
    }

    /** Admin: remove any non built-in room, sending its occupants out through the door. */
    closeRoom(slotId) {
        const room = this.rooms.get(slotId);
        if (!room || room.builtin) return { ok: false, error: 'not-found' };
        const slot = this.slotsById.get(slotId);
        const moved = [], membership = [];
        for (const id of Array.from(this.occupancy.get(slotId))) {
            const p = this.players.get(id);
            if (!p) continue;
            const change = this._eject(p, slot);
            moved.push(p);
            if (change) membership.push(change);
        }
        this.rooms.delete(slotId);
        return { ok: true, moved, membership };
    }

    permanentRooms() {
        return Array.from(this.rooms.values()).filter(r => r.permanent).map(r => ({
            slotId: r.id, name: r.name, color: r.color, topic: r.topic,
            password: r.password ? { salt: r.password.salt.toString('base64'), hash: r.password.hash.toString('base64') } : null,
            whiteboard: r.whiteboard, note: r.note
        }));
    }

    loadPermanentRooms(list) {
        if (!Array.isArray(list)) return;
        for (const r of list) {
            const rec = r.password && r.password.salt ? { salt: Buffer.from(r.password.salt, 'base64'), hash: Buffer.from(r.password.hash, 'base64') } : null;
            const res = this.createPermanentRoom({ slotId: r.slotId, name: r.name, color: r.color, topic: r.topic, passwordRecord: rec });
            if (!res.ok) continue;
            if (Array.isArray(r.whiteboard)) res.room.whiteboard = r.whiteboard.slice(-MAX_WB_BATCHES);
            if (r.note && typeof r.note.text === 'string') res.room.note = { text: r.note.text.slice(0, 5000), rev: 0 };
        }
    }

    // --------------------------------------------------------------- movement

    _pathBlocked(p, nx, ny) {
        const dist = Math.hypot(nx - p.x, ny - p.y);
        const steps = Math.max(1, Math.ceil(dist / 8));
        let prevY = p.y;
        for (let i = 1; i <= steps; i++) {
            const x = p.x + (nx - p.x) * i / steps;
            const y = p.y + (ny - p.y) * i / steps;
            const rect = { x, y, w: PS, h: PS };
            for (const room of this.rooms.values()) {
                if (room.builtin) continue;
                const slot = this.slotsById.get(room.id);
                if (W.wallsBlock(slot, rect)) return true;
                if (!this._canEnter(p, room) && W.gateBlocks(slot, rect, prevY, y)) return true;
            }
            prevY = y;
        }
        return false;
    }

    /**
     * Validates and applies a movement request.
     * @returns {{ok:boolean, reason?:string, membership?:object, destroyed?:string[]}}
     */
    tryMove(p, x, y, dirX, dirY) {
        if (![x, y, dirX, dirY].every(Number.isFinite)) return { ok: false, reason: 'invalid' };

        const t = this.now();
        p.budget = Math.min(MOVE_BUDGET_CAP, p.budget + Math.min(Math.max(t - p.lastMoveAt, 0), 1000) * MOVE_BUDGET_RATE / 1000);
        p.lastMoveAt = t;
        p.lastActive = t;

        const nx = W.clamp(x, 0, C.WIDTH - PS);
        const ny = W.clamp(y, 0, C.HEIGHT - PS);
        const dist = Math.hypot(nx - p.x, ny - p.y);
        if (dist > p.budget) return { ok: false, reason: 'speed' };
        if (dist > 0 && this._pathBlocked(p, nx, ny)) return { ok: false, reason: 'wall' };

        p.budget -= dist;
        const dl = Math.hypot(dirX, dirY) || 1;
        const dx = nx - p.x, dy = ny - p.y;
        p.x = nx; p.y = ny; p.dirX = dirX / dl; p.dirY = dirY / dl;

        const result = { ok: true, dx, dy, membership: null, destroyed: [] };
        const slot = W.slotAt(this.slots, p.x + PS / 2, p.y + PS / 2);
        const slotId = slot ? slot.id : null;
        if (slotId !== p.slotId) {
            const prevSlot = p.slotId;
            if (prevSlot) this.occupancy.get(prevSlot).delete(p.id);
            if (slotId) this.occupancy.get(slotId).add(p.id);
            p.slotId = slotId;
            if (prevSlot) this._collect(prevSlot, result.destroyed);
        }
        const room = slotId ? this.rooms.get(slotId) : null;
        if (room) room.expiresAt = null;
        const roomId = room && this._canEnter(p, room) ? room.id : null;
        if (roomId !== p.roomId) {
            const prevRoom = p.roomId ? this.rooms.get(p.roomId) : null;
            if (prevRoom) this.lowerHand(prevRoom, p.id);
            result.membership = { from: p.roomId, to: roomId };
            p.roomId = roomId;
        }
        return result;
    }

    // ------------------------------------------------------------ room tools

    addStroke(room, batch) {
        room.whiteboard.push(batch);
        if (room.whiteboard.length > MAX_WB_BATCHES) room.whiteboard.shift();
    }

    pushChat(room, msg) {
        const list = room ? room.chat : this.publicChat;
        list.push(msg);
        if (list.length > CHAT_HISTORY) list.shift();
    }

    lowerHand(room, id) {
        const i = room.hands.findIndex(h => h.id === id);
        if (i < 0) return false;
        room.hands.splice(i, 1);
        return true;
    }

    raiseHand(room, p) {
        if (room.hands.some(h => h.id === p.id)) return false;
        room.hands.push({ id: p.id, name: p.nickname, at: this.now() });
        return true;
    }

    createPoll(room, p, question, options) {
        const q = cleanText(question, 120);
        const opts = Array.isArray(options) ? options.map(o => cleanText(o, 60)).filter(Boolean).slice(0, 6) : [];
        if (!q || opts.length < 2) return { ok: false, error: 'invalid-poll' };
        if (room.poll && !room.poll.closed && room.poll.by !== p.id && room.owner !== p.id) return { ok: false, error: 'poll-running' };
        room.poll = { id: crypto.randomBytes(6).toString('hex'), question: q, options: opts, votes: new Map(), by: p.id, byName: p.nickname, closed: false };
        return { ok: true };
    }

    vote(room, p, pollId, option) {
        const poll = room.poll;
        if (!poll || poll.closed || poll.id !== pollId) return false;
        if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) return false;
        poll.votes.set(p.token, option);
        return true;
    }

    closePoll(room, p, pollId) {
        const poll = room.poll;
        if (!poll || poll.id !== pollId || poll.closed) return false;
        if (poll.by !== p.id && room.owner !== p.id) return false;
        poll.closed = true;
        return true;
    }

    publicPoll(room) {
        const poll = room.poll;
        if (!poll) return null;
        const counts = poll.options.map(() => 0);
        for (const v of poll.votes.values()) counts[v]++;
        return { id: poll.id, question: poll.question, options: poll.options, counts, total: poll.votes.size, closed: poll.closed, byName: poll.byName };
    }

    startTimer(room, p, seconds, label) {
        const s = Math.round(Number(seconds));
        if (!Number.isFinite(s) || s < 5 || s > 4 * 3600) return false;
        room.timer = { endsAt: this.now() + s * 1000, total: s * 1000, label: cleanText(label, 40), byName: p.nickname };
        return true;
    }

    publicTimer(room) {
        if (!room.timer) return null;
        return { remainingMs: Math.max(0, room.timer.endsAt - this.now()), totalMs: room.timer.total, label: room.timer.label, byName: room.timer.byName };
    }

    /** Snapshot sent to a player that enters a room (late joiners catch up). */
    roomSnapshot(room) {
        return {
            roomId: room.id,
            whiteboard: room.whiteboard,
            note: room.note,
            music: room.music.snapshot(),
            chat: room.chat,
            poll: this.publicPoll(room),
            hands: room.hands,
            timer: this.publicTimer(room)
        };
    }
}

module.exports = { World, MAX_ROOMS_PER_OWNER, ROOM_KICK_BAN_MS };
