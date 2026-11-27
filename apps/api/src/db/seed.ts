import { sql, type Kysely } from 'kysely';
import { MIN_PASSWORD_LENGTH } from '@wms/shared';
import type { Database } from './types.js';
import { hashPassword } from '../platform/crypto/password.js';

export interface SeedCompanyInput {
  company: { name: string; slug: string; homeState?: string };
  admin: { email: string; password: string; name: string };
}

/**
 * Runs with the database OWNER connection (migrations/ops), not the API's role.
 * Creates the company if it does not exist, then its first admin if it has none.
 * Returns what was created. Also how a platform owner adds a new customer company.
 */
export async function seedCompany(db: Kysely<Database>, input: SeedCompanyInput): Promise<{ companyCreated: boolean; adminCreated: boolean }> {
  if (input.admin.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const slug = input.company.slug.trim().toLowerCase();
  const passwordHash = await hashPassword(input.admin.password);
  return db.transaction().execute(async (trx) => {
    let companyCreated = false;
    let company = await trx.selectFrom('platform.companies').select('id').where('slug', '=', slug).executeTakeFirst();
    if (!company) {
      company = await trx
        .insertInto('platform.companies')
        .values({ name: input.company.name, slug, ...(input.company.homeState && { home_state: input.company.homeState }) })
        .returning('id')
        .executeTakeFirstOrThrow();
      companyCreated = true;
    }
    await sql`select set_config('app.company_id', ${company.id}, true)`.execute(trx);

    const existing = await trx
      .selectFrom('platform.users')
      .select('id')
      .where('company_id', '=', company.id)
      .where(sql<boolean>`'admin' = any(roles)`)
      .executeTakeFirst();
    if (existing) return { companyCreated, adminCreated: false };

    const created = await trx
      .insertInto('platform.users')
      .values({ email: input.admin.email.trim(), name: input.admin.name, password_hash: passwordHash, roles: ['admin'], mfa_secret: null, locked_until: null })
      .returning(['id', 'email', 'name', 'roles'])
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('platform.audit_log')
      .values({ actor_id: null, action: 'user.seeded_admin', entity_type: 'user', entity_id: created.id, before: null, after: JSON.stringify(created), ip: null, request_id: null })
      .execute();
    return { companyCreated, adminCreated: true };
  });
}
