# ADR 0002: TypeScript, React PWA, NestJS, PostgreSQL
Status: Accepted (chosen by Andrei, 2026-11-27)

## Decision
- TypeScript (strict) everywhere; pnpm workspaces.
- API: Node.js 22 + NestJS. Database access: Kysely (typed SQL) with versioned migrations.
- Web: React + Vite, installable PWA with offline support for yard and warehouse screens.
- Database: PostgreSQL 16.
- Tests: Vitest (with SWC for decorator metadata) + Supertest for the API against a real PostgreSQL; Vitest + Testing Library for the web app; Playwright for end-to-end from Phase 1.
- Modules: ESM throughout, because NestJS 12 and Kysely 0.29 ship as ESM only.

## Why
One language for screens, scanners and server; maintained SDKs for every planned integration.
