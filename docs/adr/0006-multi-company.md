# ADR 0006: Multi-company (tenant) readiness
Status: Accepted (chosen by Andrei, 2026-11-27)

## Context
Andrei may expand to other states and may sell the software to other dismantlers. Only Phase 0 tables exist today.

## Proposal
- Add `platform.companies` and a `company_id` column to every business table, starting with `platform.users`, `audit_log` and `outbox`.
- PostgreSQL row-level security on every table, keyed by a per-transaction `app.company_id` setting, so one company can never read another's rows even if a query forgets a filter.
- The signed-in user's company is set on each request by the auth guard.
- State-specific rules (DMV forms, sales tax, hazardous-waste rules) are settings per company location, not code.

## Cost
About 1-2 days now. Retrofitting after 16 modules exist would touch every table, query and test.
