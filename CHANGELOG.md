# Changelog

## 3.0.0

Locmind now runs on Node.js alone: no `npm install`, no database, no third-party services. Everything
a self-hosted community needs is built in, from the WebSocket server to the TURN relay and an admin panel.

### Self-hosting, zero dependencies
- Express and Socket.IO are gone. New dependency-free building blocks: an HTTP router, a static file
  server (brotli / gzip cached in memory, ETags, range requests, traversal protection), an RFC 6455
  WebSocket server and client, and a realtime hub with rooms, acknowledgements, encode-once broadcasts,
  back pressure, origin checks, per-address limits and a flood guard.
- **Built-in STUN / TURN relay** (RFC 5389 / 8656 subset) over UDP, TCP and TLS with short-lived
  credentials, quotas, a bandwidth cap and private-network peer filtering. Voice works behind strict
  NATs without coturn or any external service; `?relay=1` forces relaying for testing.
- **HTTPS** with your own certificate or a generated self-signed one (`TLS_SELF_SIGNED=true`).
- Layered configuration: command line flags, environment, `locmind.json`, defaults.
- Persistence in `DATA_DIR` (secrets, bans, settings, permanent rooms) with atomic writes.
- **Admin panel** at `/admin`: live dashboard with charts, players (mute, kick, ban), rooms (create
  permanent rooms, close any room), music library, bans, settings (message of the day, server password,
  uploads, word filter) and announcements. Brute-force lockout on the admin token.
- Prometheus metrics at `/metrics`, JSON or pretty logs, graceful shutdown, health checks.
- Dependency-free Dockerfile, a compose file with the TURN ports, a hardened systemd unit and nginx /
  Caddy examples in `deploy/`.
- YouTube is optional and off by default: out of the box Locmind makes no third-party request.

### New for players
- **Profiles:** status (available, busy, away, do not disturb), a status line and an emoji avatar maker.
- **Player card:** click anyone to message, wave, walk there, follow them, change their volume or block them.
- **Direct messages**, waves, typing indicator, @mentions, announcements and optional desktop notifications.
- **Room tools:** raise-hand queue, polls with live results, a shared timer, room topic, and owner
  settings (rename, colour, password, remove people).
- **Auditorium:** a stage that reaches the whole hall while the audience only whispers to neighbours;
  screen sharing from the stage.
- **Self-hosted music library:** drop files into `media/music` or let players upload songs; synced
  playback with a plain `<audio>` element.
- **Path finding:** click anywhere, on the minimap or in the room directory ("Take me there") and your
  avatar walks around walls and through doors.
- Push-to-talk (hold V), microphone level meter, connection quality indicator, camera gallery,
  chat history on join, offline app shell (service worker), server password and message of the day
  on the sign-in screen.

### Performance
- Interest management, compact movement rows (short ids, integer coordinates, packed direction),
  crowd stride, interest-managed football updates and corked socket writes: 3–5× less traffic per
  player in crowds. 800 simulated players use under half a CPU core and about 120 MB (see PERFORMANCE.md).
- `npm run bench`: a dependency-free load test that runs the server in its own process.

### Security
- WebRTC signalling is schema checked, only connects nearby players and has a per-pair budget.
- `X-Forwarded-For` is read from the right (`TRUST_PROXY` takes a hop count), `/metrics` refuses
  proxied requests, upload quotas hold for streamed bodies, oversized requests get an answer before
  the connection closes.
- Fuzz tests for every realtime event, HTTP path traversal and uploads. See SECURITY.md.

### Fixed
- A focused text field inside a closed window swallowed every keyboard shortcut; Esc now hands the
  keyboard back to the world from any field.
- Walking stopped as soon as another player nudged you into a wall; you now slide along walls and
  re-plan around people.
- The football was broadcast 33 times a second to every player in the world.
- Low frame rates slowed walking down (time step clamp).

## 2.0.0

A complete overhaul: modular server, modular client, a new design language, many fixes and a lot of new features.

### New

**Design**
- Liquid Glass interface: blurred translucent panels with specular rims, floating dock with hover magnification, traffic‑light windows, spring animations, aurora world, automatic light / dark appearance (switchable in Settings).
- Inline SVG icon set, synthesised UI sounds, speaking rings, mute badges, name plates, speech bubbles, floating reactions, click ripples.
- Responsive layout with a virtual joystick, tap / drag to walk, pinch zoom, bottom‑sheet windows and safe‑area support. Web app manifest and icons.
- Turkish and English UI (follows the browser, switchable at runtime).

