import { Injectable } from '@nestjs/common';
import type { Insertable, Selectable, Transaction } from 'kysely';
import type { Database, ExternalListingsTable } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';

export type ExternalListing = Selectable<ExternalListingsTable>;
export type ListingInput = Omit<Insertable<ExternalListingsTable>, 'company_id' | 'part_id'>;

/** Fields compared to decide whether a re-imported listing changed. */
export const LISTING_COMPARED = [
  'sku', 'title', 'price_cents', 'available_quantity', 'sold_quantity', 'status', 'category_name', 'category_id', 'condition', 'currency',
] as const;

/**
 * M1 integrations hub: marketplace listings as the marketplace reports them.
 * Modules read and write listings only through this service (platform schema).
 */
@Injectable()
export class ExternalListingsService {
  constructor(private readonly audit: AuditService) {}

  async byExternalId(trx: Transaction<Database>, provider: 'ebay'): Promise<Map<string, ExternalListing>> {
    const rows = await trx.selectFrom('platform.external_listings').selectAll().where('provider', '=', provider).execute();
    return new Map(rows.map((r) => [r.external_id, r]));
  }

  /** Creates or updates one listing. Returns its id and what happened. */
  async upsert(
    trx: Transaction<Database>,
    ctx: Omit<ActorContext, 'companyId'>,
    input: ListingInput,
    before: ExternalListing | undefined,
    note: Record<string, unknown> = {},
  ): Promise<{ id: string; result: 'created' | 'updated' | 'unchanged' }> {
    if (!before) {
      const { id } = await trx.insertInto('platform.external_listings').values({ ...input, part_id: null }).returning('id').executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, { action: 'listing.imported', entityType: 'external_listing', entityId: id, after: { ...note, ...input, raw: undefined } });
      return { id, result: 'created' };
    }
    const changed = LISTING_COMPARED.some((k) => String(before[k] ?? '') !== String((input as Record<string, unknown>)[k] ?? ''));
    if (!changed) return { id: before.id, result: 'unchanged' };
    await trx.updateTable('platform.external_listings').set({ ...input, updated_at: new Date() }).where('id', '=', before.id).execute();
    await this.audit.record(trx, ctx, {
      action: 'listing.reimported',
      entityType: 'external_listing',
      entityId: before.id,
      before: Object.fromEntries(LISTING_COMPARED.map((k) => [k, before[k]])),
      after: { ...note, ...Object.fromEntries(LISTING_COMPARED.map((k) => [k, (input as Record<string, unknown>)[k]])) },
    });
    return { id: before.id, result: 'updated' };
  }

  async linkPart(trx: Transaction<Database>, ctx: Omit<ActorContext, 'companyId'>, listingId: string, partId: string): Promise<void> {
    await trx.updateTable('platform.external_listings').set({ part_id: partId, updated_at: new Date() }).where('id', '=', listingId).execute();
    await this.audit.record(trx, ctx, { action: 'listing.part_linked', entityType: 'external_listing', entityId: listingId, after: { partId } });
  }
}
