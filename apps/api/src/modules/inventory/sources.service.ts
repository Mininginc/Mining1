import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';
import { AuditService } from '../../platform/audit/audit.service.js';

/** M4 public service: parts sources that are not a car (suppliers, bulk buckets). */
@Injectable()
export class SourcesService {
  constructor(private readonly audit: AuditService) {}

  /** Creates or updates a source by code (case-insensitive). Returns whether it was created, updated or unchanged. */
  async upsert(
    trx: Transaction<Database>,
    ctx: ActorContext,
    input: { code: string; openingSalesCents: number },
  ): Promise<'created' | 'updated' | 'unchanged'> {
    const existing = await trx
      .selectFrom('inventory.sources')
      .select(['id', 'code', 'name', 'opening_sales_cents'])
      .where(sql<boolean>`lower(code) = lower(${input.code})`)
      .executeTakeFirst();
    if (!existing) {
      const row = await trx
        .insertInto('inventory.sources')
        .values({ code: input.code, name: input.code, opening_sales_cents: input.openingSalesCents })
        .returning(['id', 'code', 'name', 'opening_sales_cents'])
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, { action: 'inventory.source.imported', entityType: 'source', entityId: row.id, after: row });
      return 'created';
    }
    if (Number(existing.opening_sales_cents) === input.openingSalesCents) return 'unchanged';
    const row = await trx
      .updateTable('inventory.sources')
      .set({ opening_sales_cents: input.openingSalesCents, updated_at: new Date() })
      .where('id', '=', existing.id)
      .returning(['id', 'code', 'name', 'opening_sales_cents'])
      .executeTakeFirstOrThrow();
    await this.audit.record(trx, ctx, { action: 'inventory.source.updated', entityType: 'source', entityId: row.id, before: existing, after: row });
    return 'updated';
  }

  /** code (lowercase) -> source id */
  async idsByCodes(trx: Transaction<Database>, codes: string[]): Promise<Map<string, string>> {
    if (!codes.length) return new Map();
    const rows = await trx
      .selectFrom('inventory.sources')
      .select(['id', 'code'])
      .where(sql<boolean>`lower(code) = any(${codes.map((c) => c.toLowerCase())})`)
      .execute();
    return new Map(rows.map((r) => [r.code.toLowerCase(), r.id]));
  }
}
