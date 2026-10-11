// Shared client state + tiny event bus. Modules import this instead of each other.
export const W = window.LocWorld;
export const C = W.C;

const SETTINGS_KEY = 'locmind.settings';
const DEFAULTS = {
    lang: null, theme: 'auto', sfx: true, spatial: true, minimap: true, reduceMotion: false,
    volume: 100, micId: '', musicVolume: 60, nick: '', avatar: 'usr1.png'
};

function loadSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; }
}

export const S = {
    socket: null,
    config: null,
    myId: null,
    active: false,
    connected: false,
    players: {},
    rooms: {},
    slots: [],
    slotsById: {},
    unlocked: new Set(),
    ball: null,
    score: { blue: 0, red: 0 },
    emojis: { images: [], unicode: [] },
    zoom: 1,
    cam: { x: 0, y: 0 },
    fx: [],
    videos: {},
    modalOpen: false,
    currentSlotId: null,   // empty plot the player is standing on
    currentRoomId: null,   // room or stadium the player is in
    settings: loadSettings(),
    micState: 'off',       // off | on | denied | none
    muted: false,
    camStream: null,
    screenStream: null,
    userVolumes: {},
    needsRedraw: true,
    resume: null,
    locate: null
};

export function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch (_) { /* private mode */ }
}

export function setSetting(key, value) {
    S.settings[key] = value;
    saveSettings();
    bus.emit('setting', { key, value });
}

// ---------------------------------------------------------------- event bus
const listeners = new Map();
export const bus = {
    on(evt, fn) {
        if (!listeners.has(evt)) listeners.set(evt, new Set());
        listeners.get(evt).add(fn);
        return () => listeners.get(evt).delete(fn);
    },
    emit(evt, data) {
        const set = listeners.get(evt);
        if (set) for (const fn of Array.from(set)) { try { fn(data); } catch (err) { console.error(`[bus ${evt}]`, err); } }
    }
};

// ------------------------------------------------------------------ helpers
export const redraw = () => { S.needsRedraw = true; };

export function slotOfPlayer(p) {
    return W.slotAt(S.slots, p.x + C.PLAYER_SIZE / 2, p.y + C.PLAYER_SIZE / 2);
}

/** Id of the room (or stadium) a player is standing in, or null. */
export function roomIdOf(p) {
    const slot = slotOfPlayer(p);
    return slot && S.rooms[slot.id] ? slot.id : null;
}

export function canEnter(room) {
    return !room.hasPassword || room.owner === S.myId || S.unlocked.has(room.id);
}

export function me() { return S.players[S.myId] || null; }

export function makePlayer(p) {
    return {
        ...p,
        rx: p.x, ry: p.y,
        muted: !!p.muted, cam: !!p.cam, screen: !!p.screen,
        hasVideo: false,
        bubble: null, emoji: null, kickAnim: 0
    };
}
