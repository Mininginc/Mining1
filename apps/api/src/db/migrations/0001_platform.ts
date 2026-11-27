import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db);
  await sql`create schema if not exists platform`.execute(db);

  await sql`
    create table platform.users (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      name text not null,
      password_hash text not null,
      roles text[] not null default '{}',
      active boolean not null default true,
      mfa_secret text,
      mfa_enabled boolean not null default false,
      failed_logins integer not null default 0,
      locked_until timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db);
  await sql`create unique index users_email_lower_idx on platform.users (lower(email))`.execute(db);

  await sql`
    create table platform.audit_log (
      id bigserial primary key,
      at timestamptz not null default now(),
      actor_id uuid,
      action text not null,
      entity_type text not null,
      entity_id text,
      before jsonb,
      after jsonb,
      ip text,
      request_id text
    )`.execute(db);
  await sql`create index audit_log_entity_idx on platform.audit_log (entity_type, entity_id, at desc)`.execute(db);
  // Append-only: block updates and deletes at the database level.
  await sql`
    create function platform.audit_log_immutable() returns trigger language plpgsql as $$
    begin
      raise exception 'audit_log is append-only';
    end $$`.execute(db);
  await sql`
    create trigger audit_log_no_change before update or delete on platform.audit_log
    for each row execute function platform.audit_log_immutable()`.execute(db);

  await sql`
    create table platform.outbox (
      id bigserial primary key,
      topic text not null,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      published_at timestamptz
    )`.execute(db);
  await sql`create index outbox_unpublished_idx on platform.outbox (id) where published_at is null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop schema if exists platform cascade`.execute(db);
}