**Gameplay & collaboration**
- Stereo spatial audio with a smoother distance curve; per‑person volume; master volume; microphone picker.
- Room colours, room directory with a compass arrow ("Show me"), room occupant counts.
- Reactions (ten emoji) next to the image stickers, chat history panel with unread badge.
- Whiteboard: palette, brush size, eraser, PNG export, touch and pen input, resolution independent strokes.
- Shared notes keep the local caret while remote edits arrive.
- Music box: server side title lookup, search results with thumbnails, drift correction, visible player.
- Football: scoreboard (blue / red), dribbling, goal banner with confetti, score reset, automatic reset when the stadium empties.
- Everyone sees who is muted, on camera or sharing a screen.
- Seamless reconnect: position, room ownership and unlocked doors survive a dropped connection; an emptied room lingers for 60 s so the owner can come back.
- Settings dialog (language, appearance, microphone, volume, sound effects, spatial audio, minimap, reduced motion).
- Health endpoint (`/healthz`), environment configuration (TURN, CORS, limits), Dockerfile, Compose file, CI workflow.

### Changed

- `server.js` (590 lines, global state) split into `src/*` modules; `public/index.html` (1600 lines of inline CSS and JS) split into `css/` and ES modules under `js/`.
- `shared/world.js` holds the map and collision geometry for both sides (previously duplicated and drifting).
- WebRTC signalling now travels over the existing Socket.io connection; the third party PeerJS broker and its CDN script are gone. One peer link per purpose (`audio`, `camera`, `screen`) with deterministic roles.
- Movement is batched into 20 Hz ticks instead of one broadcast per move per player (≈40× fewer messages in a crowd).
- No external runtime assets: Font Awesome, Google sound files, DiceBear avatars and the single hard‑coded Invidious instance were removed or made configurable.
- Joining no longer requires a microphone; the world is fully usable without one.
- Images were optimised (a 1080×1440 sticker became 144×192).

### Fixed

**Server**
- Emoji files were stored outside `public/` and the server scanned another folder: the picker was always empty and no emoji could be sent.
- A single malformed packet (`null` / missing fields) crashed the whole process. Every payload is now validated and every handler isolated.
- `createRoom` accepted arbitrary slot ids (leaking memory), teleported the sender anywhere and allowed unlimited rooms.
- Chat typed on an empty plot was invisible for everybody; chat from private rooms was sent to every client.
- Text was HTML‑escaped on the server *and* the client ("Tom &amp;amp; Jerry"), and nicknames were truncated inside entities.
- `peerId` was injected into inline `onclick` handlers: stored XSS. Signalling no longer uses client supplied identifiers.
- Music: each listener reporting "ended" skipped a song; the same video twice never restarted; start offsets used the client clock; titles and ids came straight from the client.
- Movement had no real speed limit (150 px per packet) and no swept collision; speed depended on the monitor refresh rate on the client.
- Unlocking a room stayed valid for the plot forever, even after the room was rebuilt by someone else; people could end up trapped inside a locked room built around them.
- `checkEmptyRooms` ran on every move (O(rooms × players)); rate‑limit buckets leaked for sockets that never joined.
- Kick spam had no limit and the ball speed was unbounded.
- AFK handling existed only in the client.
- World bounds were 6000 × 6000 although the map is 3300 × 2900.

**Client**
- Screen shares were only sent to late joiners when the sharer had the larger socket id.
- Notes: concurrent edits diverged and the caret jumped to the end on every remote update.
- Whiteboard used absolute pixels (mismatched sizes), had no touch support and lost its content on resize.
- After a network blip the client kept a dead socket id and never rejoined.
- Voice links flapped at the edge of the hearing radius (and played join / leave sounds every time).
- Hotkeys worked before joining (TypeError), got stuck with Shift / Caps Lock and broke on non‑QWERTY layouts.
- Mouse wheel zoomed the map while scrolling inside windows; windows could not be dragged on touch screens.
- Per‑frame allocations (`new Uint8Array` per player per frame), uncached DOM lookups, a 6000 × 6000 grid drawn every frame: replaced by culling, cached patterns and a 150 ms logic tick.
- Remote players teleported between updates; they are now interpolated.
- Volume control relied on `createMediaElementSource` for WebRTC streams, which is unreliable across browsers; replaced by `createMediaStreamSource`.
- Hidden YouTube player (1 × 1 px); the player is now visible inside the music window.
