# Test report: Phase 0 foundation
Date: 2026-11-27 · Verdict: **PASS** · Run: Node 22, PostgreSQL 16, pnpm 10

| Suite | Files | Tests | Result |
| --- | --- | --- | --- |
| API unit (password hashing, TOTP incl. RFC 6238 vectors, audit redaction, module visibility) | 3 | 15 | Pass |
| API end-to-end against real PostgreSQL (Supertest) | 1 | 22 | Pass |
| Web (Testing Library, jsdom) | 1 | 4 | Pass |
| Restore drill (`scripts/restore-drill.sh`) | n/a | row counts match | Pass |
| Build and strict type check, all packages | n/a | n/a | Pass |

## Criteria coverage
| AC | Covered by |
| --- | --- |
| 1 | `pnpm build && pnpm typecheck && pnpm test`; same steps in CI |
| 2 | e2e "running migrations again is a no-op" |
| 3 | e2e "does not create a second admin", "rejects a short admin password" |
| 4 | e2e login tests: token, case-insensitive email, identical errors for wrong password and unknown email, bad tokens refused |
| 5 | e2e lockout: 5 failures, right password still refused, lock about 15 min, audited once; password reset clears it |
| 6 | e2e MFA: wrong setup code refused, login without code and with an old code refused, valid code accepted |
| 7 | e2e: existing token refused right after deactivation; login refused |
| 8 | e2e: sales and manager get 403 on /users; sales 403 on /audit; manager 200; role change applies to an existing token at once |
| 9 | e2e: before/after, actor and request id recorded; no hashes or secrets anywhere in the audit table; update/delete on audit blocked; outbox event written |
| 10 | e2e: 400 for an 8-character password |
| 11 | web: sign-in, role-filtered modules, MFA prompt, error message, offline banner; production build emits manifest and service worker |
| 12 | restore drill |

## Edge cases added beyond the spec
Duplicate email in a different case (409), unknown role (400), last-admin protection (409), security headers.

## Not covered yet
- Installing the PWA on a real phone and scanner: to do on site during Phase 1.
- Playwright browser tests: start in Phase 1 with the first yard screens.
- CI on GitHub: first run passed on 2026-11-27 (build, type check, tests, restore drill).
