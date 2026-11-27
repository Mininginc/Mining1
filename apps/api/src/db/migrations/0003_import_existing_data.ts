import { Kysely, sql } from 'kysely';
import { protectTable } from './0002_multi_company.js';

/** Spec 1.1: vehicles (M2), parts and sources (M4), external listings and import runs (M1). */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create schema if not exists intake`.execute(db);
  await sql`create schema if not exists inventory`.execute(db);

  await sql`
    create table intake.vehicles (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references platform.companies(id),
      stock_number text not null,
      vin text,
      vin_valid boolean,
      year smallint,
      make text,
      model text,
      chassis_code text,
      engine_code text,
      transmission text,
      color text,
      m_sport boolean,
      mileage integer check (mileage is null or mileage >= 0),
      mileage_is_approximate boolean not null default false,
      title_in_hand boolean,
      sold_complete boolean not null default false,
      purchased_on date,
      purchase_cost_cents bigint,
      tow_cost_cents bigint,
      delivered_on date,
      dismantled_on date,
      first_listed_on date,
      paid_off_on date,
      opening_sales_cents bigint not null default 0,
      source text not null check (source in ('spreadsheet', 'manual')),
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (company_id, stock_number)
    )`.execute(db);
  await sql`create index vehicles_vin_idx on intake.vehicles (company_id, vin)`.execute(db);
  await protectTable(db, 'intake.vehicles');

  await sql`
    create table inventory.sources (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references platform.companies(id),
      code text not null,
      name text not null,
      kind text not null default 'other' check (kind in ('supplier', 'bulk', 'other')),
      opening_sales_cents bigint not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db);
  await sql`create unique index sources_code_idx on inventory.sources (company_id, lower(code))`.execute(db);
  await protectTable(db, 'inventory.sources');

  await sql`
    create table inventory.parts (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references platform.companies(id),
      sku text not null,
      vehicle_id uuid,
      source_id uuid references inventory.sources(id),
      title text not null,
      part_name text,
      part_number text,
      interchange_number text,
      fitment_text text,
      condition text,
      quantity integer not null default 1 check (quantity >= 0),
      status text not null check (status in ('pulled', 'listed', 'reserved', 'sold', 'returned', 'liquidated')),
      list_price_cents bigint,
      photo_urls text[] not null default '{}',
      origin text not null check (origin in ('ebay_import', 'manual')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db);
  await sql`create index parts_vehicle_idx on inventory.parts (company_id, vehicle_id)`.execute(db);
  await sql`create index parts_sku_idx on inventory.parts (company_id, sku)`.execute(db);
  await protectTable(db, 'inventory.parts');

  await sql`
    create table platform.external_listings (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references platform.companies(id),
      provider text not null check (provider in ('ebay')),
      external_id text not null,
      part_id uuid,
      sku text,
      title text not null,
      url text,
      currency char(3) not null default 'USD',
      price_cents bigint,
      available_quantity integer not null default 0,
      sold_quantity integer not null default 0,
      status text not null check (status in ('active', 'out_of_stock', 'ended')),
      category_name text,
      category_id text,
      condition text,
      started_at timestamptz,
      ends_at timestamptz,
      raw jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (company_id, provider, external_id)
    )`.execute(db);
  await protectTable(db, 'platform.external_listings');

  await sql`
    create table platform.import_runs (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references platform.companies(id),
      kind text not null check (kind in ('car_sheet', 'ebay_listings_csv')),
      file_name text,
      started_by uuid,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      status text not null check (status in ('succeeded', 'failed')),
      counts jsonb not null default '{}',
      error text
    )`.execute(db);
  await protectTable(db, 'platform.import_runs');

  await sql`
    create table platform.import_issues (
      id bigserial primary key,
      company_id uuid not null references platform.companies(id),
      run_id uuid not null references platform.import_runs(id),
      row_number integer,
      code text not null,
      message text not null,
      ref text,
      resolved_at timestamptz,
      resolved_by uuid,
      created_at timestamptz not null default now()
    )`.execute(db);
  await sql`create index import_issues_open_idx on platform.import_issues (company_id, run_id) where resolved_at is null`.execute(db);
  await protectTable(db, 'platform.import_issues');

  await sql`
    create table platform.import_mappings (
      id uuid primary key default gen_random_uuid(),
      company_id uuid not null references platform.companies(id),
      kind text not null,
      header_signature text not null,
      mapping jsonb not null,
      updated_at timestamptz not null default now(),
      unique (company_id, kind, header_signature)
    )`.execute(db);
  await protectTable(db, 'platform.import_mappings');

  for (const schema of ['intake', 'inventory']) {
    const s = sql.raw(schema);
    await sql`grant usage on schema ${s} to wms_app`.execute(db);
    await sql`grant select, insert, update, delete on all tables in schema ${s} to wms_app`.execute(db);
    await sql`alter default privileges in schema ${s} grant select, insert, update, delete on tables to wms_app`.execute(db);
  }
  await sql`grant select, insert, update, delete on all tables in schema platform to wms_app`.execute(db);
  await sql`grant usage, select on all sequences in schema platform to wms_app`.execute(db);
  await sql`revoke insert, delete on platform.companies from wms_app`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists platform.import_mappings, platform.import_issues, platform.import_runs, platform.external_listings`.execute(db);
  await sql`drop schema if exists inventory cascade`.execute(db);
  await sql`drop schema if exists intake cascade`.execute(db);
}
