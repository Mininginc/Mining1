# ADR 0003: Integrate commodity back office, don't rebuild it
Status: Accepted (2026-11-27)

Payroll, general ledger, sales-tax calculation and filing, card payments, shipping labels, marketplaces, VIN decode, NMVTIS and parts interchange data come from providers. Each provider sits behind an adapter interface in the M1 integrations hub so it can be swapped in one place.
