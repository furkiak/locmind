<div align="center">

# 🌌 Locmind

**A 2D virtual universe where you can talk, build rooms, draw, listen to music and play football together — right in the browser.**

![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)
![Node.js](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101)
![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)

<img src="docs/hero.jpg" alt="Locmind: rooms, whiteboard, shared notes, football and the mobile layout" width="900">

[🇬🇧 English](#-english) · [🇹🇷 Türkçe](#-türkçe)

</div>

---

## 🇬🇧 English

Locmind is a web based 2D universe. You walk around with an avatar, **hear people louder as you get closer**, build private (even password protected) rooms, and collaborate with a shared whiteboard, notepad, screen sharing and a synchronised music box — or just kick a ball around in the stadium. Everything runs in a plain browser tab: HTML5 Canvas for the world, WebRTC for voice/video and Socket.io for the realtime game state. No build step, no database.

### ✨ Highlights

| | |
| :-- | :-- |
| 🪟 **Liquid Glass UI** | A macOS‑style translucent interface: blurred glass panels with specular rims, a magnifying dock, traffic‑light windows, springy animations, automatic light/dark appearance and a calm aurora world behind it. |
| 🔊 **Spatial voice** | Proximity chat with distance falloff **and stereo panning** — people on your left sound on your left. Per‑person volume (up to 300 %), speaking rings, mute badges. |
| 📹 **Video & screen share** | Camera bubbles above avatars (one‑way WebRTC to everyone in earshot) and room‑wide screen sharing in draggable windows. |
| 🏠 **Rooms** | Build a room on any free plot: pick a name, an accent colour and an optional password. Locked doors are enforced by the server. Rooms are private (voice, chat, tools) and clean themselves up. |
| 🧭 **Room directory** | See every active room, who built it and how many people are inside — then tap **Show me** and a compass arrow guides you there. |
| 🎨 **Whiteboard** | Eight colours, brush size, eraser, touch/pen support, resolution independent strokes and **PNG export**. Late joiners see everything that was drawn. |
| 📝 **Shared notes** | Live co‑editing that keeps *your* caret in place while others type. Export as `.txt`. |
| 🎵 **Music box** | A shared YouTube queue (paste a link or search). Everybody hears the same second, tracks never get skipped twice, titles come from the server. |
| ⚽ **Football** | A real stadium: server side physics, dribbling by running into the ball, a **scoreboard**, goal celebrations with confetti and a "GOAL!" banner. |
| 💬 **Chat, reactions & stickers** | Speech bubbles, a scrollable chat history with unread badge, ten quick reactions plus image stickers. |
| 📱 **Mobile first‑class** | Virtual joystick, tap‑to‑walk, pinch to zoom, bottom‑sheet windows, safe‑area aware, can be added to the home screen. |
| 🌍 **Türkçe & English** | Switch language on the fly; it follows your browser by default. |
| 🔁 **Seamless reconnect** | A network hiccup drops you back exactly where you were — same room, still the owner, doors you unlocked stay unlocked. |
| 🛡️ **Hardened server** | Every payload validated, per‑event rate limits, flood guard, server authoritative movement with swept wall collision, strict CSP. |

### 🖼️ Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/login-dark.jpg" alt="Login screen"></td>
    <td width="50%"><img src="docs/world-light.jpg" alt="Light appearance with the room directory"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/world-dark.jpg" alt="Room with whiteboard, notes and chat"></td>
    <td width="50%"><img src="docs/stadium.jpg" alt="Stadium with scoreboard"></td>
  </tr>
</table>

### 🚀 Quick start

Requirements: **Node.js 18 or newer**.

```bash
git clone https://github.com/furkiak/locmind.git
cd locmind
npm install
npm start
```

Open <http://localhost:3000>, pick a nickname and an avatar, and you are in. Open a second tab (or invite a friend) to try the voice chat.

> **HTTPS note:** browsers only allow microphone, camera and screen capture on `https://` pages or on `localhost`. When you deploy, put Locmind behind HTTPS (see [Deployment](#-deployment)). Without a microphone you can still join, listen and chat.

**Docker**

```bash
docker compose up --build        # http://localhost:3000
```

### 🎮 Controls

| Key | Action |
| :-- | :-- |
| **W A S D** / **↑ ← ↓ →** | Walk (or click / tap / drag anywhere on the map) |
| **Enter** | Open the chat box · **Enter** again to send · **Esc** to cancel |
| **T** | Chat history |
| **F** | Mute / unmute the microphone |
| **C** | Camera on / off |
| **Q** | Reactions and stickers |
| **E** | Build a room on a free plot |
| **G** · **H** · **M** | Whiteboard · Notes · Music (inside a room) |
| **R** | Room directory |
| **Space** | Kick the ball (in the stadium) |
| **+** / **−** / mouse wheel / pinch | Zoom |
| **Esc** | Close the top‑most dialog or panel |

On touch screens use the joystick, the dock buttons and the hint bubble ("tap here to build a room").

### ⚙️ Configuration

All settings are optional environment variables (see [`.env.example`](.env.example); load it with `node --env-file=.env server.js`).

| Variable | Default | Description |
| :-- | :-- | :-- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP listener |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so client IPs are read from `X-Forwarded-For` |
| `CORS_ORIGIN` | *(same origin)* | Comma separated origins that may open a socket from another site |
| `MAX_PLAYERS` | `150` | Simultaneous players |
| `AFK_LIMIT_MINUTES` | `30` | Idle time before a 45 s "are you still there?" countdown and disconnect |
| `ICE_SERVERS` | public STUN | JSON array of WebRTC ICE servers (overrides everything below) |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | – | Add one TURN relay — recommended in production, required behind symmetric NATs |
| `INVIDIOUS_INSTANCES` | public list | Instances used by the music search box. Pasting a YouTube link always works |

### 🌐 Deployment

Locmind is a single Node process. Terminate TLS in front of it and forward WebSockets.

<details>
<summary>Caddy</summary>

```caddyfile
locmind.example.com {
    reverse_proxy localhost:3000
}
```
</details>

<details>
<summary>nginx</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name locmind.example.com;
    # ssl_certificate ... ;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```
</details>

Run with `TRUST_PROXY=1`. Health check: `GET /healthz`.

**Scale:** voice and video are peer‑to‑peer meshes, so a crowd standing in one spot is limited by the participants' bandwidth (comfortable up to roughly 8–10 people with cameras, many more with voice only). The server itself batches movement into 20 Hz ticks and handled 80 simulated players using about 15 % of one core.

### 🧱 Architecture

```text
server.js              entry point (listen, graceful shutdown)
src/
  app.js               express + socket.io wiring, /healthz, /api/config, YouTube search
  game.js              the realtime protocol: validation, rate limits, broadcasts
  world.js             authoritative state: players, rooms, occupancy, movement rules
  football.js          ball physics, scoreboard
  music.js             per‑room queue (ids make "ended" reports idempotent)
  youtube.js           link parsing, oEmbed titles, search
  security.js          sanitising, password hashing, rate limiter, CSP headers
  config.js            environment configuration
shared/world.js        map, constants and collision geometry — used by server AND browser
public/
  index.html           markup only
  css/                 theme.css (tokens + Liquid Glass) · app.css (components)
  js/                  ES modules: main, state, net, rtc, audio, render, input, movement,
                       ui, panels, media, whiteboard, notes, music, settings, i18n, sfx, icons
test/                  unit + socket integration tests (node:test) and a browser e2e test
scripts/               screenshots generator
```

**How the pieces talk**

* **Socket.io** carries game state: movement (batched at 20 Hz), rooms, chat, whiteboard, notes, the music queue, the football and the **WebRTC signalling** (`rtc:signal`) — there is no separate signalling server.
* **WebRTC** links are created on demand: `audio` for everybody in earshot (with 400 px → 460 px hysteresis so links do not flap), `camera` one‑way to viewers in earshot and `screen` one‑way to everybody in the same room.
* The **server is authoritative**: it validates movement against a speed budget and swept collision with walls, owns room passwords (salted `scrypt` hashes, constant‑time compare), and scopes chat/tools to the room they belong to.
* `shared/world.js` is loaded by both sides, so map layout, door geometry and constants can never drift apart.

<details>
<summary>Socket events</summary>

| Client → server | Purpose |
| :-- | :-- |
| `join` | Enter the world (optionally `resume` a previous session) |
| `move` · `kick` · `score:reset` | Walk, kick the ball, reset the scoreboard |
| `chat` · `emoji` | Speech bubble / reaction |
| `room:create` · `room:password` | Build a room / unlock a door |
| `wb:draw` · `wb:clear` | Whiteboard (batched, normalised 0‥1 coordinates) |
| `note:set` | Replace the shared note |
| `music:add` · `music:skip` · `music:ended` · `music:remove` | Jukebox |
| `rtc:signal` | WebRTC offer / answer / ICE / close, relayed to one player |
| `status` · `heartbeat` | Mic/camera/screen flags · activity ping |

| Server → client | Purpose |
| :-- | :-- |
| `players:move` · `player:join` · `player:leave` · `player:snap` · `player:status` · `player:kick` | People |
| `room:created` · `room:destroyed` · `room:sync` | Rooms and the state of the room you just entered |
| `chat` · `emoji` | Messages / reactions |
| `wb:draw` · `wb:clear` · `note:update` · `music:update` | Room tools |
| `ball` · `goal` · `score` | Football |
| `rtc:signal` · `kicked` | Signalling · forced disconnect |
</details>

### 🛡️ Security & reliability

* All input is validated server‑side; malformed packets can never crash the process (every handler is isolated).
* Per‑event rate limits, a global flood guard, a 64 KB packet cap and a player cap.
* Server authoritative movement: speed budget, bounds, **swept** collision (no tunnelling through walls) and locked doors you cannot teleport past.
* Room unlocks are bound to the room *instance*, so a rebuilt room on the same plot asks for its password again.
* Chat, whiteboard, notes and music of a room are only ever sent to the people inside it.
* Text is stored raw and rendered as text — no HTML injection, no double escaping.
* Strict Content‑Security‑Policy, `nosniff`, referrer and permissions policies, no inline scripts.
* Idle players are disconnected on the server too, not only by the client.

### 🧪 Tests

```bash
npm test               # unit + socket integration tests (no browser needed)
npm run test:e2e       # two real Chromium pages: voice, rooms, tools, screen share, reconnect, mobile
npm run screenshots    # regenerates docs/*.jpg
```

The end‑to‑end test and the screenshot script need a Chromium binary: set `CHROMIUM_PATH` (or run `npx playwright install chromium`).

### 🆕 What's new in 2.0

Locmind 2.0 is a ground‑up cleanup: a modular server, a modular ES‑module client, a new design language and a long list of fixes. See [CHANGELOG.md](CHANGELOG.md) for the full list.

### 🗺️ Ideas for later

Interest management for very large crowds · SFU for big rooms · persistent accounts and rooms · more mini games · custom avatars.

---

## 🇹🇷 Türkçe

Locmind, web tabanlı 2D bir sanal evrendir. Avatarınla dolaşırsın, **yaklaştıkça insanları daha yüksek duyarsın**, özel (hatta şifreli) odalar kurarsın; ortak beyaz tahta, not defteri, ekran paylaşımı ve senkron müzik kutusuyla birlikte çalışırsın — ya da stadyumda top oynarsın. Hepsi sade bir tarayıcı sekmesinde çalışır: dünya için HTML5 Canvas, ses/görüntü için WebRTC, gerçek zamanlı oyun durumu için Socket.io. Derleme adımı ve veritabanı yok.

### ✨ Öne çıkanlar

| | |
| :-- | :-- |
| 🪟 **Liquid Glass arayüz** | macOS tarzı yarı saydam arayüz: bulanık cam paneller, ışık yansıması veren kenarlar, büyüyen dock, trafik ışıklı pencereler, yaylı animasyonlar, otomatik açık/koyu görünüm. |
| 🔊 **Uzamsal ses** | Mesafeye göre azalan **ve stereo panlamalı** yakınlık sesi — solundaki kişiyi sol kulağından duyarsın. Kişi başına ses ayarı (%300'e kadar), konuşma halkaları, sessiz rozetleri. |
| 📹 **Görüntü ve ekran paylaşımı** | Avatarın üstünde kamera balonları ve oda içinde sürüklenebilir pencerelerde ekran paylaşımı. |
| 🏠 **Odalar** | Boş bir arsaya oda kur: ad, vurgu rengi ve isteğe bağlı şifre seç. Kilitli kapıları sunucu denetler. Odalar özeldir (ses, sohbet, araçlar) ve boşalınca kendiliğinden kalkar. |
| 🧭 **Oda rehberi** | Tüm aktif odaları, kimin kurduğunu ve içeride kaç kişi olduğunu gör; **Göster**'e dokun, pusula oku seni oraya yönlendirsin. |
| 🎨 **Beyaz tahta** | Sekiz renk, fırça boyutu, silgi, dokunmatik/kalem desteği, çözünürlükten bağımsız çizgiler ve **PNG dışa aktarma**. Sonradan gelenler çizilen her şeyi görür. |
| 📝 **Ortak notlar** | Başkaları yazarken **senin imlecini yerinde tutan** canlı ortak düzenleme. `.txt` olarak aktar. |
| 🎵 **Müzik kutusu** | Ortak YouTube sırası (bağlantı yapıştır veya ara). Herkes aynı saniyeyi duyar, şarkılar iki kez atlanmaz, başlıklar sunucudan gelir. |
| ⚽ **Futbol** | Gerçek bir stadyum: sunucu taraflı fizik, topa koşarak dripling, **skor tabelası**, konfetili gol kutlaması ve "GOOOL!" afişi. |
| 💬 **Sohbet, tepkiler ve çıkartmalar** | Konuşma balonları, okunmamış rozetli sohbet geçmişi, on hızlı tepki ve resimli çıkartmalar. |
| 📱 **Mobil birinci sınıf** | Sanal joystick, dokunarak yürüme, çimdikle yakınlaştırma, alttan açılan pencereler, çentik/güvenli alan uyumu, ana ekrana eklenebilir. |
| 🌍 **Türkçe & English** | Dil anında değişir; varsayılan olarak tarayıcı dilini izler. |
| 🔁 **Kesintisiz yeniden bağlanma** | Kısa bir ağ kesintisi seni tam olduğun yere geri koyar — aynı oda, hâlâ sahibisin, açtığın kilitler açık kalır. |
| 🛡️ **Sağlamlaştırılmış sunucu** | Her paket doğrulanır, olay başına hız sınırı, taşkın koruması, sunucu otoriteli hareket ve duvar çarpışması, sıkı CSP. |

### 🖼️ Ekran görüntüleri

<table>
  <tr>
    <td width="50%"><img src="docs/login-dark.jpg" alt="Giriş ekranı"></td>
    <td width="50%"><img src="docs/world-light.jpg" alt="Oda rehberiyle açık görünüm"></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/world-dark.jpg" alt="Beyaz tahta, notlar ve sohbetle oda"></td>
    <td width="50%"><img src="docs/stadium.jpg" alt="Skor tabelalı stadyum"></td>
  </tr>
</table>

### 🚀 Hızlı başlangıç

Gereksinim: **Node.js 18 veya üzeri**.

```bash
git clone https://github.com/furkiak/locmind.git
cd locmind
npm install
npm start
```

<http://localhost:3000> adresini aç, bir takma ad ve avatar seç, içeri girdin. Sesli sohbeti denemek için ikinci bir sekme aç (ya da bir arkadaşını davet et).

> **HTTPS notu:** tarayıcılar mikrofon, kamera ve ekran yakalamaya yalnızca `https://` sayfalarında veya `localhost`'ta izin verir. Yayına alırken Locmind'in önüne HTTPS koy ([Yayına alma](#-yayına-alma)). Mikrofonsuz da girebilir, dinleyebilir ve yazabilirsin.

**Docker**

```bash
docker compose up --build        # http://localhost:3000
```

### 🎮 Kontroller

| Tuş | İşlem |
| :-- | :-- |
| **W A S D** / **↑ ← ↓ →** | Yürü (ya da haritada tıkla / dokun / sürükle) |
| **Enter** | Sohbet kutusunu aç · tekrar **Enter** ile gönder · **Esc** ile vazgeç |
| **T** | Sohbet geçmişi |
| **F** | Mikrofonu aç / kapat |
| **C** | Kamerayı aç / kapat |
| **Q** | Tepkiler ve çıkartmalar |
| **E** | Boş arsada oda kur |
| **G** · **H** · **M** | Beyaz tahta · Notlar · Müzik (oda içindeyken) |
| **R** | Oda rehberi |
| **Boşluk** | Topa vur (stadyumda) |
| **+** / **−** / fare tekerleği / çimdik | Yakınlaştır |
| **Esc** | En üstteki pencereyi veya paneli kapat |

Dokunmatik ekranda joystick'i, dock düğmelerini ve ipucu balonunu ("oda kurmak için buraya dokun") kullan.

### ⚙️ Yapılandırma

Tüm ayarlar isteğe bağlı ortam değişkenleridir ([`.env.example`](.env.example); `node --env-file=.env server.js` ile yükle).

| Değişken | Varsayılan | Açıklama |
| :-- | :-- | :-- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | HTTP dinleyicisi |
| `TRUST_PROXY` | `0` | Ters vekil arkasında `1` yap; istemci IP'si `X-Forwarded-For`'dan okunur |
| `CORS_ORIGIN` | *(aynı kaynak)* | Başka sitelerden socket açabilecek kaynaklar (virgülle) |
| `MAX_PLAYERS` | `150` | Eşzamanlı oyuncu sayısı |
| `AFK_LIMIT_MINUTES` | `30` | Hareketsizlik süresi; sonra 45 sn'lik "hâlâ orada mısın?" geri sayımı ve bağlantı kesme |
| `ICE_SERVERS` | genel STUN | WebRTC ICE sunucularının JSON dizisi (aşağıdakilerin hepsini geçersiz kılar) |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | – | Bir TURN aktarıcısı ekle — canlıda önerilir, simetrik NAT arkasında şarttır |
| `INVIDIOUS_INSTANCES` | genel liste | Müzik kutusu aramasının kullandığı örnekler. YouTube bağlantısı yapıştırmak her zaman çalışır |

### 🌐 Yayına alma

Locmind tek bir Node sürecidir. TLS'i önünde sonlandır ve WebSocket'leri ilet.

<details>
<summary>Caddy</summary>

```caddyfile
locmind.example.com {
    reverse_proxy localhost:3000
}
```
</details>

<details>
<summary>nginx</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name locmind.example.com;
    # ssl_certificate ... ;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```
</details>

`TRUST_PROXY=1` ile çalıştır. Sağlık kontrolü: `GET /healthz`.

**Ölçek:** ses ve görüntü eşler arası ağlardır; bu yüzden aynı noktada toplanan kalabalık katılımcıların bant genişliğiyle sınırlıdır (kameralı yaklaşık 8–10 kişiye kadar rahat, yalnızca seste çok daha fazlası). Sunucu hareketi 20 Hz'lik turlarda toplu gönderir ve 80 simüle oyuncuyu bir çekirdeğin yaklaşık %15'iyle taşıdı.

### 🧱 Mimari

```text
server.js              giriş noktası (dinleme, düzgün kapanma)
src/
  app.js               express + socket.io bağlantıları, /healthz, /api/config, YouTube araması
  game.js              gerçek zamanlı protokol: doğrulama, hız sınırları, yayınlar
  world.js             otoriter durum: oyuncular, odalar, doluluk, hareket kuralları
  football.js          top fiziği, skor
  music.js             oda başına sıra (kimlikler "bitti" bildirimlerini tekrar edilebilir kılar)
  youtube.js           bağlantı ayrıştırma, oEmbed başlıkları, arama
  security.js          temizleme, şifre özeti, hız sınırlayıcı, CSP başlıkları
  config.js            ortam yapılandırması
shared/world.js        harita, sabitler ve çarpışma geometrisi — hem sunucu HEM tarayıcı kullanır
public/
  index.html           yalnızca iskelet
  css/                 theme.css (token'lar + Liquid Glass) · app.css (bileşenler)
  js/                  ES modülleri: main, state, net, rtc, audio, render, input, movement,
                       ui, panels, media, whiteboard, notes, music, settings, i18n, sfx, icons
test/                  birim + socket entegrasyon testleri (node:test) ve tarayıcı e2e testi
scripts/               ekran görüntüsü üretici
```

**Parçalar nasıl konuşuyor**

* **Socket.io** oyun durumunu taşır: hareket (20 Hz'de toplu), odalar, sohbet, beyaz tahta, notlar, müzik sırası, futbol ve **WebRTC sinyalleşmesi** (`rtc:signal`) — ayrı bir sinyal sunucusu yoktur.
* **WebRTC** bağlantıları ihtiyaç anında kurulur: menzildeki herkes için `audio` (400 px → 460 px histerezis, bağlantılar titremez), menzildeki izleyicilere tek yönlü `camera`, aynı odadaki herkese tek yönlü `screen`.
* **Sunucu otoriterdir**: hareketi hız bütçesine ve duvarlarla taramalı çarpışmaya göre doğrular, oda şifrelerini (tuzlu `scrypt`, sabit zamanlı karşılaştırma) tutar, sohbet/araçları ait oldukları odayla sınırlar.
* `shared/world.js` iki tarafça da yüklenir; harita düzeni, kapı geometrisi ve sabitler asla birbirinden ayrışamaz.

### 🛡️ Güvenlik ve dayanıklılık

* Tüm girdi sunucuda doğrulanır; bozuk paketler süreci asla çökertemez (her işleyici yalıtılmıştır).
* Olay başına hız sınırları, genel taşkın koruması, 64 KB paket sınırı ve oyuncu sınırı.
* Sunucu otoriteli hareket: hız bütçesi, sınırlar, **taramalı** çarpışma (duvardan geçilemez) ve ışınlanarak geçilemeyen kilitli kapılar.
* Oda kilitleri oda *örneğine* bağlıdır; aynı arsada yeniden kurulan oda şifresini yine ister.
* Bir odanın sohbeti, tahtası, notları ve müziği yalnızca içindekilere gider.
* Metin ham saklanır ve metin olarak çizilir — HTML enjeksiyonu yok, çift kaçış yok.
* Sıkı Content‑Security‑Policy, `nosniff`, referrer ve izin politikaları, satır içi betik yok.
* Hareketsiz oyuncular yalnızca istemciden değil sunucudan da atılır.

### 🧪 Testler

```bash
npm test               # birim + socket entegrasyon testleri (tarayıcı gerekmez)
npm run test:e2e       # iki gerçek Chromium sayfası: ses, odalar, araçlar, ekran paylaşımı, yeniden bağlanma, mobil
npm run screenshots    # docs/*.jpg dosyalarını yeniden üretir
```

Uçtan uca test ve ekran görüntüsü betiği Chromium ister: `CHROMIUM_PATH` ayarla (ya da `npx playwright install chromium`).

### 🆕 2.0'da neler yeni?

Locmind 2.0; modüler bir sunucu, modüler ES‑modül istemci, yeni bir tasarım dili ve uzun bir düzeltme listesiyle baştan temizlendi. Tam liste için [CHANGELOG.md](CHANGELOG.md).

### 🗺️ Sonrası için fikirler

Çok büyük kalabalıklar için ilgi alanı yönetimi · büyük odalar için SFU · kalıcı hesaplar ve odalar · yeni mini oyunlar · özel avatarlar.

---

<div align="center">
  <img src="docs/banner.jpg" alt="Locmind concept art" width="720">
</div>

## 📄 License

[MIT](LICENSE) © Furkan Akça

<div align="center"><sub>Built with Node.js, Socket.io and a lot of canvas pixels.</sub></div>
