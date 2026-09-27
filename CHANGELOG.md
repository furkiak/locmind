# Changelog

## Unreleased

- Bind the development server to localhost by default; allow an explicit `BIND_HOST` for configured deployments.
- Document the current silent-tour screen with an actual local browser capture and identify the older gameplay image as historical.

## 1.1.0-beta.1 · source preview

- Route private and public chat through server-verified Socket.IO channels.
- Validate and rate-limit incoming events, reject invalid room creation and locked-room movement.
- Add one-use server grants for media calls and receiver verification before answering.
- Hash room passwords with salted scrypt and avoid sending their hashes to clients.
- Add a lockfile, actual emoji route, locally served PeerJS client and local packet tests.
- Replace the fake agreement prompt with an honest privacy explanation and no-media exploration mode.
- Refresh the entry screen and in-world controls with a translucent, keyboard-readable design.
- Remove the old composite promo image that could be mistaken for a live product capture.

The version is not a public release. Real media, HTTPS/TURN and deployment checks remain open.
