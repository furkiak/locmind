# Contributing

Open an issue describing the user-visible problem before a large change. Keep patches focused and preserve the room privacy boundary on the server. Use Node.js 24, `npm ci` and `npm test`; include a test for network behavior when changing Socket.IO events or media authorization. Do not commit room passwords, user recordings, credentials, `.env` files or generated `node_modules`.

For interface changes, test Explore silently without media permission and record the viewport and keyboard path. Label illustrations as illustrations; only call a capture a screenshot when it came from a running version. Security-sensitive reports belong in the private channel described in [SECURITY.md](SECURITY.md).
