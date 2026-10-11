'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const W = require('../shared/world');
const { cleanText, hashPassword, verifyPassword } = require('./security');
const { MusicQueue } = require('./music');
const { Football } = require('./football');

const { C, STADIUM } = W;
const PS = C.PLAYER_SIZE;

const MOVE_BUDGET_RATE = C.SPEED * 1.8;  // px / s a player may "earn"
const MOVE_BUDGET_CAP = 320;             // burst allowance (network jitter, tab lag)
const MAX_ROOMS_PER_OWNER = 2;
const ROOM_GRACE_MS = 60 * 1000;   // a room whose last occupant *dropped* survives this long (reconnects)
const MAX_WB_BATCHES = 600;

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
        this.rooms.set(STADIUM.id, this._newRoom({ id: STADIUM.id, name: 'Football Arena', owner: null, builtin: true, type: 'stadium', color: 'green' }));
    }

    _newRoom({ id, name, owner, ownerToken = null, color, passwordRecord = null, builtin = false, type = 'conference' }) {
        return {
            id, name, owner, ownerToken, color, type, builtin,
            uid: crypto.randomBytes(8).toString('hex'),   // distinguishes two rooms that reuse the same plot
            password: passwordRecord,
            whiteboard: [],          // batches: { c, w, s: [[x0,y0,x1,y1], ...] }
            note: { text: '', rev: 0 },
            music: new MusicQueue(this.now)
        };
    }

    // ---------------------------------------------------------------- players

    /**
     * @param {object} [resume] state of a previous session of the same player (see takeResume in game.js)
     */
    addPlayer(id, { nickname, avatar }, resume = null) {
        let name = cleanText(nickname, 15) || 'Guest';
        const taken = new Set(Array.from(this.players.values(), p => p.nickname.toLowerCase()));
        if (taken.has(name.toLowerCase())) {
            let candidate;
            do { candidate = `${name}#${Math.floor(1000 + Math.random() * 9000)}`; } while (taken.has(candidate.toLowerCase()));
            name = candidate;
        }
        const spawn = resume ? { x: resume.x, y: resume.y } : this._spawnPoint();
        const t = this.now();
        const player = {
            id, nickname: name,
            avatar: W.AVATARS.includes(avatar) ? avatar : W.AVATARS[0],
            x: spawn.x, y: spawn.y, dirX: 0, dirY: 1,
            slotId: null, roomId: null,
            muted: false, cam: false, screen: false,
            token: resume ? resume.token : crypto.randomBytes(16).toString('hex'),
            unlocked: new Set(resume ? resume.unlocked : []),
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
            // the plot was re-built as a locked room while the player was away
            p.x = W.doorStart(slot) + C.DOOR_SIZE / 2 - PS / 2;
            p.y = slot.y + slot.h + 24;
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
        return { id: p.id, nickname: p.nickname, avatar: p.avatar, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY, muted: p.muted, cam: p.cam, screen: p.screen };
    }

    publicPlayers() { return Array.from(this.players.values(), p => this.publicPlayer(p)); }

    /**
     * Removes a player; returns the ids of rooms that vanished because they became empty.
     * With `grace` (connection lost, not walked away) an emptied room lingers for a while so the
     * player can reconnect into it.
     */
    removePlayer(id, { grace = false } = {}) {
        const p = this.players.get(id);
        if (!p) return { player: null, destroyed: [] };
        this.players.delete(id);
        const destroyed = [];
        if (p.slotId) {
            this.occupancy.get(p.slotId).delete(id);
            if (grace) this._hold(p.slotId); else this._collect(p.slotId, destroyed);
        }
        return { player: p, destroyed };
    }

    _hold(slotId) {
        const room = this.rooms.get(slotId);
        if (room && !room.builtin && this.occupancy.get(slotId).size === 0) room.expiresAt = this.now() + ROOM_GRACE_MS;
        else if (room && room.builtin) this._collect(slotId, []);
    }

    /** Destroys rooms whose grace period ran out. Returns their ids. */
    sweepRooms() {
        const t = this.now(), gone = [];
        for (const room of Array.from(this.rooms.values())) {
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
            id: room.id, name: room.name, color: room.color, type: room.type,
            builtin: room.builtin, hasPassword: !!room.password, owner: room.owner,
            ownerName: owner ? owner.nickname : null,
            occupants: this.occupancy.get(room.id) ? this.occupancy.get(room.id).size : 0
        };
    }

    publicRooms() { return Array.from(this.rooms.values(), r => this.publicRoom(r)); }

    _canEnter(p, room) {
        return !room.password || room.owner === p.id || p.unlocked.has(room.uid);
    }

    /** Destroys a conference room whose slot became empty. */
    _collect(slotId, destroyed) {
        const room = this.rooms.get(slotId);
        if (!room) return;
        if (this.occupancy.get(slotId).size > 0) return;
        if (room.builtin) {
            if (slotId === STADIUM.id) { this.football.reset(true); this.emit('football:reset'); }
            return;
        }
        this.rooms.delete(slotId);
        destroyed.push(slotId);
    }

    createRoom(p, { slotId, name, password, color }) {
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
            color: Object.prototype.hasOwnProperty.call(W.ROOM_COLORS, color) ? color : 'blue',
            passwordRecord: pass ? hashPassword(pass) : null
        });
        this.rooms.set(slotId, room);
        p.unlocked.add(room.uid);

        // The owner appears in the middle of the new room.
        const moved = [p];
        p.x = slot.x + slot.w / 2 - PS / 2;
        p.y = slot.y + slot.h / 2 - PS / 2;

        // Anybody else standing there must either be allowed in or is pushed out through the door.
        const membership = [{ player: p, from: null, to: slotId }];
        const door = { x: W.doorStart(slot) + C.DOOR_SIZE / 2 - PS / 2, y: slot.y + slot.h + 24 };
        const inflated = { x: slot.x - PS, y: slot.y - PS, w: slot.w + PS * 2, h: slot.h + PS * 2 };
        for (const other of this.players.values()) {
            if (other === p) continue;
            const rect = { x: other.x, y: other.y, w: PS, h: PS };
            if (!W.rectsIntersect(rect, inflated)) continue;
            if (!this._canEnter(other, room) || W.wallsBlock(slot, rect)) {
                other.x = door.x; other.y = door.y;
                moved.push(other);
                if (other.slotId === slotId) {
                    this.occupancy.get(slotId).delete(other.id);
                    other.slotId = null;
                }
                if (other.roomId === slotId) other.roomId = null;
            } else if (other.slotId === slotId) {
                other.roomId = slotId;
                membership.push({ player: other, from: null, to: slotId });
            }
        }
        p.roomId = slotId; // slotId is already tracked for the owner
        return { ok: true, room, moved, membership };
    }

    checkPassword(p, slotId, password) {
        const room = this.rooms.get(slotId);
        if (!room || !room.password || typeof password !== 'string') return false;
        if (!verifyPassword(password, room.password)) return false;
        p.unlocked.add(room.uid);
        return true;
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
            result.membership = { from: p.roomId, to: roomId };
            p.roomId = roomId;
        }
        return result;
    }

    // ------------------------------------------------------------- whiteboard

    addStroke(room, batch) {
        room.whiteboard.push(batch);
        if (room.whiteboard.length > MAX_WB_BATCHES) room.whiteboard.shift();
    }

    // -------------------------------------------------------------------- misc

    /** Snapshot sent to a player that enters a room (late joiners catch up). */
    roomSnapshot(room) {
        return {
            roomId: room.id,
            whiteboard: room.whiteboard,
            note: room.note,
            music: room.music.snapshot()
        };
    }
}

module.exports = { World, MAX_ROOMS_PER_OWNER };
