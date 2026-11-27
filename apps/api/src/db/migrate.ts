import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';
import * as m0001 from './migrations/0001_platform.js';
import * as m0002 from './migrations/0002_multi_company.js';
import * as m0003 from './migrations/0003_import_existing_data.js';

const migrations: Record<string, Migration> = {
  '0001_platform': m0001,
  '0002_multi_company': m0002,
  '0003_import_existing_data': m0003,
};

export async function migrateToLatest(db: Kysely<any>): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
    migrationTableSchema: 'public',
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}

/** For tests: migrate up to and including one named migration. */
export async function migrateTo(db: Kysely<any>, name: string): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations }, migrationTableSchema: 'public' });
  const { error } = await migrator.migrateTo(name);
  if (error) throw error;
}
