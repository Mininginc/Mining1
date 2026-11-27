import { Kysely, sql } from 'kysely';

/**
 * Spec 0.1 / ADR 0006: companies, company_id on every platform table, row-level security.
 * Every table that has company_id gets: a default from the request's `app.company_id`,
 * RLS enabled and FORCED, and one policy that only shows that company's rows.
 */
export const APP_ROLE = 'wms_app';

/** Company of the current transaction, or null when none is set. */
const CURRENT = sql.raw(`nullif(current_setting('app.company_id', true), '')::uuid`);

export async function protectTable(db: Kysely<unknown>, table: string): Promise<void> {
  const t = sql.raw(table);
  await sql`alter table ${t} alter column company_id set default ${CURRENT}`.execute(db);
  await sql`alter table ${t} enable row level security`.execute(db);
  await sql`alter table ${t} force row level security`.execute(db);
  await sql`create policy company_isolation on ${t} using (company_id = ${CURRENT}) with check (company_id = ${CURRENT})`.execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  // The API connects as this role: no superuser, no BYPASSRLS. Ops give it a password and LOGIN.
  await sql`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'wms_app') then
        create role wms_app nologin nosuperuser nobypassrls;
      end if;
    end $$`.execute(db);

  await sql`
    create table platform.companies (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
      home_state char(2) not null default 'CA',
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db);
  // A company row is only visible to itself.
  await sql`alter table platform.companies enable row level security`.execute(db);
  await sql`alter table platform.companies force row level security`.execute(db);
  await sql`create policy company_self on platform.companies using (id = ${CURRENT})`.execute(db);

  await sql`
    create table platform.company_locations (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references platform.companies(id),
      name text not null,
      state char(2) not null,
      address text,
      created_at timestamptz not null default now()
    )`.execute(db);
  await protectTable(db, 'platform.company_locations');

  // Existing rows move into one company (the first install has exactly one business).
  await sql`
    insert into platform.companies (name, slug)
    select 'Default company', 'default'
    where exists (select 1 from platform.users)`.execute(db);

  for (const table of ['platform.users', 'platform.audit_log', 'platform.outbox']) {
    const t = sql.raw(table);
    await sql`alter table ${t} add column company_id uuid references platform.companies(id)`.execute(db);
    // The audit log is append-only; allow this one backfill, then switch protection back on.
    if (table === 'platform.audit_log') await sql`alter table platform.audit_log disable trigger audit_log_no_change`.execute(db);
    await sql`update ${t} set company_id = (select id from platform.companies where slug = 'default')`.execute(db);
    if (table === 'platform.audit_log') await sql`alter table platform.audit_log enable trigger audit_log_no_change`.execute(db);
    await sql`alter table ${t} alter column company_id set not null`.execute(db);
    await protectTable(db, table);
  }

  await sql`drop index platform.users_email_lower_idx`.execute(db);
  await sql`create unique index users_company_email_idx on platform.users (company_id, lower(email))`.execute(db);
  await sql`create index audit_log_company_idx on platform.audit_log (company_id, id desc)`.execute(db);

  // Sign-in must find a company by slug before any company is set.
  // This function returns only the id of an active company, nothing else.
  await sql`
    create function platform.company_id_by_slug(p_slug text) returns uuid
    language sql stable security definer set search_path = pg_catalog, platform as $$
      select id from platform.companies where slug = lower(p_slug) and active
    $$`.execute(db);
  await sql`revoke all on function platform.company_id_by_slug(text) from public`.execute(db);

  await sql`grant usage on schema platform to wms_app`.execute(db);
  await sql`grant select, insert, update, delete on all tables in schema platform to wms_app`.execute(db);
  await sql`grant usage, select on all sequences in schema platform to wms_app`.execute(db);
  await sql`grant execute on function platform.company_id_by_slug(text) to wms_app`.execute(db);
  // Companies are created and removed only by the owner (seed / platform operator), never by the API.
  await sql`revoke insert, delete on platform.companies from wms_app`.execute(db);
  await sql`alter default privileges in schema platform grant select, insert, update, delete on tables to wms_app`.execute(db);
  await sql`alter default privileges in schema platform grant usage, select on sequences to wms_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  throw new Error('0002_multi_company cannot be rolled back automatically; restore from backup');
}
