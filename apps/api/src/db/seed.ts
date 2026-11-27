import { Kysely, sql } from 'kysely';
import { MIN_PASSWORD_LENGTH } from '@wms/shared';
import type { Database } from './types.js';
import { hashPassword } from '../platform/crypto/password.js';

export interface SeedAdminInput {
  email: string;
  password: string;
  name: string;
}

/** Creates the first admin only when no admin exists. Returns true if one was created. */
export async function seedFirstAdmin(db: Kysely<Database>, input: SeedAdminInput): Promise<boolean> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('platform.users')
      .select('id')
      .where(sql<boolean>`'admin' = any(roles)`)
      .executeTakeFirst();
    if (existing) return false;
    const created = await trx
      .insertInto('platform.users')
      .values({
        email: input.email.trim(),
        name: input.name,
        password_hash: await hashPassword(input.password),
        roles: ['admin'],
        mfa_secret: null,
        locked_until: null,
      })
      .returning(['id', 'email', 'name', 'roles'])
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('platform.audit_log')
      .values({
        actor_id: null,
        action: 'user.seeded_admin',
        entity_type: 'user',
        entity_id: created.id,
        before: null,
        after: JSON.stringify(created),
        ip: null,
        request_id: null,
      })
      .execute();
    return true;
  });
}
