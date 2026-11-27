import { createHash } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { Kysely, Transaction } from 'kysely';
import { DB } from '../../db/db.js';
import { withCompany } from '../../db/tenant.js';
import type { Database } from '../../db/types.js';
import type { ActorContext } from '../../common/request-context.js';

export type ImportKind = 'car_sheet' | 'ebay_listings_csv';

export interface ImportIssue {
  rowNumber: number | null;
  code: string;
  message: string;
  ref?: string | null;
}

export type Counts = Record<string, number>;

export interface ImportResult {
  runId: string;
  status: 'succeeded' | 'failed';
  counts: Counts;
  issues: ImportIssue[];
  error?: string;
}

export function headerSignature(headers: string[]): string {
  return createHash('sha256').update(headers.map((h) => h.trim().toLowerCase()).join('\u0001')).digest('hex').slice(0, 32);
}

/**
 * M1 import bookkeeping: runs, issues (the review queue) and saved column mappings.
 * Module importers do their work inside `run`; a failure rolls back every row and is recorded as a failed run.
 */
@Injectable()
export class ImportRunsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  async run(
    ctx: ActorContext,
    kind: ImportKind,
    fileName: string | null,
    work: (trx: Transaction<Database>, runId: string) => Promise<{ counts: Counts; issues: ImportIssue[] }>,
  ): Promise<ImportResult> {
    try {
      return await withCompany(this.db, ctx.companyId, async (trx) => {
        const { id: runId } = await trx
          .insertInto('platform.import_runs')
          .values({ kind, file_name: fileName, started_by: ctx.actorId, status: 'succeeded', counts: '{}', error: null, finished_at: null })
          .returning('id')
          .executeTakeFirstOrThrow();
        const { counts, issues } = await work(trx, runId);
        counts.issues = issues.length;
        if (issues.length) {
          for (let i = 0; i < issues.length; i += 500) {
            await trx
              .insertInto('platform.import_issues')
              .values(issues.slice(i, i + 500).map((x) => ({ run_id: runId, row_number: x.rowNumber, code: x.code, message: x.message, ref: x.ref ?? null, resolved_at: null, resolved_by: null })))
              .execute();
          }
        }
        await trx.updateTable('platform.import_runs').set({ counts: JSON.stringify(counts), finished_at: new Date() }).where('id', '=', runId).execute();
        return { runId, status: 'succeeded' as const, counts, issues };
      });
    } catch (e) {
      // Everything above was rolled back. Record the failure on its own.
      const message = e instanceof Error ? e.message : String(e);
      const { id: runId } = await withCompany(this.db, ctx.companyId, (trx) =>
        trx
          .insertInto('platform.import_runs')
          .values({ kind, file_name: fileName, started_by: ctx.actorId, status: 'failed', counts: '{}', error: message.slice(0, 2000), finished_at: new Date() })
          .returning('id')
          .executeTakeFirstOrThrow(),
      );
      if (isUserError(e)) return { runId, status: 'failed', counts: {}, issues: [], error: message };
      throw e;
    }
  }

  async getMapping(trx: Transaction<Database>, kind: ImportKind, signature: string): Promise<Record<string, string> | null> {
    const row = await trx.selectFrom('platform.import_mappings').select('mapping').where('kind', '=', kind).where('header_signature', '=', signature).executeTakeFirst();
    return (row?.mapping as Record<string, string> | undefined) ?? null;
  }

  async saveMapping(trx: Transaction<Database>, kind: ImportKind, signature: string, mapping: Record<string, string>): Promise<void> {
    await trx
      .insertInto('platform.import_mappings')
      .values({ kind, header_signature: signature, mapping: JSON.stringify(mapping) })
      .onConflict((oc) => oc.columns(['company_id', 'kind', 'header_signature']).doUpdateSet({ mapping: JSON.stringify(mapping), updated_at: new Date() }))
      .execute();
  }

  list(companyId: string, limit = 50) {
    return withCompany(this.db, companyId, (trx) => trx.selectFrom('platform.import_runs').selectAll().orderBy('started_at', 'desc').limit(limit).execute());
  }

  /** The review queue: open problems from every import, newest run first. */
  openIssues(companyId: string, q: { code?: string; limit: number; offset: number }) {
    return withCompany(this.db, companyId, (trx) => {
      let query = trx
        .selectFrom('platform.import_issues as i')
        .innerJoin('platform.import_runs as r', 'r.id', 'i.run_id')
        .select(['i.id', 'i.run_id', 'i.row_number', 'i.code', 'i.message', 'i.ref', 'i.created_at', 'r.kind', 'r.file_name', 'r.started_at'])
        .where('i.resolved_at', 'is', null)
        .orderBy('r.started_at', 'desc')
        .orderBy('i.row_number')
        .orderBy('i.id')
        .limit(q.limit)
        .offset(q.offset);
      if (q.code) query = query.where('i.code', '=', q.code);
      return query.execute();
    });
  }

  /** Open problem counts by type, for the review screen's filter. */
  openIssueCounts(companyId: string) {
    return withCompany(this.db, companyId, (trx) =>
      trx
        .selectFrom('platform.import_issues')
        .select(['code', (eb) => eb.fn.countAll<string>().as('count')])
        .where('resolved_at', 'is', null)
        .groupBy('code')
        .orderBy('code')
        .execute(),
    );
  }

  async resolveIssue(ctx: ActorContext, issueId: string, note: string | undefined) {
    return withCompany(this.db, ctx.companyId, async (trx) => {
      const before = await trx.selectFrom('platform.import_issues').selectAll().where('id', '=', issueId).forUpdate().executeTakeFirst();
      if (!before) throw new NotFoundException();
      if (before.resolved_at) return before;
      const after = await trx
        .updateTable('platform.import_issues')
        .set({ resolved_at: new Date(), resolved_by: ctx.actorId })
        .where('id', '=', issueId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, ctx, {
        action: 'import.issue_resolved',
        entityType: 'import_issue',
        entityId: issueId,
        before: { resolvedAt: null },
        after: { resolvedAt: after.resolved_at, code: before.code, ref: before.ref, note: note ?? null },
      });
      return after;
    });
  }

  issues(companyId: string, runId: string, onlyOpen: boolean) {
    return withCompany(this.db, companyId, (trx) => {
      let q = trx.selectFrom('platform.import_issues').selectAll().where('run_id', '=', runId).orderBy('row_number').orderBy('id');
      if (onlyOpen) q = q.where('resolved_at', 'is', null);
      return q.execute();
    });
  }
}

/** An import problem caused by the file, reported to the user as a failed run (not a 500). */
export class ImportFileError extends Error {}
function isUserError(e: unknown): boolean {
  return e instanceof ImportFileError;
}
