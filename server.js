const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    maxHttpBufferSize: 64 * 1024,
    cors: { origin: (origin, callback) => callback(null, allowedOrigin(origin)), methods: ['GET', 'POST'] },
    allowRequest: (request, callback) => callback(null, allowedOrigin(request.headers.origin))
});
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validPacket } = require('./protocol');

function allowedOrigin(origin) {
    if (!origin) return true;
    const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
        .split(',').map(value => value.trim());
    return allowed.includes(origin);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/emoji', express.static(path.join(__dirname, 'emoji')));
app.get('/vendor/peerjs.min.js', (_request, response) =>
    response.sendFile(path.join(__dirname, 'node_modules', 'peerjs', 'dist', 'peerjs.min.js')));

const SLOT_SIZE = 250;
const GAP = 150;
const GRID_ROWS = 6; 
const PLAYER_SIZE = 40;
const DOOR_SIZE = 70;

const FOOTBALL_FIELD = {
    id: 'stadium_1',
    x: 1800, 
    y: 100,
    w: 1200, 
    h: 800,  
    goalSize: 200
};

let ball = {
    x: FOOTBALL_FIELD.x + FOOTBALL_FIELD.w / 2,
    y: FOOTBALL_FIELD.y + FOOTBALL_FIELD.h / 2,
    vx: 0,
    vy: 0,
    radius: 15
};

const MAP_SLOTS = [];
let slotCounter = 1;

for (let row = 0; row < GRID_ROWS; row++) {
    if (row < 4) {
        for (let col = 0; col < 4; col++) {
            MAP_SLOTS.push({
                id: `slot_${slotCounter++}`,
                x: 100 + col * (SLOT_SIZE + GAP),
                y: 100 + row * (SLOT_SIZE + GAP),
                w: SLOT_SIZE,
                h: SLOT_SIZE,
                type: 'conference' 
            });
        }
    } else if (row === 4) {
        for (let col = 0; col < 2; col++) {
            MAP_SLOTS.push({
                id: `slot_${slotCounter++}`,
                x: 100 + col * (SLOT_SIZE * 2 + GAP * 2),
                y: 100 + row * (SLOT_SIZE + GAP),
                w: SLOT_SIZE * 2 + GAP, 
                h: SLOT_SIZE,
                type: 'conference'
            });
        }
    } else if (row === 5) {
        for (let col = 0; col < 2; col++) {
            MAP_SLOTS.push({
                id: `slot_${slotCounter++}`,
                x: 100 + col * (SLOT_SIZE * 2 + GAP * 2),
                y: 100 + row * (SLOT_SIZE + GAP),
                w: SLOT_SIZE * 2 + GAP, 
                h: SLOT_SIZE * 2 + GAP,
                type: 'conference'
            });
        }
    }
}

MAP_SLOTS.push({
    id: FOOTBALL_FIELD.id,
    x: FOOTBALL_FIELD.x,
    y: FOOTBALL_FIELD.y,
    w: FOOTBALL_FIELD.w,
    h: FOOTBALL_FIELD.h,
    type: 'stadium' 
});

let players = Object.create(null);
let rooms = Object.create(null);
const rateLimits = Object.create(null);
const mediaGrants = new Map();
const validEmojis = [];
const validAvatars = ['usr1.png', 'usr2.png', 'usr3.png', 'usr4.png']; 

rooms[FOOTBALL_FIELD.id] = {
    id: FOOTBALL_FIELD.id,
    name: "⚽ Football Arena",
    owner: "server",
    passwordHash: null,
    passwordSalt: null,
    whiteboardHistory: [],
    notepadText: "Scoreboard:\nTeam A: 0\nTeam B: 0",
    musicPlaylist: [],
    currentSong: null,
    songStartTime: 0
};

const emojiDir = path.join(__dirname, 'emoji');
if (fs.existsSync(emojiDir)) {
    validEmojis.push(...fs.readdirSync(emojiDir).filter(f => f.match(/\.(png|gif|jpe?g)$/i)));
}

function checkRateLimit(socketId, action, limit, timeWindowMs) {
    if (!rateLimits[socketId]) rateLimits[socketId] = {};
    if (!rateLimits[socketId][action]) rateLimits[socketId][action] = [];
    const now = Date.now();
    const timestamps = rateLimits[socketId][action];
    while (timestamps.length > 0 && timestamps[0] < now - timeWindowMs) timestamps.shift();
    if (timestamps.length >= limit) return false;
    timestamps.push(now);
    return true;
}

function passwordFields(password) {
    if (!password) return { passwordHash: null, passwordSalt: null };
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, passwordSalt, 32).toString('hex');
    return { passwordHash, passwordSalt };
}

