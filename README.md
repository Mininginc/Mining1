# Dismantler Operations Platform

One software package for an auto dismantler: vehicle intake, dismantling, parts and warehouse, pricing and listings, sales, shipping, returns, disposition, and the back office (marketing, finance, HR, compliance, purchasing, facilities, analytics).

- Architecture: [docs/architecture.md](docs/architecture.md)
- Roadmap: [docs/roadmap.md](docs/roadmap.md)
- Decisions: [docs/adr](docs/adr)
- Engineering team and rules: [CLAUDE.md](CLAUDE.md)

## Quick start
```bash
docker compose up -d db          # or a local PostgreSQL 16 with user/password wms/wms
cp .env.example .env             # then edit secrets
pnpm install && pnpm build
set -a; . ./.env; set +a
pnpm db:migrate                  # creates the wms_app role (no login)
psql "$OWNER_DATABASE_URL" -c "alter role wms_app login password 'change-me'"
pnpm db:seed                     # creates COMPANY_SLUG and its first admin
pnpm dev:api                     # API on :3000
pnpm dev:web                     # app on :5173
```

Status: Phase 0 done; multi-company (spec 0.1) built. Every table carries company_id with PostgreSQL row-level security.
