import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';
import { readCsv } from '../../common/csv.js';
import { cell, ebayDate, makeFromTitle, moneyToCents, parseSku } from '../../common/parse.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ExternalListingsService } from '../../platform/integrations/external-listings.service.js';
import { ImportFileError, ImportRunsService, type Counts, type ImportIssue, type ImportResult } from '../../platform/imports/import-runs.service.js';
import { IntakeService } from '../intake/intake.service.js';
import { SourcesService } from './sources.service.js';

const COLUMNS = {
  itemNumber: 'Item number',
  title: 'Title',
  sku: 'Custom label (SKU)',
  available: 'Available quantity',
  sold: 'Sold quantity',
  currency: 'Currency',
  startPrice: 'Start price',
  currentPrice: 'Current price',
  startDate: 'Start date',
  endDate: 'End date',
  categoryName: 'eBay category 1 name',
  categoryId: 'eBay category 1 number',
  condition: 'Condition',
} as const;
const REQUIRED = ['itemNumber', 'title', 'sku', 'available'] as const;

type Col = keyof typeof COLUMNS;


/**
 * M4: imports the eBay Seller Hub "Active listings" CSV (spec 1.1, part 2a).
 * eBay listings stay live at quantity 0 on purpose: sold vs remaining drives pricing (Andrei, 2026-11-27).
 */