function passwordMatches(room, candidate) {
    if (!room?.passwordHash || !room.passwordSalt) return false;
    const actual = Buffer.from(room.passwordHash, 'hex');
    const supplied = crypto.scryptSync(candidate, room.passwordSalt, actual.length);
    return crypto.timingSafeEqual(actual, supplied);
}

function publicRoom(room) {
    return {
        id: room.id, name: room.name, owner: room.owner,
        hasPassword: !!room.passwordHash, whiteboardHistory: [], notepadText: '',
        musicPlaylist: [], currentSong: null, songStartTime: 0
    };
}

const eventRates = {
    joinGame: [1, 5000], move: [30, 1000], sendChat: [3, 1000],
    sendEmoji: [3, 1000], createRoom: [1, 3000], checkPassword: [4, 10000],
    'wb-draw': [150, 1000], 'note-update': [20, 1000],
    'media-authorize': [12, 1000], 'media-verify': [12, 1000]
};

function inSameAuthorizedRoom(a, b) {
    if (!a.roomId || a.roomId !== b.roomId || !rooms[a.roomId]) return false;
    const aSocket = io.sockets.sockets.get(a.id);
    const bSocket = io.sockets.sockets.get(b.id);
    return !!aSocket?.rooms.has(a.roomId) && !!bSocket?.rooms.has(a.roomId);
}

function canShareMedia(a, b, type) {
    if (!a || !b || !a.peerId || !b.peerId || a.id === b.id) return false;
    if (inSameAuthorizedRoom(a, b))
        return type !== 'screenshare' || a.roomId !== FOOTBALL_FIELD.id;
    if (type === 'screenshare' || a.roomId || b.roomId) return false;
    return !!io.sockets.sockets.get(a.id)?.rooms.has('public') &&
        !!io.sockets.sockets.get(b.id)?.rooms.has('public') &&
        Math.hypot(a.x - b.x, a.y - b.y) < 400;
}

function revokeMedia(socket, peerIds) {
    for (const id of peerIds) {
        socket.emit('media-revoked', { id });
        io.to(id).emit('media-revoked', { id: socket.id });
    }
}

function rectIntersect(r1, r2) {
    return !(r2.x > r1.x + r1.w || r2.x + r2.w < r1.x || r2.y > r1.y + r1.h || r2.y + r2.h < r1.y);
}

const ballTimer = setInterval(() => {
    ball.vx *= 0.95;
    ball.vy *= 0.95;

    if (Math.abs(ball.vx) < 0.1) ball.vx = 0;
    if (Math.abs(ball.vy) < 0.1) ball.vy = 0;

    let nextX = ball.x + ball.vx;
    let nextY = ball.y + ball.vy;

    const fX = FOOTBALL_FIELD.x;
    const fY = FOOTBALL_FIELD.y;
    const fW = FOOTBALL_FIELD.w;
    const fH = FOOTBALL_FIELD.h;
    const goalTop = fY + (fH - FOOTBALL_FIELD.goalSize) / 2;
    const goalBottom = fY + (fH + FOOTBALL_FIELD.goalSize) / 2;

    if (nextX - ball.radius < fX) {
        if (nextY > goalTop && nextY < goalBottom) {
            resetBall();
            io.emit('goal', 'left');
            return;
        } else {
            nextX = fX + ball.radius;
            ball.vx = -ball.vx * 0.8; 
        }
    } else if (nextX + ball.radius > fX + fW) {
        if (nextY > goalTop && nextY < goalBottom) {
            resetBall();
            io.emit('goal', 'right');
            return;
        } else {
            nextX = fX + fW - ball.radius;
            ball.vx = -ball.vx * 0.8;
        }
    }

    if (nextY - ball.radius < fY) {
        nextY = fY + ball.radius;
        ball.vy = -ball.vy * 0.8;
    } else if (nextY + ball.radius > fY + fH) {
        nextY = fY + fH - ball.radius;
        ball.vy = -ball.vy * 0.8;
    }

    ball.x = nextX;
    ball.y = nextY;

    if (Math.abs(ball.vx) > 0 || Math.abs(ball.vy) > 0) {
        io.emit('updateBall', ball);
    }

}, 30); 

