# Security policy

## Supported version

Security fixes are applied to the current public beta branch. Old protocol v1 casual support is compatibility-only and does not support ranked play.

## Reporting a vulnerability

Do not publish an exploitable issue or credentials in a public ticket. Contact the repository owner privately through the security-reporting option on GitHub and include the affected revision, reproduction steps, impact, and a minimal proof of concept. Reports are acknowledged within 7 days when possible.

Never include real passwords, session tokens, production database copies, full IP addresses, or private replay data in a report. Rotate any credential that was accidentally exposed.

## Deployment invariants

- Accounts, ranked play, and public PWA installation remain disabled without HTTPS.
- `/metrics` requires a bearer token or a direct localhost connection.
- Production SQLite data is stored outside the application directory with mode `0600`.
- Releases require a verified backup, migration smoke test, dependency audit, and expected revision check.
