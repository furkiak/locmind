const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, min = 1) =>
    typeof value === 'string' && value.trim().length >= min && value.length <= max;
const finite = (value, min, max) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const peerId = value => text(value, 50) && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const slotId = value => typeof value === 'string' && /^(slot_(?:[1-9]|1[0-9]|20)|stadium_1)$/.test(value);
const color = value => typeof value === 'string' &&
    (['black', 'red', 'white'].includes(value) || /^#[0-9a-fA-F]{6}$/.test(value));

const validators = {
    joinGame: value => record(value) && text(value.nickname, 15) && text(value.avatar, 32),
    kickBall: value => value === undefined,
    sendEmoji: value => text(value, 40),
    sendChat: value => text(value, 60),
    'music-add': value => record(value) && slotId(value.roomId) &&
        typeof value.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.videoId) &&
        text(value.title, 100),
    'music-next': slotId,
    'music-remove': value => record(value) && slotId(value.roomId) &&
        Number.isInteger(value.index) && value.index >= 0 && value.index < 20,
    'music-ended': slotId,
    'wb-draw': value => record(value) && slotId(value.roomId) &&
        ['x0', 'y0', 'x1', 'y1'].every(key => finite(value[key], 0, 5000)) &&
        color(value.color) && finite(value.width, 1, 20),
    'wb-clear': slotId,
    'note-update': value => record(value) && slotId(value.roomId) &&
        typeof value.text === 'string' && value.text.length <= 5000,
    'screenshare-stop': value => value === undefined,
    'camera-stopped': value => value === undefined,
    sendPeerId: peerId,
    move: value => record(value) && finite(value.x, 0, 6000) && finite(value.y, 0, 6000) &&
        finite(value.dirX, -1, 1) && finite(value.dirY, -1, 1),
    createRoom: value => record(value) && slotId(value.slotId) && value.slotId !== 'stadium_1' &&
        text(value.name, 20) && typeof value.password === 'string' && value.password.length <= 20,
    checkPassword: value => record(value) && slotId(value.slotId) && text(value.password, 20),
    'media-authorize': value => record(value) && peerId(value.targetPeerId) &&
        ['voice', 'camera', 'screenshare'].includes(value.type),
    'media-verify': value => record(value) && typeof value.token === 'string' &&
        /^[0-9a-f]{64}$/.test(value.token) && peerId(value.callerPeerId) &&
        ['voice', 'camera', 'screenshare'].includes(value.type)
};

function validPacket(event, args) {
    return Object.hasOwn(validators, event) && args.length <= 2 &&
        validators[event](args[0]) && (args.length < 2 || typeof args[1] === 'function');
}

module.exports = { validPacket, peerId, slotId };
