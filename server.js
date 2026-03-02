const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] } 
});
const fs = require('fs');
const path = require('path');

app.use(express.static('public'));

const SLOT_SIZE = 250;
const GAP = 150;
const GRID_ROWS = 6; 
const PLAYER_SIZE = 40;
const DOOR_SIZE = 70;

// YENİ: Futbol Sahası Sabitleri
const FOOTBALL_FIELD = {
    id: 'stadium_1',
    x: 1800, // Haritanın en sağına
    y: 100,
    w: 1200, // Devasa genişlik
    h: 800,  // Devasa yükseklik
    goalSize: 200
};

// YENİ: Topun durumu
let ball = {
    x: FOOTBALL_FIELD.x + FOOTBALL_FIELD.w / 2,
    y: FOOTBALL_FIELD.y + FOOTBALL_FIELD.h / 2,
    vx: 0,
    vy: 0,
    radius: 15
};

const MAP_SLOTS = [];
let slotCounter = 1;

// SOL TARAFTAKİ KONFERANS ODALARI
for (let row = 0; row < GRID_ROWS; row++) {
    if (row < 4) {
        for (let col = 0; col < 4; col++) {
            MAP_SLOTS.push({
                id: `slot_${slotCounter++}`,
                x: 100 + col * (SLOT_SIZE + GAP),
                y: 100 + row * (SLOT_SIZE + GAP),
                w: SLOT_SIZE,
                h: SLOT_SIZE,
                type: 'conference' // C harfi için işaret
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

// YENİ: Futbol Sahasını harita slotlarına ekle
MAP_SLOTS.push({
    id: FOOTBALL_FIELD.id,
    x: FOOTBALL_FIELD.x,
    y: FOOTBALL_FIELD.y,
    w: FOOTBALL_FIELD.w,
    h: FOOTBALL_FIELD.h,
    type: 'stadium' // Özel tip
});

let players = {};
let rooms = {}; 
const rateLimits = {}; 
const validEmojis = [];
const validAvatars = ['usr1.png', 'usr2.png', 'usr3.png', 'usr4.png']; 

// YENİ: Futbol sahası odasını sunucu açılır açılmaz oluştur (Sahibi yok, şifresi yok)
rooms[FOOTBALL_FIELD.id] = {
    id: FOOTBALL_FIELD.id,
    name: "⚽ Football Arena",
    owner: "server",
    password: null,
    whiteboardHistory: [],
    notepadText: "Scoreboard:\nTeam A: 0\nTeam B: 0",
    musicPlaylist: [],
    currentSong: null,
    songStartTime: 0
};

const emojiDir = path.join(__dirname, 'public', 'emoji');
if (fs.existsSync(emojiDir)) {
    validEmojis.push(...fs.readdirSync(emojiDir).filter(f => f.match(/\.(png|gif|jpe?g)$/i)));
}

function escapeHTML(str) {
    return String(str || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

function rectIntersect(r1, r2) {
    return !(r2.x > r1.x + r1.w || r2.x + r2.w < r1.x || r2.y > r1.y + r1.h || r2.y + r2.h < r1.y);
}

// YENİ: Top Fiziği Döngüsü (Server-Side Physics)
setInterval(() => {
    // 1. Sürtünme (Top yavaşlasın)
    ball.vx *= 0.95;
    ball.vy *= 0.95;

    // Hız çok düşükse durdur (titremeyi önle)
    if (Math.abs(ball.vx) < 0.1) ball.vx = 0;
    if (Math.abs(ball.vy) < 0.1) ball.vy = 0;

    // 2. Hareket
    let nextX = ball.x + ball.vx;
    let nextY = ball.y + ball.vy;

    // 3. Duvar Çarpışmaları (Sadece Futbol Sahası içinde)
    const fX = FOOTBALL_FIELD.x;
    const fY = FOOTBALL_FIELD.y;
    const fW = FOOTBALL_FIELD.w;
    const fH = FOOTBALL_FIELD.h;
    const goalTop = fY + (fH - FOOTBALL_FIELD.goalSize) / 2;
    const goalBottom = fY + (fH + FOOTBALL_FIELD.goalSize) / 2;

    // Sol/Sağ Duvarlar
    if (nextX - ball.radius < fX) {
        // Sol tarafta mıyız?
        if (nextY > goalTop && nextY < goalBottom) {
            // GOL! (Sol Kale)
            resetBall();
            io.emit('goal', 'left');
            return;
        } else {
            nextX = fX + ball.radius;
            ball.vx = -ball.vx * 0.8; // Sekme
        }
    } else if (nextX + ball.radius > fX + fW) {
        // Sağ tarafta mıyız?
        if (nextY > goalTop && nextY < goalBottom) {
            // GOL! (Sağ Kale)
            resetBall();
            io.emit('goal', 'right');
            return;
        } else {
            nextX = fX + fW - ball.radius;
            ball.vx = -ball.vx * 0.8;
        }
    }

    // Üst/Alt Duvarlar
    if (nextY - ball.radius < fY) {
        nextY = fY + ball.radius;
        ball.vy = -ball.vy * 0.8;
    } else if (nextY + ball.radius > fY + fH) {
        nextY = fY + fH - ball.radius;
        ball.vy = -ball.vy * 0.8;
    }

    ball.x = nextX;
    ball.y = nextY;

    // 4. Oyuncu - Top Çarpışması (Oyuncular topu iter)
    for (let id in players) {
        const p = players[id];
        // Basit daire çarpışması (Oyuncuyu 20px yarıçaplı daire sayalım)
        const dx = (p.x + PLAYER_SIZE/2) - ball.x;
        const dy = (p.y + PLAYER_SIZE/2) - ball.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const minDist = 20 + ball.radius; // Oyuncu yarıçapı + Top yarıçapı

        if (dist < minDist) {
            // Çarpışma var! Oyuncudan topa doğru vektör
            const angle = Math.atan2(dy, dx);
            const force = 2.0; // İtme gücü
            
            // Topu oyuncunun ters yönüne it
            ball.vx -= Math.cos(angle) * force;
            ball.vy -= Math.sin(angle) * force;
        }
    }

    // Eğer top hareket ediyorsa herkese bildir
    if (Math.abs(ball.vx) > 0 || Math.abs(ball.vy) > 0) {
        io.emit('updateBall', ball);
    }

}, 30); // 30ms'de bir fizik güncellemesi

function resetBall() {
    ball.x = FOOTBALL_FIELD.x + FOOTBALL_FIELD.w / 2;
    ball.y = FOOTBALL_FIELD.y + FOOTBALL_FIELD.h / 2;
    ball.vx = 0;
    ball.vy = 0;
    io.emit('updateBall', ball);
}

io.on('connection', (socket) => {
    
    socket.on('joinGame', (data) => {
        const spawnPoint = findSafeSpawn();
        let safeNickname = escapeHTML(data.nickname).substring(0, 15); 
        
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

        // Başlangıçta topun yerini de yolla
        socket.emit('initWorld', { slots: MAP_SLOTS, rooms: getSafeRooms(), players: players, emojis: validEmojis, ball: ball });
        const emitPlayer = {...players[socket.id], unlockedRooms: []};
        socket.broadcast.emit('playerJoined', emitPlayer);
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
            const safeText = String(text).substring(0, 60); 
            io.emit('chatMessage', { id: socket.id, text: safeText, roomId: p.roomId });
        }
    });

    socket.on('music-add', (data) => {
        if (!checkRateLimit(socket.id, 'music', 5, 2000)) return;
        const p = players[socket.id];
        if (p && p.roomId === data.roomId && rooms[data.roomId]) {
            const room = rooms[data.roomId];
            
            room.musicPlaylist.push({
                videoId: data.videoId,
                title: escapeHTML(data.title).substring(0, 50),
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
        if (players[socket.id]) {
            socket.broadcast.emit('screenshare-stopped', players[socket.id].peerId);
        }
    });

    socket.on('camera-stopped', () => {
        io.emit('camera-stopped', socket.id);
    });

    socket.on('sendPeerId', (peerId) => {
        const p = players[socket.id];
        if (p && !p.peerId) { 
            p.peerId = String(peerId).substring(0, 50);
            socket.broadcast.emit('updatePlayerPeer', { id: socket.id, peerId: p.peerId });
        }
    });

    socket.on('move', (data) => {
        const p = players[socket.id];
        if (!p) return;

        const px = parseFloat(data.x); const py = parseFloat(data.y);
        const pdx = parseFloat(data.dirX); const pdy = parseFloat(data.dirY);

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
            
            // YENİ: Futbol sahasının kapısı yok, tamamen açık gibi davranır (duvarları index.html çizer)
            // Ama yine de dış duvarlara çarpma kontrolü ekleyelim.
            if (room.id === FOOTBALL_FIELD.id) {
                // Futbol sahasına girmek/çıkmak serbest, sadece duvarlarına bak
                // Burada "duvar" mantığını biraz esnetiyoruz, oyuncu her yerden girebilir
                // Sadece odanın içinde kilitli kalma vb. olmasın.
                continue; // Çarpışma kontrolünü pas geç (serbest giriş)
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
                if (room.password && !p.unlockedRooms.has(room.id) && room.owner !== socket.id) {
                    const wasInside = (p.y < sy + sH); const isTryingToEnter = (py < sy + sH);
                    if (!wasInside && isTryingToEnter) { collisionDetected = true; break; }
                }
            }
        }

        if (collisionDetected || px < 0 || py < 0 || px > 6000 || py > 6000) {
            socket.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
            return;
        }

        p.x = px; p.y = py; p.dirX = pdx; p.dirY = pdy;

        let calculatedRoomId = null;
        for (const slot of MAP_SLOTS) {
            const sW = slot.w || SLOT_SIZE; const sH = slot.h || SLOT_SIZE;
            if (p.x > slot.x && p.x < slot.x + sW && p.y > slot.y && p.y < slot.y + sH) {
                calculatedRoomId = slot.id; break;
            }
        }

        let isAuthorized = false;
        const room = rooms[calculatedRoomId];
        if (calculatedRoomId) {
            if (!room) isAuthorized = true; // Boş arsa
            else if (room.id === FOOTBALL_FIELD.id) isAuthorized = true; // Herkes girebilir
            else if (!room.password) isAuthorized = true; 
            else if (room.owner === socket.id) isAuthorized = true; 
            else if (p.unlockedRooms.has(calculatedRoomId)) isAuthorized = true; 
        }

        if (calculatedRoomId && isAuthorized) {
            if (p.roomId !== calculatedRoomId) {
                if (p.roomId) socket.leave(p.roomId);
                p.roomId = calculatedRoomId;
                socket.join(calculatedRoomId); 
                
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
        }

        checkEmptyRooms();
        socket.broadcast.emit('playerMoved', { id: socket.id, x: p.x, y: p.y, dirX: p.dirX, dirY: p.dirY });
    });

    socket.on('createRoom', (data) => {
        if (!checkRateLimit(socket.id, 'createRoom', 1, 3000)) return;
        const { slotId, name, password } = data;
        
        // Stadyum slotuna oda kurulamaz
        if (slotId === FOOTBALL_FIELD.id) return;

        const safeName = escapeHTML(name).substring(0, 20);
        
        if (!rooms[slotId] && players[socket.id]) {
            rooms[slotId] = { 
                id: slotId, name: safeName, owner: socket.id, 
                password: password ? String(password).substring(0,20) : null,
                whiteboardHistory: [], notepadText: "",
                musicPlaylist: [], currentSong: null, songStartTime: 0
            };
            const safeRoom = { ...rooms[slotId], password: null, hasPassword: !!password, whiteboardHistory: [], notepadText: "", musicPlaylist:[] };
            players[socket.id].unlockedRooms.add(slotId); 
            
            const slot = MAP_SLOTS.find(s => s.id === slotId);
            if (slot) {
                const p = players[socket.id];
                p.x = slot.x + (slot.w || SLOT_SIZE) / 2 - PLAYER_SIZE / 2;
                p.y = slot.y + (slot.h || SLOT_SIZE) / 2 - PLAYER_SIZE / 2;
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
        
        if (room && p && room.password === String(password)) {
            p.unlockedRooms.add(slotId); 
            socket.emit('passwordResult', { success: true, slotId: slotId });
        } else {
            socket.emit('passwordResult', { success: false, message: "Yanlış Şifre!" });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            io.emit('screenshare-stopped', players[socket.id].peerId); 
            io.emit('camera-stopped', socket.id);
            delete players[socket.id];
            delete rateLimits[socket.id];
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
            // Stadyum asla silinmez
            if (roomId === FOOTBALL_FIELD.id) continue;

            const slot = MAP_SLOTS.find(s => s.id === roomId);
            if (!slot) continue;
            let isOccupied = false;
            for (const playerId in players) {
                const p = players[playerId];
                const sW = slot.w || SLOT_SIZE; const sH = slot.h || SLOT_SIZE;
                if (p.x > slot.x && p.x < slot.x + sW && p.y > slot.y && p.y < slot.y + sH) {
                    isOccupied = true; break;
                }
            }
            if (!isOccupied) {
                delete rooms[roomId];
                io.emit('roomUpdate', { type: 'destroy', slotId: roomId });
            }
        }
    }

    function getSafeRooms() {
        const safe = {};
        for(let key in rooms) { safe[key] = { ...rooms[key], password: null, hasPassword: !!rooms[key].password, whiteboardHistory:[], notepadText:"", musicPlaylist:[] }; }
        return safe;
    }
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Sunucu ${port} portunda çalışıyor.`); });
