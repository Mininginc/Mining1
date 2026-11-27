import { createDb } from './db.js';
import { migrateToLatest } from './migrate.js';

async function main() {
  const db = createDb(process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://wms:wms@localhost:5432/wms');
  try {
    const applied = await migrateToLatest(db);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } finally {
    await db.destroy();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
