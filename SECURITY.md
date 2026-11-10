# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- **Email** **soni.mil2001@gmail.com** with the details.
- **Or, if it is enabled on this repository,** use GitHub's private vulnerability reporting:
  <https://github.com/milind-soni/OpenMausBot/security/advisories/new>. The report stays visible
  only to you and the maintainers until a fix is published.

You'll get a response as soon as possible, normally within a few days.

## Scope notes for researchers

- The harness binds **127.0.0.1** by default. The packaged desktop requires its private per-launch
  capability or a paired session for workspace reads and writes. Health, branding and pairing are
  available before sign-in. Built-in agent integrations use narrower per-turn capabilities.
  Bundled standalone and hosted servers default to service trust. A session-less loopback caller may
  reach only the routes in `SERVICE_ALLOW` (`server/request-auth.ts`). Service callers can start
  guarded Ask turns, stop requests and decline cards. They cannot open Full-access threads, request
  a guarded Full-access turn or approve cards. The Slack worker and local bot shells still share this
  limited access, including the service read routes.
- API keys live in `~/.openmausbot/config.json` and are write-only through the API (`configured`
  booleans out, never values). Any path that echoes a stored secret back — API response, SSE event,
  log line, argv visible in `ps` — is a vulnerability.
- Agents run real CLIs (`claude`, `codex`) with the user's own privileges, and the permission broker
  is the consent layer for risky actions. Bypasses of the broker (approving without a user decision,
  spoofing the broker socket) are vulnerabilities unless that bot is explicitly set to **Full
  access**. Full access is a standing user decision to approve provider permission requests; it must
  never answer questions or silently broaden product-level confirmations such as credentials,
  routines, skills, or peer communication.
- Spawning must never route user-influenced strings through a shell. Report any `shell: true` /
  `cmd.exe` string-building you find.
