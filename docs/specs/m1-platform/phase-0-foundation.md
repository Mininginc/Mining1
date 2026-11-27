# Spec: Phase 0 foundation (M1 Platform)
Status: Approved (Phase 0 requested by Andrei, 2026-11-27)
Serves: User access (5), Cybersecurity (5), Data backups (5), Dismantling/inventory software (3)

## Scope
Monorepo, CI, team agents, API skeleton with sign-in, roles, MFA, audit log and outbox, web PWA shell, local database, backup and restore runbook.

## Out of scope
Business modules M2 to M16, hosting choice, integrations, SSO.

## Data (schema `platform`)
- `users`: id (uuid), email (unique, case-insensitive), name, password_hash, roles (text[]), active, mfa_secret, mfa_enabled, failed_logins, locked_until, created_at, updated_at.
- `audit_log`: id, at, actor_id, action, entity_type, entity_id, before (jsonb), after (jsonb), ip, request_id. Append-only.
- `outbox`: id, topic, payload (jsonb), created_at, published_at.

## API
| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| GET | /health | anyone | Reports database reachability |
| POST | /auth/login | anyone | email, password, optional totp |
| GET | /auth/me | signed in | Current user and roles |
| POST | /auth/mfa/setup | signed in | Returns secret and otpauth URL |
| POST | /auth/mfa/enable | signed in | Confirms with a code |
| GET | /users | admin | List users |
| POST | /users | admin | Create user |
| PATCH | /users/:id | admin | Change name, roles, active, password |
| GET | /audit | admin, manager | Latest audit entries, filter by entity |

## Acceptance criteria
1. `pnpm install && pnpm build && pnpm test` passes on a clean checkout with PostgreSQL running; CI runs the same on every push and PR.
2. Migrations create the `platform` schema and its three tables; running them twice is a no-op.
3. A seed command creates the first admin from environment variables, only if no admin exists.
4. Login with correct credentials returns an access token; wrong password returns 401 with no hint whether the email exists.
5. After 5 failed logins the account is locked for 15 minutes, even with the right password.
6. A user with MFA enabled cannot log in without a valid TOTP code.
7. Inactive users cannot log in, and their existing tokens are refused.
8. Endpoints enforce roles: a non-admin gets 403 on /users; /audit allows admin and manager only.
9. Every write (user created, updated, MFA enabled, login success, login failure, lockout) writes an audit row with actor, before and after; password hashes and MFA secrets never appear in audit rows or API responses.
10. Passwords shorter than 12 characters are rejected.
11. The web app installs as a PWA, shows a sign-in screen, and after sign-in shows only the modules the user's roles may use; it shows an offline banner when the network drops.
12. `docs/runbooks/backup-restore.md` and scripts produce an encrypted dump and restore it into a fresh database; the restore drill is scripted.

## Notes for design verification
Module borders: everything here lives in M1 and the `platform` schema.
