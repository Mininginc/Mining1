import { Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import { DB } from '../../db/db.js';
import { withCompany } from '../../db/tenant.js';
import type { Database } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

/** Keys that must never be written to the audit log. */
const SECRET_KEYS = new Set(['password', 'password_hash', 'passwordHash', 'mfa_secret', 'mfaSecret']);

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!SECRET_KEYS.has(k)) out[k] = redact(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /**
   * Write inside the caller's company transaction (see withCompany) so the change and its audit row
   * commit together. company_id comes from that transaction; RLS rejects any mismatch.
   */
  async record(trx: Transaction<Database>, ctx: Omit<ActorContext, 'companyId'>, entry: AuditEntry): Promise<void> {
    const before = redact(entry.before);
    const after = redact(entry.after);
    await trx
      .insertInto('platform.audit_log')
      .values({
        actor_id: ctx.actorId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        before: before === null ? null : JSON.stringify(before),
        after: after === null ? null : JSON.stringify(after),
        ip: ctx.ip,
        request_id: ctx.requestId,
      })
      .execute();
  }

  async list(companyId: string, filter: { entityType?: string; entityId?: string; limit: number }) {
    return withCompany(this.db, companyId, (trx) => {
      let q = trx.selectFrom('platform.audit_log').selectAll().orderBy('id', 'desc').limit(filter.limit);
      if (filter.entityType) q = q.where('entity_type', '=', filter.entityType);
      if (filter.entityId) q = q.where('entity_id', '=', filter.entityId);
      return q.execute();
    });
  }
}
