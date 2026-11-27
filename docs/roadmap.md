# Roadmap

Importance scale: 5 = most important (confirmed by Andrei, 2026-11-27). Order = importance adjusted for dependency.

| Phase | Theme | Scope | Exit gate | Status |
| --- | --- | --- | --- | --- |
| 0 | Ready to build | Repo, CI, team agents, sign-in, roles, MFA, audit log, outbox, PWA shell, backups runbook | Restore test passes; first feature spec approved | Built and pushed 2026-11-27; waiting on spec 1.1 approval |
| 1 | Vehicle in, part shipped | **1.1 import eBay inventory and the car spreadsheet, eBay stock sync**; receiving, photos, VIN, title; dismantle orders, fluids log; SKU, labels, bins; quotes, compatibility, POS; pick, pack, ship (ShipStation), replacing Monday.com hand-offs; hulk and scrap tickets; dismantling productivity | One real vehicle processed and its parts shipped | Not started |
| 2 | Sell more, stay compliant | Pricing engine, eBay listing edits, Car-Part.com feed, Instagram/Facebook; Respond.io and Dialpad links; sales tax and accounting sync; returns and warranty; leads and B2B accounts; licenses, insurance, OSHA, safety training, incidents | Listings sync cleanly; every renewal has an alert | Not started |
| 3 | Warehouse and sourcing | Cycle counts, accuracy, space and bin optimization, 5S; aging, slow, dead, overstock; relocation, liquidation; sourcing bid calculator; vendors and POs | Inventory accuracy target met | Not started |
| 4 | Growth and back office | Marketing, payroll sync, HR, budgets, debt, cash flow, facilities and equipment | Marketing ROI and labor reports used monthly | Not started |
| 5 | Optimize and scale | Forecasting, dashboards, AI descriptions and price hints, more locations and marketplaces | Reviewed with Andrei after Phase 4 | Not started |

## Context from Andrei (2026-11-27)
Today: eBay holds all parts inventory; Excel tracks each car and a master pivot (sales, expenses, EBITDA, inventory); Monday.com coordinates sales, processing and shipping; shipping via eBay and ShipStation; Respond.io (Instagram) and Dialpad (phone). Channels: eBay, referrals, repeat customers, Instagram, Facebook, Car-Part.com. Location: California; other states and selling the software to others are possible (see ADR 0006).
