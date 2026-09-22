# Support and release gates

Locmind 1.1.0-beta.1 is a source preview. Local Node.js 24, Windows, the built-in browser's no-media exploration path, and real loopback Socket.IO packets have been exercised. A GitHub Actions workflow is provided but its remote result is not part of this local evidence. Linux CI is configured but not yet observed here.

| Area | Current evidence | Remaining gate |
| --- | --- | --- |
| Room chat | Two locked rooms, two members each and an outside client tested at the Socket.IO packet level | Two real browsers in separate rooms and a hosted HTTPS reverse proxy |
| Media | Authorization, wrong-recipient and replay denial tested with Socket.IO acknowledgements | Real PeerJS/WebRTC voice, camera and screen flows in two browsers; room exit while streaming |
| Network | Localhost browser tour without media | Two networks, HTTPS, peer signaling outage, NAT/TURN and reconnect behavior |
| Data | In-memory room content and scrypt password hashes | Restart recovery decision, durable storage if needed, retention and moderation policy |
| Interface | Entry screen and silent chat used in the local browser | Narrow viewport, keyboard, touch and screen-reader pass through each room tool |

Stop the local server with Ctrl+C. Changing from an earlier source version does not migrate in-memory rooms; restart clears that state. To return to the previous source commit, switch Git back and run `npm ci` for that revision's dependency tree. Back up any externally stored deployment configuration before replacing a running service.