@Injectable()
export class EbayCsvImportService {
  constructor(
    private readonly runs: ImportRunsService,
    private readonly intake: IntakeService,
    private readonly sources: SourcesService,
    private readonly listings: ExternalListingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  import(ctx: ActorContext, fileName: string | null, content: string): Promise<ImportResult> {
    return this.runs.run(ctx, 'ebay_listings_csv', fileName, (trx, runId) => this.work(trx, ctx, runId, content));
  }

  private async work(trx: Transaction<Database>, ctx: ActorContext, runId: string, content: string) {
    const rows = readCsv(content);
    if (!rows.length) throw new ImportFileError('The file is empty');
    const headers = rows[0]!.map((h) => h.trim());
    const idx = {} as Record<Col, number>;
    for (const [key, name] of Object.entries(COLUMNS) as [Col, string][]) idx[key] = headers.indexOf(name);
    const missing = REQUIRED.filter((k) => idx[k] < 0).map((k) => `"${COLUMNS[k]}"`);
    if (missing.length) throw new ImportFileError(`This does not look like an eBay active listings export: missing ${missing.join(', ')}`);
    const get = (row: string[], k: Col) => (idx[k] < 0 ? '' : cell(row[idx[k]]));

    const issues: ImportIssue[] = [];
    const counts: Counts = {
      listings_created: 0, listings_updated: 0, listings_unchanged: 0, parts_created: 0, parts_updated: 0,
      out_of_stock: 0, linked_to_car: 0, linked_to_source: 0, unlinked: 0, skipped: 0,
    };

    const body = rows.slice(1).map((row, i) => ({ row, rowNumber: i + 2 })).filter((r) => r.row.some((c) => c.trim()));
    const skus = body.map((r) => parseSku(get(r.row, 'sku')));
    const cars = await this.intake.byStockNumbers(trx, [...new Set(skus.filter((s) => s?.isCarNumber).map((s) => s!.prefix))]);
    const srcs = await this.sources.idsByCodes(trx, [...new Set(skus.filter((s) => s && !s.isCarNumber).map((s) => s!.prefix))]);
    const existing = await this.listings.byExternalId(trx, 'ebay');

    for (let n = 0; n < body.length; n++) {
      const { row, rowNumber } = body[n]!;
      const itemNumber = get(row, 'itemNumber');
      if (!/^\d{6,20}$/.test(itemNumber)) {
        issues.push({ rowNumber, code: 'bad_item_number', message: `"${itemNumber}" is not an eBay item number; row skipped` });
        counts.skipped!++;
        continue;
      }
      const title = get(row, 'title');
      const rawSku = get(row, 'sku');
      const sku = skus[n];
      const available = Number.parseInt(get(row, 'available') || '0', 10);
      const sold = Number.parseInt(get(row, 'sold') || '0', 10);
      if (!Number.isInteger(available) || available < 0) {
        issues.push({ rowNumber, code: 'bad_quantity', message: `Item ${itemNumber}: available quantity "${get(row, 'available')}" is not a whole number; row skipped`, ref: itemNumber });
        counts.skipped!++;
        continue;
      }
      let price = moneyToCents(get(row, 'currentPrice') || get(row, 'startPrice'));
      if (Number.isNaN(price)) {
        issues.push({ rowNumber, code: 'invalid_money', message: `Item ${itemNumber}: price is not an amount`, ref: itemNumber });
        price = null;
      }
      const startedAt = ebayDate(get(row, 'startDate'));
      const endsAt = ebayDate(get(row, 'endDate'));
      if (startedAt === undefined || endsAt === undefined) {
        issues.push({ rowNumber, code: 'invalid_date', message: `Item ${itemNumber}: start or end date could not be read`, ref: itemNumber });
      }

      // Link to a car (numeric prefix) or a parts source (text prefix).
      let vehicleId: string | null = null;
      let sourceId: string | null = null;
      if (!sku) {
        issues.push({ rowNumber, code: 'sku_unlinked', message: `Item ${itemNumber}: custom label "${rawSku}" is not in the car#part format`, ref: itemNumber });
      } else if (sku.isCarNumber) {
        const car = cars.get(sku.prefix);
        if (!car) {
          issues.push({ rowNumber, code: 'sku_unlinked', message: `Item ${itemNumber}: car ${sku.prefix} is not in the car list`, ref: itemNumber });
        } else {
          vehicleId = car.id;
          const titleMake = makeFromTitle(title);
          if (titleMake && car.make && titleMake !== car.make) {
            issues.push({ rowNumber, code: 'car_mismatch', message: `Item ${itemNumber}: label says car ${sku.prefix} (${car.make}) but the title says ${titleMake}`, ref: itemNumber });
          }
        }
      } else {
        sourceId = srcs.get(sku.prefix.toLowerCase()) ?? null;
        if (!sourceId) issues.push({ rowNumber, code: 'sku_unlinked', message: `Item ${itemNumber}: "${sku.prefix}" is not a known car or source`, ref: itemNumber });
      }
      if (vehicleId) counts.linked_to_car!++;
      else if (sourceId) counts.linked_to_source!++;
      else counts.unlinked!++;

      const status = available > 0 ? ('active' as const) : ('out_of_stock' as const);
      if (status === 'out_of_stock') counts.out_of_stock!++;
      const raw = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']).filter(([h, v]) => h && v));
      const listing = {
        provider: 'ebay' as const,
        external_id: itemNumber,
        sku: rawSku || null,
        title,
        url: `https://www.ebay.com/itm/${itemNumber}`,
        currency: (get(row, 'currency') || 'USD').slice(0, 3),
        price_cents: price,
        available_quantity: available,
        sold_quantity: Number.isInteger(sold) && sold >= 0 ? sold : 0,
        status,
        category_name: get(row, 'categoryName') || null,
        category_id: get(row, 'categoryId') || null,
        condition: get(row, 'condition') || null,
        started_at: startedAt ?? null,
        ends_at: endsAt ?? null,
        raw: JSON.stringify(raw),
      };

      const before = existing.get(itemNumber);
      const { id: listingId, result } = await this.listings.upsert(trx, ctx, listing, before, { runId });
      counts[`listings_${result}`]!++;
      let partId: string | null = before?.part_id ?? null;

      // Parts on the shelf: one part row per listing, quantity = units available.
      const part = {
        sku: rawSku || `ebay-${itemNumber}`,
        vehicle_id: vehicleId,
        source_id: sourceId,
        title,
        part_name: sku?.partName ?? null,
        fitment_text: title,
        condition: listing.condition,
        quantity: available,
        status: available > 0 ? ('listed' as const) : ('sold' as const),
        list_price_cents: price,
      };
      if (!partId && available > 0) {
        const created = await trx.insertInto('inventory.parts').values({ ...part, origin: 'ebay_import', part_number: null, interchange_number: null }).returning('id').executeTakeFirstOrThrow();
        partId = created.id;
        await this.listings.linkPart(trx, ctx, listingId, partId);
        counts.parts_created!++;
        await this.audit.record(trx, ctx, { action: 'inventory.part.imported', entityType: 'part', entityId: partId, after: { runId, listing: itemNumber, ...part } });
      } else if (partId) {
        const current = await trx.selectFrom('inventory.parts').selectAll().where('id', '=', partId).executeTakeFirstOrThrow();
        const keys = Object.keys(part) as (keyof typeof part)[];
        const changed = keys.some((k) => String(current[k] ?? '') !== String(part[k] ?? ''));
        if (changed) {
          await trx.updateTable('inventory.parts').set({ ...part, updated_at: new Date() }).where('id', '=', partId).execute();
          counts.parts_updated!++;
          await this.audit.record(trx, ctx, {
            action: 'inventory.part.reimported',
            entityType: 'part',
            entityId: partId,
            before: Object.fromEntries(keys.map((k) => [k, current[k]])),
            after: part,
          });
        }
      }
    }

    await this.outbox.publish(trx, 'inventory.listings.imported', { runId, created: counts.listings_created, updated: counts.listings_updated });
    return { counts, issues };
  }
}
