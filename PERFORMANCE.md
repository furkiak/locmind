# Performance

> **Türkçe özet:** Tek bir Node.js süreci, 4 çekirdekli sıradan bir sanal makinede 400 eş zamanlı
> oyuncuyu tek çekirdeğin yaklaşık %20'siyle, 800 oyuncuyu %44'üyle taşıyor; bellek 120 MB'ın altında.
> Ses ve görüntü sunucudan geçmez (eşler arası), bu yüzden sunucu yükünü belirleyen şey hareket ve
> sohbet trafiğidir. Ölçümü kendiniz `npm run bench` ile tekrarlayabilirsiniz.

## How to measure

```bash
npm run bench                                   # 50, 100, 200, 400 players for 20 s each
node scripts/bench.mjs --stages 100,500,1000 --duration 30
node scripts/bench.mjs --url http://your-server:3000 --token <admin token>
node scripts/bench.mjs --stages 800 --profile ./prof   # V8 CPU profile of the server
```

`scripts/bench.mjs` needs nothing but Node.js. It starts the server in its own process (so the
server's CPU is measured on its own) and simulates players in worker threads. Every simulated player
behaves like the browser client: it walks to random points at walking speed and sends its position
20 times a second while moving, stands still for one to five seconds between walks, pings every two
seconds and chats now and then. A third of the players crowd into one busy area of the map, the rest
spread out, which is a worse case than a real event. Server numbers come from its own `/metrics`.

## Results

4 vCPU virtual machine (Intel Xeon 2.8 GHz), Node.js 22, server and simulated players on the same
machine, 20 seconds per step.

| Players | Server CPU (% of one core) | Memory (RSS) | Event loop p99 | Messages in / s | Traffic out | Per player | Ping p50 / p99 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 5.7 % | 71 MB | 1.9 ms | 513 | 0.33 MB/s | 6.8 KB/s | 0.9 / 3.1 ms |
| 100 | 8.1 % | 74 MB | 2.3 ms | 954 | 1.23 MB/s | 12.6 KB/s | 1.2 / 4.6 ms |
| 200 | 10.4 % | 85 MB | 3.6 ms | 1,983 | 2.76 MB/s | 14.1 KB/s | 4.5 / 15.3 ms |
| 400 | 20.3 % | 109 MB | 8.6 ms | 3,884 | 10.72 MB/s | 27.4 KB/s | 22.5 / 96.4 ms |
| 800 | 43.8 % | 117 MB | 29.2 ms | 7,537 | 23.16 MB/s | 29.6 KB/s | 83.2 / 233.8 ms |

Reading the table:

- **CPU and memory are not the limit.** Even 800 players use less than half of one core and about
  120 MB. Node.js runs the game on one thread, so the remaining cores are free for the TURN relay,
  TLS and the operating system.
- **Bandwidth is.** Each player receives the movements of everybody around them. In the crowded
  area of the test hundreds of people walk at the same time, which is why the per-player traffic grows
  with the crowd. Spread out players cost far less.
- **Latency** stays low up to a few hundred players. At 800 it grows because the virtual machine
  makes system calls expensive (about half of the server's time is spent in `write()`), and because
  the simulated players share the same four cores.

**Recommended size:** up to about 300–400 people on one instance for a smooth experience everywhere,
more if they spread over the map. Voice and video do not touch the server (peer-to-peer, or relayed
through the built-in TURN server when a direct path is impossible), so a big meeting is limited by the
participants' own upload bandwidth, not by the server.

## What made it fast

| Change | Effect |
|---|---|
| **Interest management.** The map is split into 700 px cells; a player gets the positions of the 3×3 cells around them 20 times a second and everybody else twice a second. | The cost of a crowd no longer grows with the square of the whole world. |
| **Encode once.** A movement batch or a broadcast is serialised and framed one time and the same buffer is written to every recipient. | No per-recipient `JSON.stringify` or frame header. |
| **Compact movement rows.** `[short id, x, y, direction]` with integer coordinates and the facing packed into 0–63, instead of the 20 character socket id and floating point numbers. | 3–5× less traffic: at 400 players 27 KB/s per player instead of 136 KB/s, at 200 players 14 KB/s instead of 81 KB/s. |
| **Crowd stride.** Above 150 players nearby updates go out at 10 Hz, above 400 at about 7 Hz. Positions accumulate in between (nothing is lost) and the client interpolates. | Half the messages in big crowds, still smooth on screen. |
| **Ball interest.** The football moves 33 times a second; only people around the stadium get every update, everybody else twice a second and the final position reliably. | A match no longer sends 33 messages a second to every player in the world. |
| **Corked writes.** Frames written to a socket in the same tick leave in one `writev()`. | Fewer system calls when several messages go to the same player at once. |
| **Back pressure.** Movement and ball updates are volatile: they are skipped for a client that has 128 KB waiting, and a client 2 MB behind is disconnected. | One slow phone cannot make the server buffer without limit. |
| **Static files.** Brotli/gzip compression cached in memory, ETags, `304 Not Modified`, range requests. | Repeat visits load almost nothing. |
| **Client.** The canvas only redraws when something changed or animates, sprites and text widths are cached, the minimap redraws ten times a second, time based movement. | Low CPU on laptops and phones; an idle tab does nearly nothing. |

Before these changes the same test measured 81 KB/s per player at 200 players, 136 KB/s at 400 and
56 % of a core at 800.

## Server limits worth knowing

| Setting | Default | Notes |
|---|---|---|
| `MAX_PLAYERS` | 150 | Raise it for big events; see the table above. |
| `MAX_CONNECTIONS_PER_IP` | 16 | Offices and schools behind one NAT may need more. |
| `TURN_BANDWIDTH_KBPS` | 4000 | Per relayed connection. Audio needs about 40 kbps, a camera 300–800 kbps. |
| `TURN_RELAY_PORTS` | 49160-49359 | 200 ports = 200 relayed connections at the same time. Widen the range for large events. |
