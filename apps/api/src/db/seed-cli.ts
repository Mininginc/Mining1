import { createDb } from './db.js';
import { seedCompany } from './seed.js';

/**
 * Creates a company and its first admin. Run with the database owner connection.
 * Env: OWNER_DATABASE_URL (or DATABASE_URL), COMPANY_NAME, COMPANY_SLUG, COMPANY_STATE,
 *      ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME
 */
async function main() {
  const e = process.env;
  if (!e.ADMIN_EMAIL || !e.ADMIN_PASSWORD || !e.COMPANY_SLUG) throw new Error('Set COMPANY_SLUG, ADMIN_EMAIL and ADMIN_PASSWORD');
  const db = createDb(e.OWNER_DATABASE_URL ?? e.DATABASE_URL ?? 'postgres://wms:wms@localhost:5432/wms');
  try {
    const r = await seedCompany(db, {
      company: { name: e.COMPANY_NAME ?? e.COMPANY_SLUG, slug: e.COMPANY_SLUG, homeState: e.COMPANY_STATE },
      admin: { email: e.ADMIN_EMAIL, password: e.ADMIN_PASSWORD, name: e.ADMIN_NAME ?? 'Administrator' },
    });
    console.log(`Company ${e.COMPANY_SLUG}: ${r.companyCreated ? 'created' : 'already existed'}; admin ${r.adminCreated ? `created (${e.ADMIN_EMAIL})` : 'already exists, nothing changed'}`);
  } finally {
    await db.destroy();
  }
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
