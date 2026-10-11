// Shared client state + tiny event bus. Modules import this instead of each other.
export const W = window.LocWorld;
export const C = W.C;

const SETTINGS_KEY = 'locmind.settings';
const DEFAULTS = {
    lang: null, theme: 'auto', sfx: true, spatial: true, minimap: true, reduceMotion: false,
    volume: 100, micId: '', musicVolume: 60, nick: '', avatar: 'usr1.png',
    ptt: false, notify: false, blocked: []
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
    // ?relay=1 forces every call through the TURN relay (handy to test firewalled networks)
    forceRelay: new URLSearchParams(location.search).has('relay'),
    locate: null,
    server: null,           // { name, motd, youtube, library, uploads, uploadMaxBytes } from the join answer
    serverPassword: '',
    room: { hands: [], poll: null, timer: null },   // live tools of the room I am in
    follow: null,           // id of the player I am following
    pttDown: false,         // push-to-talk key held
    rtt: null
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

/** Players I chose to block: their chat, bubbles, DMs and waves are hidden and their voice is muted. */
export const isBlocked = id => {
    const p = S.players[id];
    return !!p && S.settings.blocked.includes(p.nickname);
};

/** Is the player (top-left x/y) standing on the auditorium stage? */
export const onStage = p => !!p && W.onStage(p.x, p.y);

/**
 * Who hears whom:
 *  - rooms and the stadium: everybody inside, nobody outside
 *  - auditorium: the stage reaches the whole hall, the audience only whispers to neighbours
 *  - open world: proximity voice that fades with distance
 * Returns the gain (0..1) I should play `p` at and whether a link is needed at all.
 */
export function voiceRelation(self, p, linked = false) {
    const myRoom = S.currentRoomId, theirRoom = roomIdOf(p);
    const dx = p.x - self.x, dy = p.y - self.y, dist = Math.hypot(dx, dy);
    if (myRoom === C.AUDITORIUM_ID && theirRoom === C.AUDITORIUM_ID) {
        const whisper = linked ? C.WHISPER_DISTANCE + 40 : C.WHISPER_DISTANCE;
        if (onStage(p)) return { link: true, gain: 1, pan: dx / 900 };
        if (onStage(self)) return { link: true, gain: dist < C.WHISPER_DISTANCE ? Math.pow(1 - dist / C.WHISPER_DISTANCE, 1.2) : 0, pan: dx / 600 };
        return { link: dist < whisper, gain: dist < C.WHISPER_DISTANCE ? Math.pow(1 - dist / C.WHISPER_DISTANCE, 1.2) : 0, pan: dx / (C.WHISPER_DISTANCE * .8) };
    }
    if (myRoom || theirRoom) return myRoom === theirRoom ? { link: true, gain: 1, pan: dx / 1400 } : { link: false, gain: 0, pan: 0 };
    const reach = linked ? C.HEAR_LINK_DISTANCE : C.HEAR_DISTANCE;
    return { link: dist < reach, gain: dist < C.HEAR_DISTANCE ? Math.pow(1 - dist / C.HEAR_DISTANCE, 1.4) : 0, pan: dx / (C.HEAR_DISTANCE * .7) };
}

export function makePlayer(p) {
    return {
        ...p,
        rx: p.x, ry: p.y,
        muted: !!p.muted, cam: !!p.cam, screen: !!p.screen,
        hasVideo: false,
        bubble: null, emoji: null, kickAnim: 0
    };
}
