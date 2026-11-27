# ADR 0001: Modular monolith with a schema per module
Status: Accepted (2026-11-27)

## Context
One small team builds a system covering 16 business areas that share the same vehicles, parts, customers and people.

## Decision
One deployable API and one web app. Each module owns a PostgreSQL schema and exposes a public service and events. No cross-schema reads or writes.

## Consequences
Simple deploys and transactions; modules can be split out later because their borders are already enforced. Design verification checks border violations on every PR.
