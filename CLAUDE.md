# Dismantler Operations Platform

One system for an auto dismantler's whole business. Read `docs/architecture.md`, `docs/roadmap.md` and the ADRs in `docs/adr/` before changing structure.

## Team process (subagents in `.claude/agents/`)
architect -> coder -> design-verifier -> tester -> merge. No code without an approved spec in `docs/specs/`. Specs that change scope or cost need Andrei's approval.

## Rules
- TypeScript strict, ESM (`"type": "module"`, relative imports end in `.js`). pnpm workspaces: `apps/api` (NestJS + Kysely), `apps/web` (React + Vite PWA), `packages/shared`.
- **Multi-company (ADR 0006):** every business table has `company_id` and goes through `protectTable()` in its migration (RLS enabled + forced). All data access runs inside `withCompany(db, companyId, trx => ...)`; never query `this.db` directly for business data. The API connects as `wms_app`; migrations and seeding use the owner role.
- One PostgreSQL schema per module; never touch another module's schema. Cross-module: public service or `platform.outbox` event in the same transaction.
- Every write goes through a transaction that also calls `AuditService.record`. Never put passwords, hashes or MFA secrets in audit rows or responses.
- Every route needs sign-in unless `@Public()`; restrict with `@Roles(...)`.
- Outside services only through integration adapters in M1.
- Never skip or weaken a test to get green.

## Commands
```bash
pnpm install
pnpm build          # shared first, then api and web
pnpm test           # API tests need PostgreSQL: TEST_DATABASE_URL (owner, default wms:wms@localhost/wms_test) and TEST_APP_DATABASE_URL (default wms_app:wms_app@...)
pnpm db:migrate     # uses OWNER_DATABASE_URL (falls back to DATABASE_URL)
pnpm db:seed        # COMPANY_SLUG, COMPANY_NAME, COMPANY_STATE, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
pnpm dev:api        # needs JWT_SECRET (32+ chars)
pnpm dev:web        # http://localhost:5173, proxies /api to :3000
```
