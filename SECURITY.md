# Security reporting and scope

For a suspected security issue, use GitHub's private vulnerability reporting for this repository if it is enabled. If it is unavailable, contact the maintainer through the public profile to arrange a private channel without including exploit details or user data in the first message. Do not post credentials, room passwords, private chat packets or an active exploit in a public issue.

The current source preview has no accounts or durable data. The server validates room membership for chat, uses short-lived one-use media grants, bounds socket payloads and hashes room passwords with scrypt. These controls do not make a public deployment production ready: denial of service across reconnects, unauthorized custom clients, media already recorded by a participant, NAT/TURN failures, lack of moderation and memory-only recovery remain important limits. Run it behind HTTPS and appropriate infrastructure controls before inviting untrusted users.

Security fixes are evaluated with a reproducer, a network-level regression test and a documented effect on existing rooms. Do not include real users' identifiers or secret material in test fixtures.
