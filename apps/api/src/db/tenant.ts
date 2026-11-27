import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from './types.js';

/**
 * Runs `fn` in a transaction scoped to one company. Row-level security then shows and accepts
 * only that company's rows, and new rows get its company_id by default.
 * All business data access goes through here.
 */
export async function withCompany<T>(
  db: Kysely<Database>,
  companyId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.company_id', ${companyId}, true)`.execute(trx);
    return fn(trx);
  });
}

/** Looks up an active company by slug. Works before any company is set (security definer function). */
export async function companyIdBySlug(db: Kysely<Database>, slug: string): Promise<string | null> {
  const { rows } = await sql<{ id: string | null }>`select platform.company_id_by_slug(${slug}) as id`.execute(db);
  return rows[0]?.id ?? null;
}
