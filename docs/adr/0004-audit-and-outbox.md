# ADR 0004: Audit log on every write; transactional outbox for events
Status: Accepted (2026-11-27)

- `platform.audit_log` records actor, action, entity, before and after, IP and request id for every write. Rows are append-only; the API exposes no update or delete for them.
- Modules publish domain events by inserting into `platform.outbox` in the same transaction as the change. A dispatcher delivers them to subscribers (dispatcher arrives in Phase 1 with the first consumer).
