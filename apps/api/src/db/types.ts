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

export interface Database {
  'platform.companies': CompaniesTable;
  'platform.company_locations': CompanyLocationsTable;
  'platform.users': UsersTable;
  'platform.audit_log': AuditLogTable;
  'platform.outbox': OutboxTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
