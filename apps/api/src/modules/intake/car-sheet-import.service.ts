import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database, VehiclesTable } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';
import { readCsv } from '../../common/csv.js';
import { bool, cell, makeFromVin, moneyToCents, normalizeVin, usDate, vinIsValid } from '../../common/parse.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { headerSignature, ImportFileError, ImportRunsService, type Counts, type ImportIssue, type ImportResult } from '../../platform/imports/import-runs.service.js';
import { SourcesService } from '../inventory/sources.service.js';

/** Fields the importer understands, and the header names it recognises for each (lower case). */
export const CAR_FIELDS = {
  sold_complete: ['sold complete', 'for sale complete'],
  stock_number: ['car id', 'stock', 'stock number', 'stock #', 'stock no'],
  year: ['year'],
  model: ['model'],
  m_sport: ['m-sport', 'm sport', 'msport'],
  chassis_code: ['body style', 'chassis', 'chassis code'],
  color: ['color', 'colour'],
  engine_code: ['engine'],
  title_in_hand: ['title', 'title in hand'],
  transmission: ['transmission'],
  vin: ['vin'],
  mileage: ['mileage', 'miles'],
  purchased_on: ['bought on', 'purchase date', 'purchased on'],
  delivered_on: ['delievered on', 'delivered on'],
  dismantled_on: ['dismantled on'],
  first_listed_on: ['started posted', 'first listed', 'posted on'],
  paid_off_on: ['paid off on'],
  purchase_cost: ['car cost', 'purchase cost', 'cost'],
  total_sales: ['total sales'],
  sheet_profit: ['profit'],
} as const;
export type CarField = keyof typeof CAR_FIELDS;

const DATE_FIELDS = ['purchased_on', 'delivered_on', 'dismantled_on', 'first_listed_on', 'paid_off_on'] as const;

/** Columns compared to decide whether a re-imported car changed. */
const COMPARED: (keyof VehiclesTable)[] = [
  'vin', 'vin_valid', 'year', 'make', 'model', 'chassis_code', 'engine_code', 'transmission', 'color', 'm_sport', 'mileage',
  'mileage_is_approximate', 'title_in_hand', 'sold_complete', 'purchased_on', 'purchase_cost_cents', 'delivered_on', 'dismantled_on',
  'first_listed_on', 'paid_off_on', 'opening_sales_cents',
];

function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const lower = rows[i]!.map((c) => c.trim().toLowerCase());
    if (lower.includes('vin') && CAR_FIELDS.stock_number.some((a) => lower.includes(a))) return i;
  }
  throw new ImportFileError('Could not find the header row: expected a row with "Car ID" (or "Stock") and "VIN" in the first 5 rows');
}

/** Maps field -> column index. A saved or supplied mapping (field -> header text) wins over auto-detection. */
export function resolveColumns(headers: string[], mapping: Partial<Record<CarField, string>> | null): Partial<Record<CarField, number>> {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const out: Partial<Record<CarField, number>> = {};
  for (const field of Object.keys(CAR_FIELDS) as CarField[]) {
    const wanted = mapping?.[field];
    const idx = wanted !== undefined ? lower.indexOf(wanted.trim().toLowerCase()) : lower.findIndex((h) => (CAR_FIELDS[field] as readonly string[]).includes(h));
    if (idx >= 0) out[field] = idx;
  }
  // Andrei's sheet: the unlabeled first column is "sold complete".
  if (out.sold_complete === undefined && lower[0] === '' && mapping?.sold_complete === undefined) out.sold_complete = 0;
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date) a = a.toISOString().slice(0, 10);
  if (b instanceof Date) b = b.toISOString().slice(0, 10);
  if (typeof a === 'bigint' || typeof b === 'bigint' || (typeof a === 'string' && typeof b === 'number') || (typeof a === 'number' && typeof b === 'string')) {
    return a !== null && b !== null && Number(a) === Number(b);
  }
  return (a ?? null) === (b ?? null);
}