function resetBall() {
    ball.x = FOOTBALL_FIELD.x + FOOTBALL_FIELD.w / 2;
    ball.y = FOOTBALL_FIELD.y + FOOTBALL_FIELD.h / 2;
    ball.vx = 0;
    ball.vy = 0;
    io.emit('updateBall', ball);
}

io.on('connection', (socket) => {
    socket.use(([event, ...args], next) => {
        const rate = eventRates[event] || [20, 1000];
        if (!validPacket(event, args) || !checkRateLimit(socket.id, `packet:${event}`, ...rate)) {
            socket.emit('requestError', { event, message: 'Invalid or excessive request.' });
            return next(new Error('Rejected event: ' + event));
        }
        next();
    });
    socket.on('error', () => {});
    
    socket.on('joinGame', (data) => {
        if (players[socket.id] || Object.keys(players).length >= 60) {
            socket.emit('requestError', { event: 'joinGame', message: 'World is full or this session already joined.' });
            return;
        }
        const spawnPoint = findSafeSpawn();
        let safeNickname = data.nickname.trim().substring(0, 15);
        
        const existingNames = Object.values(players).map(p => p.nickname);
        if (existingNames.includes(safeNickname)) {
            safeNickname = safeNickname + "#" + Math.floor(1000 + Math.random() * 9000);
        }

        const safeAvatar = validAvatars.includes(data.avatar) ? data.avatar : 'usr1.png';
        
        players[socket.id] = {
            id: socket.id,
            nickname: safeNickname,
            avatar: safeAvatar,
            x: spawnPoint.x, 
            y: spawnPoint.y,
            dirX: 0, 
            dirY: 1, 
            peerId: null,
            roomId: null,
            unlockedRooms: new Set() 
        };

        socket.join('public');

        socket.emit('initWorld', { slots: MAP_SLOTS, rooms: getSafeRooms(),
            players: Object.fromEntries(Object.entries(players).map(([id, p]) =>
                [id, { ...p, unlockedRooms: [] }])), emojis: validEmojis, ball: ball });
        const emitPlayer = {...players[socket.id], unlockedRooms: []};
        socket.broadcast.emit('playerJoined', emitPlayer);
    });

    socket.on('kickBall', () => {
        const p = players[socket.id];
        if (!p) return;
        
        const dx = ball.x - (p.x + PLAYER_SIZE/2);
        const dy = ball.y - (p.y + PLAYER_SIZE/2);
        const dist = Math.sqrt(dx*dx + dy*dy);
        const kickRadius = 60; 

        if (dist < kickRadius + ball.radius) {
            io.emit('playerKicked', socket.id);
            const angle = Math.atan2(dy, dx);
            const force = 20.0; 
            ball.vx += Math.cos(angle) * force;
            ball.vy += Math.sin(angle) * force;
            io.emit('updateBall', ball);
        }
    });

    socket.on('sendEmoji', (emojiName) => {
        if (!checkRateLimit(socket.id, 'emoji', 3, 1000)) return; 
        if (validEmojis.includes(emojiName)) {
            io.emit('showEmoji', { id: socket.id, emoji: emojiName });
        }
    });

    socket.on('sendChat', (text) => {
        if (!checkRateLimit(socket.id, 'chat', 2, 1000)) return; 
        const p = players[socket.id];
        if (p) {
            const safeText = text.substring(0, 60);
            if (p.roomId && (!rooms[p.roomId] || !socket.rooms.has(p.roomId))) return;
            if (!p.roomId && !socket.rooms.has('public')) return;
            const channel = p.roomId || 'public';
            io.to(channel).emit('chatMessage', { id: socket.id, text: safeText,
                roomId: channel === 'public' ? null : channel });
        }
    });

    socket.on('music-add', (data) => {
        if (!checkRateLimit(socket.id, 'music', 5, 2000)) return;
        const p = players[socket.id];
        if (p && p.roomId === data.roomId && rooms[data.roomId]) {
            const room = rooms[data.roomId];
            
            if (room.musicPlaylist.length >= 20) return;
            room.musicPlaylist.push({
                videoId: data.videoId,
                title: data.title.trim().substring(0, 50),
                addedBy: p.nickname
            });

            if (!room.currentSong) {
                playNextSong(data.roomId);
            } else {
                io.to(data.roomId).emit('music-update', { 
                    current: room.currentSong, 
                    playlist: room.musicPlaylist,
                    startTime: room.songStartTime 
                });
            }
        }
    });

    socket.on('music-next', (roomId) => {
        const p = players[socket.id];
        if (p && p.roomId === roomId && rooms[roomId]) {
            playNextSong(roomId);
        }
    });

    socket.on('music-remove', (data) => {
        const { roomId, index } = data;
        const p = players[socket.id];
        if (p && p.roomId === roomId && rooms[roomId]) {
            const room = rooms[roomId];
            if (index >= 0 && index < room.musicPlaylist.length) {
                room.musicPlaylist.splice(index, 1);
                io.to(roomId).emit('music-update', { 
                    current: room.currentSong, 
                    playlist: room.musicPlaylist,
                    startTime: room.songStartTime 
                });
            }
        }
    });

    socket.on('music-ended', (roomId) => {
        const p = players[socket.id];
        if (p && p.roomId === roomId && rooms[roomId]) {
            const room = rooms[roomId];
            if (room.currentSong) {
                playNextSong(roomId);
            }
        }
    });

    function playNextSong(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        if (room.musicPlaylist.length > 0) {
            const next = room.musicPlaylist.shift(); 
            room.currentSong = next;
            room.songStartTime = Date.now(); 
            
            io.to(roomId).emit('music-update', { 
                current: room.currentSong, 
                playlist: room.musicPlaylist,
                startTime: room.songStartTime
            });
        } else {
            room.currentSong = null;
            room.songStartTime = 0;
            io.to(roomId).emit('music-update', { current: null, playlist: [], startTime: 0 });
        }
    }

    socket.on('wb-draw', (data) => {
        if (!checkRateLimit(socket.id, 'wb', 150, 1000)) return;
        const p = players[socket.id];
        if (typeof data.x0 !== 'number' || isNaN(data.x0)) return;
        data.color = String(data.color).substring(0, 20); 

        if (p && p.roomId && p.roomId === data.roomId) { 
            const r = rooms[p.roomId];
            if (r) {
                r.whiteboardHistory.push(data);
                if(r.whiteboardHistory.length > 5000) r.whiteboardHistory.shift();
            }
            socket.to(data.roomId).emit('wb-draw', data);
        }
    });
    
    socket.on('wb-clear', (roomId) => {
        const p = players[socket.id];
        if (p && p.roomId === roomId) {
            const r = rooms[roomId];
            if (r) r.whiteboardHistory = [];
            socket.to(roomId).emit('wb-clear');
        }
    });

    socket.on('note-update', (data) => {
        if (!checkRateLimit(socket.id, 'note', 20, 1000)) return;
        const p = players[socket.id];
        if (p && p.roomId === data.roomId) {
            const safeText = String(data.text).substring(0, 5000); 
            const r = rooms[p.roomId];
            if (r) r.notepadText = safeText;
            socket.to(data.roomId).emit('note-update', safeText);
        }
    });

    socket.on('screenshare-stop', () => {
        const p = players[socket.id];
        if (p?.roomId && socket.rooms.has(p.roomId)) {
            socket.to(p.roomId).emit('screenshare-stopped', p.peerId);
        }
    });

    socket.on('camera-stopped', () => {
        io.emit('camera-stopped', socket.id);
    });

    socket.on('sendPeerId', (peerId) => {
        const p = players[socket.id];
        if (p && !p.peerId && !Object.values(players).some(other => other.peerId === peerId)) {
            p.peerId = peerId;
            socket.broadcast.emit('updatePlayerPeer', { id: socket.id, peerId: p.peerId });
        }
    });

    socket.on('media-authorize', (data, respond = () => {}) => {
        const caller = players[socket.id];
        const target = Object.values(players).find(player => player.peerId === data.targetPeerId);
        if (!canShareMedia(caller, target, data.type)) return respond({ allowed: false });
        const now = Date.now();
        for (const [token, grant] of mediaGrants)
            if (grant.expiresAt <= now) mediaGrants.delete(token);
        if (mediaGrants.size >= 1000) return respond({ allowed: false });
        const token = crypto.randomBytes(32).toString('hex');
        mediaGrants.set(token, {
            callerId: socket.id, targetId: target.id, type: data.type,
            callerPeerId: caller.peerId, targetPeerId: target.peerId, expiresAt: now + 10000
        });
        respond({ allowed: true, token });
    });

    socket.on('media-verify', (data, respond = () => {}) => {
        const grant = mediaGrants.get(data.token);
        mediaGrants.delete(data.token);
        const caller = grant && players[grant.callerId];
        const target = players[socket.id];
        respond({ allowed: !!grant && grant.expiresAt > Date.now() &&
            grant.targetId === socket.id && grant.callerPeerId === data.callerPeerId &&
            grant.targetPeerId === target?.peerId && grant.type === data.type &&
            canShareMedia(caller, target, data.type) });
    });

    socket.on('move', (data) => {
        const p = players[socket.id];
        if (!p) return;

        const px = data.x; const py = data.y;
        const pdx = data.dirX; const pdy = data.dirY;

        if (isNaN(px) || isNaN(py) || isNaN(pdx) || isNaN(pdy)) return; 
        const dist = Math.sqrt(Math.pow(px - p.x, 2) + Math.pow(py - p.y, 2));
        
        if (dist > 150) {
            socket.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
            return; 
        } 

        let collisionDetected = false;
        const pRect = { x: px, y: py, w: PLAYER_SIZE, h: PLAYER_SIZE };
        
        for (let key in rooms) {
            const room = rooms[key];
            const slot = MAP_SLOTS.find(s => s.id === room.id);
            if (!slot) continue;
            
            const sx = slot.x, sy = slot.y, sW = slot.w || SLOT_SIZE, sH = slot.h || SLOT_SIZE; 
            const dStart = sx + (sW - DOOR_SIZE)/2;
            
            if (room.id === FOOTBALL_FIELD.id) {
                continue; 
            }

            const walls = [ 
                { x: sx, y: sy, w: sW, h: 5 }, 
                { x: sx, y: sy, w: 5, h: sH }, 
                { x: sx + sW - 5, y: sy, w: 5, h: sH }, 
                { x: sx, y: sy + sH - 5, w: dStart - sx, h: 5 }, 
                { x: dStart + DOOR_SIZE, y: sy + sH - 5, w: (sx + sW) - (dStart + DOOR_SIZE), h: 5 } 
            ];
            
            for (let w of walls) { if (rectIntersect(pRect, w)) { collisionDetected = true; break; } }
            if (collisionDetected) break;

            const doorRect = { x: dStart, y: sy + sH - 10, w: DOOR_SIZE, h: 20 };
            if (rectIntersect(pRect, doorRect)) {
                if (room.passwordHash && !p.unlockedRooms.has(room.id) && room.owner !== socket.id) {
                    const wasInside = (p.y < sy + sH); const isTryingToEnter = (py < sy + sH);
                    if (!wasInside && isTryingToEnter) { collisionDetected = true; break; }
                }
            }
        }

        if (collisionDetected || px < 0 || py < 0 || px > 6000 || py > 6000) {
            socket.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
            return;
        }

        let calculatedRoomId = null;
        for (const slot of MAP_SLOTS) {
            const sW = slot.w || SLOT_SIZE; const sH = slot.h || SLOT_SIZE;
            if (px > slot.x && px < slot.x + sW && py > slot.y && py < slot.y + sH) {
                calculatedRoomId = slot.id; break;
            }
        }

        const room = rooms[calculatedRoomId];
        if (room && room.passwordHash && room.owner !== socket.id && !p.unlockedRooms.has(calculatedRoomId)) {
            socket.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
            return;
        }
        const previousPeers = Object.values(players)
            .filter(other => canShareMedia(p, other, 'voice')).map(other => other.id);
        p.x = px; p.y = py; p.dirX = pdx; p.dirY = pdy;
        const nextRoomId = room ? calculatedRoomId : null;

        if (nextRoomId) {
            if (p.roomId !== nextRoomId) {
                if (p.roomId) socket.leave(p.roomId);
                socket.leave('public');
                p.roomId = nextRoomId;
                socket.join(nextRoomId);
                
                if (room) {
                    socket.emit('roomSync', { 
                        whiteboard: room.whiteboardHistory, 
                        notepad: room.notepadText,
                        music: {
                            current: room.currentSong,
                            playlist: room.musicPlaylist,
                            startTime: room.songStartTime
                        }
                    });
                }
            }
        } else {
            if (p.roomId) { socket.leave(p.roomId); p.roomId = null; }
            socket.join('public');
        }

        revokeMedia(socket, previousPeers.filter(id => !canShareMedia(p, players[id], 'voice')));

        checkEmptyRooms();
        socket.broadcast.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
    });

    socket.on('createRoom', (data) => {
        if (!checkRateLimit(socket.id, 'createRoom', 1, 3000)) return;
        const { slotId, name, password } = data;
        
        const slot = MAP_SLOTS.find(item => item.id === slotId && item.id !== FOOTBALL_FIELD.id);
        const p = players[socket.id];
        if (!slot || !p || rooms[slotId] || Object.keys(rooms).length >= MAP_SLOTS.length ||
            !(p.x > slot.x && p.x < slot.x + slot.w && p.y > slot.y && p.y < slot.y + slot.h)) {
            socket.emit('requestError', { event: 'createRoom', message: 'Move into an empty plot before creating a room.' });
            return;
        }

        const safeName = name.trim().substring(0, 20);
        
        if (!rooms[slotId]) {
            rooms[slotId] = { 
                id: slotId, name: safeName, owner: socket.id, 
                ...passwordFields(password),
                whiteboardHistory: [], notepadText: "",
                musicPlaylist: [], currentSong: null, songStartTime: 0
            };
            const safeRoom = publicRoom(rooms[slotId]);
            p.unlockedRooms.add(slotId);
            
            if (slot) {
                const previousPeers = Object.values(players)
                    .filter(other => canShareMedia(p, other, 'voice')).map(other => other.id);
                p.x = slot.x + (slot.w || SLOT_SIZE) / 2 - PLAYER_SIZE / 2;
                p.y = slot.y + (slot.h || SLOT_SIZE) / 2 - PLAYER_SIZE / 2;
                if (p.roomId) socket.leave(p.roomId);
                socket.leave('public');
                p.roomId = slotId;
                socket.join(slotId);
                revokeMedia(socket, previousPeers);
                io.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
            }

            io.emit('roomUpdate', { type: 'create', room: safeRoom });
        }
    });

    socket.on('checkPassword', (data) => {
        if (!checkRateLimit(socket.id, 'password', 4, 10000)) {
            socket.emit('passwordResult', { success: false, message: "Çok fazla deneme yaptınız. Lütfen 10 saniye bekleyin." });
            return;
        }

        const { slotId, password } = data;
        const room = rooms[slotId];
        const p = players[socket.id];
        
        if (room && p && passwordMatches(room, password)) {
            p.unlockedRooms.add(slotId); 
            socket.emit('passwordResult', { success: true, slotId: slotId });
        } else {
            socket.emit('passwordResult', { success: false, message: "Yanlış Şifre!" });
        }
    });

    socket.on('disconnect', () => {
        for (const [token, grant] of mediaGrants)
            if (grant.callerId === socket.id || grant.targetId === socket.id) mediaGrants.delete(token);
        delete rateLimits[socket.id];
        if (players[socket.id]) {
            revokeMedia(socket, Object.keys(players).filter(id => id !== socket.id));
            io.emit('screenshare-stopped', players[socket.id].peerId); 
            io.emit('camera-stopped', socket.id);
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
            checkEmptyRooms();
        }
    });

    function findSafeSpawn() {
        let safe = false; let x = 0, y = 0; let attempts = 0;
        while (!safe && attempts < 100) {
            x = 50; y = 50 + Math.random() * 600; safe = true; 
            for (let id in players) {
                const p = players[id];
                const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
                if (dist < PLAYER_SIZE * 1.5) { safe = false; break; }
            }
            attempts++;
        }
        return { x, y };
    }

    function checkEmptyRooms() {
        for (const roomId in rooms) {
            if (roomId === FOOTBALL_FIELD.id) continue;
            if (!Object.values(players).some(player => player.roomId === roomId)) {
                delete rooms[roomId];
                io.emit('roomUpdate', { type: 'destroy', slotId: roomId });
            }
        }
    }

    function getSafeRooms() {
        const safe = {};
        for (const key in rooms) safe[key] = publicRoom(rooms[key]);
        return safe;
    }
});

if (require.main === module) {
    const port = Number(process.env.PORT || 3000);
    http.listen(port, () => { console.log(`Server listening on ${http.address().port}.`); });
}

module.exports = {
    http, io,
    getPlayer: id => players[id],
    roomIds: () => Object.keys(rooms),
    close: callback => { clearInterval(ballTimer); io.close(callback); }
};
