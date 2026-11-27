import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { createApp } from '../src/app.factory.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/db.js';
import { migrateToLatest } from '../src/db/migrate.js';
import type { Database } from '../src/db/types.js';
import { seedFirstAdmin } from '../src/db/seed.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://wms:wms@localhost:5432/wms_test';
export const ADMIN = { email: 'admin@test.local', password: 'admin-password-123', name: 'Test Admin' };

export async function resetDatabase(): Promise<Kysely<Database>> {
  const db = createDb(TEST_DB_URL);
  await sql`drop schema if exists platform cascade`.execute(db);
  await sql`drop table if exists public.kysely_migration, public.kysely_migration_lock`.execute(db);
  await migrateToLatest(db);
  await seedFirstAdmin(db, ADMIN);
  return db;
}

export async function startApp(): Promise<INestApplication> {
  const app = await createApp(
    loadConfig({ DATABASE_URL: TEST_DB_URL, JWT_SECRET: 'test-secret-test-secret-test-secret-42', JWT_TTL_SECONDS: '900' }),
  );
  await app.init();
  return app;
}