@Injectable()
export class CarSheetImportService {
  constructor(
    private readonly runs: ImportRunsService,
    private readonly sources: SourcesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  import(ctx: ActorContext, fileName: string | null, content: string, mappingOverride?: Partial<Record<CarField, string>>): Promise<ImportResult> {
    return this.runs.run(ctx, 'car_sheet', fileName, (trx, runId) => this.work(trx, ctx, runId, content, mappingOverride));
  }

  private async work(trx: Transaction<Database>, ctx: ActorContext, runId: string, content: string, mappingOverride?: Partial<Record<CarField, string>>) {
    const rows = readCsv(content);
    const headerAt = findHeaderRow(rows);
    const headers = rows[headerAt]!;
    const signature = headerSignature(headers);
    const saved = await this.runs.getMapping(trx, 'car_sheet', signature);
    const mapping = mappingOverride ?? (saved as Partial<Record<CarField, string>> | null);
    const col = resolveColumns(headers, mapping);
    if (col.stock_number === undefined || col.vin === undefined) throw new ImportFileError('The sheet needs a Car ID (stock number) column and a VIN column');
    // Remember the mapping by header text so the next upload of this layout needs no setup.
    const toSave: Record<string, string> = {};
    for (const [field, idx] of Object.entries(col)) toSave[field] = headers[idx as number] ?? '';
    await this.runs.saveMapping(trx, 'car_sheet', signature, toSave);

    const get = (row: string[], f: CarField) => (col[f] === undefined ? '' : cell(row[col[f]!]));
    const issues: ImportIssue[] = [];
    const counts: Counts = { created: 0, updated: 0, unchanged: 0, sources_created: 0, sources_updated: 0, sources_unchanged: 0, skipped: 0 };
    const seenStock = new Map<string, number>();
    const vinRows = new Map<string, { stock: string; row: number }[]>();

    const existing = new Map(
      (await trx.selectFrom('intake.vehicles').selectAll().execute()).map((v) => [v.stock_number, v]),
    );

    for (let i = headerAt + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const rowNumber = i + 1;
      const stock = get(row, 'stock_number');
      if (!stock) continue;

      if (!/^\d+$/.test(stock)) {
        const total = moneyToCents(get(row, 'total_sales'));
        const result = await this.sources.upsert(trx, ctx, { code: stock, openingSalesCents: Number.isNaN(total) ? 0 : (total ?? 0) });
        counts[`sources_${result}`]!++;
        continue;
      }

      if (seenStock.has(stock)) {
        issues.push({ rowNumber, code: 'duplicate_car_id', message: `Car ID ${stock} also appears on row ${seenStock.get(stock)}; this row was not imported`, ref: stock });
        counts.skipped!++;
        continue;
      }
      seenStock.set(stock, rowNumber);

      const vin = normalizeVin(get(row, 'vin'));
      const vinValid = vin ? vinIsValid(vin) : null;
      if (vin && !vinValid) issues.push({ rowNumber, code: 'vin_invalid', message: `VIN ${vin} on car ${stock} fails the check digit (likely a typo)`, ref: stock });
      if (vin) vinRows.set(vin, [...(vinRows.get(vin) ?? []), { stock, row: rowNumber }]);

      const dates: Record<string, string | null> = {};
      for (const f of DATE_FIELDS) {
        const raw = get(row, f);
        const d = usDate(raw);
        if (d === undefined) issues.push({ rowNumber, code: 'invalid_date', message: `Car ${stock}: "${raw}" in ${headers[col[f]!]} is not a date (M/D/YYYY)`, ref: stock });
        dates[f] = d ?? null;
      }
      const money = (f: CarField) => {
        const v = moneyToCents(get(row, f));
        if (Number.isNaN(v)) {
          issues.push({ rowNumber, code: 'invalid_money', message: `Car ${stock}: "${get(row, f)}" in ${headers[col[f]!]} is not an amount`, ref: stock });
          return null;
        }
        return v;
      };
      const cost = money('purchase_cost');
      const sales = money('total_sales');
      const sheetProfit = money('sheet_profit');
      if (sheetProfit !== null) {
        const computed = (sales ?? 0) - (cost ?? 0);
        if (Math.abs(computed - sheetProfit) > 100) {
          issues.push({
            rowNumber,
            code: 'profit_mismatch',
            message: `Car ${stock}: sheet profit ${(sheetProfit / 100).toFixed(2)} but total sales minus car cost is ${(computed / 100).toFixed(2)}`,
            ref: stock,
          });
        }
      }
      const yearRaw = Number(get(row, 'year'));
      const milesRaw = get(row, 'mileage').replace(/,/g, '');

      const record = {
        stock_number: stock,
        vin,
        vin_valid: vinValid,
        year: Number.isInteger(yearRaw) && yearRaw >= 1900 && yearRaw <= 2100 ? yearRaw : null,
        make: makeFromVin(vin),
        model: get(row, 'model') || null,
        chassis_code: get(row, 'chassis_code') || null,
        engine_code: get(row, 'engine_code') || null,
        transmission: get(row, 'transmission') || null,
        color: get(row, 'color') || null,
        m_sport: bool(get(row, 'm_sport')),
        // The sheet records thousands of miles (93 = 93,000), so imported mileage is approximate.
        mileage: /^\d+(\.\d+)?$/.test(milesRaw) ? Math.round(Number(milesRaw) * 1000) : null,
        mileage_is_approximate: /^\d+(\.\d+)?$/.test(milesRaw),
        title_in_hand: bool(get(row, 'title_in_hand')),
        sold_complete: bool(get(row, 'sold_complete')) ?? false,
        purchased_on: dates.purchased_on ?? null,
        purchase_cost_cents: cost,
        delivered_on: dates.delivered_on ?? null,
        dismantled_on: dates.dismantled_on ?? null,
        first_listed_on: dates.first_listed_on ?? null,
        paid_off_on: dates.paid_off_on ?? null,
        opening_sales_cents: sales ?? 0,
      };

      const before = existing.get(stock);
      if (!before) {
        const created = await trx
          .insertInto('intake.vehicles')
          .values({ ...record, tow_cost_cents: null, source: 'spreadsheet', notes: null })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, ctx, { action: 'intake.vehicle.imported', entityType: 'vehicle', entityId: created.id, after: { runId, ...record } });
        counts.created!++;
        continue;
      }
      const changed = COMPARED.some((k) => !sameValue(before[k], (record as Record<string, unknown>)[k]));
      if (!changed) {
        counts.unchanged!++;
        continue;
      }
      await trx.updateTable('intake.vehicles').set({ ...record, updated_at: new Date() }).where('id', '=', before.id).execute();
      await this.audit.record(trx, ctx, { action: 'intake.vehicle.reimported', entityType: 'vehicle', entityId: before.id, before, after: { runId, ...record } });
      counts.updated!++;
    }

    // The same VIN on several cars: keep them all, but flag each for review.
    for (const [vin, list] of vinRows) {
      if (list.length < 2) continue;
      const cars = list.map((x) => x.stock).join(', ');
      for (const x of list) issues.push({ rowNumber: x.row, code: 'duplicate_vin', message: `VIN ${vin} is on cars ${cars}`, ref: x.stock });
    }
    // A VIN already on a different car from an earlier import or manual entry.
    for (const v of existing.values()) {
      if (!v.vin) continue;
      for (const x of vinRows.get(v.vin) ?? []) {
        if (x.stock !== v.stock_number && !seenStock.has(v.stock_number)) {
          issues.push({ rowNumber: x.row, code: 'duplicate_vin', message: `VIN ${v.vin} is already on car ${v.stock_number}`, ref: x.stock });
        }
      }
    }
    issues.sort((a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0));

    await this.outbox.publish(trx, 'intake.vehicles.imported', { runId, created: counts.created, updated: counts.updated });
    return { counts, issues };
  }
}
