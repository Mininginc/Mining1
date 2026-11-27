import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface CompaniesTable {
  id: Generated<string>;
  name: string;
  slug: string;
  home_state: Generated<string>;
  active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CompanyLocationsTable {
  id: Generated<string>;
  company_id: Generated<string>;
  name: string;
  state: string;
  address: string | null;
  created_at: Generated<Date>;
}

/** company_id defaults to the transaction's app.company_id (see withCompany). */
export interface UsersTable {
  id: Generated<string>;
  company_id: Generated<string>;
  email: string;
  name: string;
  password_hash: string;
  roles: string[];
  active: Generated<boolean>;
  mfa_secret: string | null;
  mfa_enabled: Generated<boolean>;
  failed_logins: Generated<number>;
  locked_until: Date | null;
  created_at: Generated<Date>;
  updated_at: Timestamp;
}

export interface AuditLogTable {
  id: Generated<string>;
  company_id: Generated<string>;
  at: Generated<Date>;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
  ip: string | null;
  request_id: string | null;
}

export interface OutboxTable {
  id: Generated<string>;
  company_id: Generated<string>;
  topic: string;
  payload: unknown;
  created_at: Generated<Date>;
  published_at: Date | null;
}

export interface Database extends ImportDatabase {
  'platform.companies': CompaniesTable;
  'platform.company_locations': CompanyLocationsTable;
  'platform.users': UsersTable;
  'platform.audit_log': AuditLogTable;
  'platform.outbox': OutboxTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export interface VehiclesTable {
  id: Generated<string>;
  company_id: Generated<string>;
  stock_number: string;
  vin: string | null;
  vin_valid: boolean | null;
  year: number | null;
  make: string | null;
  model: string | null;
  chassis_code: string | null;
  engine_code: string | null;
  transmission: string | null;
  color: string | null;
  m_sport: boolean | null;
  mileage: number | null;
  mileage_is_approximate: Generated<boolean>;
  title_in_hand: boolean | null;
  sold_complete: Generated<boolean>;
  purchased_on: string | null;
  purchase_cost_cents: string | number | null;
  tow_cost_cents: string | number | null;
  delivered_on: string | null;
  dismantled_on: string | null;
  first_listed_on: string | null;
  paid_off_on: string | null;
  opening_sales_cents: Generated<string | number>;
  source: 'spreadsheet' | 'manual';
  notes: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SourcesTable {
  id: Generated<string>;
  company_id: Generated<string>;
  code: string;
  name: string;
  kind: Generated<'supplier' | 'bulk' | 'other'>;
  opening_sales_cents: Generated<string | number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PartsTable {
  id: Generated<string>;
  company_id: Generated<string>;
  sku: string;
  vehicle_id: string | null;
  source_id: string | null;
  title: string;
  part_name: string | null;
  part_number: string | null;
  interchange_number: string | null;
  fitment_text: string | null;
  condition: string | null;
  quantity: number;
  status: 'pulled' | 'listed' | 'reserved' | 'sold' | 'returned' | 'liquidated';
  list_price_cents: string | number | null;
  photo_urls: Generated<string[]>;
  origin: 'ebay_import' | 'manual';
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ExternalListingsTable {
  id: Generated<string>;
  company_id: Generated<string>;
  provider: 'ebay';
  external_id: string;
  part_id: string | null;
  sku: string | null;
  title: string;
  url: string | null;
  currency: Generated<string>;
  price_cents: string | number | null;
  available_quantity: number;
  sold_quantity: number;
  status: 'active' | 'out_of_stock' | 'ended';
  category_name: string | null;
  category_id: string | null;
  condition: string | null;
  started_at: Date | null;
  ends_at: Date | null;
  raw: unknown;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ImportRunsTable {
  id: Generated<string>;
  company_id: Generated<string>;
  kind: 'car_sheet' | 'ebay_listings_csv';
  file_name: string | null;
  started_by: string | null;
  started_at: Generated<Date>;
  finished_at: Date | null;
  status: 'succeeded' | 'failed';
  counts: unknown;
  error: string | null;
}

export interface ImportIssuesTable {
  id: Generated<string>;
  company_id: Generated<string>;
  run_id: string;
  row_number: number | null;
  code: string;
  message: string;
  ref: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_at: Generated<Date>;
}

export interface ImportMappingsTable {
  id: Generated<string>;
  company_id: Generated<string>;
  kind: string;
  header_signature: string;
  mapping: unknown;
  updated_at: Generated<Date>;
}

export interface ImportDatabase {
  'intake.vehicles': VehiclesTable;
  'inventory.sources': SourcesTable;
  'inventory.parts': PartsTable;
  'platform.external_listings': ExternalListingsTable;
  'platform.import_runs': ImportRunsTable;
  'platform.import_issues': ImportIssuesTable;
  'platform.import_mappings': ImportMappingsTable;
}
