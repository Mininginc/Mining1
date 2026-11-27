import { Kysely, PostgresDialect } from 'kysely';
import pg, { Pool } from 'pg';

// Return SQL `date` columns as 'YYYY-MM-DD' strings, not JS Dates, so no time zone can shift a day.
pg.types.setTypeParser(1082, (v: string) => v);
import type { Database } from './types.js';

export const DB = Symbol('DB');

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 10 }) }),
  });
}
