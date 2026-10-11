# Security

Locmind is meant to run on your own server, open to the internet, with nothing in front of it.
This page explains what the server defends against, what it deliberately does not do, and how to
harden a deployment.

> **Türkçe özet:** Locmind herkese açık bir sunucuda tek başına çalışacak şekilde tasarlandı. Aşağıda
> sunucunun hangi saldırılara karşı nasıl korunduğu, kurulumda yapılması önerilenler ve güvenlik
> açığı bildirme yolu anlatılıyor.

## Reporting a vulnerability

Please use **GitHub → Security → Report a vulnerability** on this repository (private advisory).
Do not open a public issue for security problems. You will get an answer within a few days, and a
fix is released as soon as it is verified. Credit is given in the changelog unless you prefer otherwise.

## Threat model

| Who | Can | Locmind makes sure that |
|---|---|---|
| Anonymous visitor | open the page, connect a WebSocket, call public HTTP endpoints | they cannot read files outside `public/`, flood the server, or reach the admin API |
| Player | send any realtime message, upload songs (if allowed) | every message is validated and rate limited; text is never rendered as HTML; uploads must be real audio and fit the quota |
| Malicious player | harass others, spam, scrape | owners can remove people from rooms, players can block each other, the operator can mute, kick and ban by IP |
| Another website | embed or script against your server from a visitor's browser | WebSocket origins are checked, the admin API uses a bearer token (no cookies, so no CSRF), framing is limited to the same origin |
| Network attacker | watch or tamper with traffic | use HTTPS (built-in TLS or a reverse proxy); voice and video are always end-to-end encrypted by WebRTC (DTLS-SRTP), the relay only forwards ciphertext |
| Someone abusing the TURN relay | use your server as a free proxy or to reach your internal network | credentials expire, every address has quotas and a bandwidth cap, and relaying to private, loopback and link-local addresses is refused |

Out of scope: the operator (whoever holds the admin token and the data folder has full control),
and denial of service by a botnet larger than one server can absorb (put a CDN or firewall in front for that).

## What the server does

**Transport**
- WebSocket upgrades are accepted only from the same host or the origins listed in `CORS_ORIGIN`
  (stops cross-site WebSocket hijacking).
- Per address: at most `MAX_CONNECTIONS_PER_IP` open connections and a connection rate limit.
  Banned addresses are refused at the upgrade.
- Per connection: messages up to 64 KB, at most 400 messages a second, ten malformed messages and
  the connection is closed. A client that stops reading is dropped before it can make the server buffer
  more than 2 MB for it.
- HTTP: header and request timeouts against slow-loris, at most 64 headers, request bodies have size
  limits (32 KB for the admin API, `UPLOAD_MAX_MB` for songs). When a body is too large the server
  answers first and then closes the connection.

**Browser hardening (every response)**
- `Content-Security-Policy`: scripts only from the server itself, connections only to the server's
  own WebSocket, no plugins, no foreign frames (YouTube is allowed only when the operator turns it on).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a strict `Permissions-Policy`
  (camera, microphone and screen capture for this origin only), `Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`, `X-Frame-Options` / `frame-ancestors 'self'`.
- `Strict-Transport-Security` on HTTPS.

**Input**
- All user text is normalised (NFC), stripped of control, bidi-override and zero-width characters and
  cut to a length in code points. The client only ever puts user text into the page with `textContent`
  or draws it on the canvas, so names and messages cannot inject HTML.
- Every realtime event checks its payload shape and ranges and has its own rate limit. The test suite
  throws malformed, huge, deeply nested and prototype-polluting payloads at every event
  (`test/fuzz.test.js`) and requires that no handler throws.
- WebRTC signalling is relayed only between players who share a room or stand near each other, only
  the fields a browser needs are forwarded, and each pair has a message budget. Nobody can push data
  at a player on the other side of the map.
- Static files are served from `public/` and `shared/` only; `..`, encoded separators, NUL bytes and
  backslashes are rejected.

**Accounts, passwords and secrets**
- There are no user accounts. A player gets a random 128 bit resume token that lives in server memory.
- The admin token (144 bits) and the TURN secret (256 bits) are generated on first start and stored in
  `DATA_DIR/secrets.json` with mode `0600`. Admin requests use `Authorization: Bearer …`, the
  comparison is constant time, and an address that sends 20 wrong tokens in ten minutes is locked out.
- The server password is compared in constant time and limited to ten attempts a minute per address.
- Room passwords are hashed with scrypt and a random salt; wrong guesses are rate limited. Changing a
  room password locks out everybody who only knew the old one (people inside stay).
- `/metrics` answers only to requests from the machine itself (not relayed by a proxy) or with the admin token.

**Uploads and media**
- Uploaded files must start with the signature of a real audio format (MP3, Ogg, FLAC, WAV, M4A/AAC,
  WebM); anything else is refused. Files get random names, the total size is capped by
  `UPLOAD_QUOTA_MB` (also for streamed bodies without a length), and each player may upload six files
  per ten minutes.
- Songs are addressed by an HMAC of their path, so nobody can guess or traverse to other files.
  They are served with the correct audio type and `nosniff`.

**TURN relay**
- Short-lived credentials (REST API scheme, HMAC-SHA1 of `expiry:user`), stateless nonces, message
  integrity and fingerprint checks.
- Per address allocation limit (`TURN_MAX_ALLOCATIONS_PER_IP`) and a token bucket bandwidth cap
  (`TURN_BANDWIDTH_KBPS`) per allocation.
- Peers on loopback, link-local, multicast and (unless `TURN_ALLOW_PRIVATE_PEERS=true`) private
  ranges are refused, so the relay cannot be used to reach your internal network.

**Proxies**
- `TRUST_PROXY` is off by default. Set it to `true` (one proxy) or to the number of proxies in front
  of Locmind. Only the `X-Forwarded-For` entries those proxies appended are believed: an address a
  client writes into the header itself is ignored, so bans and rate limits cannot be dodged.

## Privacy

- Voice, camera and screen sharing go directly between browsers. When a direct connection is not
  possible the built-in TURN relay forwards the still-encrypted packets. Nothing is recorded.
- Chat, direct messages, reactions, polls and the music queue live in memory only. Whiteboards and
  notes of player-built rooms disappear with the room; permanent rooms keep theirs in `DATA_DIR`.
- The data folder holds: secrets, bans (IP address, name, reason), settings and permanent rooms.
- No cookies, no analytics, no third-party requests (unless the operator enables YouTube music).

## Hardening checklist

- [ ] Serve over HTTPS: `TLS_CERT` / `TLS_KEY` (or `TLS_SELF_SIGNED=true` for a LAN), or a reverse
      proxy with `TRUST_PROXY=1`. Browsers only allow the microphone on HTTPS (and localhost).
- [ ] Open only the ports you use: the web port, `3478/udp+tcp` and `5349/tcp` for TURN, and the relay
      range (`TURN_RELAY_PORTS`, default `49160-49359/udp`).
- [ ] Set `TURN_PUBLIC_IP` when the server is behind NAT, keep `TURN_ALLOW_PRIVATE_PEERS=false`.
- [ ] Run as an unprivileged user (see the systemd unit in `deploy/`), keep `DATA_DIR` private and back it up.
- [ ] Set `SERVER_PASSWORD` for a private community, `ALLOW_UPLOADS=false` if you do not want uploads.
- [ ] Rotate the admin token by setting `ADMIN_TOKEN` or deleting `adminToken` from `secrets.json`.
- [ ] Keep Node.js up to date (20 LTS or newer). Locmind has no runtime dependencies to patch.
