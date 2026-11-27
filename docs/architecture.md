# Architecture

Source of truth for the big picture: the "Dismantler Operations Platform: Architecture & Roadmap" doc
(https://claude.ai/artifact/BnPpYPueqqGwAjLJCkLC6R). This file keeps the parts engineers need in the repo.

## Shape
- Modular monolith: one API (`apps/api`), one web/PWA app (`apps/web`), shared types (`packages/shared`).
- One PostgreSQL database, **one schema per module**. A module never reads or writes another module's schema.
- Cross-module communication: the owning module's public service, or events written to `platform.outbox` in the same transaction.
- Every write is audit-logged (`platform.audit_log`).
- Outside services (eBay, payments, shipping, accounting, sales tax, payroll, VIN decode, NMVTIS, interchange) only through adapters in the integrations hub (M1).

## Modules
| Code | Module | Schema | Phase |
| --- | --- | --- | --- |
| M1 | Platform (auth, roles, audit, files, notifications, integrations hub) | `platform` | 0 |
| M2 | Vehicle Intake | `intake` | 1 |
| M3 | Assessment & Dismantling | `dismantling` | 1 |
| M4 | Parts & Inventory (WMS) | `inventory` | 1 / 3 |
| M5 | Pricing & Listings | `listings` | 2 |
| M6 | Sales & Orders | `sales` | 1 |
| M7 | Fulfillment | `fulfillment` | 1 |
| M8 | Returns & Warranty | `returns` | 2 |
| M9 | Disposition & Recycling | `disposition` | 1 |
| M10 | Marketing & CRM | `crm` | 2 / 4 |
| M11 | Finance | `finance` | 2 / 4 |
| M12 | People & HR | `people` | 2 / 4 |
| M13 | Compliance & Risk | `compliance` | 2 |
| M14 | Purchasing & Vendors | `purchasing` | 3 |
| M15 | Facilities & Equipment | `facilities` | 4 |
| M16 | Analytics | `analytics` | 1+ |

## Master keys
Vehicle **stock number** and part **SKU**. Every part keeps its vehicle stock number for life.

## Roles
`admin`, `manager`, `yard_tech`, `dismantler`, `warehouse`, `sales`, `shipping`, `accounting`.
