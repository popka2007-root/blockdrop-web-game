# BlockDrop beta privacy notice

Effective: 2026-07-20

BlockDrop works without an account. On public HTTP, accounts and ranked play are disabled. Local settings, saves, replays, achievements, mastery progress, quests, cosmetics, and analytics consent are stored in the browser. A user can clear them through browser storage controls.

Casual online rooms process a generated player identifier, display name, room identifier, gameplay commands, authoritative snapshots, match result, replay checksum, and technical connection events. Match and replay records are retained for up to 30 days. Technical events are retained for up to 14 days. Aggregate game statistics may be retained without a fixed limit.

Optional product analytics is off until the user consents and the server capability is enabled. It can include screen views, game start/finish, mode, duration, tutorial completion, reconnect duration, locale, and non-sensitive error codes. It never stores a board snapshot, input stream, password, session token, account token, or full IP address. IP addresses may be used transiently in memory for abuse rate limiting and are not written to product analytics.

Signed profile export contains the local mastery profile and quest/cosmetic state selected by the user. Import sends the envelope to the same server only to verify its HMAC signature.

Server logs use request, connection, room, and match identifiers. They must not contain passwords or tokens. Operational backups use the retention schedule documented in `docs/operations.md`.

This beta currently has no advertising, payments, or third-party marketing analytics. To request deletion of server-side beta data, contact the repository owner and provide only the non-secret room/match identifier needed to locate it.
