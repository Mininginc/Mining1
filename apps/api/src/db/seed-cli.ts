import { createDb } from './db.js';
import { seedFirstAdmin } from './seed.js';

async function main() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD');
  const db = createDb(process.env.DATABASE_URL ?? 'postgres://wms:wms@localhost:5432/wms');
  try {
    const created = await seedFirstAdmin(db, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: ADMIN_NAME ?? 'Administrator' });
    console.log(created ? `Created admin ${ADMIN_EMAIL}` : 'An admin already exists; nothing changed');
  } finally {
    await db.destroy();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
