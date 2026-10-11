/*
 * Locmind - shared world definition.
 *
 * Loaded by the Node server (require) and by the browser (<script>), so both
 * sides always agree on map layout, collision geometry and gameplay constants.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LocWorld = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const C = Object.freeze({
        PLAYER_SIZE: 40,
        DOOR_SIZE: 70,
        WALL: 5,
        SLOT_SIZE: 250,
        GAP: 150,
        GRID_ROWS: 6,
        WIDTH: 3300,
        HEIGHT: 2900,
        SPEED: 300,              // walking speed in px / second
        HEAR_DISTANCE: 400,      // proximity voice radius (px)
        HEAR_LINK_DISTANCE: 460, // radius at which a voice link is dropped (hysteresis)
        STADIUM_ID: 'stadium_1',
        KICK_RADIUS: 60
    });

    const STADIUM = Object.freeze({
        id: C.STADIUM_ID,
        x: 1800, y: 100, w: 1200, h: 800,
        goalSize: 200, goalDepth: 40
    });

    // Apple-style system accent colours a room owner can pick from.
    const ROOM_COLORS = Object.freeze({
        blue: '#0A84FF', indigo: '#5E5CE6', purple: '#BF5AF2', pink: '#FF375F',
        red: '#FF453A', orange: '#FF9F0A', green: '#30D158', teal: '#64D2FF'
    });

    // Quick reactions available next to the image emojis shipped in /emoji.
    const REACTIONS = Object.freeze(['👍', '❤️', '😂', '🎉', '👏', '🔥', '😮', '😢', '🙌', '👋']);

    const AVATARS = Object.freeze(['usr1.png', 'usr2.png', 'usr3.png', 'usr4.png']);

    function buildSlots() {
        const slots = [];
        let n = 1;
        const { SLOT_SIZE: S, GAP: G, GRID_ROWS: ROWS } = C;
        for (let row = 0; row < ROWS; row++) {
            if (row < 4) {
                for (let col = 0; col < 4; col++) {
                    slots.push({ id: `slot_${n++}`, x: 100 + col * (S + G), y: 100 + row * (S + G), w: S, h: S, type: 'conference' });
                }
            } else {
                for (let col = 0; col < 2; col++) {
                    slots.push({
                        id: `slot_${n++}`,
                        x: 100 + col * (S * 2 + G * 2),
                        y: 100 + row * (S + G),
                        w: S * 2 + G,
                        h: row === 4 ? S : S * 2 + G,
                        type: 'conference'
                    });
                }
            }
        }
        slots.push({ id: STADIUM.id, x: STADIUM.x, y: STADIUM.y, w: STADIUM.w, h: STADIUM.h, type: 'stadium' });
        return slots;
    }

    function rectsIntersect(a, b) {
        return !(b.x > a.x + a.w || b.x + b.w < a.x || b.y > a.y + a.h || b.y + b.h < a.y);
    }

    function doorStart(slot) { return slot.x + (slot.w - C.DOOR_SIZE) / 2; }

    /** The five wall segments of a room (the bottom wall has a door gap). */
    function slotWalls(slot) {
        const { x, y, w, h } = slot, T = C.WALL, d0 = doorStart(slot), d1 = d0 + C.DOOR_SIZE;
        return [
            { x, y, w, h: T },
            { x, y, w: T, h },
            { x: x + w - T, y, w: T, h },
            { x, y: y + h - T, w: d0 - x, h: T },
            { x: d1, y: y + h - T, w: x + w - d1, h: T }
        ];
    }

    function slotDoor(slot) {
        return { x: doorStart(slot), y: slot.y + slot.h - 10, w: C.DOOR_SIZE, h: 20 };
    }

    function wallsBlock(slot, rect) {
        const walls = slotWalls(slot);
        for (let i = 0; i < walls.length; i++) if (rectsIntersect(rect, walls[i])) return true;
        return false;
    }

    /** True when `rect` is entering the (locked) door from outside while moving fromY -> toY. */
    function gateBlocks(slot, rect, fromY, toY) {
        if (!rectsIntersect(rect, slotDoor(slot))) return false;
        const edge = slot.y + slot.h;
        return fromY >= edge && toY < edge;
    }

    function slotAt(slots, cx, cy) {
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (cx > s.x && cx < s.x + s.w && cy > s.y && cy < s.y + s.h) return s;
        }
        return null;
    }

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    return { C, STADIUM, ROOM_COLORS, REACTIONS, AVATARS, buildSlots, rectsIntersect, doorStart, slotWalls, slotDoor, wallsBlock, gateBlocks, slotAt, clamp };
}));
