import type { INestApplication } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/db.js';
import { migrateTo, migrateToLatest } from '../src/db/migrate.js';
import { seedCompany } from '../src/db/seed.js';
import type { Database } from '../src/db/types.js';
import { ADMIN, COMPANY, TEST_APP_DB_URL, TEST_DB_URL, resetDatabase, startApp } from './helpers.js';

const OTHER = { name: 'Other Yard', slug: 'other-yard', homeState: 'NV' };
const SHARED_EMAIL = 'same@person.test';

let app: INestApplication;
let db: Kysely<Database>;
const http = () => request(app.getHttpServer());
const login = (company: string | undefined, email: string, password: string) =>
  http().post('/auth/login').send({ ...(company && { company }), email, password });

let tokenA: string;
let tokenB: string;
let userA: string;
let userB: string;

beforeAll(async () => {
  db = await resetDatabase();
  await seedCompany(db, { company: OTHER, admin: { email: 'boss@other.test', password: 'other-password-12', name: 'Other Boss' } });
  app = await startApp();

  const adminA = (await login(COMPANY.slug, ADMIN.email, ADMIN.password)).body.accessToken;
  const adminB = (await login(OTHER.slug, 'boss@other.test', 'other-password-12')).body.accessToken;
  const mk = async (token: string, password: string) =>
    (await http().post('/users').set('authorization', `Bearer ${token}`).send({ email: SHARED_EMAIL, name: 'Same Person', password, roles: ['manager'] })).body.id as string;
  userA = await mk(adminA, 'password-for-a-123');
  userB = await mk(adminB, 'password-for-b-123');
  tokenA = adminA;
  tokenB = adminB;
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('AC1 same email, separate companies', () => {
  it('each person signs in only to their own company', async () => {
    const a = await login(COMPANY.slug, SHARED_EMAIL, 'password-for-a-123');
    const b = await login(OTHER.slug, SHARED_EMAIL, 'password-for-b-123');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.user.id).toBe(userA);
    expect(b.body.user.id).toBe(userB);
    expect((await login(OTHER.slug, SHARED_EMAIL, 'password-for-a-123')).status).toBe(401);
    expect((await http().get('/auth/me').set('authorization', `Bearer ${b.body.accessToken}`)).body.company.slug).toBe(OTHER.slug);
  });
  it('uses the default company when none is sent, and refuses an unknown company', async () => {
    expect((await login(undefined, ADMIN.email, ADMIN.password)).status).toBe(200);
    expect((await login('no-such-co', ADMIN.email, ADMIN.password)).status).toBe(401);
  });
});

describe("AC2 one company cannot see another's data", () => {
  it('returns 404 for the other company user IDs', async () => {
    const res = await http().patch(`/users/${userB}`).set('authorization', `Bearer ${tokenA}`).send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
    const still = await db.selectFrom('platform.users').select('name').where('id', '=', userB).executeTakeFirstOrThrow();
    expect(still.name).toBe('Same Person');
  });
  it('lists only its own users and audit rows', async () => {
    const usersA = (await http().get('/users').set('authorization', `Bearer ${tokenA}`)).body as { id: string }[];
    expect(usersA.map((u) => u.id)).toContain(userA);
    expect(usersA.map((u) => u.id)).not.toContain(userB);
    const auditA = (await http().get('/audit').query({ limit: 500 }).set('authorization', `Bearer ${tokenA}`)).body as { entity_id: string; company_id: string }[];
    const companyA = (await db.selectFrom('platform.companies').select('id').where('slug', '=', COMPANY.slug).executeTakeFirstOrThrow()).id;
    expect(auditA.length).toBeGreaterThan(0);
    expect(auditA.every((r) => r.company_id === companyA)).toBe(true);
    expect(auditA.some((r) => r.entity_id === userB)).toBe(false);
  });
  it('a token whose company does not match its user is refused', async () => {
    // Even a correctly signed token cannot reach a user outside the token's company.
    const companyB = (await db.selectFrom('platform.companies').select('id').where('slug', '=', OTHER.slug).executeTakeFirstOrThrow()).id;
    const forged = await new JwtService({ secret: 'test-secret-test-secret-test-secret-42' }).signAsync({ sub: userA, cid: companyB });
    expect((await http().get('/auth/me').set('authorization', `Bearer ${forged}`)).status).toBe(401);
    expect((await http().get('/users').set('authorization', `Bearer ${tokenB}`)).body.map((u: { id: string }) => u.id)).not.toContain(userA);
  });
});

describe('AC3 database refuses rows without a company', () => {
  it('the app role sees zero rows when no company is set', async () => {
    const appDb = createDb(TEST_APP_DB_URL);
    try {
      for (const t of ['platform.users', 'platform.audit_log', 'platform.outbox', 'platform.companies', 'platform.company_locations']) {
        const { rows } = await sql<{ n: string }>`select count(*) as n from ${sql.raw(t)}`.execute(appDb);
        expect([t, Number(rows[0].n)]).toEqual([t, 0]);
      }
    } finally {
      await appDb.destroy();
    }
  });
  it('the app role cannot write a row into another company', async () => {
    const appDb = createDb(TEST_APP_DB_URL);
    const other = (await db.selectFrom('platform.companies').select('id').where('slug', '=', OTHER.slug).executeTakeFirstOrThrow()).id;
    const mine = (await db.selectFrom('platform.companies').select('id').where('slug', '=', COMPANY.slug).executeTakeFirstOrThrow()).id;
    try {
      await expect(
        appDb.transaction().execute(async (trx) => {
          await sql`select set_config('app.company_id', ${mine}, true)`.execute(trx);
          await sql`insert into platform.outbox (company_id, topic, payload) values (${other}, 'x', '{}')`.execute(trx);
        }),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await appDb.destroy();
    }
  });
  it('the app role is not a superuser and cannot bypass RLS', async () => {
    const { rows } = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`select rolsuper, rolbypassrls from pg_roles where rolname = 'wms_app'`.execute(db);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('Companies are created only by the owner', () => {
  it('the app role cannot create or delete companies', async () => {
    const appDb = createDb(TEST_APP_DB_URL);
    try {
      await expect(sql`insert into platform.companies (name, slug) values ('Evil', 'evil')`.execute(appDb)).rejects.toThrow(/permission denied/);
      await expect(sql`delete from platform.companies`.execute(appDb)).rejects.toThrow(/permission denied/);
    } finally {
      await appDb.destroy();
    }
  });
});

describe('AC4 schema guard', () => {
  it('every table with company_id has row-level security enabled and forced', async () => {
    const { rows } = await sql<{ table: string; rls: boolean; forced: boolean; policies: string }>`
      select n.nspname || '.' || c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and exists (
        select 1 from information_schema.columns col
        where col.table_schema = n.nspname and col.table_name = c.relname and col.column_name = 'company_id')`.execute(db);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) expect({ table: r.table, rls: r.rls, forced: r.forced, hasPolicy: Number(r.policies) > 0 }).toEqual({ table: r.table, rls: true, forced: true, hasPolicy: true });
  });
});

describe('Migration moves existing rows into the first company', () => {
  it('backfills a Phase 0 database into a "default" company', async () => {
    await sql`drop schema if exists intake cascade`.execute(db);
    await sql`drop schema if exists inventory cascade`.execute(db);
    await sql`drop schema if exists platform cascade`.execute(db);
    await sql`drop table if exists public.kysely_migration, public.kysely_migration_lock`.execute(db);
    await migrateTo(db, '0001_platform');
    await sql`insert into platform.users (email, name, password_hash, roles) values ('old@admin.test', 'Old', 'x', '{admin}')`.execute(db);
    await sql`insert into platform.audit_log (action, entity_type) values ('user.seeded_admin', 'user')`.execute(db);
    await migrateToLatest(db);
    const { rows } = await sql<{ slug: string; users: string; audits: string }>`
      select c.slug,
        (select count(*) from platform.users u where u.company_id = c.id) as users,
        (select count(*) from platform.audit_log a where a.company_id = c.id) as audits
      from platform.companies c`.execute(db);
    expect(rows).toEqual([{ slug: 'default', users: '1', audits: '1' }]);
  });
});
